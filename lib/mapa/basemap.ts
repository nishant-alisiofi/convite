/**
 * The real basemap, added underneath our own geography.
 *
 * §5.7 / §3: OpenStreetMap as the base, not Google. Of 36 route edges 22 are river, which
 * Google has no data for, and the landing sites a transporter needs are unmapped in every
 * provider — so the value of a basemap here is the coastline, the rivers and the roads OSM
 * *does* have, drawn under the circles and connectors this app knows. Standard OSM raster
 * tiles need no key, no billing account and no vector glyph server, which is why they are
 * the base and a vector style is not.
 *
 * This lives apart from `lib/mapa/capas.ts` on purpose. `fuentesYCapas` stays pure and
 * tile-free — it is the layer a test asserts never quietly grows a `raster` source, because
 * that is where a centroid could be silently promoted to a dot. The basemap is presentation:
 * it is composed on top at the component, so the honesty layer and the geography layer never
 * blur into one another.
 *
 * Non-negotiable 2.2 is untouched by any of this: a `centroide` is still a kilometre-wide
 * dashed circle drawn ON the real map, never a pin, because the shapes still come from
 * `figurasDe` and `representacionDe`. A truthful uncertainty over real ground reads as more
 * honest, not less — you can see the circle covers three bends of the river, not one house.
 */

/**
 * Standard OSM raster tiles. A single host, no subdomains: OSM deprecated the `a/b/c.`
 * prefixes, and one host over HTTP/2 is what the tile policy now expects.
 */
export const TESELAS_OSM = ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'] as const

/** Required by the OSM tile usage policy, and shown by the AttributionControl. */
export const ATRIBUCION_OSM =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'

/** The raster source, in the shape MapLibre's style spec expects. */
export const FUENTE_OSM = {
  type: 'raster' as const,
  tiles: [...TESELAS_OSM],
  tileSize: 256,
  // The web-Mercator maximum for these tiles; MapLibre overzooms past this so the map keeps
  // working when someone leans all the way in to place a pin on a building.
  maxzoom: 19,
  attribution: ATRIBUCION_OSM,
}

/** The layer that paints the basemap. Referenced by id so it can sit beneath everything else. */
export const CAPA_OSM = { id: 'osm', type: 'raster' as const, source: 'osm' }

type EstiloBase = {
  version: number
  sources: Record<string, unknown>
  layers: Record<string, unknown>[]
}

/**
 * Returns a copy of a data-only style with the OSM basemap slipped in underneath.
 *
 * The raster layer goes directly above the `background` fill (so the flat colour is only
 * ever seen for the instant before tiles arrive) and below every data layer, so the accuracy
 * circles, pins and schematic connectors always draw ON TOP of real geography. Nothing in
 * the input is mutated — the same `fuentesYCapas` result can still be rendered tile-free by
 * the offline `vista:mapa` check.
 */
export function estiloConBasemap<E extends EstiloBase>(estilo: E) {
  const capas = [...estilo.layers]
  const iFondo = capas.findIndex((c) => c.type === 'background')
  capas.splice(iFondo >= 0 ? iFondo + 1 : 0, 0, CAPA_OSM)
  return {
    ...estilo,
    sources: { ...estilo.sources, osm: FUENTE_OSM },
    layers: capas,
  }
}
