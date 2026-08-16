import type { DominioEvaluacion, OrigenBom, ViaDeRespuesta } from '@/db/schema/evaluaciones'

/**
 * PRD-29 «Evaluaciones y recuperación» — demo assessment sweeps, findings and a bill of
 * materials for the /evaluaciones screen. STAGING ONLY.
 *
 * Consumed only by scripts/seed.ts, which lands them on ASOREDIPARCHOCÓ (the demo org) and marks
 * every UI-visible text [DATO DE PRUEBA] before it reaches a screen a partner might open. The data
 * is shaped so the page renders its whole story rather than an empty state:
 *
 *   - Level 4 coverage: three sweeps across real registry communities give «evaluado de estimado,
 *     con su fecha» by municipality and by vereda/domain — including a stale one that shows
 *     «vencido», the honest reminder that an assessment is a claim made on a day (§21).
 *   - Level 3 findings: routed across the three vías — `convite` (matchable, costed), `derivacion`
 *     (another mandate, never despacho) and `sin_via` (recorded, never queued) — using the
 *     ASOREDIPARCHOCÓ housing/health/water context.
 *   - Level 2 bill of materials: one matchable finding is costed in four components with partial
 *     coverage, so it reads «falta $X» — the number Apadrinar (PRD-12) prices against.
 *
 * Idempotent: fixed UUIDs with `on conflict (id) do nothing`, and templates keyed on their
 * (organizacion, codigo) natural key. Every date is relative so a re-run stays coherent.
 */

/** A multi-domain template, proposing the baseline four components at severity 2 (§21 / AC #1). */
export type PlantillaEvaluacionSemilla = {
  id: string
  dominio: DominioEvaluacion
  codigo: string
  nombre: string
  descripcion: string | null
  materialesCop: number
  transporteCop: number
  asistenciaTecnicaCop: number
  manoDeObraDias: number
}

/** One assessment sweep: a visit to a community, for a domain, on a date, with an expiry (§21). */
export type EvaluacionSemilla = {
  id: string
  comunidad: string
  dominio: DominioEvaluacion
  evaluadorNombre: string
  /** The visit date, expressed as days before today. */
  fechaVisitaDiasAtras: number
  totalEstimado: number
  /** Expiry as days from today: negative = already lapsed (renders «vencido»); null = no expiry. */
  venceEnEnDias: number | null
  notas: string | null
}

/** A finding, routed by `via_de_respuesta`. Belongs to a sweep when `evaluacion` is set. */
export type HallazgoSemilla = {
  id: string
  /** The sweep this finding was recorded in, by its fixed id; null = a loose finding. */
  evaluacion: string | null
  comunidad: string
  dominio: DominioEvaluacion
  descripcion: string
  severidad: number | null
  viaDeRespuesta: ViaDeRespuesta
  /** Required iff via = derivacion — the mandate it goes to. */
  derivacionDestino: string | null
}

/** The four-component repair estimate for one matchable finding (§21 / Level 2). */
export type HallazgoBomSemilla = {
  id: string
  /** The finding it costs, by its fixed id. One BoM per finding. */
  hallazgo: string
  origen: OrigenBom
  /** The template it was proposed from, by its fixed id; null when entered by hand. */
  plantilla: string | null
  materialesCop: number
  transporteCop: number
  asistenciaTecnicaCop: number
  manoDeObraDias: number
  materialesCubiertoCop: number
  transporteCubiertoCop: number
  asistenciaTecnicaCubiertoCop: number
  manoDeObraCubiertaDias: number
}

export const PLANTILLAS_EVALUACION_DEMO: PlantillaEvaluacionSemilla[] = [
  {
    id: 'd3000010-0000-4000-8000-000000000001',
    dominio: 'vivienda',
    codigo: 'VIV-2',
    nombre: 'Reparación de vivienda afectada por inundación',
    descripcion: 'Techo, pisos y saneamiento básico de una vivienda anegada. Base a severidad 2.',
    materialesCop: 1_200_000,
    transporteCop: 300_000,
    asistenciaTecnicaCop: 400_000,
    manoDeObraDias: 5,
  },
  {
    id: 'd3000010-0000-4000-8000-000000000002',
    dominio: 'agua',
    codigo: 'AGU-2',
    nombre: 'Rehabilitación de acueducto o pozo veredal',
    descripcion: 'Limpieza, cloración y reparación de la fuente de agua de una vereda.',
    materialesCop: 800_000,
    transporteCop: 250_000,
    asistenciaTecnicaCop: 350_000,
    manoDeObraDias: 4,
  },
  {
    id: 'd3000010-0000-4000-8000-000000000003',
    dominio: 'salud',
    codigo: 'SAL-2',
    nombre: 'Adecuación de puesto de salud',
    descripcion: 'Reparaciones menores y dotación básica de un puesto de salud rural.',
    materialesCop: 1_500_000,
    transporteCop: 400_000,
    asistenciaTecnicaCop: 600_000,
    manoDeObraDias: 6,
  },
]

export const EVALUACIONES_DEMO: EvaluacionSemilla[] = [
  {
    id: 'd3000011-0000-4000-8000-000000000001',
    comunidad: 'BET',
    dominio: 'vivienda',
    evaluadorNombre: 'Equipo de vivienda — ASOREDIPARCHOCÓ',
    fechaVisitaDiasAtras: 28,
    totalEstimado: 210,
    venceEnEnDias: 150,
    notas: 'Barrido de la cabecera y las casas de la orilla tras la última creciente.',
  },
  {
    id: 'd3000011-0000-4000-8000-000000000002',
    comunidad: 'TAG',
    dominio: 'vivienda',
    evaluadorNombre: 'Brigada de ASOREDIPARCHOCÓ',
    fechaVisitaDiasAtras: 20,
    totalEstimado: 140,
    venceEnEnDias: 160,
    notas: 'Recorrido casa por casa con la junta.',
  },
  {
    // Deliberately stale: visited long ago and already lapsed, so the coverage row reads «vencido».
    id: 'd3000011-0000-4000-8000-000000000003',
    comunidad: 'PAI',
    dominio: 'agua',
    evaluadorNombre: 'Comité de agua — ASOREDIPARCHOCÓ',
    fechaVisitaDiasAtras: 200,
    totalEstimado: 60,
    venceEnEnDias: -30,
    notas: 'Diagnóstico del pozo comunitario. Requiere volver a verificar.',
  },
]

export const HALLAZGOS_EVALUACION_DEMO: HallazgoSemilla[] = [
  {
    id: 'd3000012-0000-4000-8000-000000000001',
    evaluacion: 'd3000011-0000-4000-8000-000000000001',
    comunidad: 'BET',
    dominio: 'vivienda',
    descripcion: 'Doce viviendas con el techo colapsado en la cabecera; requieren reparación estructural.',
    severidad: 2,
    viaDeRespuesta: 'convite',
    derivacionDestino: null,
  },
  {
    id: 'd3000012-0000-4000-8000-000000000002',
    evaluacion: 'd3000011-0000-4000-8000-000000000001',
    comunidad: 'BET',
    dominio: 'vivienda',
    descripcion: 'Riesgo sanitario por aguas estancadas alrededor de cinco viviendas.',
    severidad: 1,
    viaDeRespuesta: 'derivacion',
    derivacionDestino: 'Secretaría de Salud del Chocó',
  },
  {
    id: 'd3000012-0000-4000-8000-000000000003',
    evaluacion: 'd3000011-0000-4000-8000-000000000002',
    comunidad: 'TAG',
    dominio: 'vivienda',
    descripcion: 'Ocho familias sin cambuche ni material; no hay ruta de respuesta esta temporada.',
    severidad: 2,
    viaDeRespuesta: 'sin_via',
    derivacionDestino: null,
  },
  {
    id: 'd3000012-0000-4000-8000-000000000004',
    evaluacion: 'd3000011-0000-4000-8000-000000000003',
    comunidad: 'PAI',
    dominio: 'agua',
    descripcion: 'El pozo comunitario quedó contaminado tras la creciente.',
    severidad: 3,
    viaDeRespuesta: 'convite',
    derivacionDestino: null,
  },
  {
    id: 'd3000012-0000-4000-8000-000000000005',
    evaluacion: null,
    comunidad: 'MER',
    dominio: 'vivienda',
    descripcion: 'Dos viviendas con daños menores en Las Mercedes, reportadas fuera de un barrido.',
    severidad: 1,
    viaDeRespuesta: 'convite',
    derivacionDestino: null,
  },
]

export const HALLAZGO_BOM_DEMO: HallazgoBomSemilla[] = [
  {
    // The Beté housing finding, costed from VIV-2 at severity 2 (the baseline), with materials and
    // some local labour already covered — so the screen shows «falta $X», the fundable balance.
    id: 'd3000013-0000-4000-8000-000000000001',
    hallazgo: 'd3000012-0000-4000-8000-000000000001',
    origen: 'plantilla',
    plantilla: 'd3000010-0000-4000-8000-000000000001',
    materialesCop: 1_200_000,
    transporteCop: 300_000,
    asistenciaTecnicaCop: 400_000,
    manoDeObraDias: 5,
    materialesCubiertoCop: 600_000,
    transporteCubiertoCop: 0,
    asistenciaTecnicaCubiertoCop: 0,
    manoDeObraCubiertaDias: 2,
  },
]
