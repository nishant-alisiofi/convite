import type { PoolClient } from 'pg'

/**
 * Manual entry — the zeroth channel (PRD-35, §29.3b).
 *
 * Stage-0 setup must work with no channel at all: once the data agreement is signed, a coordinator
 * types in reports they are already receiving by phone, on paper, or in their own WhatsApp group.
 * Every such record is an ordinary `reportes` row tagged `canal = 'manual'`, born RECIBIDO, with the
 * person who entered it recorded in `payload_crudo`. A live channel attaches later as verification
 * clears, and nothing already entered changes.
 *
 * The insert goes through the SECURITY DEFINER `registrar_reporte_manual` (migration 0052) — the one
 * gated door into `reportes` for a signed-in coordinator, the same shape the radio relay uses. Every
 * function here takes the RLS-bound client from `conSesion` (lib/sesion.ts).
 */

export type ComunidadOpcion = { id: string; nombre: string; municipio: string }

/** The caller's own-org active communities — the only ones a manual report may be keyed in for. */
export async function comunidadesDeOrganizacion(
  client: PoolClient,
  organizacionId: string,
): Promise<ComunidadOpcion[]> {
  const { rows } = await client.query<ComunidadOpcion>(
    `select id, nombre, municipio
       from comunidades
      where organizacion_id = $1 and activa
      order by municipio, nombre`,
    [organizacionId],
  )
  return rows
}

export type ItemCatalogo = {
  codigo: string
  itemLabel: string
  familiaLabel: string
  tipo: string
  pideDetalle: boolean
}

/** The active catalogue, for the item picker. Data, never code (2.8). */
export async function catalogoActivo(client: PoolClient): Promise<ItemCatalogo[]> {
  const { rows } = await client.query<{
    codigo: string
    item_label: string
    familia_label: string
    tipo: string
    pide_detalle: boolean
  }>(
    `select codigo, item_label, familia_label, tipo, pide_detalle
       from catalogo_items
      where activo
      order by orden, codigo`,
  )
  return rows.map((r) => ({
    codigo: r.codigo,
    itemLabel: r.item_label,
    familiaLabel: r.familia_label,
    tipo: r.tipo,
    pideDetalle: r.pide_detalle,
  }))
}

/**
 * Key in a report received off-channel. Goes through `registrar_reporte_manual`: it checks role and
 * organisation, requires the community to be the caller's own, derives the type from the catalogue
 * item (or leaves it `sin_clasificar` — we never guess, 2.12), and writes a `canal = 'manual'`
 * report born RECIBIDO. The folio comes back so the operator can be told the number, as on every
 * other channel.
 */
export async function registrarReporteManual(
  client: PoolClient,
  args: {
    comunidadId: string
    codigoItem?: string | null
    familias?: number | null
    urgencia?: number | null
    detalle?: string | null
    descripcion?: string | null
  },
): Promise<{ ok: true; folio: number; reporteId: string } | { ok: false; error: string }> {
  if (!args.comunidadId) return { ok: false, error: 'Elija la comunidad del reporte.' }
  const detalle = (args.detalle ?? '').trim() || null
  const descripcion = (args.descripcion ?? '').trim() || null
  const codigoItem = (args.codigoItem ?? '').trim() || null
  const familias = args.familias != null && args.familias > 0 ? Math.trunc(args.familias) : null
  const urgencia =
    args.urgencia != null && args.urgencia >= 1 && args.urgencia <= 3 ? Math.trunc(args.urgencia) : null

  // A record with nothing in it is not a report. Require an item or a written detail.
  if (!codigoItem && !detalle) {
    return { ok: false, error: 'Diga qué se necesita: elija un ítem del catálogo o escriba el detalle.' }
  }

  try {
    const { rows } = await client.query<{ reporte_id: string; folio: number }>(
      `select reporte_id, folio from registrar_reporte_manual($1, $2, $3, $4, $5, $6)`,
      [args.comunidadId, codigoItem, familias, urgencia, detalle, descripcion],
    )
    const fila = rows[0]
    if (!fila) return { ok: false, error: 'No se pudo registrar el reporte.' }
    return { ok: true, folio: fila.folio, reporteId: fila.reporte_id }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'No se pudo registrar el reporte.' }
  }
}

export type ReporteManual = {
  folio: number
  comunidad: string | null
  municipio: string | null
  tipo: string
  item: string | null
  familias: number | null
  detalle: string | null
  estado: string
  creadoEn: Date
}

/** Recent manual reports, so the desk can see what has been typed in lately. */
export async function reportesManualesRecientes(
  client: PoolClient,
  limite = 15,
): Promise<ReporteManual[]> {
  const { rows } = await client.query<{
    folio: number
    comunidad: string | null
    municipio: string | null
    tipo: string
    item: string | null
    familias: number | null
    detalle: string | null
    estado: string
    creado_en: Date
  }>(
    `select r.folio,
            c.nombre         as comunidad,
            c.municipio,
            r.tipo,
            ci.item_label    as item,
            r.familias,
            r.detalle_libre  as detalle,
            r.estado,
            r.creado_en
       from reportes r
       left join comunidades c on c.id = r.comunidad_id
       left join catalogo_items ci on ci.codigo = r.codigo_item
      where r.canal = 'manual'
      order by r.creado_en desc
      limit $1`,
    [limite],
  )
  return rows.map((r) => ({
    folio: r.folio,
    comunidad: r.comunidad,
    municipio: r.municipio,
    tipo: r.tipo,
    item: r.item,
    familias: r.familias,
    detalle: r.detalle,
    estado: r.estado,
    creadoEn: r.creado_en,
  }))
}
