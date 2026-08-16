/**
 * The route graph.
 *
 * Section 7.3 is the whole story here: most of this basin is reachable only by boat, and
 * Google has no river data — no route, no travel time, no seasonality. Every fluvial leg
 * below is `fuente: 'manual'` with times a person who knows the river would give. None of
 * them carries a `distancia_m`: nobody has measured the channel, and a straight line is
 * meaningless when the real path is ninety minutes upriver. The column stays null rather
 * than holding a number we made up.
 *
 * Edges are directed because upstream and downstream are different trips — often by half
 * again as long. Seasonal legs appear twice, once per `temporada`.
 *
 * Shape of the basin:
 *
 *     road/trocha            river (Atrato, downstream →)
 *     SFI ─ TUT ─┐
 *     PAC ───────┤
 *     YUT ─ GUY ─┴─ QBD ──▶ BTA ──▶ MER ──▶ TAG ──▶ BET ──▶ BLL
 *                    │              └──▶ WIN  (solo en lluvias)
 *                    └──▶ PAI  (río Quito)
 *
 * MER→TAG is the chokepoint: deactivating that single leg cuts off Tagachí, Beté and
 * Bellavista at once. The M2 matcher tests rely on that.
 * MER→WIN exists only in `lluvias`; in `seca` Winandó has no open path at all.
 */

export type RutaSemilla = {
  origen: string
  destino: string
  modo: 'lancha' | 'chalupa' | 'carretera' | 'trocha' | 'avioneta'
  minutos: number
  distanciaM: number | null
  costoEstimadoCop: number | null
  temporada: 'todo_el_ano' | 'lluvias' | 'seca'
  fuente: 'google' | 'manual'
  activa: boolean
  notas?: string
}

type ParSemilla = {
  a: string
  b: string
  modo: RutaSemilla['modo']
  /** Minutes a→b, then b→a. Downstream first for river legs. */
  minutos: [number, number]
  distanciaM?: number | null
  costoEstimadoCop?: number | null
  temporada?: RutaSemilla['temporada']
  notas?: string
}

/** Expands a pair into the two directed edges. */
function par(p: ParSemilla): RutaSemilla[] {
  const base = {
    modo: p.modo,
    distanciaM: p.distanciaM ?? null,
    costoEstimadoCop: p.costoEstimadoCop ?? null,
    temporada: p.temporada ?? ('todo_el_ano' as const),
    fuente: 'manual' as const,
    activa: true,
    notas: p.notas,
  }
  return [
    { ...base, origen: p.a, destino: p.b, minutos: p.minutos[0] },
    { ...base, origen: p.b, destino: p.a, minutos: p.minutos[1] },
  ]
}

const PENDIENTE_GOOGLE =
  'Tiempo estimado por el equipo. Pendiente de recalcular con la Routes API cuando haya llave de Google.'

export const RUTAS_SEMILLA: RutaSemilla[] = [
  // ── Road and trail ────────────────────────────────────────────────────────────────
  // fuente stays 'manual' until M6 recalculates these with the Routes API. Section 7.2:
  // only carretera and trocha may ever be populated from Google.
  par({
    a: 'QBD',
    b: 'TUT',
    modo: 'carretera',
    minutos: [35, 35],
    distanciaM: 18000,
    costoEstimadoCop: 45000,
    notas: PENDIENTE_GOOGLE,
  }),
  par({
    a: 'QBD',
    b: 'GUY',
    modo: 'carretera',
    minutos: [25, 25],
    distanciaM: 12500,
    costoEstimadoCop: 30000,
    notas: PENDIENTE_GOOGLE,
  }),
  par({
    a: 'GUY',
    b: 'YUT',
    modo: 'carretera',
    minutos: [20, 20],
    distanciaM: 11000,
    costoEstimadoCop: 28000,
    notas: PENDIENTE_GOOGLE,
  }),
  par({
    a: 'QBD',
    b: 'PAC',
    modo: 'trocha',
    minutos: [55, 55],
    distanciaM: 9000,
    costoEstimadoCop: 35000,
    notas: 'Camino destapado. En aguacero fuerte se pone pesado pero se pasa.',
  }),
  // The same trail, twice, because it is a different trip in each season.
  par({
    a: 'TUT',
    b: 'SFI',
    modo: 'trocha',
    minutos: [90, 90],
    distanciaM: 12000,
    costoEstimadoCop: 40000,
    temporada: 'seca',
  }),
  par({
    a: 'TUT',
    b: 'SFI',
    modo: 'trocha',
    minutos: [150, 150],
    distanciaM: 12000,
    costoEstimadoCop: 55000,
    temporada: 'lluvias',
    notas: 'Barrizal. Solo moto alta o a pie.',
  }),

  // ── Atrato trunk, rainy season ────────────────────────────────────────────────────
  par({
    a: 'QBD',
    b: 'BTA',
    modo: 'lancha',
    minutos: [50, 70],
    costoEstimadoCop: 180000,
    temporada: 'lluvias',
  }),
  par({
    a: 'BTA',
    b: 'MER',
    modo: 'lancha',
    minutos: [45, 65],
    costoEstimadoCop: 160000,
    temporada: 'lluvias',
  }),
  par({
    a: 'MER',
    b: 'TAG',
    modo: 'lancha',
    minutos: [40, 60],
    costoEstimadoCop: 150000,
    temporada: 'lluvias',
    notas: 'Tramo cuello de botella: por aquí pasa todo lo que va para Tagachí y más abajo.',
  }),
  par({
    a: 'TAG',
    b: 'BET',
    modo: 'lancha',
    minutos: [35, 50],
    costoEstimadoCop: 140000,
    temporada: 'lluvias',
  }),
  par({
    a: 'BET',
    b: 'BLL',
    modo: 'lancha',
    minutos: [110, 165],
    costoEstimadoCop: 420000,
    temporada: 'lluvias',
  }),

  // ── Atrato trunk, dry season ──────────────────────────────────────────────────────
  // Lower water, more sandbars, longer everywhere.
  par({
    a: 'QBD',
    b: 'BTA',
    modo: 'lancha',
    minutos: [70, 95],
    costoEstimadoCop: 210000,
    temporada: 'seca',
    notas: 'Hay que bordear los playones.',
  }),
  par({
    a: 'BTA',
    b: 'MER',
    modo: 'lancha',
    minutos: [60, 85],
    costoEstimadoCop: 190000,
    temporada: 'seca',
  }),
  par({
    a: 'MER',
    b: 'TAG',
    modo: 'lancha',
    minutos: [55, 80],
    costoEstimadoCop: 180000,
    temporada: 'seca',
    notas: 'Tramo cuello de botella.',
  }),
  par({
    a: 'TAG',
    b: 'BET',
    modo: 'lancha',
    minutos: [50, 70],
    costoEstimadoCop: 170000,
    temporada: 'seca',
  }),
  par({
    a: 'BET',
    b: 'BLL',
    modo: 'lancha',
    minutos: [145, 215],
    costoEstimadoCop: 480000,
    temporada: 'seca',
  }),

  // ── Winandó: rainy season only ────────────────────────────────────────────────────
  // In `seca` the caño has no water for a chalupa, so there is no row — and the matcher
  // correctly reports SIN_RUTA rather than inventing a longer way round.
  par({
    a: 'MER',
    b: 'WIN',
    modo: 'chalupa',
    minutos: [25, 35],
    costoEstimadoCop: 90000,
    temporada: 'lluvias',
    notas: 'Por el caño. En verano no entra chalupa: toca canoa y varias horas a canalete.',
  }),

  // ── Río Quito ─────────────────────────────────────────────────────────────────────
  par({
    a: 'QBD',
    b: 'PAI',
    modo: 'chalupa',
    minutos: [95, 70],
    costoEstimadoCop: 260000,
    notas: 'Subiendo el Quito. Bajando rinde más.',
  }),
].flat()

/**
 * Demo-only routes. STAGING ONLY — see COMUNIDADES_DEMO.
 *
 * The one connector on the Pacific coast: Pizarro to Sivirú by boat. It exists so Sivirú is
 * reachable from Pizarro's acopio (which is empty of what Sivirú asks for), while the Quibdó
 * warehouse — with the goods — has no path to the coast at all. That is the SIN_RUTA the
 * matcher is meant to name: «hay 180 mercados en Quibdó, pero no hay cómo llegar a Sivirú».
 * Docampadó is deliberately left with no route, so its own request is a plain SIN_RUTA.
 *
 * Kept out of RUTAS_SEMILLA because that array is what the reachability tests pin — the basin
 * they describe is strongly connected from Quibdó, and the coast is precisely not.
 */
export const RUTAS_DEMO: RutaSemilla[] = [
  par({
    a: 'PIZ',
    b: 'SIV',
    modo: 'lancha',
    minutos: [40, 45],
    costoEstimadoCop: 120000,
    notas: 'Por la costa y la boca del Baudó. Depende de la marea y del mar de leva.',
  }),
].flat()
