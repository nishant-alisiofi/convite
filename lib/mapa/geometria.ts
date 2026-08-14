/**
 * Turning an accuracy radius into something a map can draw.
 *
 * A circle on screen has to be a circle *on the ground*: a fixed pixel radius would shrink
 * the uncertainty as the coordinator zooms in, which is precisely backwards — the closer
 * you look at a centroid, the more wrong a dot becomes. So the radius is drawn as a real
 * polygon in WGS84 and scales with the map like any other geography.
 */

const RADIO_TIERRA_M = 6_371_008.8

/** Enough segments that the edge reads as a circle at any zoom, few enough to stay cheap. */
const LADOS = 64

export type Anillo = [number, number][]

/**
 * A closed ring approximating a circle of `radioM` around a point, as `[lon, lat]` pairs in
 * GeoJSON order.
 *
 * Uses the spherical destination-point formula rather than a flat offset, because a degree
 * of longitude is not a degree of latitude and a naive version draws visible ellipses. At
 * Chocó's latitude the error either way is small — the formula is here so the shape stays
 * honest wherever the basin's bounding box ends up.
 */
export function anilloCircular(
  lat: number,
  lon: number,
  radioM: number,
  lados: number = LADOS,
): Anillo {
  const rad = Math.PI / 180
  const angular = radioM / RADIO_TIERRA_M
  const lat1 = lat * rad
  const lon1 = lon * rad
  const senoLat1 = Math.sin(lat1)
  const cosLat1 = Math.cos(lat1)

  const anillo: Anillo = []
  for (let i = 0; i <= lados; i += 1) {
    // The last vertex repeats the first: GeoJSON rings must close.
    const rumbo = (i % lados) * ((2 * Math.PI) / lados)
    const lat2 = Math.asin(
      senoLat1 * Math.cos(angular) + cosLat1 * Math.sin(angular) * Math.cos(rumbo),
    )
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(rumbo) * Math.sin(angular) * cosLat1,
        Math.cos(angular) - senoLat1 * Math.sin(lat2),
      )
    anillo.push([lon2 / rad, lat2 / rad])
  }
  return anillo
}

/** Metres between two WGS84 points, for labelling a schematic connector. */
export function distanciaM(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(a.lat * rad) * Math.cos(b.lat * rad)
  return 2 * RADIO_TIERRA_M * Math.asin(Math.sqrt(h))
}
