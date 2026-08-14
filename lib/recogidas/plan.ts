import type { PoolClient } from 'pg'

/**
 * The first mile: collecting scattered donations in town into one node.
 *
 * A different problem from delivery, and the one place where road distance is genuinely the
 * right measure — a straight line across Quibdó means something, while five kilometres on
 * the Atrato can be ninety minutes upriver (Section 7.3, 9.5). What it is *not* is a browser
 * problem: 0017 revoked `ofertas.ubicacion` from `authenticated`, so the coordinates never
 * leave Postgres and the clustering happens there (`recogidas_sugeridas`, migration 0020).
 *
 * The output is one ordered run, not a list of errands. Neighbourhoods are visited
 * perishables first — cooked lunches for tomorrow set the departure time for the whole trip,
 * not just for their own stop (2.15) — and nearest-first after that.
 */

/** How far from the node an offer can sit and still belong to its run, in metres. */
export const ALCANCE_RECOGIDA_M = 5_000

/**
 * How close two offers must be to count as the same neighbourhood, in metres.
 *
 * Quibdó's barrios are a few hundred metres across, so 400 m groups a block without welding
 * the whole town into one cluster. It is a parameter rather than a constant because the next
 * town this runs in will not be this one.
 */
export const RADIO_BARRIO_M = 400

export type Parada = {
  orden: number
  /** Neighbourhood, numbered in visiting order. Stops sharing one are collected together. */
  grupo: number
  ofertaId: string
  metrosAlNodo: number
  perecedero: boolean
  venceEn: Date | null
  ofrecidoPor: string | null
  textoOriginal: string
  item: string | null
  cantidad: number | null
  unidad: string | null
  /**
   * Only ever populated for a coordinator planning the run or the driver assigned to it —
   * it comes through `direccion_de_oferta()`, which is the one door 2.16 leaves open.
   */
  direccion: string | null
}

export type PlanRecogida = {
  paradas: Parada[]
  /** Number of neighbourhoods the run passes through. */
  grupos: number
}

export async function planearRecogida(
  client: PoolClient,
  nodoId: string,
  opciones: { radioBarrioM?: number; alcanceM?: number } = {},
): Promise<PlanRecogida> {
  const { rows } = await client.query<{
    orden: number
    grupo: number
    oferta_id: string
    metros_al_nodo: number
    perecedero: boolean
    vence_en: Date | null
    ofrecido_por: string | null
    texto_original: string
    item_label: string | null
    cantidad: number | null
    unidad: string | null
    direccion: string | null
  }>(
    `select rs.orden, rs.grupo, rs.oferta_id, rs.metros_al_nodo, rs.perecedero, rs.vence_en,
            ct.nombre as ofrecido_por, o.texto_original, ci.item_label,
            o.cantidad, o.unidad, d.direccion_texto as direccion
       from recogidas_sugeridas($1, $2, $3) rs
       join ofertas o on o.id = rs.oferta_id
       join contactos ct on ct.id = o.contacto_id
       left join catalogo_items ci on ci.codigo = o.codigo_item
       left join lateral direccion_de_oferta(o.id) d on true
      order by rs.orden`,
    [nodoId, opciones.radioBarrioM ?? RADIO_BARRIO_M, opciones.alcanceM ?? ALCANCE_RECOGIDA_M],
  )

  const paradas: Parada[] = rows.map((r) => ({
    orden: r.orden,
    grupo: r.grupo,
    ofertaId: r.oferta_id,
    metrosAlNodo: r.metros_al_nodo,
    perecedero: r.perecedero,
    venceEn: r.vence_en,
    ofrecidoPor: r.ofrecido_por,
    textoOriginal: r.texto_original,
    item: r.item_label,
    cantidad: r.cantidad,
    unidad: r.unidad,
    direccion: r.direccion,
  }))

  return { paradas, grupos: new Set(paradas.map((p) => p.grupo)).size }
}

export type NodoRecogida = { id: string; nombre: string; comunidad: string; ubicado: boolean }

/** Nodes a run can be planned into. One without a location cannot anchor distances. */
export async function nodosParaRecogida(client: PoolClient): Promise<NodoRecogida[]> {
  const { rows } = await client.query<NodoRecogida>(
    `select n.id, n.nombre, c.nombre as comunidad, n.ubicacion is not null as ubicado
       from nodos n
       join comunidades c on c.id = n.comunidad_id
      where n.activo
      order by n.ubicacion is null, n.nombre`,
  )
  return rows
}
