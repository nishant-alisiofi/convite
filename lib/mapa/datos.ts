import type { PoolClient } from 'pg'
import type { FuenteUbicacion, Modo, Temporada } from '@/db/schema/vocabulario'
import type { TemporadaActual } from '@/lib/matching/tipos'

/**
 * What the coordinator map is allowed to know.
 *
 * Read through `conSesion`, so a verificador scoped to the Atrato medio gets their
 * communities and no others — the query does not filter, the policies do.
 *
 * Every location travels with its source and its accuracy radius. Nothing downstream may
 * receive a bare lat/lon pair, because a bare pair is exactly how a centroid becomes a pin
 * three components later (2.2).
 */

export type ComunidadMapa = {
  id: string
  codigo: string
  nombre: string
  municipio: string
  lat: number | null
  lon: number | null
  fuente: FuenteUbicacion | null
  precisionM: number | null
  familiasEstimadas: number | null
  tierConectividad: number
  /** The open request that most needs attention here, or null when there are none. */
  estado: string | null
  abiertos: number
}

export type NodoMapa = {
  id: string
  nombre: string
  tipo: string
  comunidad: string
  lat: number | null
  lon: number | null
  fuente: FuenteUbicacion | null
  precisionM: number | null
}

/**
 * One schematic connector between two communities.
 *
 * Deliberately not a path. Section 7.3: we hold no channel geometry, and a `lancha` leg
 * drawn as a straight line across land invents a route the same way a bare coordinate
 * invents a location. The map draws these dashed, labelled with mode and time, and the
 * legend says so out loud.
 *
 * The two directions of a pair are collapsed into one connector because upstream and
 * downstream are the same line on a screen even though they are not the same trip — the
 * label carries both times when they differ.
 */
export type TramoMapa = {
  clave: string
  modo: Modo
  origen: string
  destino: string
  origenLat: number
  origenLon: number
  destinoLat: number
  destinoLon: number
  minutosIda: number | null
  minutosVuelta: number | null
  temporada: Temporada
  activa: boolean
}

export type DatosMapa = {
  comunidades: ComunidadMapa[]
  nodos: NodoMapa[]
  tramos: TramoMapa[]
  temporada: TemporadaActual
}

type FilaRuta = {
  origen_id: string
  destino_id: string
  origen: string
  destino: string
  modo: Modo
  minutos: number | null
  temporada: Temporada
  activa: boolean
  origen_lat: number | null
  origen_lon: number | null
  destino_lat: number | null
  destino_lon: number | null
}

export async function cargarMapa(
  client: PoolClient,
  temporada: TemporadaActual,
): Promise<DatosMapa> {
  const comunidades = await client.query<ComunidadMapa>(
    `select c.id, c.codigo, c.nombre, c.municipio,
            st_y(c.ubicacion) as lat, st_x(c.ubicacion) as lon,
            c.ubicacion_fuente as fuente, c.ubicacion_precision_m as "precisionM",
            c.familias_estimadas as "familiasEstimadas",
            c.tier_conectividad as "tierConectividad",
            abiertos.estado, coalesce(abiertos.n, 0)::int as abiertos
       from comunidades c
       left join lateral (
         -- The state that most needs a phone call, not the most recent one.
         select p.estado, count(*) over () as n
           from pedidos p
          where p.comunidad_id = c.id
            and p.estado in ('SIN_RUTA', 'SIN_EXISTENCIA', 'SIN_CAPACIDAD', 'LISTO', 'EN_CAMINO')
          order by array_position(
            array['SIN_RUTA', 'SIN_EXISTENCIA', 'SIN_CAPACIDAD', 'LISTO', 'EN_CAMINO'],
            p.estado)
          limit 1
       ) abiertos on true
      where c.activa
      order by c.nombre`,
  )

  const nodos = await client.query<NodoMapa>(
    `select n.id, n.nombre, n.tipo, c.nombre as comunidad,
            st_y(n.ubicacion) as lat, st_x(n.ubicacion) as lon,
            n.ubicacion_fuente as fuente, n.ubicacion_precision_m as "precisionM"
       from nodos n
       join comunidades c on c.id = n.comunidad_id
      where n.activo
      order by n.nombre`,
  )

  // Only the legs that apply this season. A pair with no row in the current season is
  // impassable, and drawing it anyway would put a line where there is no way through.
  const rutas = await client.query<FilaRuta>(
    `select r.origen_id, r.destino_id, o.nombre as origen, d.nombre as destino,
            r.modo, r.minutos, r.temporada, r.activa,
            st_y(o.ubicacion) as origen_lat, st_x(o.ubicacion) as origen_lon,
            st_y(d.ubicacion) as destino_lat, st_x(d.ubicacion) as destino_lon
       from rutas r
       join comunidades o on o.id = r.origen_id
       join comunidades d on d.id = r.destino_id
      where r.temporada in ('todo_el_ano', $1)`,
    [temporada],
  )

  return {
    comunidades: comunidades.rows,
    nodos: nodos.rows,
    tramos: colapsarTramos(rutas.rows),
    temporada,
  }
}

/**
 * Collapses the two directed edges of a pair into one drawable connector.
 *
 * Keyed on the unordered pair plus mode plus season, which is the same key the map needs
 * and one direction narrower than `rutas_tramo_key`. A leg only counts as active on the map
 * when both directions are — a closed return trip is still a closed trip for anyone
 * planning to come back.
 */
function colapsarTramos(filas: readonly FilaRuta[]): TramoMapa[] {
  const porClave = new Map<string, TramoMapa>()

  for (const fila of filas) {
    // Communities with no stored point cannot anchor a line. None today, but the column is
    // nullable and a made-up endpoint is a made-up route.
    if (
      fila.origen_lat === null ||
      fila.origen_lon === null ||
      fila.destino_lat === null ||
      fila.destino_lon === null
    ) {
      continue
    }

    const [a, b] = [fila.origen_id, fila.destino_id].sort() as [string, string]
    const directa = a === fila.origen_id
    const clave = `${a}|${b}|${fila.modo}|${fila.temporada}`

    const existente = porClave.get(clave)
    if (existente) {
      if (directa) existente.minutosIda = fila.minutos
      else existente.minutosVuelta = fila.minutos
      existente.activa = existente.activa && fila.activa
      continue
    }

    porClave.set(clave, {
      clave,
      modo: fila.modo,
      origen: directa ? fila.origen : fila.destino,
      destino: directa ? fila.destino : fila.origen,
      origenLat: directa ? fila.origen_lat : fila.destino_lat,
      origenLon: directa ? fila.origen_lon : fila.destino_lon,
      destinoLat: directa ? fila.destino_lat : fila.origen_lat,
      destinoLon: directa ? fila.destino_lon : fila.origen_lon,
      minutosIda: directa ? fila.minutos : null,
      minutosVuelta: directa ? null : fila.minutos,
      temporada: fila.temporada,
      activa: fila.activa,
    })
  }

  return [...porClave.values()].sort((x, y) => x.origen.localeCompare(y.origen))
}

/** «lancha · 50–70 min», or «lancha · 50 min» when both directions match. */
export function etiquetaTramo(tramo: TramoMapa): string {
  const tiempos = [tramo.minutosIda, tramo.minutosVuelta].filter(
    (m): m is number => m !== null,
  )
  if (tiempos.length === 0) return `${tramo.modo} · sin tiempo registrado`

  const min = Math.min(...tiempos)
  const max = Math.max(...tiempos)
  return min === max ? `${tramo.modo} · ${min} min` : `${tramo.modo} · ${min}–${max} min`
}
