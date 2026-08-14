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

export type ConfirmacionAmbigua = {
  comunidad: string
  codigo: string
  entregas: number
  envios: string[]
}

/**
 * Codes that cannot be resolved, found before somebody tries to use one.
 *
 * `confirmarConCodigo` matches four digits against the deliveries the caller's community is
 * waiting for. Two open deliveries in one community sharing a code makes that unanswerable —
 * the channel replies that it could not tell which one, and then nothing happens: no row
 * changes, no job fails, no alert fires. From the board it looks exactly like a community
 * that never confirmed, which is the failure this whole screen exists to catch.
 *
 * Dispatch now avoids codes already outstanding in a destination, so this should stay empty.
 * It is checked anyway, because it also covers rows written before that and rows written by
 * hand — and because a guarantee nobody verifies is a guarantee that quietly stops holding.
 */
export async function confirmacionesAmbiguas(
  client: PoolClient,
): Promise<ConfirmacionAmbigua[]> {
  const { rows } = await client.query<{
    comunidad: string
    codigo: string
    entregas: string
    envios: string[]
  }>(
    `select c.nombre as comunidad, e.codigo_confirmacion as codigo,
            count(*)::text as entregas, array_agg(en.codigo order by en.codigo) as envios
       from entregas e
       join pedidos p on p.id = e.pedido_id
       join comunidades c on c.id = p.comunidad_id
       join envios en on en.id = e.envio_id
      where not e.confirmado
      group by c.nombre, e.codigo_confirmacion
     having count(*) > 1
      order by count(*) desc, c.nombre`,
  )

  return rows.map((r) => ({
    comunidad: r.comunidad,
    codigo: r.codigo,
    entregas: Number(r.entregas),
    envios: r.envios,
  }))
}
