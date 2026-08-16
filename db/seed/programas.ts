import type { CadenciaPrograma, EstadoPrograma } from '@/db/schema/programas'
import type { EstadoJornada, TipoJornada } from '@/db/schema/vocabulario'

/**
 * PRD-30 / PRD-31 «Agenda › Programas y Jornadas» — the funded layer and its occurrences, for the
 * /programas and /jornadas screens. STAGING ONLY.
 *
 * Consumed only by scripts/seed.ts, on ASOREDIPARCHOCÓ (the demo org). `sembrar:territorio` already
 * plants Fundación Herencia's historical jornadas on ITS org, so the panel — which signs in as
 * ASOREDIPARCHOCÓ — needs its own, or /jornadas is empty. These are those: a prenatal-kit programa
 * with a budget, a cadence, a persistent roster, a programa-level sponsorship and a spend ledger,
 * realised by a set of jornadas with stops and attendance; plus a lighter housing-recovery programa.
 *
 * The seasonal gap the PRD asks for is real, not decorative: the prenatal programa targets Winandó
 * (WIN), which the route seed leaves reachable only in `lluvias` (see db/seed/rutas.ts), so the
 * feasibility calendar shows it out of reach for the dry-season months.
 *
 * Idempotent: fixed UUIDs with `on conflict (id) do nothing`; programa/jornada keyed on their unique
 * `codigo`; join rows on their natural unique keys. Dates are relative so a re-run stays coherent.
 * Every UI-visible string is marked [DATO DE PRUEBA] by scripts/seed.ts.
 */

export type ComunidadObjetivoSemilla = { codigo: string; familiasEstimadas: number | null }

export type ParticipanteSemilla = {
  id: string
  nombre: string
  contacto: string | null
  completado: boolean
  /** When they completed, as days before today. Required when `completado` is true. */
  completadoDiasAtras: number | null
}

export type ProgramaApadrinamientoSemilla = {
  id: string
  etiqueta: string
  padrinoNombre: string
  padrinoContacto: string | null
  padrinoTipo: 'individuo' | 'organizacion'
  montoCop: number
  recurrencia: 'unico' | 'mensual'
  estado: EstadoPrograma
  consentimiento: boolean
}

export type ProgramaSemilla = {
  id: string
  codigo: string
  titulo: string
  objetivo: string
  poblacionObjetivo: string | null
  familiasObjetivo: number | null
  cadencia: CadenciaPrograma
  fechaInicioDiasAtras: number | null
  fechaFinEnDias: number | null
  renueva: boolean
  estado: EstadoPrograma
  presupuestoComprometidoCop: number
  financiador: string | null
  financiadorReporte: string | null
  notas: string | null
  comunidades: ComunidadObjetivoSemilla[]
  participantes: ParticipanteSemilla[]
  apadrinamientos: ProgramaApadrinamientoSemilla[]
}

export type JornadaParadaSemilla = { codigo: string; orden: number; notas: string | null }

export type JornadaSemilla = {
  id: string
  codigo: string
  tipo: TipoJornada
  titulo: string
  /** The programa it realises, by fixed id; null = a loose jornada. */
  programa: string | null
  fechaInicioDiasAtras: number | null
  fechaFinDiasAtras: number | null
  estado: EstadoJornada
  familiasAtendidas: number | null
  notas: string | null
  paradas: JornadaParadaSemilla[]
  /** Roster participant ids who attended this session (§21b.3 — that they attended, never for what). */
  asistieron: string[]
}

/** A slice of a programa's budget applied to a jornada, optionally drawn from a sponsorship. */
export type ProgramaAplicacionSemilla = {
  id: string
  programa: string
  apadrinamiento: string | null
  jornada: string | null
  montoAplicadoCop: number
  concepto: string | null
}

const PRENATAL = 'd3000001-0000-4000-8000-000000000001'
const VIVIENDA = 'd3000001-0000-4000-8000-000000000002'

const JORNADA_TALLER = 'd3000002-0000-4000-8000-000000000001'
const JORNADA_BRIGADA = 'd3000002-0000-4000-8000-000000000002'
const JORNADA_OBRA = 'd3000002-0000-4000-8000-000000000003'

const PART_1 = 'd3000003-0000-4000-8000-000000000001'
const PART_2 = 'd3000003-0000-4000-8000-000000000002'
const PART_3 = 'd3000003-0000-4000-8000-000000000003'
const PART_4 = 'd3000003-0000-4000-8000-000000000004'

const APADRINA_PRENATAL = 'd3000004-0000-4000-8000-000000000001'

export const PROGRAMAS_DEMO: ProgramaSemilla[] = [
  {
    id: PRENATAL,
    codigo: 'PRG-PRENATAL',
    titulo: 'Kit prenatal y parto seguro',
    objetivo: 'Que ninguna gestante del Atrato medio quede sin control prenatal ni kit de parto limpio.',
    poblacionObjetivo: 'Gestantes y familias acompañadas por una partera',
    familiasObjetivo: 120,
    cadencia: 'mensual',
    fechaInicioDiasAtras: 60,
    fechaFinEnDias: 300,
    renueva: true,
    estado: 'activo',
    presupuestoComprometidoCop: 24_000_000,
    financiador: 'Fondo de Mujeres del Pacífico',
    financiadorReporte: 'familias atendidas y kits entregados por jornada',
    notas: 'Plan a doce meses; una sesión de formación y una brigada por comunidad al mes.',
    comunidades: [
      { codigo: 'BET', familiasEstimadas: 40 },
      { codigo: 'TAG', familiasEstimadas: 35 },
      { codigo: 'MER', familiasEstimadas: 20 },
      // Winandó: solo tiene paso en lluvias (db/seed/rutas.ts). Deja ver la brecha estacional.
      { codigo: 'WIN', familiasEstimadas: 15 },
    ],
    participantes: [
      { id: PART_1, nombre: 'Bertha Rentería (partera)', contacto: null, completado: true, completadoDiasAtras: 20 },
      { id: PART_2, nombre: 'Custodia Palacios (partera)', contacto: null, completado: true, completadoDiasAtras: 20 },
      { id: PART_3, nombre: 'Nubia Moreno (auxiliar de salud)', contacto: null, completado: false, completadoDiasAtras: null },
      { id: PART_4, nombre: 'Derly Mosquera (promotora)', contacto: null, completado: false, completadoDiasAtras: null },
    ],
    apadrinamientos: [
      {
        id: APADRINA_PRENATAL,
        etiqueta: 'el banco de kits prenatales',
        padrinoNombre: 'Fundación Solidaridad Chocó',
        padrinoContacto: 'aportes@solidaridadchoco.example',
        padrinoTipo: 'organizacion',
        montoCop: 6_000_000,
        recurrencia: 'mensual',
        estado: 'activo',
        consentimiento: true,
      },
    ],
  },
  {
    id: VIVIENDA,
    codigo: 'PRG-VIVIENDA',
    titulo: 'Recuperación de vivienda post-inundación',
    objetivo: 'Reparar las viviendas priorizadas en los barridos, empezando por los techos colapsados.',
    poblacionObjetivo: 'Familias con vivienda afectada verificada en un barrido',
    familiasObjetivo: 60,
    cadencia: 'trimestral',
    fechaInicioDiasAtras: 30,
    fechaFinEnDias: 330,
    renueva: false,
    estado: 'activo',
    presupuestoComprometidoCop: 40_000_000,
    financiador: 'Cooperación internacional (por confirmar)',
    financiadorReporte: 'viviendas reparadas y familias beneficiadas',
    notas: 'Se alimenta de los hallazgos de vivienda de /evaluaciones.',
    comunidades: [
      { codigo: 'BET', familiasEstimadas: 12 },
      { codigo: 'MER', familiasEstimadas: 8 },
    ],
    participantes: [],
    apadrinamientos: [],
  },
]

export const JORNADAS_DEMO: JornadaSemilla[] = [
  {
    id: JORNADA_TALLER,
    codigo: 'JOR-PRENATAL-T1',
    tipo: 'formacion',
    titulo: 'Formación de parteras — sesión 1',
    programa: PRENATAL,
    fechaInicioDiasAtras: 30,
    fechaFinDiasAtras: 30,
    estado: 'completada',
    familiasAtendidas: 28,
    notas: 'Primera de doce sesiones. Mismo roster a lo largo del programa.',
    paradas: [{ codigo: 'BET', orden: 0, notas: 'En el puesto de salud de la cabecera.' }],
    asistieron: [PART_1, PART_2, PART_3],
  },
  {
    id: JORNADA_BRIGADA,
    codigo: 'JOR-PRENATAL-B1',
    tipo: 'brigada',
    titulo: 'Brigada prenatal — Atrato medio',
    programa: PRENATAL,
    fechaInicioDiasAtras: -15,
    fechaFinDiasAtras: -15,
    estado: 'planificada',
    familiasAtendidas: null,
    notas: 'Dos paradas. Winandó depende de que el río tenga paso en la fecha.',
    paradas: [
      { codigo: 'TAG', orden: 0, notas: null },
      { codigo: 'WIN', orden: 1, notas: 'Solo si hay paso; en seca queda incomunicada.' },
    ],
    asistieron: [],
  },
  {
    id: JORNADA_OBRA,
    codigo: 'JOR-VIVIENDA-O1',
    tipo: 'obra',
    titulo: 'Reparación de techos — Beté',
    programa: VIVIENDA,
    fechaInicioDiasAtras: -20,
    fechaFinDiasAtras: -27,
    estado: 'borrador',
    familiasAtendidas: null,
    notas: 'Sujeto a financiación; cubre los techos colapsados del barrido de Beté.',
    paradas: [{ codigo: 'BET', orden: 0, notas: null }],
    asistieron: [],
  },
]

export const PROGRAMA_APLICACIONES_DEMO: ProgramaAplicacionSemilla[] = [
  {
    id: 'd3000005-0000-4000-8000-000000000001',
    programa: PRENATAL,
    apadrinamiento: APADRINA_PRENATAL,
    jornada: JORNADA_TALLER,
    montoAplicadoCop: 2_500_000,
    concepto: 'Kits prenatales entregados en la sesión 1',
  },
  {
    id: 'd3000005-0000-4000-8000-000000000002',
    programa: PRENATAL,
    apadrinamiento: null,
    jornada: JORNADA_BRIGADA,
    montoAplicadoCop: 1_200_000,
    concepto: 'Transporte fluvial de la brigada',
  },
]
