import type { PoolClient } from 'pg'
import {
  DOMINIOS_EVALUACION,
  type DominioEvaluacion,
  ORIGENES_BOM,
  type OrigenBom,
  VIAS_DE_RESPUESTA,
  type ViaDeRespuesta,
} from '@/db/schema/evaluaciones'

/**
 * PRD-29 «Assessments and recovery» — reading and recording the assessment records, the coverage
 * rollup and the bill of materials.
 *
 * Every query here runs against the client `conSesion()` hands it, so RLS (0044) is the real
 * boundary: reads are scoped to the caller's organisation, and writes have to satisfy the policies.
 * The panel gates the UI on top of that, but the data boundary does not depend on the UI (§11).
 *
 * The pure functions (`generarBom`, `estadoReparacion`, `cobertura`, `estaVencida`, …) hold the
 * arithmetic Level 2 and Level 4 depend on, and are proven without a database in
 * tests/evaluaciones.test.ts. COP is plain integer pesos; `bigint` comes back from pg as a string,
 * so the row mappers convert with `Number()` (COP is far inside the safe-integer range).
 */

export { DOMINIOS_EVALUACION, ORIGENES_BOM, VIAS_DE_RESPUESTA }
export type { DominioEvaluacion, OrigenBom, ViaDeRespuesta }

/** Roles the assessment screen is written for. RLS (0044) is the real boundary. */
export const EVALUACION_ROLES = ['coordinador', 'admin'] as const

/** Human labels for the domains, for the screen. */
export const ETIQUETA_DOMINIO: Record<DominioEvaluacion, string> = {
  vivienda: 'Vivienda',
  educacion: 'Educación',
  salud: 'Salud',
  agua: 'Agua',
  ambiente: 'Ambiente',
  organizacional: 'Capacidad organizacional',
}

/** Human labels for the response routes. */
export const ETIQUETA_VIA: Record<ViaDeRespuesta, string> = {
  convite: 'Convite',
  derivacion: 'Derivación',
  sin_via: 'Sin vía',
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Pure logic (Level 2 costing + Level 4 coverage)
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** The four components of a repair. COP for the three costs, days for local labour (a supply). */
export type ComponentesBom = {
  materialesCop: number
  transporteCop: number
  asistenciaTecnicaCop: number
  manoDeObraDias: number
}

/**
 * §21 AC #1: severity scales the baseline a template proposes. Severity 2 is the reference the
 * PRD is written against (factor 1); severity 1 is lighter, 3 is heavier. Anything unknown (a
 * finding with no severity) is treated as the reference.
 */
const FACTOR_SEVERIDAD: Record<number, number> = { 1: 0.5, 2: 1, 3: 1.5 }

export function factorSeveridad(severidad: number | null): number {
  if (severidad === null) return 1
  return FACTOR_SEVERIDAD[severidad] ?? 1
}

/**
 * Propose a bill of materials from a template baseline (severity-2 amounts) and a finding's
 * severity. Pure so it can be unit-tested and reused without a database. COP rounds to the nearest
 * thousand pesos (nobody quotes a repair to the peso); labour days round to a whole day, floored at
 * zero. The técnico edits the result — this is the proposal, not the final estimate.
 */
export function generarBom(baseline: ComponentesBom, severidad: number | null): ComponentesBom {
  const f = factorSeveridad(severidad)
  const cop = (n: number) => Math.max(0, Math.round((n * f) / 1000) * 1000)
  return {
    materialesCop: cop(baseline.materialesCop),
    transporteCop: cop(baseline.transporteCop),
    asistenciaTecnicaCop: cop(baseline.asistenciaTecnicaCop),
    manoDeObraDias: Math.max(0, Math.round(baseline.manoDeObraDias * f)),
  }
}

/** One component of the four-component match: what it needs, what is covered, what is missing. */
export type ComponenteReparacion = {
  requerido: number
  cubierto: number
  faltante: number
  completo: boolean
}

/**
 * §21 AC #4: the four-component match. Materiales, transporte and asistencia técnica are matched in
 * COP; mano de obra local is matched in days (a supply side). A component is `faltante` when what
 * is covered is short of what is required; the labels of the unmet components are what feed the
 * Bandeja stuck-states. `completo` when all four are met.
 */
export type EstadoReparacion = {
  materiales: ComponenteReparacion
  transporte: ComponenteReparacion
  asistenciaTecnica: ComponenteReparacion
  manoDeObra: ComponenteReparacion
  completo: boolean
  /** Human labels of the components still short, worst kept legible for the stuck-state list. */
  faltantes: string[]
}

/** The persisted BoM: the four required amounts and the four covered amounts. */
export type Bom = ComponentesBom & {
  id: string
  hallazgoId: string
  origen: OrigenBom
  plantillaId: string | null
  materialesCubiertoCop: number
  transporteCubiertoCop: number
  asistenciaTecnicaCubiertoCop: number
  manoDeObraCubiertaDias: number
  actualizadoEn: Date
}

function componente(requerido: number, cubierto: number): ComponenteReparacion {
  const faltante = Math.max(0, requerido - cubierto)
  return { requerido, cubierto, faltante, completo: faltante === 0 }
}

export function estadoReparacion(
  bom: Pick<
    Bom,
    | 'materialesCop'
    | 'transporteCop'
    | 'asistenciaTecnicaCop'
    | 'manoDeObraDias'
    | 'materialesCubiertoCop'
    | 'transporteCubiertoCop'
    | 'asistenciaTecnicaCubiertoCop'
    | 'manoDeObraCubiertaDias'
  >,
): EstadoReparacion {
  const materiales = componente(bom.materialesCop, bom.materialesCubiertoCop)
  const transporte = componente(bom.transporteCop, bom.transporteCubiertoCop)
  const asistenciaTecnica = componente(bom.asistenciaTecnicaCop, bom.asistenciaTecnicaCubiertoCop)
  const manoDeObra = componente(bom.manoDeObraDias, bom.manoDeObraCubiertaDias)
  const faltantes: string[] = []
  if (!materiales.completo) faltantes.push('materiales')
  if (!transporte.completo) faltantes.push('transporte')
  if (!asistenciaTecnica.completo) faltantes.push('asistencia técnica')
  if (!manoDeObra.completo) faltantes.push('mano de obra')
  return { materiales, transporte, asistenciaTecnica, manoDeObra, completo: faltantes.length === 0, faltantes }
}

/**
 * §21 AC #7: what a sponsor prices against — the sum of the three COP components. Mano de obra
 * local is a supply side, not a cost, so it is never in this number.
 */
export function costoFundableCop(bom: ComponentesBom): number {
  return bom.materialesCop + bom.transporteCop + bom.asistenciaTecnicaCop
}

/** COP already covered against the three fundable components. */
export function fondosAplicadosCop(
  bom: Pick<Bom, 'materialesCubiertoCop' | 'transporteCubiertoCop' | 'asistenciaTecnicaCubiertoCop'>,
): number {
  return bom.materialesCubiertoCop + bom.transporteCubiertoCop + bom.asistenciaTecnicaCubiertoCop
}

/** What Apadrinar/programa funding still needs to cover for this repair, never negative. */
export function saldoFundableCop(bom: Bom): number {
  return Math.max(0, costoFundableCop(bom) - fondosAplicadosCop(bom))
}

/** §21 Level 3: a finding expires. True when `venceEn` is on or before `ahora`. */
export function estaVencida(venceEn: string | null, ahora: Date = new Date()): boolean {
  if (!venceEn) return false
  // Compare on the calendar day: an assessment that expires «today» is expired at end of day.
  const hoy = ahora.toISOString().slice(0, 10)
  return venceEn < hoy
}

/** A flat sweep row, the input the coverage rollup aggregates. */
export type FilaCobertura = {
  comunidadId: string
  comunidadNombre: string
  municipio: string
  dominio: DominioEvaluacion
  fechaVisita: string
  totalEstimado: number
  evaluados: number
  venceEn: string | null
}

/** Coverage for one (community, domain): assessed out of estimated total, with its date. */
export type CoberturaVereda = {
  comunidadId: string
  comunidadNombre: string
  municipio: string
  dominio: DominioEvaluacion
  evaluados: number
  totalEstimado: number
  porcentaje: number
  fecha: string
  venceEn: string | null
  vencida: boolean
}

/** Coverage rolled up to a municipality across its assessed communities and domains. */
export type CoberturaMunicipio = {
  municipio: string
  evaluados: number
  totalEstimado: number
  porcentaje: number
  fecha: string
}

export type Cobertura = {
  veredas: CoberturaVereda[]
  municipios: CoberturaMunicipio[]
}

function porcentaje(evaluados: number, total: number): number {
  return total > 0 ? Math.round((evaluados / total) * 100) : 0
}

/**
 * §21 Level 4: coverage as *assessed out of estimated total, with its date*, at vereda and
 * municipality level. Pure so it is testable without a database.
 *
 * A place is assessed by a dated visit, and a later visit re-estimates it, so the coverage of a
 * (community, domain) is its *latest* sweep — not a sum across visits that would double-count. The
 * municipality rolls up the latest-per-community-domain rows within it. «Forty of a hundred houses
 * surveyed» stays a different claim from «forty damaged houses»: the numerator is items assessed,
 * never findings of damage.
 */
export function cobertura(filas: readonly FilaCobertura[], ahora: Date = new Date()): Cobertura {
  // Latest sweep per (community, domain).
  const ultima = new Map<string, FilaCobertura>()
  for (const fila of filas) {
    const clave = `${fila.comunidadId}::${fila.dominio}`
    const previa = ultima.get(clave)
    if (!previa || fila.fechaVisita > previa.fechaVisita) ultima.set(clave, fila)
  }

  const veredas: CoberturaVereda[] = [...ultima.values()]
    .map((f) => ({
      comunidadId: f.comunidadId,
      comunidadNombre: f.comunidadNombre,
      municipio: f.municipio,
      dominio: f.dominio,
      evaluados: f.evaluados,
      totalEstimado: f.totalEstimado,
      porcentaje: porcentaje(f.evaluados, f.totalEstimado),
      fecha: f.fechaVisita,
      venceEn: f.venceEn,
      vencida: estaVencida(f.venceEn, ahora),
    }))
    .sort(
      (a, b) =>
        a.municipio.localeCompare(b.municipio, 'es') ||
        a.comunidadNombre.localeCompare(b.comunidadNombre, 'es') ||
        a.dominio.localeCompare(b.dominio, 'es'),
    )

  const porMunicipio = new Map<string, CoberturaMunicipio>()
  for (const v of veredas) {
    const actual = porMunicipio.get(v.municipio) ?? {
      municipio: v.municipio,
      evaluados: 0,
      totalEstimado: 0,
      porcentaje: 0,
      fecha: v.fecha,
    }
    actual.evaluados += v.evaluados
    actual.totalEstimado += v.totalEstimado
    if (v.fecha > actual.fecha) actual.fecha = v.fecha
    porMunicipio.set(v.municipio, actual)
  }
  const municipios = [...porMunicipio.values()]
    .map((m) => ({ ...m, porcentaje: porcentaje(m.evaluados, m.totalEstimado) }))
    .sort((a, b) => a.municipio.localeCompare(b.municipio, 'es'))

  return { veredas, municipios }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
//  Queries (run against the RLS-scoped client)
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type Plantilla = ComponentesBom & {
  id: string
  dominio: DominioEvaluacion
  codigo: string
  nombre: string
  descripcion: string | null
  activa: boolean
}

/** Every template the caller may see, by domain then name. */
export async function listarPlantillas(client: PoolClient): Promise<Plantilla[]> {
  const { rows } = await client.query<{
    id: string
    dominio: DominioEvaluacion
    codigo: string
    nombre: string
    descripcion: string | null
    activa: boolean
    materiales_cop: string
    transporte_cop: string
    asistencia_tecnica_cop: string
    mano_de_obra_dias: number
  }>(
    `select id, dominio, codigo, nombre, descripcion, activa,
            materiales_cop, transporte_cop, asistencia_tecnica_cop, mano_de_obra_dias
       from plantillas_evaluacion
      order by dominio, nombre`,
  )
  return rows.map((r) => ({
    id: r.id,
    dominio: r.dominio,
    codigo: r.codigo,
    nombre: r.nombre,
    descripcion: r.descripcion,
    activa: r.activa,
    materialesCop: Number(r.materiales_cop),
    transporteCop: Number(r.transporte_cop),
    asistenciaTecnicaCop: Number(r.asistencia_tecnica_cop),
    manoDeObraDias: r.mano_de_obra_dias,
  }))
}

export type NuevaPlantilla = ComponentesBom & {
  organizacionId: string
  dominio: DominioEvaluacion
  codigo: string
  nombre: string
  descripcion?: string | null
}

export async function crearPlantilla(
  client: PoolClient,
  entrada: NuevaPlantilla,
  actorId: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into plantillas_evaluacion
       (organizacion_id, dominio, codigo, nombre, descripcion,
        materiales_cop, transporte_cop, asistencia_tecnica_cop, mano_de_obra_dias, creado_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning id`,
    [
      entrada.organizacionId,
      entrada.dominio,
      entrada.codigo,
      entrada.nombre,
      entrada.descripcion ?? null,
      entrada.materialesCop,
      entrada.transporteCop,
      entrada.asistenciaTecnicaCop,
      entrada.manoDeObraDias,
      actorId,
    ],
  )
  return rows[0]!.id
}

/** A sweep with the community it visited and its assessed count (coverage numerator). */
export type EvaluacionResumen = {
  id: string
  comunidadId: string
  comunidadNombre: string
  municipio: string
  dominio: DominioEvaluacion
  evaluadorNombre: string
  fechaVisita: string
  totalEstimado: number
  evaluados: number
  venceEn: string | null
  vencida: boolean
  porcentaje: number
}

export async function listarEvaluaciones(client: PoolClient): Promise<EvaluacionResumen[]> {
  const { rows } = await client.query<{
    id: string
    comunidad_id: string
    comunidad_nombre: string
    municipio: string
    dominio: DominioEvaluacion
    evaluador_nombre: string
    fecha_visita: string
    total_estimado: number
    evaluados: string
    vence_en: string | null
  }>(
    `select e.id,
            e.comunidad_id,
            c.nombre as comunidad_nombre,
            c.municipio,
            e.dominio,
            e.evaluador_nombre,
            to_char(e.fecha_visita, 'YYYY-MM-DD') as fecha_visita,
            e.total_estimado,
            count(h.id) as evaluados,
            to_char(e.vence_en, 'YYYY-MM-DD') as vence_en
       from evaluaciones e
       join comunidades c on c.id = e.comunidad_id
       left join evaluacion_hallazgos h on h.evaluacion_id = e.id
      group by e.id, c.nombre, c.municipio
      order by e.fecha_visita desc, c.nombre`,
  )
  return rows.map((r) => {
    const evaluados = Number(r.evaluados)
    return {
      id: r.id,
      comunidadId: r.comunidad_id,
      comunidadNombre: r.comunidad_nombre,
      municipio: r.municipio,
      dominio: r.dominio,
      evaluadorNombre: r.evaluador_nombre,
      fechaVisita: r.fecha_visita,
      totalEstimado: r.total_estimado,
      evaluados,
      venceEn: r.vence_en,
      vencida: estaVencida(r.vence_en),
      porcentaje: porcentaje(evaluados, r.total_estimado),
    }
  })
}

export type NuevaEvaluacion = {
  organizacionId: string
  comunidadId: string
  dominio: DominioEvaluacion
  evaluadorNombre: string
  fechaVisita: string
  totalEstimado: number
  venceEn?: string | null
  jornadaId?: string | null
  notas?: string | null
}

export async function crearEvaluacion(
  client: PoolClient,
  entrada: NuevaEvaluacion,
  actorId: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into evaluaciones
       (organizacion_id, comunidad_id, dominio, jornada_id, evaluador_nombre,
        fecha_visita, total_estimado, vence_en, registrado_por, notas)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning id`,
    [
      entrada.organizacionId,
      entrada.comunidadId,
      entrada.dominio,
      entrada.jornadaId ?? null,
      entrada.evaluadorNombre,
      entrada.fechaVisita,
      entrada.totalEstimado,
      entrada.venceEn ?? null,
      actorId,
      entrada.notas ?? null,
    ],
  )
  return rows[0]!.id
}

/** A finding, with its community, its sweep's provenance/expiry, and its BoM's fundable total. */
export type Hallazgo = {
  id: string
  comunidadId: string
  comunidadNombre: string
  municipio: string
  dominio: DominioEvaluacion
  descripcion: string
  severidad: number | null
  viaDeRespuesta: ViaDeRespuesta
  derivacionDestino: string | null
  evaluacionId: string | null
  reporteId: string | null
  /** Provenance of the sweep it came from, if any. */
  evaluadorNombre: string | null
  fechaVisita: string | null
  venceEn: string | null
  vencida: boolean
  /** Whether a bill of materials has been costed for it, and its fundable total. */
  tieneBom: boolean
  costoFundableCop: number
  saldoFundableCop: number
  reparacionCompleta: boolean
  creadoEn: Date
}

export async function listarHallazgos(client: PoolClient): Promise<Hallazgo[]> {
  const { rows } = await client.query<{
    id: string
    comunidad_id: string
    comunidad_nombre: string
    municipio: string
    dominio: DominioEvaluacion
    descripcion: string
    severidad: number | null
    via_de_respuesta: ViaDeRespuesta
    derivacion_destino: string | null
    evaluacion_id: string | null
    reporte_id: string | null
    evaluador_nombre: string | null
    fecha_visita: string | null
    vence_en: string | null
    materiales_cop: string | null
    transporte_cop: string | null
    asistencia_tecnica_cop: string | null
    mano_de_obra_dias: number | null
    materiales_cubierto_cop: string | null
    transporte_cubierto_cop: string | null
    asistencia_tecnica_cubierto_cop: string | null
    mano_de_obra_cubierta_dias: number | null
    creado_en: Date
  }>(
    `select h.id,
            h.comunidad_id,
            c.nombre as comunidad_nombre,
            c.municipio,
            h.dominio,
            h.descripcion,
            h.severidad,
            h.via_de_respuesta,
            h.derivacion_destino,
            h.evaluacion_id,
            h.reporte_id,
            e.evaluador_nombre,
            to_char(e.fecha_visita, 'YYYY-MM-DD') as fecha_visita,
            to_char(e.vence_en, 'YYYY-MM-DD') as vence_en,
            b.materiales_cop,
            b.transporte_cop,
            b.asistencia_tecnica_cop,
            b.mano_de_obra_dias,
            b.materiales_cubierto_cop,
            b.transporte_cubierto_cop,
            b.asistencia_tecnica_cubierto_cop,
            b.mano_de_obra_cubierta_dias,
            h.creado_en
       from evaluacion_hallazgos h
       join comunidades c on c.id = h.comunidad_id
       left join evaluaciones e on e.id = h.evaluacion_id
       left join hallazgo_bom b on b.hallazgo_id = h.id
      order by h.creado_en desc`,
  )

  return rows.map((r) => {
    const tieneBom = r.materiales_cop !== null
    const bom: ComponentesBom & {
      materialesCubiertoCop: number
      transporteCubiertoCop: number
      asistenciaTecnicaCubiertoCop: number
      manoDeObraCubiertaDias: number
    } = {
      materialesCop: Number(r.materiales_cop ?? 0),
      transporteCop: Number(r.transporte_cop ?? 0),
      asistenciaTecnicaCop: Number(r.asistencia_tecnica_cop ?? 0),
      manoDeObraDias: r.mano_de_obra_dias ?? 0,
      materialesCubiertoCop: Number(r.materiales_cubierto_cop ?? 0),
      transporteCubiertoCop: Number(r.transporte_cubierto_cop ?? 0),
      asistenciaTecnicaCubiertoCop: Number(r.asistencia_tecnica_cubierto_cop ?? 0),
      manoDeObraCubiertaDias: r.mano_de_obra_cubierta_dias ?? 0,
    }
    const estado = estadoReparacion(bom)
    return {
      id: r.id,
      comunidadId: r.comunidad_id,
      comunidadNombre: r.comunidad_nombre,
      municipio: r.municipio,
      dominio: r.dominio,
      descripcion: r.descripcion,
      severidad: r.severidad,
      viaDeRespuesta: r.via_de_respuesta,
      derivacionDestino: r.derivacion_destino,
      evaluacionId: r.evaluacion_id,
      reporteId: r.reporte_id,
      evaluadorNombre: r.evaluador_nombre,
      fechaVisita: r.fecha_visita,
      venceEn: r.vence_en,
      vencida: estaVencida(r.vence_en),
      tieneBom,
      costoFundableCop: costoFundableCop(bom),
      saldoFundableCop: tieneBom
        ? Math.max(0, costoFundableCop(bom) - fondosAplicadosCop(bom))
        : 0,
      reparacionCompleta: tieneBom && estado.completo,
      creadoEn: r.creado_en,
    }
  })
}

export type NuevoHallazgo = {
  organizacionId: string
  comunidadId: string
  dominio: DominioEvaluacion
  descripcion: string
  severidad?: number | null
  viaDeRespuesta: ViaDeRespuesta
  derivacionDestino?: string | null
  evaluacionId?: string | null
  reporteId?: string | null
}

export async function crearHallazgo(
  client: PoolClient,
  entrada: NuevoHallazgo,
  actorId: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into evaluacion_hallazgos
       (organizacion_id, evaluacion_id, reporte_id, comunidad_id, dominio, descripcion,
        severidad, via_de_respuesta, derivacion_destino, registrado_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning id`,
    [
      entrada.organizacionId,
      entrada.evaluacionId ?? null,
      entrada.reporteId ?? null,
      entrada.comunidadId,
      entrada.dominio,
      entrada.descripcion,
      entrada.severidad ?? null,
      entrada.viaDeRespuesta,
      entrada.viaDeRespuesta === 'derivacion' ? (entrada.derivacionDestino ?? null) : null,
      actorId,
    ],
  )
  return rows[0]!.id
}

/** The full bill of materials for one finding, or null when none has been costed yet. */
export async function bomDe(client: PoolClient, hallazgoId: string): Promise<Bom | null> {
  const { rows } = await client.query<{
    id: string
    hallazgo_id: string
    origen: OrigenBom
    plantilla_id: string | null
    materiales_cop: string
    transporte_cop: string
    asistencia_tecnica_cop: string
    mano_de_obra_dias: number
    materiales_cubierto_cop: string
    transporte_cubierto_cop: string
    asistencia_tecnica_cubierto_cop: string
    mano_de_obra_cubierta_dias: number
    actualizado_en: Date
  }>(
    `select id, hallazgo_id, origen, plantilla_id,
            materiales_cop, transporte_cop, asistencia_tecnica_cop, mano_de_obra_dias,
            materiales_cubierto_cop, transporte_cubierto_cop, asistencia_tecnica_cubierto_cop,
            mano_de_obra_cubierta_dias, actualizado_en
       from hallazgo_bom
      where hallazgo_id = $1`,
    [hallazgoId],
  )
  const r = rows[0]
  if (!r) return null
  return {
    id: r.id,
    hallazgoId: r.hallazgo_id,
    origen: r.origen,
    plantillaId: r.plantilla_id,
    materialesCop: Number(r.materiales_cop),
    transporteCop: Number(r.transporte_cop),
    asistenciaTecnicaCop: Number(r.asistencia_tecnica_cop),
    manoDeObraDias: r.mano_de_obra_dias,
    materialesCubiertoCop: Number(r.materiales_cubierto_cop),
    transporteCubiertoCop: Number(r.transporte_cubierto_cop),
    asistenciaTecnicaCubiertoCop: Number(r.asistencia_tecnica_cubierto_cop),
    manoDeObraCubiertaDias: r.mano_de_obra_cubierta_dias,
    actualizadoEn: r.actualizado_en,
  }
}

export type EntradaBom = ComponentesBom & {
  hallazgoId: string
  organizacionId: string
  origen: OrigenBom
  plantillaId?: string | null
  materialesCubiertoCop?: number
  transporteCubiertoCop?: number
  asistenciaTecnicaCubiertoCop?: number
  manoDeObraCubiertaDias?: number
}

/**
 * Record or replace the bill of materials for a finding (§21 AC #1: template-proposed, editable by
 * the técnico). Upserts on the finding — one BoM per finding — so «generate from template» and
 * «edit» are the same write. `actorId` becomes `editado_por`, checked against auth.uid() by the
 * insert policy.
 */
export async function guardarBom(
  client: PoolClient,
  entrada: EntradaBom,
  actorId: string,
): Promise<void> {
  await client.query(
    `insert into hallazgo_bom
       (hallazgo_id, organizacion_id, origen, plantilla_id,
        materiales_cop, transporte_cop, asistencia_tecnica_cop, mano_de_obra_dias,
        materiales_cubierto_cop, transporte_cubierto_cop, asistencia_tecnica_cubierto_cop,
        mano_de_obra_cubierta_dias, editado_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     on conflict (hallazgo_id) do update set
        origen = excluded.origen,
        plantilla_id = excluded.plantilla_id,
        materiales_cop = excluded.materiales_cop,
        transporte_cop = excluded.transporte_cop,
        asistencia_tecnica_cop = excluded.asistencia_tecnica_cop,
        mano_de_obra_dias = excluded.mano_de_obra_dias,
        materiales_cubierto_cop = excluded.materiales_cubierto_cop,
        transporte_cubierto_cop = excluded.transporte_cubierto_cop,
        asistencia_tecnica_cubierto_cop = excluded.asistencia_tecnica_cubierto_cop,
        mano_de_obra_cubierta_dias = excluded.mano_de_obra_cubierta_dias,
        editado_por = excluded.editado_por`,
    [
      entrada.hallazgoId,
      entrada.organizacionId,
      entrada.origen,
      entrada.plantillaId ?? null,
      entrada.materialesCop,
      entrada.transporteCop,
      entrada.asistenciaTecnicaCop,
      entrada.manoDeObraDias,
      entrada.materialesCubiertoCop ?? 0,
      entrada.transporteCubiertoCop ?? 0,
      entrada.asistenciaTecnicaCubiertoCop ?? 0,
      entrada.manoDeObraCubiertaDias ?? 0,
      actorId,
    ],
  )
}

/** Communities the caller may see, for the sweep/finding forms. */
export async function comunidadesParaEvaluar(
  client: PoolClient,
): Promise<{ id: string; nombre: string; municipio: string }[]> {
  const { rows } = await client.query<{ id: string; nombre: string; municipio: string }>(
    `select id, nombre, municipio from comunidades where activa order by municipio, nombre`,
  )
  return rows
}

/** The flat sweep rows the Level 4 coverage rollup aggregates. */
export async function filasCobertura(client: PoolClient): Promise<FilaCobertura[]> {
  const { rows } = await client.query<{
    comunidad_id: string
    comunidad_nombre: string
    municipio: string
    dominio: DominioEvaluacion
    fecha_visita: string
    total_estimado: number
    evaluados: string
    vence_en: string | null
  }>(
    `select e.comunidad_id,
            c.nombre as comunidad_nombre,
            c.municipio,
            e.dominio,
            to_char(e.fecha_visita, 'YYYY-MM-DD') as fecha_visita,
            e.total_estimado,
            count(h.id) as evaluados,
            to_char(e.vence_en, 'YYYY-MM-DD') as vence_en
       from evaluaciones e
       join comunidades c on c.id = e.comunidad_id
       left join evaluacion_hallazgos h on h.evaluacion_id = e.id
      group by e.id, c.nombre, c.municipio`,
  )
  return rows.map((r) => ({
    comunidadId: r.comunidad_id,
    comunidadNombre: r.comunidad_nombre,
    municipio: r.municipio,
    dominio: r.dominio,
    fechaVisita: r.fecha_visita,
    totalEstimado: r.total_estimado,
    evaluados: Number(r.evaluados),
    venceEn: r.vence_en,
  }))
}
