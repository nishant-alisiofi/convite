import type { PoolClient } from 'pg'
import type { SesionStaff } from '@/lib/sesion'

/**
 * What the field surface (/campo) can show, and to whom.
 *
 * The panel is a laptop product — `app/(panel)/layout.tsx` says so outright: «works on a laptop
 * over a weak connection». That is the right target for a coordinator at a desk and the wrong one
 * for the people who touch this product occasionally and only ever from a phone: somebody minding
 * an acopio, a transporter between runs, somebody reporting on behalf of a community.
 *
 * /campo is for them. It is not a second product and not a mobile skin of the panel — it is the
 * two or three things those people actually do, big enough to hit with a thumb.
 *
 * **Stock is signed-in only, and scoped by RLS.** Founder decision (2026-08-21): an acopio worker
 * sees their own node's stock. It is deliberately NOT shown to reporters or to any account-less
 * surface — v3 principle 6 is «inventory is never a promise» and principle 8 is «show less in
 * public, on purpose». Telling a community that 40 bidones sit at Tagachí, on a channel with no
 * account and no follow-up, promises an outcome nobody has agreed to deliver. That is the
 * reportante-facing e-Catalog question, still open in the work items, and this does not answer it.
 */

/** Roles that may read stock: the desks that actually handle goods. */
const VEN_EXISTENCIAS = ['despachador', 'coordinador', 'admin']
/** Roles that may write a need. Mirrors /manual's own gate — the same write, a smaller screen. */
const REPORTAN = ['verificador', 'coordinador', 'admin']

export function puedeVerExistencias(sesion: Pick<SesionStaff, 'rolStaff'>): boolean {
  return VEN_EXISTENCIAS.includes(sesion.rolStaff)
}

export function puedeReportar(sesion: Pick<SesionStaff, 'rolStaff'>): boolean {
  return REPORTAN.includes(sesion.rolStaff)
}

export type ExistenciaNodo = {
  nodoId: string
  nodo: string
  comunidad: string
  item: string
  cantidad: number
  unidad: string | null
  /** Days since somebody counted. Non-negotiable 2.3: a count without its age is a rumour. */
  diasDesdeConteo: number | null
}

/**
 * Stock per node, as a flat list a phone can scroll.
 *
 * Carries `diasDesdeConteo` on every row and the screen always prints it. A number with no date
 * is exactly the false certainty 2.3 exists to prevent — «40 bidones» read on a phone at the
 * muelle is acted on immediately, and whether it was counted yesterday or in April is the whole
 * difference between a dispatch and a wasted trip.
 */
export async function existenciasVisibles(client: PoolClient): Promise<ExistenciaNodo[]> {
  const { rows } = await client.query<{
    nodo_id: string
    nodo: string
    comunidad: string
    item: string
    cantidad: string
    unidad: string | null
    dias: number | null
  }>(
    `select n.id as nodo_id, n.nombre as nodo, c.nombre as comunidad,
            ci.item_label as item, e.cantidad,
            case when e.cantidad = 1 then ci.unidad_singular else ci.unidad_plural end as unidad,
            extract(day from now() - e.contado_en)::int as dias
       from existencias e
       join nodos n on n.id = e.nodo_id
       join comunidades c on c.id = n.comunidad_id
       join catalogo_items ci on ci.codigo = e.codigo_item
      where n.activo and e.cantidad > 0
      order by n.nombre, ci.item_label`,
  )
  return rows.map((r) => ({
    nodoId: r.nodo_id,
    nodo: r.nodo,
    comunidad: r.comunidad,
    item: r.item,
    cantidad: Number(r.cantidad),
    unidad: r.unidad,
    diasDesdeConteo: r.dias,
  }))
}
