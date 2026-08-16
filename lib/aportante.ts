import { getPool } from '@/db/client'
import type { Modo } from '@/db/schema/vocabulario'
import { conSesion, type SesionStaff } from '@/lib/sesion'

/**
 * FR-18 (§29.3b) — the supply-side transporter.
 *
 * A transporter who only OFFERS capacity is aportante-shaped: near-immediate, touches no community
 * data, never sees a household address. This module is the application side of migration 0051 —
 * the self-signup that lands a person as an aportante, and the reading and writing of their own
 * transport-capacity offers. The address boundary is the database's (RLS in 0017/0047); this code
 * only ever reaches it through the signed-in `authenticated` role, exactly like the rest of the
 * panel.
 */

/**
 * Links a freshly-proven session to an aportante staff record. The aportante analogue of
 * `vincularStaff` (lib/sesion.ts): possession is proven by the time this runs (the caller holds a
 * Better Auth session), so `convite_autoregistrar_aportante()` writes the person their own
 * aportante organisation (empty ceiling — no addresses, no community reach) and a `lectura` staff
 * row. If they are already staff it no-ops (`ya_existe`) rather than downgrading them.
 *
 * Kept separate from `vincularStaff` on purpose: the default open sign-in lands an uninvited
 * person as a home-org admin, which is exactly what a self-signed transporter must NOT become.
 */
export async function vincularAportante(sesion: {
  authId: string
  correo: string
  telefono?: string | null
}): Promise<'creado' | 'ya_existe' | 'sin_sesion'> {
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
    const { rows } = await client.query<{ convite_autoregistrar_aportante: string }>(
      'select convite_autoregistrar_aportante()',
    )
    await client.query('commit')
    return (rows[0]?.convite_autoregistrar_aportante ?? 'sin_sesion') as 'creado'
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/** A transport-capacity offer as the aportante sees their own. */
export type OfertaTransporte = {
  id: string
  modo: string
  areaCobertura: string
  cupoFamilias: number
  disponibleDesde: string | null
  disponibleHasta: string | null
  notas: string | null
  estado: string
  creadoEn: string
}

/** The caller's own standing transport-capacity offers, newest first. */
export async function misOfertasTransporte(sesion: SesionStaff): Promise<OfertaTransporte[]> {
  return conSesion(sesion, async (client) => {
    const { rows } = await client.query<{
      id: string
      modo: string
      area_cobertura: string
      cupo_familias: number
      disponible_desde: Date | null
      disponible_hasta: Date | null
      notas: string | null
      estado: string
      creado_en: Date
    }>(
      `select id, modo, area_cobertura, cupo_familias, disponible_desde, disponible_hasta,
              notas, estado, creado_en
         from ofertas_transporte
        where usuario_id = $1
        order by creado_en desc`,
      [sesion.authId],
    )
    return rows.map((r) => ({
      id: r.id,
      modo: r.modo,
      areaCobertura: r.area_cobertura,
      cupoFamilias: Number(r.cupo_familias),
      disponibleDesde: r.disponible_desde ? r.disponible_desde.toISOString() : null,
      disponibleHasta: r.disponible_hasta ? r.disponible_hasta.toISOString() : null,
      notas: r.notas,
      estado: r.estado,
      creadoEn: r.creado_en.toISOString(),
    }))
  })
}

export type NuevaOfertaTransporte = {
  modo: Modo
  areaCobertura: string
  cupoFamilias: number
  notas?: string | null
}

/**
 * Records a transport-capacity offer for the signed-in aportante. The insert is bounded by the
 * `ofertas_transporte_propias` policy (usuario_id = auth.uid()), so it can only ever write the
 * caller's own row — the capacity-offer ability FR-18 grants, available to a plain `lectura`
 * self-signed transporter because it is keyed to identity, not to a PII role.
 */
export async function crearOfertaTransporte(
  sesion: SesionStaff,
  datos: NuevaOfertaTransporte,
): Promise<void> {
  await conSesion(
    sesion,
    async (client) => {
      await client.query(
        `insert into ofertas_transporte
           (usuario_id, organizacion_id, modo, area_cobertura, cupo_familias, notas)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          sesion.authId,
          sesion.organizacionId,
          datos.modo,
          datos.areaCobertura,
          datos.cupoFamilias,
          datos.notas ?? null,
        ],
      )
    },
    { escribe: true },
  )
}
