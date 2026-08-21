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
  /** So a «pedir más» from this row can seed a report against the right community. */
  comunidadId: string
  codigoItem: string
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
    comunidad_id: string
    codigo_item: string
    item: string
    cantidad: string
    unidad: string | null
    dias: number | null
  }>(
    `select n.id as nodo_id, n.nombre as nodo, c.nombre as comunidad, c.id as comunidad_id,
            e.codigo_item,
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
    comunidadId: r.comunidad_id,
    codigoItem: r.codigo_item,
    item: r.item,
    cantidad: Number(r.cantidad),
    unidad: r.unidad,
    diasDesdeConteo: r.dias,
  }))
}

/**
 * Whether this session is a transporter rather than centre staff.
 *
 * A self-registered transporter (FR-18) gets their own one-person organisation, `aprobada` on
 * creation, with `nivel_admision = 'aportante'` and a `lectura` role. `aprobada` means
 * `panelBloqueado` lets them into the panel shell — so they can already reach pages built for
 * coordinators, where RLS correctly gives them nothing and they see an empty screen with no
 * explanation. That is a UX leak, not a data leak, and it is worth closing separately.
 *
 * The tier is what distinguishes them, not the role: a centre may also invite somebody as
 * `lectura`, and that person IS staff of a real organisation.
 */
export function esTransportista(
  sesion: Pick<SesionStaff, 'nivelAdmision' | 'rolStaff' | 'esPlataforma'>,
): boolean {
  if (sesion.esPlataforma) return false
  return sesion.nivelAdmision === 'aportante' && sesion.rolStaff === 'lectura'
}

export type ParadaViaje = { comunidadId: string; comunidad: string; municipio: string | null }
export type ViajeActivo = {
  envioId: string
  codigo: string
  estado: string
  /** What dispatch wrote on the order — including «while you are there, ask about…». */
  notas: string | null
  paradas: ParadaViaje[]
}

/**
 * The transporter's live run, or null.
 *
 * Every row here is already reachable to them by policy — `envio_items_transportista`,
 * `pedidos_transportista` and `comunidades_transportista` (0025) all key off
 * `convite_conduce_hacia`, which holds only while the envío is theirs AND out and not yet back.
 * So this query states no rule of its own; it reads what the window already permits, and stops
 * returning rows the moment the trip closes.
 *
 * `notas` is the dispatch instruction. It is the cheapest possible task channel — a coordinator
 * writes «pregunte en Tagachí si llegó el agua» on the order, and the driver reads it standing
 * there — and it needed no new column, because despatch has always had somewhere to write.
 */
export async function viajeActivo(client: PoolClient): Promise<ViajeActivo | null> {
  const { rows } = await client.query<{
    envio_id: string
    codigo: string
    estado: string
    notas: string | null
    comunidad_id: string
    comunidad: string
    municipio: string | null
  }>(
    `select e.id as envio_id, e.codigo, e.estado, e.notas,
            c.id as comunidad_id, c.nombre as comunidad, c.municipio
       from envios e
       join envio_items ei on ei.envio_id = e.id
       join pedidos p on p.id = ei.pedido_id
       join comunidades c on c.id = p.comunidad_id
      where e.estado in ('DESPACHADO', 'EN_RUTA')
      order by c.nombre`,
  )
  const primera = rows[0]
  if (!primera) return null

  const vistas = new Set<string>()
  const paradas: ParadaViaje[] = []
  for (const r of rows) {
    if (vistas.has(r.comunidad_id)) continue
    vistas.add(r.comunidad_id)
    paradas.push({ comunidadId: r.comunidad_id, comunidad: r.comunidad, municipio: r.municipio })
  }

  return {
    envioId: primera.envio_id,
    codigo: primera.codigo,
    estado: primera.estado,
    notas: primera.notas,
    paradas,
  }
}

/**
 * File a report from the community the caller is currently delivering to (migration 0067).
 *
 * Deliberately a different function from `registrarReporteManual`: that one is verification-desk
 * work and demands the community belong to the caller's own organisation, which is never true for
 * a transporter. This one is gated by the live trip instead, and writes into the *community's*
 * organisation — a report filed into a one-person aportante org would sit where no coordinator
 * looks.
 */
export async function registrarReporteDesdeViaje(
  client: PoolClient,
  args: {
    comunidadId: string
    codigoItem?: string | null
    familias?: number | null
    detalle?: string | null
  },
): Promise<{ ok: true; folio: number } | { ok: false; error: string }> {
  const detalle = (args.detalle ?? '').trim() || null
  const codigoItem = (args.codigoItem ?? '').trim() || null
  if (!args.comunidadId) return { ok: false, error: 'Falta la comunidad.' }
  if (!codigoItem && !detalle) {
    return { ok: false, error: 'Diga qué le contaron: elija un ítem o escríbalo.' }
  }
  try {
    const { rows } = await client.query<{ folio: number }>(
      `select folio from registrar_reporte_transportista($1, $2, $3, null, $4, null)`,
      [args.comunidadId, codigoItem, args.familias ?? null, detalle],
    )
    const fila = rows[0]
    return fila ? { ok: true, folio: fila.folio } : { ok: false, error: 'No se pudo registrar.' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'No se pudo registrar.' }
  }
}

export type CanalesOrganizacion = {
  whatsapp: string | null
  voz: string | null
  workspace: string | null
}

/**
 * The organisation's own channel identity (migration 0068).
 *
 * Distinct from `waba_phone_number_id`, which is a Meta routing identifier and cannot be dialled
 * or printed. These are the numbers a partner actually answers on and hands to a community.
 */
export async function canalesDeOrganizacion(client: PoolClient): Promise<CanalesOrganizacion> {
  const { rows } = await client.query<{
    telefono_whatsapp: string | null
    telefono_voz: string | null
    dominio_workspace: string | null
  }>(
    `select telefono_whatsapp, telefono_voz, dominio_workspace
       from organizaciones where id = convite_organizacion()`,
  )
  const f = rows[0]
  return {
    whatsapp: f?.telefono_whatsapp ?? null,
    voz: f?.telefono_voz ?? null,
    workspace: f?.dominio_workspace ?? null,
  }
}

export async function fijarCanalesOrganizacion(
  client: PoolClient,
  c: CanalesOrganizacion,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await client.query(`select convite_fijar_canales_organizacion($1, $2, $3)`, [
      c.whatsapp,
      c.voz,
      c.workspace,
    ])
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudieron guardar los canales.',
    }
  }
}

