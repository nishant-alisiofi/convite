import type { PoolClient } from 'pg'
import type { FuenteUbicacion } from '@/db/schema/vocabulario'
import { ESTADOS_PEDIDO_PENDIENTE } from '@/db/schema/vocabulario'
import type { TemporadaActual } from '@/lib/matching/tipos'
import type { AristaPlan } from './planificacion'

/**
 * What the planning surface is allowed to know (§23), read through `conSesion` so the same
 * RLS that scopes the base map scopes the planner — a verificador plans over their communities
 * and no others. This is the richer companion to `cargarMapa`: `cargarMapa` answers «where is
 * this, and how sure are we», this answers «what does this area need, who has ever heard from
 * it, and what would a run to it cost in its own season».
 *
 * Deliberately separate from `cargarMapa`: that query and its `DatosMapa` type are pinned by
 * tests/mapa.test.ts as the honest base, and the planner must not force a change there to grow
 * a field. Both are keyed by community id, so a component joins them without either widening.
 */

export type PendienteBucket = { codigo: string; etiqueta: string; pedidos: number; familias: number }
export type EstadoBucket = { estado: string; pedidos: number; familias: number }

export type ComunidadPlan = {
  id: string
  codigo: string
  nombre: string
  municipio: string
  agrupador: string | null
  regionId: string | null
  regionNombre: string | null
  lat: number | null
  lon: number | null
  fuente: FuenteUbicacion | null
  precisionM: number | null
  familiasEstimadas: number | null
  tierConectividad: number
  intervaloChequeoDias: number
  /** §23.4 assessment-recency source: when the territory last confirmed this community (§14). */
  verificadoEn: string | null
  /** Most recent inbound contact from anyone here; null = never heard from (§23.5). */
  ultimoContacto: string | null
  pendientesPorCategoria: PendienteBucket[]
  pendientesPorEstado: EstadoBucket[]
  /** Families named across pending requests — the demand a draft has to serve (§23.5). */
  familiasPendientes: number
}

export type PuntoConexionPlan = {
  id: string
  nombre: string
  tipo: string
  lat: number | null
  lon: number | null
  fuente: FuenteUbicacion | null
  precisionM: number | null
  seguridad: string
  privacidad: string
  energia: string
  accesibilidad: string
  costo: string
  notas: string | null
  comunidades: string[]
}

export type NodoStockPlan = {
  id: string
  nombre: string
  comunidad: string
  lat: number | null
  lon: number | null
  fuente: FuenteUbicacion | null
  precisionM: number | null
  items: { codigo: string; etiqueta: string; cantidad: number; contadoEn: string }[]
}

export type DatosPlanificacion = {
  comunidades: ComunidadPlan[]
  aristas: AristaPlan[]
  puntos: PuntoConexionPlan[]
  nodos: NodoStockPlan[]
  regiones: { id: string; nombre: string }[]
  municipios: string[]
  agrupadores: string[]
  /** Server «now», so age (recency, coverage) is computed against one clock, not the browser's. */
  ahora: string
}

const iso = (v: Date | string | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString()

type FilaComunidad = {
  id: string
  codigo: string
  nombre: string
  municipio: string
  agrupador: string | null
  regionId: string | null
  regionNombre: string | null
  lat: number | null
  lon: number | null
  fuente: FuenteUbicacion | null
  precisionM: number | null
  familiasEstimadas: number | null
  tierConectividad: number
  intervaloChequeoDias: number
  verificadoEn: Date | null
  ultimoContacto: Date | null
}

type FilaPendiente = {
  comunidadId: string
  codigo: string
  etiqueta: string
  estado: string
  pedidos: number
  familias: number
}

type FilaArista = {
  origenId: string
  destinoId: string
  origen: string
  destino: string
  modo: AristaPlan['modo']
  minutos: number | null
  costoCop: number | null
  temporada: AristaPlan['temporada']
  activa: boolean
  motivoCierre: string | null
}

export async function cargarPlanificacion(client: PoolClient): Promise<DatosPlanificacion> {
  const comunidades = await client.query<FilaComunidad>(
    `select c.id, c.codigo, c.nombre, c.municipio, c.agrupador,
            c.region_id as "regionId", r.nombre as "regionNombre",
            st_y(c.ubicacion) as lat, st_x(c.ubicacion) as lon,
            c.ubicacion_fuente as fuente, c.ubicacion_precision_m as "precisionM",
            c.familias_estimadas as "familiasEstimadas",
            c.tier_conectividad as "tierConectividad",
            c.intervalo_chequeo_dias as "intervaloChequeoDias",
            c.verificado_en as "verificadoEn",
            uc.ultimo_contacto as "ultimoContacto"
       from comunidades c
       left join regiones r on r.id = c.region_id
       left join lateral (
         select max(ct.ultimo_contacto_en) as ultimo_contacto
           from contactos ct
          where ct.comunidad_id = c.id
       ) uc on true
      where c.activa
      order by c.nombre`,
  )

  // Pending requests split two ways at once — by catalogue item and by stuck-state — so the
  // panel can answer «what does it need» and «what is stuck» from one pass (§23.5).
  const pendientes = await client.query<FilaPendiente>(
    `select p.comunidad_id as "comunidadId", p.codigo_item as codigo,
            ci.item_label as etiqueta, p.estado,
            count(*)::int as pedidos, coalesce(sum(p.familias), 0)::int as familias
       from pedidos p
       join catalogo_items ci on ci.codigo = p.codigo_item
      where p.estado = any($1)
      group by p.comunidad_id, p.codigo_item, ci.item_label, p.estado`,
    [[...ESTADOS_PEDIDO_PENDIENTE]],
  )

  // Every seasonal edge, both directions, every season — the planner resolves the one that
  // matches a draft's date itself (§23.3), so it needs them all, not just today's.
  const aristas = await client.query<FilaArista>(
    `select r.origen_id as "origenId", r.destino_id as "destinoId",
            o.nombre as origen, d.nombre as destino,
            r.modo, r.minutos, r.costo_estimado_cop as "costoCop",
            r.temporada, r.activa, r.notas as "motivoCierre"
       from rutas r
       join comunidades o on o.id = r.origen_id
       join comunidades d on d.id = r.destino_id
      order by o.nombre`,
  )

  const puntos = await client.query<{
    id: string
    nombre: string
    tipo: string
    lat: number | null
    lon: number | null
    fuente: FuenteUbicacion | null
    precisionM: number | null
    seguridad: string
    privacidad: string
    energia: string
    accesibilidad: string
    costo: string
    notas: string | null
    comunidades: string[] | null
  }>(
    `select pc.id, pc.nombre, pc.tipo,
            st_y(pc.ubicacion) as lat, st_x(pc.ubicacion) as lon,
            pc.ubicacion_fuente as fuente, pc.ubicacion_precision_m as "precisionM",
            pc.seguridad, pc.privacidad, pc.energia, pc.accesibilidad, pc.costo, pc.notas,
            coalesce(array_agg(c.nombre) filter (where c.nombre is not null), '{}') as comunidades
       from puntos_conexion pc
       left join puntos_conexion_comunidades pcc on pcc.punto_id = pc.id
       left join comunidades c on c.id = pcc.comunidad_id
      where pc.activo
      group by pc.id
      order by pc.nombre`,
  )

  const nodos = await client.query<{
    id: string
    nombre: string
    comunidad: string
    lat: number | null
    lon: number | null
    fuente: FuenteUbicacion | null
    precisionM: number | null
    items: { codigo: string; etiqueta: string; cantidad: number; contadoEn: string }[] | null
  }>(
    `select n.id, n.nombre, c.nombre as comunidad,
            st_y(n.ubicacion) as lat, st_x(n.ubicacion) as lon,
            n.ubicacion_fuente as fuente, n.ubicacion_precision_m as "precisionM",
            coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'codigo', e.codigo_item, 'etiqueta', ci.item_label,
                  'cantidad', e.cantidad, 'contadoEn', e.contado_en
                ) order by ci.item_label
              ) filter (where e.id is not null), '[]'
            ) as items
       from nodos n
       join comunidades c on c.id = n.comunidad_id
       left join existencias e on e.nodo_id = n.id
       left join catalogo_items ci on ci.codigo = e.codigo_item
      where n.activo
      group by n.id, c.nombre
      order by n.nombre`,
  )

  const { rows: reloj } = await client.query<{ ahora: Date }>('select now() as ahora')

  // Assemble per-community pending buckets from the two-way grouping.
  const porCategoria = new Map<string, PendienteBucket[]>()
  const porEstado = new Map<string, Map<string, EstadoBucket>>()
  const familiasPendientes = new Map<string, number>()
  const categoriaVista = new Map<string, Map<string, PendienteBucket>>()

  for (const p of pendientes.rows) {
    const cat = categoriaVista.get(p.comunidadId) ?? new Map<string, PendienteBucket>()
    const prevCat = cat.get(p.codigo)
    if (prevCat) {
      prevCat.pedidos += p.pedidos
      prevCat.familias += p.familias
    } else {
      cat.set(p.codigo, { codigo: p.codigo, etiqueta: p.etiqueta, pedidos: p.pedidos, familias: p.familias })
    }
    categoriaVista.set(p.comunidadId, cat)

    const est = porEstado.get(p.comunidadId) ?? new Map<string, EstadoBucket>()
    const prevEst = est.get(p.estado)
    if (prevEst) {
      prevEst.pedidos += p.pedidos
      prevEst.familias += p.familias
    } else {
      est.set(p.estado, { estado: p.estado, pedidos: p.pedidos, familias: p.familias })
    }
    porEstado.set(p.comunidadId, est)

    familiasPendientes.set(p.comunidadId, (familiasPendientes.get(p.comunidadId) ?? 0) + p.familias)
  }
  for (const [id, cat] of categoriaVista) porCategoria.set(id, [...cat.values()])

  const comunidadesPlan: ComunidadPlan[] = comunidades.rows.map((c) => ({
    id: c.id,
    codigo: c.codigo,
    nombre: c.nombre,
    municipio: c.municipio,
    agrupador: c.agrupador,
    regionId: c.regionId,
    regionNombre: c.regionNombre,
    lat: c.lat,
    lon: c.lon,
    fuente: c.fuente,
    precisionM: c.precisionM,
    familiasEstimadas: c.familiasEstimadas,
    tierConectividad: c.tierConectividad,
    intervaloChequeoDias: c.intervaloChequeoDias,
    verificadoEn: iso(c.verificadoEn),
    ultimoContacto: iso(c.ultimoContacto),
    pendientesPorCategoria: (porCategoria.get(c.id) ?? []).sort((a, b) => b.familias - a.familias),
    pendientesPorEstado: [...(porEstado.get(c.id)?.values() ?? [])].sort((a, b) => b.familias - a.familias),
    familiasPendientes: familiasPendientes.get(c.id) ?? 0,
  }))

  const regiones = [
    ...new Map(
      comunidades.rows
        .filter((c) => c.regionId && c.regionNombre)
        .map((c) => [c.regionId!, { id: c.regionId!, nombre: c.regionNombre! }]),
    ).values(),
  ].sort((a, b) => a.nombre.localeCompare(b.nombre))

  const municipios = [...new Set(comunidades.rows.map((c) => c.municipio))].sort((a, b) =>
    a.localeCompare(b),
  )
  const agrupadores = [
    ...new Set(comunidades.rows.map((c) => c.agrupador).filter((a): a is string => a !== null)),
  ].sort((a, b) => a.localeCompare(b))

  return {
    comunidades: comunidadesPlan,
    aristas: aristas.rows.map((a) => ({
      origenId: a.origenId,
      destinoId: a.destinoId,
      origen: a.origen,
      destino: a.destino,
      modo: a.modo,
      minutos: a.minutos,
      costoCop: a.costoCop,
      temporada: a.temporada,
      activa: a.activa,
      // Only a closed leg carries its note as a closure reason; an open leg's notes are
      // operational colour, not a closure, so they are not surfaced as one (§23.3).
      motivoCierre: a.activa ? null : a.motivoCierre,
    })),
    puntos: puntos.rows.map((p) => ({ ...p, comunidades: p.comunidades ?? [] })),
    nodos: nodos.rows.map((n) => ({
      ...n,
      items: (n.items ?? []).map((it) => ({ ...it, contadoEn: iso(it.contadoEn) ?? it.contadoEn })),
    })),
    regiones,
    municipios,
    agrupadores,
    ahora: iso(reloj[0]?.ahora ?? new Date())!,
  }
}

/** The season a draft resolves against — exported for the page/tests to reuse the one clock. */
export type { TemporadaActual }
