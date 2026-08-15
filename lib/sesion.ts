import { headers } from 'next/headers'
import type { PoolClient } from 'pg'
import { getPool } from '@/db/client'
import { autenticacionConfigurada, getAuth } from '@/lib/auth'

/**
 * Reading data as the signed-in person.
 *
 * Every query the coordinator UI makes runs inside a transaction that has assumed the
 * `authenticated` role and carries the user's JWT claims, so the RLS policies in
 * db/migrations/0017 apply exactly as they do in the tests. There is no path in this
 * codebase that reads domain data with the owner role on behalf of a human — if a policy is
 * wrong, the screen goes empty, which is the correct direction to fail.
 *
 * Section 11: `rol_staff` gates the UI, RLS gates the data. This is the second half.
 *
 * Identity comes from Better Auth on our own Postgres (lib/auth.ts). Only the first two
 * lines of `sesionActual` know that; everything below — the claims, the role, the policies
 * — is the same machinery it has always been.
 */

/**
 * A path we are willing to send somebody to after they sign in, or null.
 *
 * `desde` is carried across a sign-in — the middleware puts the page you were trying to
 * reach into the redirect, and it comes back through the form. That makes it attacker-
 * controlled, which is how «redirect back where you were» becomes an open redirect and
 * then a convincing phishing link that genuinely starts at our domain.
 *
 * Leading-slash alone is not enough, and this is the whole reason this function exists:
 * `//evil.example` starts with `/` and is a protocol-relative URL, so
 * `new URL('//evil.example', 'https://convite…')` resolves to `https://evil.example`. A
 * backslash does the same in some parsers. Only a single slash followed by something that
 * is not a slash or a backslash is a path on this site.
 */
export function rutaInterna(valor: string): string | null {
  if (!valor.startsWith('/')) return null
  if (valor.startsWith('//') || valor.startsWith('/\\')) return null
  return valor
}

/** Who is signed in, and what they are allowed to be. */
export type SesionStaff = {
  /** The Better Auth user id. A uuid, because `usuarios.id` is one — see lib/auth.ts. */
  authId: string
  correo: string
  /**
   * E.164 when they came in over WhatsApp, null when they used the emailed link.
   *
   * Carried because `vincular_usuario_staff()` has to find the invitation by whichever
   * identifier the person actually proved. A phone sign-in's `correo` is a placeholder that
   * matches nothing on the allowlist by design, so without this the WhatsApp door would
   * always answer «sin invitación».
   */
  telefono: string | null
  rolStaff: string
  organizacionId: string
}

/**
 * What to call somebody on screen.
 *
 * A WhatsApp sign-in has no real address — `auth_user.correo` holds a placeholder ending in
 * `.invalid`, because Better Auth requires an email on every user and this one never gave us
 * one. Showing that to a coordinator would be showing them a made-up address as their own
 * identity, which is both confusing and slightly alarming. They gave us a number; show the
 * number.
 */
export function identidadVisible(sesion: SesionStaff): string {
  return sesion.telefono ?? sesion.correo
}

export async function sesionActual(): Promise<SesionStaff | null> {
  if (!autenticacionConfigurada()) return null

  const sesion = await getAuth().api.getSession({ headers: await headers() })
  if (!sesion?.user) return null

  // The staff record is read with the owner role: a session with no `usuarios` row has no
  // access to `usuarios` either, so it could never discover that it is not staff.
  const { rows } = await getPool().query<{ rol_staff: string; organizacion_id: string }>(
    'select rol_staff, organizacion_id from usuarios where id = $1 and activo',
    [sesion.user.id],
  )
  const fila = rows[0]
  if (!fila) return null

  return {
    authId: sesion.user.id,
    correo: sesion.user.email,
    telefono: (sesion.user as { phoneNumber?: string | null }).phoneNumber ?? null,
    rolStaff: fila.rol_staff,
    organizacionId: fila.organizacion_id,
  }
}

/**
 * Runs `fn` against Postgres as the signed-in user, with RLS in force.
 *
 * Read-only by default and rolled back at the end; pass `escribe: true` for a mutation, and
 * remember that a mutation still has to satisfy the policies.
 */
export async function conSesion<T>(
  sesion: SesionStaff,
  fn: (client: PoolClient) => Promise<T>,
  opciones: { escribe?: boolean } = {},
): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({
        sub: sesion.authId,
        role: 'authenticated',
        email: sesion.correo,
        // Additive. No policy in 0017 reads it — they compare `auth.uid()` and
        // `convite_rol()` — so the RLS contract is unchanged by its presence. Only
        // `vincular_usuario_staff()` looks at it, and only to find the invitation.
        ...(sesion.telefono ? { telefono: sesion.telefono } : {}),
      }),
    ])
    await client.query('set local role authenticated')
    const resultado = await fn(client)
    await client.query(opciones.escribe ? 'commit' : 'rollback')
    return resultado
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/**
 * Links a fresh sign-in to its staff record, if an admin invited that address or that number.
 * Returns what happened so the caller can say something useful rather than dumping the person
 * on an empty screen.
 *
 * `ya_vinculada` is the one to know about: the invitation was already spent by the *other*
 * door. One human invited with both an address and a number gets two different Better Auth
 * identities if they use both, and letting the second one through would quietly write a second
 * `usuarios` row — two staff records, two audit trails, one person. It refuses instead (0029).
 */
export async function vincularStaff(sesion: {
  authId: string
  correo: string
  telefono?: string | null
}): Promise<'creado' | 'ya_existe' | 'sin_invitacion' | 'ya_vinculada' | 'sin_sesion'> {
  const client = await getPool().connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({
        sub: sesion.authId,
        role: 'authenticated',
        email: sesion.correo,
        ...(sesion.telefono ? { telefono: sesion.telefono } : {}),
      }),
    ])
    await client.query('set local role authenticated')
    const { rows } = await client.query<{ vincular_usuario_staff: string }>(
      'select vincular_usuario_staff()',
    )
    await client.query('commit')
    return (rows[0]?.vincular_usuario_staff ?? 'sin_sesion') as 'creado'
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
