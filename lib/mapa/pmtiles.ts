/**
 * The offline basemap: a PMTiles archive MapLibre reads with no live tile connection.
 *
 * PRD-13 / §26. Field devices in Chocó / Pacífico work with no signal, so the basemap the
 * coordinator (or a vetted transporter on a run) needs cannot be a call to tile.openstreetmap.org
 * — that host is unreachable the moment the boat leaves the muelle. A PMTiles archive is a
 * single file of vector tiles: downloaded while signal exists, then served locally and read by
 * range requests, so the map still draws the coastline, the rivers and the roads offline.
 *
 * Two deliberate choices keep this honest and cheap, and both mirror `basemap.ts`:
 *
 *  1. It composes UNDER the data layers, never inside them. Exactly like `estiloConBasemap`
 *     slips the OSM raster beneath the circles, `estiloConPmtiles` slips the vector basemap
 *     beneath them. The pure, tile-free layer in `lib/mapa/capas.ts` is untouched — the test
 *     that asserts `fuentesYCapas` never grows a tile source still holds, because the tile
 *     source is added here, at presentation, not there.
 *
 *  2. The style has NO symbol layers, so it needs NO glyph server and NO sprite — the same
 *     constraint the rest of the map already lives under (community names are DOM markers, not
 *     a symbol layer, precisely because we host no glyphs). We paint water, land, roads and
 *     boundaries as fills and lines; place names come from the app's own markers on top.
 *
 * No paid provider and no API key: the archive is built from a free OSM extract (see
 * `scripts/construir-pmtiles.sh`) and served as a static file. The `pmtiles://` protocol is
 * registered on MapLibre at runtime only when an archive is actually configured.
 */

import { estiloConBasemap } from './basemap'

/** Where the archive is served from, e.g. `/mapa/choco.pmtiles`. Empty when none is built. */
export const URL_PMTILES = (process.env.NEXT_PUBLIC_PMTILES_URL ?? '').trim()

/** True when an offline basemap archive has been configured for this deployment. */
export function hayPaqueteOffline(): boolean {
  return URL_PMTILES.length > 0
}

/**
 * Resolves {@link URL_PMTILES} to an absolute URL. The `pmtiles` reader issues range requests
 * against a concrete origin, so a root-relative path (`/mapa/choco.pmtiles`) has to be lifted
 * against the current origin first. Guarded for the server, where `location` does not exist.
 */
export function urlAbsolutaPmtiles(base?: string): string {
  if (!URL_PMTILES) return ''
  const origen = base ?? (typeof location !== 'undefined' ? location.href : undefined)
  if (!origen) return URL_PMTILES
  try {
    return new URL(URL_PMTILES, origen).href
  } catch {
    return URL_PMTILES
  }
}

type EstiloBase = {
  version: number
  sources: Record<string, unknown>
  layers: Record<string, unknown>[]
}

/**
 * The source-layers of the Protomaps "basemaps" schema this style paints. Only the polygon
 * and line layers — never the point/label layers (`places`, `pois`, `physical_point`), which
 * would need glyphs we do not host. Referencing a layer an archive happens not to contain is
 * harmless: MapLibre simply draws nothing for it.
 */
const CAPAS_BASE = [
  { id: 'pm-earth', 'source-layer': 'earth', type: 'fill', paint: { 'fill-color': '#f2efe9' } },
  {
    id: 'pm-landcover',
    'source-layer': 'landcover',
    type: 'fill',
    paint: { 'fill-color': '#e9e5db', 'fill-opacity': 0.6 },
  },
  {
    id: 'pm-landuse',
    'source-layer': 'landuse',
    type: 'fill',
    paint: { 'fill-color': '#e6e2d6', 'fill-opacity': 0.5 },
  },
  {
    id: 'pm-water',
    'source-layer': 'water',
    type: 'fill',
    // The reason this basemap exists at all: 22 of 36 route edges are river, unmapped by every
    // commercial provider. A muted atrato blue so the honesty circles still read on top.
    paint: { 'fill-color': '#a9c9d6' },
  },
  {
    id: 'pm-roads',
    'source-layer': 'roads',
    type: 'line',
    paint: { 'line-color': '#d8cfc2', 'line-width': 1.2 },
  },
  {
    id: 'pm-boundaries',
    'source-layer': 'boundaries',
    type: 'line',
    paint: { 'line-color': '#b8afa4', 'line-width': 1, 'line-dasharray': [2, 2] },
  },
] as const

/** Required attribution for a Protomaps/OSM-derived archive. */
export const ATRIBUCION_PMTILES =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>, <a href="https://protomaps.com" target="_blank" rel="noreferrer">Protomaps</a>'

/**
 * Returns a copy of a data-only style with the PMTiles vector basemap slipped in underneath.
 *
 * Nothing in the input is mutated: the same `fuentesYCapas` result can still be rendered
 * tile-free by the offline `vista:mapa` check, or composed with the OSM raster by
 * `estiloConBasemap`. The basemap layers go directly above the `background` fill and below
 * every data layer, so the accuracy circles, pins and schematic connectors always draw ON TOP.
 *
 * @param urlArchivo an absolute URL to the `.pmtiles` file (see {@link urlAbsolutaPmtiles}).
 */
export function estiloConPmtiles<E extends EstiloBase>(estilo: E, urlArchivo: string) {
  const capas = [...estilo.layers]
  const iFondo = capas.findIndex((c) => c.type === 'background')
  const capasBase = CAPAS_BASE.map((c) => ({ ...c, source: 'protomaps' }))
  capas.splice(iFondo >= 0 ? iFondo + 1 : 0, 0, ...capasBase)
  return {
    ...estilo,
    sources: {
      ...estilo.sources,
      protomaps: {
        type: 'vector' as const,
        url: `pmtiles://${urlArchivo}`,
        attribution: ATRIBUCION_PMTILES,
      },
    },
    layers: capas,
  }
}

/**
 * Picks the basemap for this deployment: the offline PMTiles archive when one is configured
 * (it works online AND offline — it IS the offline-capable basemap), otherwise the online OSM
 * raster of `basemap.ts`. With no archive built — the state of this repo today — the result is
 * byte-for-byte the OSM path, so the online panel map is unchanged. PRD-13: «loads from the
 * local PMTiles bundle when offline, falling back to online tiles when available.»
 */
export function estiloDeMapa<E extends EstiloBase>(estilo: E) {
  return hayPaqueteOffline()
    ? estiloConPmtiles(estilo, urlAbsolutaPmtiles())
    : estiloConBasemap(estilo)
}

let protocoloRegistrado = false

/**
 * Registers the `pmtiles://` protocol on MapLibre so a `vector` source can point at a local
 * archive. Idempotent, client-only, and a no-op unless an archive is configured — so a
 * deployment with no bundle never pays for the `pmtiles` import, and the online OSM path is
 * byte-for-byte what it was.
 */
export async function registrarProtocoloPmtiles(): Promise<void> {
  if (protocoloRegistrado || !hayPaqueteOffline() || typeof window === 'undefined') return
  const [{ addProtocol }, { Protocol }] = await Promise.all([
    import('maplibre-gl'),
    import('pmtiles'),
  ])
  const protocolo = new Protocol()
  addProtocol('pmtiles', protocolo.tile)
  protocoloRegistrado = true
}
