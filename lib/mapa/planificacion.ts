import type { FaseRespuesta, Modo, Temporada } from '@/db/schema/vocabulario'
import type { TemporadaActual } from '@/lib/matching/tipos'

/**
 * The planning surface's reasoning, kept out of React and out of the database (§23).
 *
 * PRD-32 turns the map from a picture of the present into a surface you plan on. Everything
 * here is pure data in, pure data out: season resolution from a draft's date, costing an
 * ordered draft over the seasonal route graph, and aggregating a selected area. It is pure
 * for the same reason `lib/mapa/capas.ts` is — this is where a draft could quietly cost what
 * *today* costs instead of what its own month costs (§23.3), or where a damage-closed leg
 * could be silently routed around, and both are asserted in tests/planificacion.test.ts
 * rather than left to a component.
 *
 * The draft itself is never persisted here (§23.2, principle 7): nothing commits without a
 * person, and the jornada entity that consumes a confirmed draft is PRD-30. A draft lives as
 * client state; this module only reasons about one it is handed.
 */

// ── The draft's date picks the season, and the season picks the route (§23.3) ────────────

/**
 * Which season a draft's date falls in, for the Atrato basin.
 *
 * The route graph is seasonal — Bellavista→Beté is 165 min in `lluvias` and 215 in `seca`,
 * and Winandó has no open path at all in `seca` — so a draft dated in October has to resolve
 * against October's rows, not against whatever `configuracion.temporada` says today (§23.3).
 * That resolution needs a date→season answer, and the system has none: `temporadaVigente`
 * reads an admin setting, never a calendar. This is that missing map.
 *
 * The boundary is the basin's climatology, not a claim about a specific year: the Atrato's
 * drier, lower-water months are December through March, and it is `lluvias` the rest of the
 * year (Chocó is one of the wettest places on earth — see `temporadaDeEntorno`). It is a
 * documented default, not a forecast; a coordinator can always override the resolved season
 * on the draft, which is why the season is shown, never hidden.
 */
export const MESES_SECA = [12, 1, 2, 3] as const

export function temporadaDeFecha(fechaISO: string): TemporadaActual {
  // Parse the calendar month from a YYYY-MM-DD string directly, without `new Date()`, so the
  // answer never shifts by a day across a timezone — a draft dated «2026-03-31» is seca in
  // Chocó no matter where the browser drawing it happens to be.
  const mes = Number(fechaISO.slice(5, 7))
  return (MESES_SECA as readonly number[]).includes(mes) ? 'seca' : 'lluvias'
}

// ── The seasonal route graph a draft is costed over ──────────────────────────────────────

/** One directed leg of the route graph, as the planner reasons about it. */
export type AristaPlan = {
  origenId: string
  destinoId: string
  origen: string
  destino: string
  modo: Modo
  /** Null means nobody has timed this leg — reachable, duration unknown, never zero. */
  minutos: number | null
  /** Null means nobody has costed it. Never invented (2.12); shown as unknown. */
  costoCop: number | null
  temporada: Temporada
  /** False when a person closed it after a verified damage report (§9.3). */
  activa: boolean
  /** Why it was closed and by implication when — carried so the draft can flag it. */
  motivoCierre: string | null
}

/** A resolved path between two stops, for the draft's season. */
export type Pierna =
  | {
      estado: 'ok'
      origenId: string
      destinoId: string
      /** The legs actually traversed, in order. */
      aristas: AristaPlan[]
      minutos: number | null
      costoCop: number | null
      /** False when some leg on the path is untimed — do not quote the total time. */
      tiempoCierto: boolean
      /** False when some leg on the path is uncosted — do not quote the total cost. */
      costoCierto: boolean
    }
  | {
      /** A path exists this season only if we ignore a damage-closed leg. Stays closed. */
      estado: 'cerrada'
      origenId: string
      destinoId: string
      /** The closed legs standing in the way, with their reasons (§23.3). */
      cierres: { arista: AristaPlan; motivo: string | null }[]
    }
  | {
      /** No path at all this season — Winandó in `seca`. Never an invented detour. */
      estado: 'sin_ruta'
      origenId: string
      destinoId: string
    }

type Adyacencia = Map<string, AristaPlan[]>

/** Cost assumed for an untimed leg. Orders paths only; never surfaced as a real number. */
const MINUTOS_DESCONOCIDOS = 24 * 60

function adyacenciaDe(aristas: readonly AristaPlan[], temporada: TemporadaActual, incluirCerradas: boolean): Adyacencia {
  const salientes: Adyacencia = new Map()
  for (const a of aristas) {
    if (!incluirCerradas && !a.activa) continue
    if (a.temporada !== 'todo_el_ano' && a.temporada !== temporada) continue
    const lista = salientes.get(a.origenId)
    if (lista) lista.push(a)
    else salientes.set(a.origenId, [a])
  }
  return salientes
}

type Rastro = { minutos: number; aristas: AristaPlan[] }

/** Cheapest-by-time path over a given adjacency, or null when unreachable. */
function caminoMasCorto(salientes: Adyacencia, origen: string, destino: string): AristaPlan[] | null {
  if (origen === destino) return []
  const mejor = new Map<string, Rastro>([[origen, { minutos: 0, aristas: [] }]])
  const pendientes = new Set<string>([origen])

  while (pendientes.size > 0) {
    let actual: string | null = null
    let costoActual = Number.POSITIVE_INFINITY
    for (const candidato of pendientes) {
      const r = mejor.get(candidato)!
      if (r.minutos < costoActual) {
        costoActual = r.minutos
        actual = candidato
      }
    }
    if (actual === null) break
    pendientes.delete(actual)

    const rastroActual = mejor.get(actual)!
    for (const arista of salientes.get(actual) ?? []) {
      const costo = rastroActual.minutos + (arista.minutos ?? MINUTOS_DESCONOCIDOS)
      const previo = mejor.get(arista.destinoId)
      if (!previo || costo < previo.minutos) {
        mejor.set(arista.destinoId, { minutos: costo, aristas: [...rastroActual.aristas, arista] })
        pendientes.add(arista.destinoId)
      }
    }
  }

  return mejor.get(destino)?.aristas ?? null
}

/**
 * Resolve one leg of a draft — origen → destino — for the draft's season.
 *
 * Honest by construction (§23.3): an open path is costed from its real legs; a path that
 * exists *only* if a damage-closed leg is reopened comes back `cerrada` with the closure
 * reasons, never routed around silently; and a pair with no row this season comes back
 * `sin_ruta`, never an invented detour.
 */
export function resolverPierna(
  aristas: readonly AristaPlan[],
  origenId: string,
  destinoId: string,
  temporada: TemporadaActual,
): Pierna {
  const abierto = caminoMasCorto(adyacenciaDe(aristas, temporada, false), origenId, destinoId)
  if (abierto) {
    let minutos = 0
    let costoCop = 0
    let tiempoCierto = true
    let costoCierto = true
    for (const a of abierto) {
      if (a.minutos === null) tiempoCierto = false
      else minutos += a.minutos
      if (a.costoCop === null) costoCierto = false
      else costoCop += a.costoCop
    }
    return {
      estado: 'ok',
      origenId,
      destinoId,
      aristas: abierto,
      minutos: tiempoCierto ? minutos : null,
      costoCop: costoCierto ? costoCop : null,
      tiempoCierto,
      costoCierto,
    }
  }

  // No open path. Is it closed by a damage report, or simply out of season?
  const conCerradas = caminoMasCorto(adyacenciaDe(aristas, temporada, true), origenId, destinoId)
  if (conCerradas) {
    const cierres = conCerradas
      .filter((a) => !a.activa)
      .map((arista) => ({ arista, motivo: arista.motivoCierre }))
    return { estado: 'cerrada', origenId, destinoId, cierres }
  }
  return { estado: 'sin_ruta', origenId, destinoId }
}

// ── The draft jornada, and its costing (§23.2, §23.5, §23.6) ─────────────────────────────

/**
 * A draft jornada — the single object both entry points produce (§23.2).
 *
 * Supply-first (`Planear este viaje` on an offered transport) and demand-first (select an
 * area, ask who serves it) both fill this in. It is client state: saveable, several at once,
 * committed to a real jornada only by a person, in PRD-30.
 */
export type Borrador = {
  id: string
  nombre: string
  /** YYYY-MM-DD. The date that picks the season, and with it the route (§23.3). */
  fecha: string
  /** Ordered community ids — the stops, in the order they are visited. */
  paradas: string[]
  /** Offered capacity in families, when a transport is known (supply-first). Null otherwise. */
  cupoOfrecido: number | null
}

/** Per-community facts the costing needs: how many families are waiting at each stop. */
export type NecesidadComunidad = {
  id: string
  nombre: string
  /** Families named across that community's pending requests — the demand to serve. */
  familiasPendientes: number
}

export type CosteoBorrador = {
  temporada: TemporadaActual
  piernas: Pierna[]
  /** Total travel time in minutes, or null when any traversed leg is untimed. */
  minutosTotal: number | null
  /** Total cost in COP, or null when any traversed leg is uncosted. */
  costoTotal: number | null
  /** True when a stop is only reachable through a damage-closed leg — flagged, not routed. */
  hayCerradas: boolean
  /** True when a consecutive pair has no path at all this season. */
  haySinRuta: boolean
  /** Families to serve across the stops — the required capacity. */
  familiasRequeridas: number
  cupoOfrecido: number | null
  /** Required − offered when positive; the named shortfall (§23.5). Null when no cupo given. */
  faltante: number | null
}

/**
 * Cost an ordered draft over the seasonal graph for its own date (§23.3, §23.5).
 *
 * The season comes from the draft's date, never from today. Each consecutive pair of stops
 * is resolved as its own leg; a closed or missing leg is carried through as a flag, so the
 * total is honest about what it does not know rather than quietly dropping a stop.
 */
export function costearBorrador(
  borrador: Borrador,
  aristas: readonly AristaPlan[],
  necesidades: ReadonlyMap<string, NecesidadComunidad>,
): CosteoBorrador {
  const temporada = temporadaDeFecha(borrador.fecha)
  const piernas: Pierna[] = []

  let minutosTotal = 0
  let costoTotal = 0
  let tiempoCierto = true
  let costoCierto = true
  let hayCerradas = false
  let haySinRuta = false

  for (let i = 0; i + 1 < borrador.paradas.length; i += 1) {
    const pierna = resolverPierna(aristas, borrador.paradas[i]!, borrador.paradas[i + 1]!, temporada)
    piernas.push(pierna)
    if (pierna.estado === 'ok') {
      if (pierna.minutos === null) tiempoCierto = false
      else minutosTotal += pierna.minutos
      if (pierna.costoCop === null) costoCierto = false
      else costoTotal += pierna.costoCop
    } else if (pierna.estado === 'cerrada') {
      hayCerradas = true
      tiempoCierto = false
      costoCierto = false
    } else {
      haySinRuta = true
      tiempoCierto = false
      costoCierto = false
    }
  }

  let familiasRequeridas = 0
  for (const id of borrador.paradas) {
    familiasRequeridas += necesidades.get(id)?.familiasPendientes ?? 0
  }

  const faltante =
    borrador.cupoOfrecido === null ? null : Math.max(0, familiasRequeridas - borrador.cupoOfrecido)

  return {
    temporada,
    piernas,
    minutosTotal: tiempoCierto ? minutosTotal : null,
    costoTotal: costoCierto ? costoTotal : null,
    hayCerradas,
    haySinRuta,
    familiasRequeridas,
    cupoOfrecido: borrador.cupoOfrecido,
    faltante,
  }
}

// ── Assessment recency — the layer nobody else has (§23.4) ────────────────────────────────

/**
 * How long ago a community was last surveyed, bucketed for the map (§23.4).
 *
 * `nunca` is a first-class, distinct bucket, not a zero: a community nobody has ever assessed
 * is the diagnostic team's next destination and the honest answer to «how do you know you are
 * reaching everyone». The recency signal is `comunidades.verificado_en` — when someone from
 * the territory last confirmed the community (§14) — which is the closest thing the system
 * holds to «last surveyed» until PRD-29 lands the assessment record itself. Every seeded row
 * has it NULL on purpose, so today the whole basin renders as `nunca`: honestly grey.
 */
export type RecenciaEvaluacion = 'reciente' | 'media' | 'vieja' | 'nunca'

/** Bucket boundaries in days. A survey older than a year reads as `vieja`; within 90 `reciente`. */
export const DIAS_RECIENTE = 90
export const DIAS_MEDIA = 365

export function recenciaEvaluacion(
  verificadoEn: string | null,
  ahora: string | number | Date = Date.now(),
): RecenciaEvaluacion {
  if (verificadoEn === null) return 'nunca'
  const dias = diasEntre(verificadoEn, ahora)
  if (dias <= DIAS_RECIENTE) return 'reciente'
  if (dias <= DIAS_MEDIA) return 'media'
  return 'vieja'
}

/** Whole days between an ISO timestamp and a reference instant. Never negative. */
export function diasEntre(desdeISO: string, ahora: string | number | Date = Date.now()): number {
  const a = new Date(desdeISO).getTime()
  const b = new Date(ahora).getTime()
  return Math.max(0, Math.floor((b - a) / 86_400_000))
}

// ── Area selection: what falls inside, and what it aggregates (§23.5) ─────────────────────

/** A [lon, lat] vertex, GeoJSON order — the same order the map draws in. */
export type Vertice = [number, number]

/**
 * Whether a point is inside a polygon, by ray casting.
 *
 * Used for the «draw a polygon» selection (§23.5). A community with no located point is never
 * inside anything — 2.2 again: we do not place it somewhere convenient to make it selectable.
 */
export function puntoEnPoligono(lon: number, lat: number, poligono: readonly Vertice[]): boolean {
  let dentro = false
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i, i += 1) {
    const [xi, yi] = poligono[i]!
    const [xj, yj] = poligono[j]!
    const cruza = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (cruza) dentro = !dentro
  }
  return dentro
}

/** Per-community facts the selection panel aggregates. */
export type ComunidadSeleccionable = {
  id: string
  codigo: string
  nombre: string
  municipio: string
  agrupador: string | null
  regionId: string | null
  familiasEstimadas: number | null
  tierConectividad: number
  /** Assessment recency source (§23.4). NULL = never surveyed. */
  verificadoEn: string | null
  /** Most recent contact from anyone in the community. NULL = never heard from (§23.5). */
  ultimoContacto: string | null
  pendientesPorCategoria: { codigo: string; etiqueta: string; pedidos: number; familias: number }[]
  pendientesPorEstado: { estado: string; pedidos: number; familias: number }[]
}

export type ResumenSeleccion = {
  comunidades: number
  familiasEstimadas: number
  pendientesPorCategoria: { codigo: string; etiqueta: string; pedidos: number; familias: number }[]
  pendientesPorEstado: { estado: string; pedidos: number; familias: number }[]
  /** Coverage as «assessed of estimated total» plus its age — never a bare count (§23.5). */
  cobertura: {
    evaluadas: number
    total: number
    /** Days since the most recent assessment in the selection; null when none assessed. */
    edadMasRecienteDias: number | null
    /** Days since the oldest assessment; null when none assessed — the worst gap. */
    edadMasAntiguaDias: number | null
  }
  /** Names of communities never surveyed (§23.5). */
  nuncaEvaluadas: string[]
  /** Names of communities never heard from — «who has never spoken» (§23.5). */
  nuncaContactadas: string[]
}

function sumarBuckets(
  acc: Map<string, { etiqueta: string; pedidos: number; familias: number }>,
  clave: string,
  etiqueta: string,
  pedidos: number,
  familias: number,
): void {
  const prev = acc.get(clave)
  if (prev) {
    prev.pedidos += pedidos
    prev.familias += familias
  } else {
    acc.set(clave, { etiqueta, pedidos, familias })
  }
}

/**
 * Aggregate the communities in a selection into the panel's answer (§23.5).
 *
 * Coverage is returned as «assessed of total» with an age, never a bare count, because a
 * count with no denominator and no age is exactly the false certainty this layer exists to
 * refuse: «12 assessed» hides both how many were missed and how stale the twelve are.
 */
export function agregarSeleccion(
  comunidades: readonly ComunidadSeleccionable[],
  ahora: string | number | Date = Date.now(),
): ResumenSeleccion {
  const porCategoria = new Map<string, { etiqueta: string; pedidos: number; familias: number }>()
  const porEstado = new Map<string, { etiqueta: string; pedidos: number; familias: number }>()
  const nuncaEvaluadas: string[] = []
  const nuncaContactadas: string[] = []

  let familiasEstimadas = 0
  let evaluadas = 0
  let edadMasReciente: number | null = null
  let edadMasAntigua: number | null = null

  for (const c of comunidades) {
    familiasEstimadas += c.familiasEstimadas ?? 0

    for (const p of c.pendientesPorCategoria) {
      sumarBuckets(porCategoria, p.codigo, p.etiqueta, p.pedidos, p.familias)
    }
    for (const p of c.pendientesPorEstado) {
      sumarBuckets(porEstado, p.estado, p.estado, p.pedidos, p.familias)
    }

    if (c.verificadoEn === null) {
      nuncaEvaluadas.push(c.nombre)
    } else {
      evaluadas += 1
      const dias = diasEntre(c.verificadoEn, ahora)
      edadMasReciente = edadMasReciente === null ? dias : Math.min(edadMasReciente, dias)
      edadMasAntigua = edadMasAntigua === null ? dias : Math.max(edadMasAntigua, dias)
    }

    if (c.ultimoContacto === null) nuncaContactadas.push(c.nombre)
  }

  const orden = (m: Map<string, { etiqueta: string; pedidos: number; familias: number }>) =>
    [...m.entries()]
      .map(([clave, v]) => ({ ...v, clave }))
      .sort((a, b) => b.familias - a.familias)

  return {
    comunidades: comunidades.length,
    familiasEstimadas,
    pendientesPorCategoria: orden(porCategoria).map((v) => ({
      codigo: v.clave,
      etiqueta: v.etiqueta,
      pedidos: v.pedidos,
      familias: v.familias,
    })),
    pendientesPorEstado: orden(porEstado).map((v) => ({
      estado: v.clave,
      pedidos: v.pedidos,
      familias: v.familias,
    })),
    cobertura: {
      evaluadas,
      total: comunidades.length,
      edadMasRecienteDias: edadMasReciente,
      edadMasAntiguaDias: edadMasAntigua,
    },
    nuncaEvaluadas,
    nuncaContactadas,
  }
}

// ── Which routes serve a selection (§23.5) ───────────────────────────────────────────────

export type RutaEnArea = {
  origen: string
  destino: string
  modo: Modo
  temporada: Temporada
  activa: boolean
  minutos: number | null
  costoCop: number | null
}

/**
 * The routes that touch a set of communities — «which routes serve the area, open under which
 * season» (§23.5). A leg counts if either endpoint is in the selection. Directed pairs are
 * collapsed the way the map draws them, so a two-way leg is one row carrying both seasons'
 * state rather than four near-identical lines.
 */
export function rutasQueSirven(
  aristas: readonly AristaPlan[],
  idsSeleccionados: ReadonlySet<string>,
): RutaEnArea[] {
  const porClave = new Map<string, RutaEnArea>()
  for (const a of aristas) {
    if (!idsSeleccionados.has(a.origenId) && !idsSeleccionados.has(a.destinoId)) continue
    const [x, y] = [a.origenId, a.destinoId].sort() as [string, string]
    const clave = `${x}|${y}|${a.modo}|${a.temporada}`
    if (porClave.has(clave)) {
      // A pair already seen from the other direction: keep it closed if either way is closed.
      const prev = porClave.get(clave)!
      prev.activa = prev.activa && a.activa
      continue
    }
    porClave.set(clave, {
      origen: a.origen,
      destino: a.destino,
      modo: a.modo,
      temporada: a.temporada,
      activa: a.activa,
      minutos: a.minutos,
      costoCop: a.costoCop,
    })
  }
  return [...porClave.values()].sort(
    (p, q) => p.origen.localeCompare(q.origen) || p.temporada.localeCompare(q.temporada),
  )
}

// ── Phase decides which layer opens first, never the structure (§18) ──────────────────────

/** The independently-toggleable map layers (§23.4). */
export type CapaId =
  | 'pedidos'
  | 'existencias'
  | 'rutas'
  | 'recencia'
  | 'conexion'
  | 'conectividad'
  | 'silencio'
  | 'contacto'
  | 'cems'

/**
 * The operational phase (§18).
 *
 * It *is* a stored value now — `organizaciones.fase`, declared at onboarding (migration 0065)
 * — so this is no longer «future work» and the surface no longer has to default blindly.
 * Derived from `FASES_RESPUESTA` rather than restating the four strings, so the column's check
 * constraint and this union cannot drift apart.
 */
export type Fase = FaseRespuesta

/**
 * What the map opens on for each phase (§18). Phase changes what opens first, never the
 * structure: the same layers exist in every phase, and only the one that leads changes.
 */
export function capaInicialPorFase(fase: Fase): CapaId {
  switch (fase) {
    case 'impacto':
      return 'contacto' // silence, unreachable communities → contact recency
    case 'emergencia':
      return 'pedidos' // stuck states, matches to confirm → routes and stock
    case 'recuperacion':
      return 'recencia' // assessments to review → assessment coverage
    case 'ordinario':
      return 'conexion' // scheduling → connection points and windows
  }
}
