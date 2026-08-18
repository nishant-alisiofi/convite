import type { PoolClient } from 'pg'

/**
 * PRD-47 — the vetted lanchero relay network.
 *
 * Upriver communities may have no channel at all — no WhatsApp, no SMS, no signal for a missed
 * call — but a lanchero passing through them and later reaching a town with connectivity is a
 * human sneakernet. Built on stated assumptions (flagged for partner review in the WI): a
 * lanchero is a REGISTERED, VETTED relay, never an anonymous self-signup, mirroring the vetted
 * stance FR-18 drew for transport. So this file has two halves:
 *
 *   * Registration — a coordinador/admin registers a lanchero (an ordinary `contactos` row with
 *     `rol = 'lanchero'`) and the communities on their route (`lancheros_comunidades`, reusing
 *     the coverage-join shape `puntos_conexion_comunidades` already uses). Ordinary authenticated
 *     inserts bounded by RLS — the same shape connection points and registry proposals use.
 *   * Relay — keying in a report a lanchero carried out, attributed to the origin community and
 *     the relaying lanchero. Goes through the SECURITY DEFINER `registrar_reporte_relevo`
 *     (migration 0056) — the one gated door into `reportes`, which also checks the lanchero is
 *     vetted (registered) for the origin community named.
 */

export type ComunidadOpcion = { id: string; nombre: string; municipio: string }

/** The caller's own-org active communities. */
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

export type Lanchero = {
  id: string
  nombre: string | null
  telefono: string
  comunidades: { id: string; nombre: string }[]
}

/** Registered lancheros whose route touches the caller's own org, each with the communities they cover. */
export async function lancherosDeOrganizacion(
  client: PoolClient,
  organizacionId: string,
): Promise<Lanchero[]> {
  const { rows } = await client.query<{
    id: string
    nombre: string | null
    telefono: string
    comunidades: { id: string; nombre: string }[]
  }>(
    `select ct.id, ct.nombre, ct.telefono,
            coalesce(
              jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre) order by c.nombre)
                filter (where c.id is not null),
              '[]'
            ) as comunidades
       from contactos ct
       join lancheros_comunidades lc on lc.lanchero_contacto_id = ct.id
       join comunidades c on c.id = lc.comunidad_id
      where ct.rol = 'lanchero' and c.organizacion_id = $1 and ct.activo
      group by ct.id, ct.nombre, ct.telefono
      order by ct.nombre`,
    [organizacionId],
  )
  return rows
}

const TELEFONO_E164 = /^\+[1-9][0-9]{7,14}$/

export type NuevoLanchero = {
  nombre: string
  telefono: string
  comunidadIds: string[]
}

/**
 * Register a lanchero — an ordinary contact with `rol = 'lanchero'` — and the communities on
 * their route. Both writes run inside the caller's existing `conSesion` transaction, so a
 * partial registration (contact created, no coverage) never lands.
 */
export async function registrarLanchero(
  client: PoolClient,
  entrada: NuevoLanchero,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const nombre = entrada.nombre.trim()
  const telefono = entrada.telefono.trim()
  const comunidadIds = [...new Set(entrada.comunidadIds.filter(Boolean))]

  if (!nombre) return { ok: false, error: 'Falta el nombre del lanchero.' }
  if (!TELEFONO_E164.test(telefono)) {
    return { ok: false, error: 'El teléfono debe estar en formato internacional, p. ej. +573001234567.' }
  }
  if (comunidadIds.length === 0) {
    return { ok: false, error: 'Elija al menos una comunidad de su ruta.' }
  }

  try {
    const { rows } = await client.query<{ id: string }>(
      `insert into contactos (telefono, nombre, rol) values ($1, $2, 'lanchero') returning id`,
      [telefono, nombre],
    )
    const lancheroId = rows[0]?.id
    if (!lancheroId) return { ok: false, error: 'No se pudo registrar el lanchero.' }

    for (const comunidadId of comunidadIds) {
      await client.query(
        `insert into lancheros_comunidades (lanchero_contacto_id, comunidad_id) values ($1, $2)`,
        [lancheroId, comunidadId],
      )
    }
    return { ok: true, id: lancheroId }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'No se pudo registrar el lanchero.' }
  }
}

/**
 * Key in a report a lanchero relayed. Goes through `registrar_reporte_relevo`: it checks role,
 * organisation, that the lanchero is registered AND vetted for the origin community (via
 * `lancheros_comunidades`), then writes a `canal = 'relevo'` report born RECIBIDO recording both
 * the lanchero and the origin community.
 */
export async function registrarReporteRelevo(
  client: PoolClient,
  args: {
    lancheroId: string
    comunidadId: string
    codigoItem?: string | null
    familias?: number | null
    urgencia?: number | null
    detalle?: string | null
    descripcion?: string | null
  },
): Promise<{ ok: true; folio: number; reporteId: string } | { ok: false; error: string }> {
  if (!args.lancheroId) return { ok: false, error: 'Elija el lanchero que releva el reporte.' }
  if (!args.comunidadId) return { ok: false, error: 'Elija la comunidad de origen.' }
  const detalle = (args.detalle ?? '').trim() || null
  const descripcion = (args.descripcion ?? '').trim() || null
  const codigoItem = (args.codigoItem ?? '').trim() || null
  const familias = args.familias != null && args.familias > 0 ? Math.trunc(args.familias) : null
  const urgencia =
    args.urgencia != null && args.urgencia >= 1 && args.urgencia <= 3 ? Math.trunc(args.urgencia) : null

  if (!codigoItem && !detalle) {
    return { ok: false, error: 'Diga qué se necesita: elija un ítem del catálogo o escriba el detalle.' }
  }

  try {
    const { rows } = await client.query<{ reporte_id: string; folio: number }>(
      `select reporte_id, folio from registrar_reporte_relevo($1, $2, $3, $4, $5, $6, $7)`,
      [args.lancheroId, args.comunidadId, codigoItem, familias, urgencia, detalle, descripcion],
    )
    const fila = rows[0]
    if (!fila) return { ok: false, error: 'No se pudo registrar el relevo.' }
    return { ok: true, folio: fila.folio, reporteId: fila.reporte_id }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'No se pudo registrar el relevo.' }
  }
}

export type ReporteRelevo = {
  folio: number
  comunidad: string | null
  municipio: string | null
  lancheroNombre: string | null
  tipo: string
  item: string | null
  familias: number | null
  detalle: string | null
  estado: string
  creadoEn: Date
}

/** Recent relayed reports, so the desk sees what has come in through lancheros lately. */
export async function reportesRelevoRecientes(
  client: PoolClient,
  limite = 15,
): Promise<ReporteRelevo[]> {
  const { rows } = await client.query<{
    folio: number
    comunidad: string | null
    municipio: string | null
    lanchero_nombre: string | null
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
            ln.nombre        as lanchero_nombre,
            r.tipo,
            ci.item_label    as item,
            r.familias,
            r.detalle_libre  as detalle,
            r.estado,
            r.creado_en
       from reportes r
       left join comunidades c on c.id = r.comunidad_id
       left join contactos ln on ln.id = r.relevo_lanchero_id
       left join catalogo_items ci on ci.codigo = r.codigo_item
      where r.canal = 'relevo'
      order by r.creado_en desc
      limit $1`,
    [limite],
  )
  return rows.map((r) => ({
    folio: r.folio,
    comunidad: r.comunidad,
    municipio: r.municipio,
    lancheroNombre: r.lanchero_nombre,
    tipo: r.tipo,
    item: r.item,
    familias: r.familias,
    detalle: r.detalle,
    estado: r.estado,
    creadoEn: r.creado_en,
  }))
}
