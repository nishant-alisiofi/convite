import type { ComunidadMapa, DatosMapa, TramoMapa } from './datos'
import { etiquetaTramo } from './datos'
import { anilloCircular } from './geometria'
import { representacionDe, type Trazo, type Ubicacion } from './precision'

/**
 * Turning what the database knows into what the map draws.
 *
 * Kept out of the React component on purpose: this is the step where a centroid could
 * silently become a dot, so it is pure, it takes the same rows the screen takes, and it is
 * asserted in tests/mapa.test.ts. The component only hands the result to MapLibre.
 */

/** One hue per board state, the same ones the Tablero uses. Nothing else is coloured. */
export const COLOR_ESTADO: Record<string, string> = {
  SIN_RUTA: '#fb7185',
  SIN_EXISTENCIA: '#38bdf8',
  SIN_CAPACIDAD: '#8a6229',
  LISTO: '#2c7a5f',
  EN_CAMINO: '#6f675e',
}

/** A community with nothing open is not news, and does not get a colour. */
export const COLOR_QUIETO = '#a8a29e'
export const COLOR_NODO = '#1f5c4a'

/** Dash patterns in line-width units: solid, dashed, dotted as confidence drops. */
export const GUION: Record<Trazo, number[] | null> = {
  solido: null,
  discontinuo: [2, 2],
  punteado: [0.4, 2],
}

export const TRAZOS = ['solido', 'discontinuo', 'punteado'] as const

/**
 * Minimal GeoJSON shapes, written out rather than pulled from `@types/geojson`: these three
 * geometries are all this screen builds, and they are structurally what MapLibre expects.
 */
export type Posicion = [number, number]

export type Geometria =
  | { type: 'Point'; coordinates: Posicion }
  | { type: 'LineString'; coordinates: Posicion[] }
  | { type: 'Polygon'; coordinates: Posicion[][] }

export type Rasgo = {
  type: 'Feature'
  properties: Record<string, string | number | boolean>
  geometry: Geometria
}

export type Coleccion = { type: 'FeatureCollection'; features: Rasgo[] }

export type Figuras = {
  circulos: Record<Trazo, Rasgo[]>
  pines: Rasgo[]
  /** Named, not drawn. Acopio Yuto has no coordinates and must not acquire one. */
  sinUbicar: string[]
}

export function coleccion(features: Rasgo[]): Coleccion {
  return { type: 'FeatureCollection', features }
}

export function colorDe(comunidad: ComunidadMapa): string {
  return comunidad.estado ? (COLOR_ESTADO[comunidad.estado] ?? COLOR_QUIETO) : COLOR_QUIETO
}

/**
 * Every community and node as the shape its precision earns: an exact fix becomes a point,
 * everything else becomes a circle of its accuracy radius, and anything unlocatable is
 * returned by name so the screen can list it instead of placing it somewhere convenient.
 */
export function figurasDe(datos: DatosMapa): Figuras {
  const circulos: Record<Trazo, Rasgo[]> = { solido: [], discontinuo: [], punteado: [] }
  const pines: Rasgo[] = []
  const sinUbicar: string[] = []

  const agregar = (nombre: string, color: string, ubicacion: Ubicacion) => {
    const figura = representacionDe(ubicacion)

    if (figura.forma === 'ausente') {
      sinUbicar.push(nombre)
      return
    }

    if (figura.forma === 'pin') {
      pines.push({
        type: 'Feature',
        properties: { nombre, color },
        geometry: { type: 'Point', coordinates: [figura.lon, figura.lat] },
      })
      return
    }

    circulos[figura.trazo].push({
      type: 'Feature',
      properties: { nombre, color, radioM: figura.radioM },
      geometry: {
        type: 'Polygon',
        coordinates: [anilloCircular(figura.lat, figura.lon, figura.radioM)],
      },
    })
  }

  for (const c of datos.comunidades) agregar(c.nombre, colorDe(c), c)
  for (const n of datos.nodos) agregar(n.nombre, COLOR_NODO, n)

  return { circulos, pines, sinUbicar }
}

/**
 * Sources and layers for the whole map, defined once.
 *
 * Both the panel screen and `scripts/vista-mapa.ts` render from this. Two copies of the
 * style would drift the moment one of them changed, and the copy that drifted would be the
 * one used to check whether precision still renders honestly.
 */
export function fuentesYCapas(figuras: Figuras, tramos: readonly TramoMapa[]) {
  const fuentes: Record<string, { type: 'geojson'; data: Coleccion }> = {
    tramos: { type: 'geojson', data: tramosGeoJSON(tramos) },
  }

  const capas: Record<string, unknown>[] = [
    { id: 'fondo', type: 'background', paint: { 'background-color': '#f2efe9' } },
    // A light casing UNDER the connector so it reads over the OSM basemap — a road, a river,
    // dark forest — instead of dissolving into it. The tint-and-thin overlays were drawn for
    // the old flat background; once real tiles sit below them (basemap.ts), a 1.5 px muted
    // dashed line is invisible, and the screen looks like it lost its own data. Casings fix
    // that without a colour becoming a claim: they are white, not a fifth state hue.
    {
      id: 'tramos-casing',
      type: 'line',
      source: 'tramos',
      paint: { 'line-color': '#ffffff', 'line-width': 4, 'line-opacity': 0.9 },
    },
    {
      id: 'tramos-linea',
      type: 'line',
      source: 'tramos',
      // Schematic, and drawn to look it. Section 7.3: we hold no channel geometry, so a
      // solid line would be a claim about the path that we cannot make. Kept dashed; only
      // widened so the schematic connector is legible on top of the basemap.
      paint: {
        'line-color': ['case', ['get', 'activa'], '#8a6229', '#c9c2b8'],
        'line-width': 2,
        'line-dasharray': [3, 2],
      },
    },
  ]

  for (const trazo of TRAZOS) {
    const features = figuras.circulos[trazo]
    if (features.length === 0) continue

    const guion = GUION[trazo]
    fuentes[`circulos-${trazo}`] = { type: 'geojson', data: coleccion(features) }
    capas.push(
      {
        id: `circulos-${trazo}-relleno`,
        type: 'fill',
        source: `circulos-${trazo}`,
        // Raised from 0.12: over the OSM basemap a 12% tint is invisible. 0.2 still reads as
        // a translucent margin-of-error area you can see the ground through — not a solid
        // footprint (2.2: the circle is uncertainty, not the size of the place).
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.2 },
      },
      // A white casing under the coloured ring. Solid (no dash) on purpose: the gaps in the
      // dashed/dotted ring above then fall on white, which is what keeps a dashed ring
      // readable over a photographic tile. It lifts the ring off the basemap without adding
      // a colour that could be mistaken for a state.
      {
        id: `circulos-${trazo}-casing`,
        type: 'line',
        source: `circulos-${trazo}`,
        paint: { 'line-color': '#ffffff', 'line-width': 3.5, 'line-opacity': 0.9 },
      },
      {
        id: `circulos-${trazo}-borde`,
        type: 'line',
        source: `circulos-${trazo}`,
        // The dash pattern still carries the confidence (solid → dashed → dotted); only the
        // width grew so the ring holds up against the basemap detail beneath it.
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
          ...(guion ? { 'line-dasharray': guion } : {}),
        },
      },
    )
  }

  if (figuras.pines.length > 0) {
    fuentes.pines = { type: 'geojson', data: coleccion(figuras.pines) }
    capas.push({
      id: 'pines-punto',
      type: 'circle',
      source: 'pines',
      // The exact fix is the one shape allowed to be a dot (2.2). A slightly wider white ring
      // keeps that dot legible on top of the basemap, the same casing idea as the circles.
      paint: {
        'circle-radius': 5,
        'circle-color': ['get', 'color'],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    })
  }

  return { version: 8 as const, sources: fuentes, layers: capas }
}

/**
 * The extent of everything drawn, as `[[oeste, sur], [este, norte]]`.
 *
 * The map fits to this rather than opening on a fixed centre and zoom. At a hardcoded
 * basin-wide view a 1000 m circle is about one pixel across, so the precision the whole
 * screen exists to show renders as a dot — which is the exact failure 2.2 is about, arrived
 * at through the camera instead of through the data.
 *
 * Circle rings are included, not just their centres, so a community at the edge of the
 * basin does not get its uncertainty cropped.
 */
export function limitesDe(figuras: Figuras, tramos: readonly TramoMapa[]) {
  let oeste = Infinity
  let sur = Infinity
  let este = -Infinity
  let norte = -Infinity

  const ver = (lon: number, lat: number) => {
    oeste = Math.min(oeste, lon)
    este = Math.max(este, lon)
    sur = Math.min(sur, lat)
    norte = Math.max(norte, lat)
  }

  for (const trazo of TRAZOS) {
    for (const rasgo of figuras.circulos[trazo]) {
      if (rasgo.geometry.type !== 'Polygon') continue
      for (const [lon, lat] of rasgo.geometry.coordinates[0] ?? []) ver(lon, lat)
    }
  }
  for (const rasgo of figuras.pines) {
    if (rasgo.geometry.type !== 'Point') continue
    ver(rasgo.geometry.coordinates[0], rasgo.geometry.coordinates[1])
  }
  for (const t of tramos) {
    ver(t.origenLon, t.origenLat)
    ver(t.destinoLon, t.destinoLat)
  }

  if (oeste === Infinity) return null
  return [
    [oeste, sur],
    [este, norte],
  ] as [[number, number], [number, number]]
}

/** Straight connectors between endpoints — schematic by construction, never a traced path. */
export function tramosGeoJSON(tramos: readonly TramoMapa[]): Coleccion {
  return coleccion(
    tramos.map((t) => ({
      type: 'Feature' as const,
      properties: { activa: t.activa, etiqueta: etiquetaTramo(t) },
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [t.origenLon, t.origenLat],
          [t.destinoLon, t.destinoLat],
        ] as Posicion[],
      },
    })),
  )
}
