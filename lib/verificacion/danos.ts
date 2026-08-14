import type { PoolClient } from 'pg'
import { alcanzables, cargarCuenca, perdidas } from '@/lib/alcance'
import type { TemporadaActual } from '@/lib/matching/tipos'

/**
 * From a damage report to the leg it might have closed.
 *
 * Section 9.3, and it is a rule about who decides rather than about plumbing: «la
 * desactivación de rutas la hace una persona, no el reporte. El daño llega, el coordinador
 * lo verifica, y ahí se desactiva el tramo. Un solo reporte falso o exagerado no puede»
 * close a river to a whole basin.
 *
 * So nothing here deactivates anything. It answers the question a verifier has in front of
 * them — «bajó una palizada y tapó el paso antes de Tagachí», which leg is that? — and hands
 * them the route editor's existing confirmation, which names what closing it costs and
 * records who decided.
 */

export type RutaAfectada = {
  id: string
  origen: string
  destino: string
  modo: string
  temporada: string
  minutos: number | null
  /** Communities that would lose every way in if this leg closed. */
  dejaSinPaso: string[]
}

/**
 * Legs touching the community a damage report came from.
 *
 * Both directions, because a slide blocks the channel rather than a heading. Only legs that
 * apply this season and are still open — offering to close what is already closed is noise
 * on a screen that exists to be read quickly.
 */
export async function rutasAfectadasPor(
  client: PoolClient,
  reporteId: string,
  temporada: TemporadaActual,
): Promise<RutaAfectada[]> {
  const { rows } = await client.query<{
    id: string
    origen: string
    destino: string
    modo: string
    temporada: string
    minutos: number | null
  }>(
    `select r.id, o.nombre as origen, d.nombre as destino, r.modo, r.temporada, r.minutos
       from rutas r
       join comunidades o on o.id = r.origen_id
       join comunidades d on d.id = r.destino_id
      where r.activa
        and r.temporada in ('todo_el_ano', $2)
        and (
          r.origen_id = (select comunidad_id from reportes where id = $1)
          or r.destino_id = (select comunidad_id from reportes where id = $1)
        )
      order by o.nombre, d.nombre`,
    [reporteId, temporada],
  )

  if (rows.length === 0) return []

  // The consequence is computed the same way the route editor computes it, so the warning a
  // verifier reads here is the warning they will see on the confirmation page.
  const cuenca = await cargarCuenca(client)
  const antes = alcanzables(cuenca, temporada)

  return rows.map((r) => ({
    id: r.id,
    origen: r.origen,
    destino: r.destino,
    modo: r.modo,
    temporada: r.temporada,
    minutos: r.minutos,
    dejaSinPaso: perdidas(cuenca, antes, alcanzables(cuenca, temporada, { sinRuta: r.id })),
  }))
}
