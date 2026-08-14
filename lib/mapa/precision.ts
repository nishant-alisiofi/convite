import { PRECISION_POR_FUENTE, type FuenteUbicacion } from '@/db/schema/vocabulario'

/**
 * How a stored location is allowed to be drawn.
 *
 * Non-negotiable 2.2, and the thing an information-management team checks first: a centroid
 * is not a pin. Thirteen of thirteen seeded communities are `centroide` with a 1000 m
 * radius, which means the honest map of this basin today is a map with no pins on it at
 * all. Drawing them as dots would claim we know where people are to within a few metres,
 * and somebody would plan a landing on that.
 *
 * The rule is deliberately driven by the *radius*, not by the source name. A row claiming
 * `gps` while carrying a 1000 m accuracy is either bad data or a silent upgrade, and in
 * both cases the circle is the truthful picture. Shape follows the number we actually hold.
 */

export type Ubicacion = {
  lat: number | null
  lon: number | null
  fuente: FuenteUbicacion | null
  precisionM: number | null
}

/**
 * Stroke styles run solid → dashed → dotted as confidence drops, so the four sources stay
 * distinguishable at a glance even where their radii happen to coincide.
 *   manual    a person placed it deliberately and stated the radius
 *   centroide derived from a populated-place centroid, nobody has been there
 *   referida  relayed by radio or a third party — the weakest thing we store
 */
export type Trazo = 'solido' | 'discontinuo' | 'punteado'

export type Representacion =
  | { forma: 'ausente' }
  | { forma: 'pin'; lat: number; lon: number }
  | { forma: 'circulo'; lat: number; lon: number; radioM: number; trazo: Trazo }

const TRAZO_POR_FUENTE: Record<FuenteUbicacion, Trazo> = {
  gps: 'solido',
  manual: 'solido',
  centroide: 'discontinuo',
  referida: 'punteado',
}

/**
 * The accuracy radius in metres for a stored location.
 *
 * A declared `ubicacion_precision_m` always wins — it is what whoever saved the row said
 * they knew. The per-source defaults only cover rows that predate the column or arrive
 * without one, and `manual` has no default on purpose: staff enter the radius, and guessing
 * one for them would be inventing the very number this column exists to record.
 */
export function radioDe(fuente: FuenteUbicacion | null, precisionM: number | null): number | null {
  if (precisionM !== null) return precisionM
  if (fuente === null) return null
  return PRECISION_POR_FUENTE[fuente] ?? null
}

/**
 * What to draw for a location, or `ausente` when there is nothing honest to draw.
 *
 * `ausente` is a real case, not a defect: Acopio Yuto has no coordinates because nobody has
 * located it yet. Every map surface has to say so rather than drop the node or park it at
 * the centre of the basin.
 */
export function representacionDe(ubicacion: Ubicacion): Representacion {
  const { lat, lon, fuente, precisionM } = ubicacion
  if (lat === null || lon === null || fuente === null) return { forma: 'ausente' }

  const radioM = radioDe(fuente, precisionM)
  // No stated radius and no default: we know roughly where it is and cannot say how
  // roughly. A pin would be a lie, so the caller lists it rather than drawing it.
  if (radioM === null) return { forma: 'ausente' }

  // Only an exact fix earns a point. Everything else is an area.
  if (radioM === 0) return { forma: 'pin', lat, lon }

  return { forma: 'circulo', lat, lon, radioM, trazo: TRAZO_POR_FUENTE[fuente] }
}
