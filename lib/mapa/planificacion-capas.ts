import { coleccion, type Coleccion, type Posicion, type Rasgo } from './capas'
import { anilloCircular } from './geometria'
import { representacionDe, type Ubicacion } from './precision'
import type { Pierna, RecenciaEvaluacion } from './planificacion'
import { diasEntre, recenciaEvaluacion } from './planificacion'

/**
 * The geometry the planning overlays draw, kept pure and tile-free (§23, §10).
 *
 * This is the §23.1 rule made literal: facts are drawn by `lib/mapa/capas.ts` (solid, or the
 * confidence dash a source earns); everything a *draft* draws is built here and drawn dashed
 * on top. The two never blur — a coordinator never has to be told which line is the plan and
 * which is the river, because the plan is the dashed one (§23.1). Same discipline as `capas.ts`:
 * pure functions, GeoJSON only, no basemap and no `raster` source ever, so the honesty layer
 * can never quietly acquire a tile fetch. The component composes these on top of the base.
 */

// ── Assessment recency: shade communities by time since last survey (§23.4) ───────────────

/**
 * The recency ramp. `nunca` is a distinct, deliberately flat grey — not a colour on the
 * warm→cool age scale — because a community nobody has ever surveyed is a different statement
 * from an old survey: it is the team's next destination, and the honest answer to «how do you
 * know you are reaching everyone». It must not read as «just very old».
 */
export const RECENCIA_COLOR: Record<RecenciaEvaluacion, string> = {
  reciente: '#2c7a5f', // selva — surveyed within the quarter
  media: '#8a6229', // barro — within the year
  vieja: '#b45309', // amber — over a year, the picture is stale
  nunca: '#9ca3af', // grey — never surveyed, the diagnostic gap itself
}

export const RECENCIA_ETIQUETA: Record<RecenciaEvaluacion, string> = {
  reciente: 'Evaluada hace menos de 3 meses',
  media: 'Evaluada en el último año',
  vieja: 'Evaluada hace más de un año',
  nunca: 'Nunca evaluada',
}

/** A community as the recency layer needs it: where it is, and when it was last surveyed. */
export type ComunidadRecencia = Ubicacion & {
  nombre: string
  verificadoEn: string | null
}

/**
 * The assessment-recency circles (§23.4).
 *
 * The shape is still exactly what precision earns — a `centroide` is a kilometre-wide dashed
 * ring, never a pin (2.2) — because it comes from the same `representacionDe`. Only the fill
 * colour changes, to the recency shade. Toggling this layer recolours the basin by how long
 * ago each place was heard from; it never promotes a circle to a dot.
 */
export function coleccionRecencia(
  comunidades: readonly ComunidadRecencia[],
  ahora: string | number | Date = Date.now(),
): Coleccion {
  const features: Rasgo[] = []
  for (const c of comunidades) {
    const figura = representacionDe(c)
    if (figura.forma === 'ausente') continue
    const recencia = recenciaEvaluacion(c.verificadoEn, ahora)
    const color = RECENCIA_COLOR[recencia]
    const edadDias = c.verificadoEn === null ? -1 : diasEntre(c.verificadoEn, ahora)
    if (figura.forma === 'pin') {
      features.push({
        type: 'Feature',
        properties: { nombre: c.nombre, color, recencia, edadDias, forma: 'pin' },
        geometry: { type: 'Point', coordinates: [figura.lon, figura.lat] },
      })
      continue
    }
    features.push({
      type: 'Feature',
      properties: {
        nombre: c.nombre,
        color,
        recencia,
        edadDias,
        radioM: figura.radioM,
        trazo: figura.trazo,
      },
      geometry: { type: 'Polygon', coordinates: [anilloCircular(figura.lat, figura.lon, figura.radioM)] },
    })
  }
  return coleccion(features)
}

// ── Connectivity tier, last contact and silence — generic circle shadings (§23.4) ────────

/** Connectivity tier colours (§23.4). 1 = reliable data … 4 = radio relay only. */
export const TIER_COLOR: Record<number, string> = {
  1: '#2c7a5f', // reliable data
  2: '#8a6229', // intermittent
  3: '#b45309', // voice / SMS only
  4: '#e11d48', // radio relay only — the hardest to reach
}

export const TIER_ETIQUETA: Record<number, string> = {
  1: 'Datos confiables',
  2: 'Intermitente',
  3: 'Solo voz / SMS',
  4: 'Solo relevo por radio',
}

export function colorTier(tier: number): string {
  return TIER_COLOR[tier] ?? '#9ca3af'
}

/**
 * Whether a community is «in silence» (§23.4 / §9.8): heard from longer ago than its own
 * check interval, or never heard from at all. Silence is a signal, not an absence of need,
 * so a never-contacted community counts as in silence — the loudest case, not an exemption.
 */
export function enSilencio(
  ultimoContacto: string | null,
  intervaloDias: number,
  ahora: string | number | Date = Date.now(),
): boolean {
  if (ultimoContacto === null) return true
  return diasEntre(ultimoContacto, ahora) > intervaloDias
}

/** A community as a generic coloured shading needs it — its point, and a precomputed colour. */
export type CirculoColoreado = Ubicacion & { nombre: string; color: string; detalle?: string }

/**
 * Generic coloured-circle shading, honouring precision the same way every other layer does
 * (2.2): the shape is what `representacionDe` returns, only the fill colour is the caller's.
 * Used by the connectivity-tier and last-contact layers, which differ from recency only in
 * how the colour is chosen — so they share one tested geometry builder rather than three.
 */
export function coleccionCirculos(items: readonly CirculoColoreado[]): Coleccion {
  const features: Rasgo[] = []
  for (const it of items) {
    const figura = representacionDe(it)
    if (figura.forma === 'ausente') continue
    const props: Record<string, string | number | boolean> = { nombre: it.nombre, color: it.color }
    if (it.detalle !== undefined) props.detalle = it.detalle
    if (figura.forma === 'pin') {
      features.push({
        type: 'Feature',
        properties: { ...props, forma: 'pin' },
        geometry: { type: 'Point', coordinates: [figura.lon, figura.lat] },
      })
      continue
    }
    features.push({
      type: 'Feature',
      properties: { ...props, radioM: figura.radioM, trazo: figura.trazo },
      geometry: { type: 'Polygon', coordinates: [anilloCircular(figura.lat, figura.lon, figura.radioM)] },
    })
  }
  return coleccion(features)
}

// ── Connection points (§23.4 / §5.9) ─────────────────────────────────────────────────────

export type PuntoConexionFigura = Ubicacion & {
  id: string
  nombre: string
  tipo: string
  seguridad: string
  energia: string
}

/**
 * Connection points as their own markers (§23.4). Located like everything else on this map:
 * a point with no coordinate is not placed somewhere convenient, it is simply absent from the
 * layer (2.2) and stays listed in the panel instead.
 */
export function coleccionConexion(puntos: readonly PuntoConexionFigura[]): Coleccion {
  const features: Rasgo[] = []
  for (const p of puntos) {
    const figura = representacionDe(p)
    if (figura.forma === 'ausente') continue
    // A connection point is drawn at its located centre whether that is a pin or a circle —
    // it is a place people walk to, marked as a point, not shaded as an area.
    const { lon, lat } = figura
    features.push({
      type: 'Feature',
      properties: { id: p.id, nombre: p.nombre, tipo: p.tipo, seguridad: p.seguridad, energia: p.energia },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    })
  }
  return coleccion(features)
}

// ── The draft overlay: stops and the route being composed, dashed (§23.1) ─────────────────

/** A stop that can anchor a drawn draft: it has a point (an unlocated stop is listed, not drawn). */
export type ParadaFigura = { id: string; nombre: string; lat: number | null; lon: number | null }

/**
 * The draft's stops, in order (§23.2). Drawn as points carrying their visit order, so the
 * coordinator sees the sequence they chose. A stop with no coordinate is skipped here and
 * surfaced in the panel — never placed at a convenient guess.
 */
export function coleccionParadasBorrador(paradas: readonly ParadaFigura[]): Coleccion {
  const features: Rasgo[] = []
  paradas.forEach((p, i) => {
    if (p.lat === null || p.lon === null) return
    features.push({
      type: 'Feature',
      properties: { nombre: p.nombre, orden: i + 1 },
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    })
  })
  return coleccion(features)
}

/**
 * The route being composed, as schematic dashed connectors between consecutive stops (§23.1,
 * §7.3). Straight lines on purpose — we hold no channel geometry, so a drawn draft leg is as
 * schematic as a fact leg, and drawn dashed because it is a *draft* over the facts. Each leg
 * carries the resolution `estado` so a leg that is `cerrada` (damage-closed) or `sin_ruta`
 * (out of season) can be drawn distinctly and never look like an open plan (§23.3).
 */
export function coleccionRutaBorrador(
  paradas: readonly ParadaFigura[],
  piernas?: readonly Pierna[],
): Coleccion {
  const features: Rasgo[] = []
  for (let i = 0; i + 1 < paradas.length; i += 1) {
    const a = paradas[i]!
    const b = paradas[i + 1]!
    if (a.lat === null || a.lon === null || b.lat === null || b.lon === null) continue
    const estado = piernas?.[i]?.estado ?? 'ok'
    features.push({
      type: 'Feature',
      properties: { estado, desde: a.nombre, hasta: b.nombre },
      geometry: {
        type: 'LineString',
        coordinates: [
          [a.lon, a.lat],
          [b.lon, b.lat],
        ] as Posicion[],
      },
    })
  }
  return coleccion(features)
}

/**
 * The area being selected (§23.5). While the polygon is still open (fewer than three
 * vertices, or mid-draw) it is returned as a `LineString` so it reads as a work-in-progress;
 * once closed it is a `Polygon`. Empty selection returns an empty collection.
 *
 * **Every vertex is also emitted as a Point**, and that is not decoration. Without it the
 * first click produced a one-coordinate LineString — geometry MapLibre renders as nothing at
 * all, silently — and the second produced a hairline. Somebody drawing an area clicked, saw
 * absolutely nothing happen, and reasonably concluded the tool was broken. The shape only
 * becomes self-evident on the third click, which is two clicks too late to be trusted.
 */
export function coleccionPoligono(vertices: readonly Posicion[]): Coleccion {
  if (vertices.length === 0) return coleccion([])

  const puntos = vertices.map((v, i) => ({
    type: 'Feature' as const,
    properties: { estado: 'vertice', indice: i },
    geometry: { type: 'Point' as const, coordinates: v },
  }))

  if (vertices.length < 3) {
    return coleccion([
      {
        type: 'Feature',
        properties: { estado: 'dibujando' },
        geometry: { type: 'LineString', coordinates: [...vertices] as Posicion[] },
      },
      ...puntos,
    ])
  }
  const anillo = [...vertices, vertices[0]!] as Posicion[]
  return coleccion([
    {
      type: 'Feature',
      properties: { estado: 'cerrado' },
      geometry: { type: 'Polygon', coordinates: [anillo] },
    },
    ...puntos,
  ])
}

/** Dash patterns for the draft overlay, in line-width units. Draft is dashed; closed is tighter. */
export const GUION_BORRADOR: Record<'ok' | 'cerrada' | 'sin_ruta', number[]> = {
  ok: [2, 1.5],
  cerrada: [1, 1],
  sin_ruta: [0.5, 1.5],
}

/** Colour for a draft leg by its resolution. A closed or missing leg is never drawn as open. */
export const COLOR_BORRADOR: Record<'ok' | 'cerrada' | 'sin_ruta', string> = {
  ok: '#4338ca', // indigo — the plan, distinct from every fact hue on the map
  cerrada: '#e11d48', // rose — closed by a damage report, flagged
  sin_ruta: '#a8a29e', // grey — no path this season
}
