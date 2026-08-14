import type { PoolClient } from 'pg'
import { getPool } from '@/db/client'
import { clienteServidor, type SesionStaff } from '@/lib/supabase/servidor'

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
 */

export async function sesionActual(): Promise<SesionStaff | null> {
  const supabase = await clienteServidor()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  // The staff record is read with the owner role: a session with no `usuarios` row has no
  // access to `usuarios` either, so it could never discover that it is not staff.
  const { rows } = await getPool().query<{ rol_staff: string; organizacion_id: string }>(
    'select rol_staff, organizacion_id from usuarios where id = $1 and activo',
    [user.id],
  )
  const fila = rows[0]
  if (!fila) return null

  return {
    authId: user.id,
    correo: user.email ?? '',
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
 * Links a fresh magic-link sign-in to its staff record, if an admin invited that address.
 * Returns what happened so the callback can say something useful rather than dumping the
 * person on an empty screen.
 */
export async function vincularStaff(sesion: {
  authId: string
  correo: string
}): Promise<'creado' | 'ya_existe' | 'sin_invitacion' | 'sin_sesion'> {
  const client = await getPool().connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: sesion.authId, role: 'authenticated', email: sesion.correo }),
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
