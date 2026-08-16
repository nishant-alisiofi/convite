import type { PoolClient } from 'pg'
import {
  type CadenciaPrograma,
  CADENCIAS_PROGRAMA,
  type EstadoPrograma,
  ESTADOS_PROGRAMA,
} from '@/db/schema/programas'
import type { Modo, Temporada } from '@/db/schema/vocabulario'
import { Grafo } from '@/lib/matching/grafo'
import type { RutaGrafo, TemporadaActual } from '@/lib/matching/tipos'

/**
 * PRD-31 (§21b) — programas: reading and recording the funded layer above jornadas, and the
 * seasonal-feasibility calendar that is its differentiated capability (§21b.2).
 *
 * Every function runs against the client `conSesion()` hands it, so RLS (0045) is the real
 * boundary: only coordinador/admin see or write, and reads are scoped to the caller's
 * organisation. The panel gates the UI on top of that; the data boundary does not depend on the
 * UI being right (§11). COP is plain COP; pg returns bigint as a string, so the row mappers
 * convert with `Number()` (COP is far inside the safe-integer range).
 *
 * The seasonal-feasibility calc is split into pure functions (unit-tested without a database) and
 * a thin loader that feeds them the route graph. Reachability reuses the matching engine's `Grafo`
 * unchanged (§22 — the engine does not change); cost is the cheapest inbound seasonal leg, which is
 * the per-leg-by-season figure §21b.2 itself quotes. It never fabricates future state beyond
 * seasonality: a route closed by a verified damage report stays closed and is flagged.
 */

export const PROGRAMA_ROLES = ['coordinador', 'admin'] as const

export const ETIQUETA_CADENCIA: Record<CadenciaPrograma, string> = {
  mensual: 'Mensual',
  semanal: 'Semanal',
  trimestral: 'Trimestral',
  unico: 'Una sola vez',
}

export const ETIQUETA_ESTADO_PROGRAMA: Record<EstadoPrograma, string> = {
  borrador: 'Borrador',
  activo: 'Activo',
  pausado: 'Pausado',
  completado: 'Completado',
  cancelado: 'Cancelado',
}

/** Calendar month names, es-CO. Index 0 = enero. */
export const MESES_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const

// ── Types ────────────────────────────────────────────────────────────────────────────────────

export type Programa = {
  id: string
  codigo: string
  titulo: string
  objetivo: string
  poblacionObjetivo: string | null
  familiasObjetivo: number | null
  cadencia: string
  estado: string
  fechaInicio: string | null
  fechaFin: string | null
  renueva: boolean
  presupuestoComprometidoCop: number
  aplicadoCop: number
  restanteCop: number
  financiador: string | null
  financiadorReporte: string | null
  notas: string | null
  comunidades: number
  jornadas: number
  participantes: number
  creadoEn: Date
}

export type ComunidadObjetivo = {
  id: string
  comunidadId: string
  comunidadNombre: string | null
  familiasEstimadas: number | null
}

export type Participante = {
  id: string
  nombre: string
  contacto: string | null
  completado: boolean
  completadoEn: Date | null
  asistencias: number
  creadoEn: Date
}

export type ApadrinamientoPrograma = {
  id: string
  etiqueta: string
  padrinoNombre: string
  padrinoTipo: string
  montoCop: number
  recurrencia: string
  estado: string
  consentimiento: boolean
  aplicadoCop: number
  disponibleCop: number
  creadoEn: Date
}

export type AplicacionPrograma = {
  id: string
  montoAplicadoCop: number
  concepto: string | null
  apadrinamientoId: string | null
  apadrinamientoEtiqueta: string | null
  jornadaId: string | null
  jornadaTitulo: string | null
  creadoEn: Date
}

// ── Budget & sponsorship arithmetic (pure) ─────────────────────────────────────────────────────

export type ResumenPresupuesto = {
  comprometidoCop: number
  aplicadoCop: number
  restanteCop: number
}

/**
 * §21b.1 Presupuesto (AC2): committed, applied, remaining. Clamped so a hand-repaired row stays
 * honest. Pure, so PRD reporting can reuse it without a database.
 */
export function resumenPresupuesto(comprometidoCop: number, aplicadoCop: number): ResumenPresupuesto {
  return { comprometidoCop, aplicadoCop, restanteCop: Math.max(0, comprometidoCop - aplicadoCop) }
}

export type ResumenPadrinazgo = {
  comprometidoCop: number
  aplicadoCop: number
  disponibleCop: number
  activos: number
}

/**
 * §21b.4 (AC5): programa sponsorship totals across the *active* sponsorships — comprometido,
 * aplicado, disponible — mirroring Apadrinar. Pure.
 */
export function resumenPadrinazgo(padrinazgos: readonly ApadrinamientoPrograma[]): ResumenPadrinazgo {
  const activos = padrinazgos.filter((p) => p.estado === 'activo')
  const comprometidoCop = activos.reduce((s, p) => s + p.montoCop, 0)
  const aplicadoCop = activos.reduce((s, p) => s + p.aplicadoCop, 0)
  return {
    comprometidoCop,
    aplicadoCop,
    disponibleCop: Math.max(0, comprometidoCop - aplicadoCop),
    activos: activos.length,
  }
}

// ── Seasonal feasibility (§21b.2) ──────────────────────────────────────────────────────────────

/**
 * Which season a calendar month falls in, in the Chocó basin. The route graph carries `lluvias`
 * and `seca` rows; a plan dated in a month must resolve the season that month is in (§23.3).
 *
 * DEFAULT ASSUMPTION, correctable: the Pacific Chocó is one of the wettest places on earth, so
 * `lluvias` is the normal state; the drier «veranillo» runs roughly December–March. The season a
 * given month is really in is local knowledge — this is the sane default a coordinator's context
 * can override, never a claim of certainty.
 */
export function temporadaDeMes(mes: number): TemporadaActual {
  const m = ((mes % 12) + 12) % 12
  return m === 11 || m <= 2 ? 'seca' : 'lluvias'
}

/** Whether a jornada is planned in the i-th month of the window, given the programa's cadence. */
export function ocurreEnMes(cadencia: string, indice: number): boolean {
  switch (cadencia) {
    case 'unico':
      return indice === 0
    case 'trimestral':
      return indice % 3 === 0
    case 'semanal': // «twelve weekly sessions» — at least one every month it runs
    case 'mensual':
      return true
    default:
      return true
  }
}

/** Reachability + cost of one target community, per season — the input to the calendar. */
export type AlcanceComunidad = {
  comunidadId: string
  nombre: string
  porTemporada: Record<
    TemporadaActual,
    { alcanzable: boolean; costoCop: number | null; rutaCerrada: boolean }
  >
}

export type MesFeasibilidad = {
  indice: number
  mes: number
  anio: number
  temporada: TemporadaActual
  ocurre: boolean
  costoMesCop: number
  inalcanzables: string[]
}

export type Feasibilidad = {
  meses: MesFeasibilidad[]
  costoAnioCop: number
  /** Named gaps, verbatim-style: «Docampadó queda incomunicada de junio a octubre». */
  brechas: string[]
  /** % change of the second half's cost vs the first half's, or null when the first half is free. */
  costoSegundoSemestrePct: number | null
  /** True when there is no supply origin (no active node) to reach anything from. */
  sinOrigenes: boolean
}

const TEMPORADAS_CAL: readonly TemporadaActual[] = ['lluvias', 'seca']

/**
 * The window a programa's calendar covers: the month/year its start date falls in, and how many
 * months to project. Duration bounds it (capped at 24); with no dates it is the coming 12 months
 * from today. Pure.
 */
export function ventana(
  fechaInicio: string | null,
  fechaFin: string | null,
  ahora: Date = new Date(),
): { mesInicio: number; anioInicio: number; meses: number } {
  const inicio = fechaInicio ? new Date(`${fechaInicio}T00:00:00Z`) : ahora
  const mesInicio = inicio.getUTCMonth()
  const anioInicio = inicio.getUTCFullYear()
  let meses = 12
  if (fechaInicio && fechaFin) {
    const fin = new Date(`${fechaFin}T00:00:00Z`)
    const diff = (fin.getUTCFullYear() - anioInicio) * 12 + (fin.getUTCMonth() - mesInicio) + 1
    meses = Math.min(24, Math.max(1, diff))
  }
  return { mesInicio, anioInicio, meses }
}

/**
 * The calendar of reachability and cost by season (AC3). Pure: handed each community's per-season
 * reachability and cost, it returns the calendar, the year cost, the named gaps and the season
 * cost delta. It never guesses beyond seasonality.
 */
export function calcularFeasibilidad(
  alcances: readonly AlcanceComunidad[],
  cadencia: string,
  mesInicio: number,
  anioInicio: number,
  meses: number,
  sinOrigenes = false,
): Feasibilidad {
  const filas: MesFeasibilidad[] = []
  for (let i = 0; i < meses; i++) {
    const mes = (mesInicio + i) % 12
    const anio = anioInicio + Math.floor((mesInicio + i) / 12)
    const temporada = temporadaDeMes(mes)
    const ocurre = ocurreEnMes(cadencia, i)
    let costoMesCop = 0
    const inalcanzables: string[] = []
    for (const a of alcances) {
      const s = a.porTemporada[temporada]
      if (s.alcanzable) {
        if (ocurre) costoMesCop += s.costoCop ?? 0
      } else if (ocurre) {
        inalcanzables.push(a.nombre)
      }
    }
    filas.push({ indice: i, mes, anio, temporada, ocurre, costoMesCop, inalcanzables })
  }

  // Named gaps: contiguous runs, over the window, where a community cannot be reached.
  const brechas: string[] = []
  for (const a of alcances) {
    const cerradaPorReporte = TEMPORADAS_CAL.some(
      (t) => !a.porTemporada[t].alcanzable && a.porTemporada[t].rutaCerrada,
    )
    const runs: Array<[number, number]> = []
    let ini = -1
    for (let i = 0; i < meses; i++) {
      const inalcanzable = !a.porTemporada[temporadaDeMes((mesInicio + i) % 12)].alcanzable
      if (inalcanzable && ini === -1) ini = i
      if (ini !== -1 && (!inalcanzable || i === meses - 1)) {
        runs.push([ini, inalcanzable ? i : i - 1])
        ini = -1
      }
    }
    if (runs.length === 0) continue
    const nota = cerradaPorReporte ? ' — ruta cerrada por un reporte' : ''
    if (runs.length === 1 && runs[0]![0] === 0 && runs[0]![1] === meses - 1) {
      brechas.push(`${a.nombre} queda incomunicada todo el periodo${nota}`)
      continue
    }
    for (const [desde, hasta] of runs) {
      const mesDesde = MESES_ES[(mesInicio + desde) % 12]
      if (desde === hasta) {
        brechas.push(`${a.nombre} queda incomunicada en ${mesDesde}${nota}`)
      } else {
        const mesHasta = MESES_ES[(mesInicio + hasta) % 12]
        brechas.push(`${a.nombre} queda incomunicada de ${mesDesde} a ${mesHasta}${nota}`)
      }
    }
  }

  const mitad = Math.floor(meses / 2)
  let primer = 0
  let segundo = 0
  for (const f of filas) {
    if (f.indice < mitad) primer += f.costoMesCop
    else segundo += f.costoMesCop
  }
  const costoSegundoSemestrePct = primer > 0 ? Math.round(((segundo - primer) / primer) * 100) : null

  return {
    meses: filas,
    costoAnioCop: filas.reduce((s, f) => s + f.costoMesCop, 0),
    brechas,
    costoSegundoSemestrePct,
    sinOrigenes,
  }
}

type FilaRuta = {
  id: string
  origen_id: string
  destino_id: string
  modo: string
  minutos: number | null
  costo_estimado_cop: string | number | null
  temporada: string
  activa: boolean
  cerrada_por_reporte: boolean
}

/**
 * Turn raw route rows + a set of supply origins into per-community, per-season reachability and
 * cost. Reachability reuses `Grafo` (multi-hop, season-aware, the engine unchanged); cost is the
 * cheapest active inbound leg for that season. A community that is unreachable and whose only
 * inbound leg is closed by a verified damage report is flagged (§21b.2). Pure.
 */
export function alcancesDeComunidades(
  comunidades: ReadonlyArray<{ comunidad_id: string; nombre: string | null }>,
  rutas: readonly FilaRuta[],
  origenes: readonly string[],
): AlcanceComunidad[] {
  const rutasGrafo: RutaGrafo[] = rutas.map((r) => ({
    id: r.id,
    origenId: r.origen_id,
    destinoId: r.destino_id,
    modo: r.modo as Modo,
    minutos: r.minutos,
    temporada: r.temporada as Temporada,
    activa: r.activa,
  }))
  const grafos = new Map(TEMPORADAS_CAL.map((t) => [t, new Grafo(rutasGrafo, t)]))

  return comunidades.map((c) => {
    const porTemporada = {} as AlcanceComunidad['porTemporada']
    for (const t of TEMPORADAS_CAL) {
      const g = grafos.get(t)!
      const alcanzable = origenes.some((o) => g.llega(o, c.comunidad_id))
      let costoCop: number | null = null
      let cerrada = false
      for (const r of rutas) {
        if (r.destino_id !== c.comunidad_id) continue
        if (r.temporada !== 'todo_el_ano' && r.temporada !== t) continue
        if (r.activa) {
          const cop = r.costo_estimado_cop === null ? null : Number(r.costo_estimado_cop)
          if (cop !== null && (costoCop === null || cop < costoCop)) costoCop = cop
        } else if (r.cerrada_por_reporte) {
          cerrada = true
        }
      }
      porTemporada[t] = { alcanzable, costoCop, rutaCerrada: cerrada && !alcanzable }
    }
    return { comunidadId: c.comunidad_id, nombre: c.nombre ?? '—', porTemporada }
  })
}

/** The seasonal-feasibility calendar for a programa's target communities (§21b.2 / AC3). */
export async function feasibilidadDePrograma(
  client: PoolClient,
  programaId: string,
): Promise<Feasibilidad> {
  const { rows: prog } = await client.query<{
    cadencia: string
    fecha_inicio: string | null
    fecha_fin: string | null
  }>(`select cadencia, fecha_inicio, fecha_fin from programas where id = $1`, [programaId])
  const p = prog[0]
  if (!p) {
    return { meses: [], costoAnioCop: 0, brechas: [], costoSegundoSemestrePct: null, sinOrigenes: false }
  }

  const { rows: comunidades } = await client.query<{ comunidad_id: string; nombre: string | null }>(
    `select pc.comunidad_id, c.nombre
       from programa_comunidades pc
       left join comunidades c on c.id = pc.comunidad_id
      where pc.programa_id = $1
      order by c.nombre`,
    [programaId],
  )

  const { rows: nodos } = await client.query<{ comunidad_id: string }>(
    `select distinct comunidad_id from nodos where activo`,
  )
  const origenes = nodos.map((n) => n.comunidad_id)

  const { rows: rutas } = await client.query<FilaRuta>(
    `select id, origen_id, destino_id, modo, minutos, costo_estimado_cop, temporada, activa,
            (desactivada_por is not null) as cerrada_por_reporte
       from rutas`,
  )

  const alcances = alcancesDeComunidades(comunidades, rutas, origenes)
  const { mesInicio, anioInicio, meses } = ventana(p.fecha_inicio, p.fecha_fin)
  return calcularFeasibilidad(alcances, p.cadencia, mesInicio, anioInicio, meses, origenes.length === 0)
}

// ── Reads ──────────────────────────────────────────────────────────────────────────────────────

type FilaPrograma = {
  id: string
  codigo: string
  titulo: string
  objetivo: string
  poblacion_objetivo: string | null
  familias_objetivo: number | null
  cadencia: string
  estado: string
  fecha_inicio: string | null
  fecha_fin: string | null
  renueva: boolean
  presupuesto_comprometido_cop: string
  aplicado_cop: string
  financiador: string | null
  financiador_reporte: string | null
  notas: string | null
  comunidades: string
  jornadas: string
  participantes: string
  creado_en: Date
}

function mapearPrograma(r: FilaPrograma): Programa {
  const comprometido = Number(r.presupuesto_comprometido_cop)
  const aplicado = Number(r.aplicado_cop)
  return {
    id: r.id,
    codigo: r.codigo,
    titulo: r.titulo,
    objetivo: r.objetivo,
    poblacionObjetivo: r.poblacion_objetivo,
    familiasObjetivo: r.familias_objetivo,
    cadencia: r.cadencia,
    estado: r.estado,
    fechaInicio: r.fecha_inicio,
    fechaFin: r.fecha_fin,
    renueva: r.renueva,
    presupuestoComprometidoCop: comprometido,
    aplicadoCop: aplicado,
    restanteCop: Math.max(0, comprometido - aplicado),
    financiador: r.financiador,
    financiadorReporte: r.financiador_reporte,
    notas: r.notas,
    comunidades: Number(r.comunidades),
    jornadas: Number(r.jornadas),
    participantes: Number(r.participantes),
    creadoEn: r.creado_en,
  }
}

const SELECT_PROGRAMA = `
  select p.id, p.codigo, p.titulo, p.objetivo, p.poblacion_objetivo, p.familias_objetivo,
         p.cadencia, p.estado, p.fecha_inicio, p.fecha_fin, p.renueva,
         p.presupuesto_comprometido_cop,
         coalesce((select sum(a.monto_aplicado_cop) from programa_aplicaciones a
                    where a.programa_id = p.id), 0) as aplicado_cop,
         p.financiador, p.financiador_reporte, p.notas,
         (select count(*) from programa_comunidades pc where pc.programa_id = p.id) as comunidades,
         (select count(*) from jornadas j where j.programa_id = p.id) as jornadas,
         (select count(*) from programa_participantes pp where pp.programa_id = p.id) as participantes,
         p.creado_en
    from programas p`

export async function listarProgramas(client: PoolClient): Promise<Programa[]> {
  const { rows } = await client.query<FilaPrograma>(`${SELECT_PROGRAMA} order by p.creado_en desc`)
  return rows.map(mapearPrograma)
}

export async function programaPorId(client: PoolClient, id: string): Promise<Programa | null> {
  const { rows } = await client.query<FilaPrograma>(`${SELECT_PROGRAMA} where p.id = $1`, [id])
  return rows[0] ? mapearPrograma(rows[0]) : null
}

export async function comunidadesDe(
  client: PoolClient,
  programaId: string,
): Promise<ComunidadObjetivo[]> {
  const { rows } = await client.query<{
    id: string
    comunidad_id: string
    comunidad_nombre: string | null
    familias_estimadas: number | null
  }>(
    `select pc.id, pc.comunidad_id, c.nombre as comunidad_nombre, pc.familias_estimadas
       from programa_comunidades pc
       left join comunidades c on c.id = pc.comunidad_id
      where pc.programa_id = $1
      order by c.nombre`,
    [programaId],
  )
  return rows.map((r) => ({
    id: r.id,
    comunidadId: r.comunidad_id,
    comunidadNombre: r.comunidad_nombre,
    familiasEstimadas: r.familias_estimadas,
  }))
}

export async function participantesDe(
  client: PoolClient,
  programaId: string,
): Promise<Participante[]> {
  const { rows } = await client.query<{
    id: string
    nombre: string
    contacto: string | null
    completado: boolean
    completado_en: Date | null
    asistencias: string
    creado_en: Date
  }>(
    `select pp.id, pp.nombre, pp.contacto, pp.completado, pp.completado_en,
            (select count(*) from programa_asistencias pas
              where pas.participante_id = pp.id and pas.asistio) as asistencias,
            pp.creado_en
       from programa_participantes pp
      where pp.programa_id = $1
      order by pp.nombre`,
    [programaId],
  )
  return rows.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    contacto: r.contacto,
    completado: r.completado,
    completadoEn: r.completado_en,
    asistencias: Number(r.asistencias),
    creadoEn: r.creado_en,
  }))
}

export async function apadrinamientosDe(
  client: PoolClient,
  programaId: string,
): Promise<ApadrinamientoPrograma[]> {
  const { rows } = await client.query<{
    id: string
    etiqueta: string
    padrino_nombre: string
    padrino_tipo: string
    monto_cop: string
    recurrencia: string
    estado: string
    consentimiento: boolean
    aplicado_cop: string
    creado_en: Date
  }>(
    `select pa.id, pa.etiqueta, pa.padrino_nombre, pa.padrino_tipo, pa.monto_cop,
            pa.recurrencia, pa.estado, pa.consentimiento,
            coalesce((select sum(a.monto_aplicado_cop) from programa_aplicaciones a
                       where a.apadrinamiento_id = pa.id), 0) as aplicado_cop,
            pa.creado_en
       from programa_apadrinamientos pa
      where pa.programa_id = $1
      order by pa.creado_en desc`,
    [programaId],
  )
  return rows.map((r) => {
    const montoCop = Number(r.monto_cop)
    const aplicadoCop = Number(r.aplicado_cop)
    return {
      id: r.id,
      etiqueta: r.etiqueta,
      padrinoNombre: r.padrino_nombre,
      padrinoTipo: r.padrino_tipo,
      montoCop,
      recurrencia: r.recurrencia,
      estado: r.estado,
      consentimiento: r.consentimiento,
      aplicadoCop,
      disponibleCop: Math.max(0, montoCop - aplicadoCop),
      creadoEn: r.creado_en,
    }
  })
}

export async function aplicacionesDe(
  client: PoolClient,
  programaId: string,
): Promise<AplicacionPrograma[]> {
  const { rows } = await client.query<{
    id: string
    monto_aplicado_cop: string
    concepto: string | null
    apadrinamiento_id: string | null
    apadrinamiento_etiqueta: string | null
    jornada_id: string | null
    jornada_titulo: string | null
    creado_en: Date
  }>(
    `select a.id, a.monto_aplicado_cop, a.concepto,
            a.apadrinamiento_id, pa.etiqueta as apadrinamiento_etiqueta,
            a.jornada_id, j.titulo as jornada_titulo, a.creado_en
       from programa_aplicaciones a
       left join programa_apadrinamientos pa on pa.id = a.apadrinamiento_id
       left join jornadas j on j.id = a.jornada_id
      where a.programa_id = $1
      order by a.creado_en desc`,
    [programaId],
  )
  return rows.map((r) => ({
    id: r.id,
    montoAplicadoCop: Number(r.monto_aplicado_cop),
    concepto: r.concepto,
    apadrinamientoId: r.apadrinamiento_id,
    apadrinamientoEtiqueta: r.apadrinamiento_etiqueta,
    jornadaId: r.jornada_id,
    jornadaTitulo: r.jornada_titulo,
    creadoEn: r.creado_en,
  }))
}

// ── Writes ───────────────────────────────────────────────────────────────────────────────────

/** `P-260816-2`: short and legible, mirroring the envío / jornada code convention. */
async function siguienteCodigo(client: PoolClient): Promise<string> {
  const hoy = new Date()
  const dia = `${String(hoy.getUTCFullYear()).slice(2)}${String(hoy.getUTCMonth() + 1).padStart(2, '0')}${String(hoy.getUTCDate()).padStart(2, '0')}`
  const { rows } = await client.query<{ n: string }>(
    `select count(*)::text as n from programas where codigo like $1`,
    [`P-${dia}-%`],
  )
  return `P-${dia}-${Number(rows[0]!.n) + 1}`
}

export type NuevoPrograma = {
  organizacionId: string
  titulo: string
  objetivo: string
  poblacionObjetivo?: string | null
  familiasObjetivo?: number | null
  cadencia: CadenciaPrograma
  fechaInicio?: string | null
  fechaFin?: string | null
  renueva?: boolean
  estado?: EstadoPrograma
  presupuestoComprometidoCop?: number
  financiador?: string | null
  financiadorReporte?: string | null
  notas?: string | null
}

/** Record a programa. `actorId` becomes `creado_por`, checked against auth.uid() by RLS (0045). */
export async function crearPrograma(
  client: PoolClient,
  entrada: NuevoPrograma,
  actorId: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into programas
       (codigo, organizacion_id, titulo, objetivo, poblacion_objetivo, familias_objetivo,
        cadencia, fecha_inicio, fecha_fin, renueva, estado, presupuesto_comprometido_cop,
        financiador, financiador_reporte, notas, creado_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     returning id`,
    [
      await siguienteCodigo(client),
      entrada.organizacionId,
      entrada.titulo,
      entrada.objetivo,
      entrada.poblacionObjetivo ?? null,
      entrada.familiasObjetivo ?? null,
      entrada.cadencia,
      entrada.fechaInicio ?? null,
      entrada.fechaFin ?? null,
      entrada.renueva ?? false,
      entrada.estado ?? 'borrador',
      entrada.presupuestoComprometidoCop ?? 0,
      entrada.financiador ?? null,
      entrada.financiadorReporte ?? null,
      entrada.notas ?? null,
      actorId,
    ],
  )
  return rows[0]!.id
}

export type CambioPrograma = {
  titulo?: string
  objetivo?: string
  poblacionObjetivo?: string | null
  familiasObjetivo?: number | null
  cadencia?: CadenciaPrograma
  fechaInicio?: string | null
  fechaFin?: string | null
  renueva?: boolean
  estado?: EstadoPrograma
  presupuestoComprometidoCop?: number
  financiador?: string | null
  financiadorReporte?: string | null
  notas?: string | null
}

export async function actualizarPrograma(
  client: PoolClient,
  id: string,
  cambios: CambioPrograma,
): Promise<void> {
  const sets: string[] = []
  const params: unknown[] = []
  const poner = (col: string, valor: unknown) => {
    params.push(valor)
    sets.push(`${col} = $${params.length}`)
  }
  if (cambios.titulo !== undefined) poner('titulo', cambios.titulo)
  if (cambios.objetivo !== undefined) poner('objetivo', cambios.objetivo)
  if (cambios.poblacionObjetivo !== undefined) poner('poblacion_objetivo', cambios.poblacionObjetivo)
  if (cambios.familiasObjetivo !== undefined) poner('familias_objetivo', cambios.familiasObjetivo)
  if (cambios.cadencia !== undefined) poner('cadencia', cambios.cadencia)
  if (cambios.fechaInicio !== undefined) poner('fecha_inicio', cambios.fechaInicio)
  if (cambios.fechaFin !== undefined) poner('fecha_fin', cambios.fechaFin)
  if (cambios.renueva !== undefined) poner('renueva', cambios.renueva)
  if (cambios.estado !== undefined) poner('estado', cambios.estado)
  if (cambios.presupuestoComprometidoCop !== undefined)
    poner('presupuesto_comprometido_cop', cambios.presupuestoComprometidoCop)
  if (cambios.financiador !== undefined) poner('financiador', cambios.financiador)
  if (cambios.financiadorReporte !== undefined)
    poner('financiador_reporte', cambios.financiadorReporte)
  if (cambios.notas !== undefined) poner('notas', cambios.notas)
  if (sets.length === 0) return
  params.push(id)
  await client.query(`update programas set ${sets.join(', ')} where id = $${params.length}`, params)
}

export async function agregarComunidad(
  client: PoolClient,
  programaId: string,
  comunidadId: string,
  familiasEstimadas?: number | null,
): Promise<void> {
  await client.query(
    `insert into programa_comunidades (programa_id, comunidad_id, familias_estimadas)
     values ($1, $2, $3)
     on conflict (programa_id, comunidad_id)
       do update set familias_estimadas = excluded.familias_estimadas`,
    [programaId, comunidadId, familiasEstimadas ?? null],
  )
}

export async function quitarComunidad(client: PoolClient, id: string): Promise<void> {
  await client.query(`delete from programa_comunidades where id = $1`, [id])
}

export async function agregarParticipante(
  client: PoolClient,
  programaId: string,
  nombre: string,
  contacto?: string | null,
): Promise<void> {
  await client.query(
    `insert into programa_participantes (programa_id, nombre, contacto) values ($1, $2, $3)`,
    [programaId, nombre, contacto ?? null],
  )
}

/** Completion is per cohort (§21b.3): the flag and its timestamp move together. */
export async function marcarCompletado(
  client: PoolClient,
  participanteId: string,
  completado: boolean,
): Promise<void> {
  await client.query(
    `update programa_participantes
        set completado = $2, completado_en = case when $2 then now() else null end
      where id = $1`,
    [participanteId, completado],
  )
}

export async function quitarParticipante(client: PoolClient, id: string): Promise<void> {
  await client.query(`delete from programa_participantes where id = $1`, [id])
}

/**
 * Record attendance of a participant at a session (a jornada). One row per pair; re-marking
 * updates it. Records only THAT they attended (§22).
 */
export async function marcarAsistencia(
  client: PoolClient,
  participanteId: string,
  jornadaId: string,
  asistio: boolean,
): Promise<void> {
  await client.query(
    `insert into programa_asistencias (participante_id, jornada_id, asistio)
     values ($1, $2, $3)
     on conflict (participante_id, jornada_id) do update set asistio = excluded.asistio`,
    [participanteId, jornadaId, asistio],
  )
}

export type NuevoApadrinamientoPrograma = {
  programaId: string
  etiqueta: string
  padrinoNombre: string
  padrinoContacto?: string | null
  padrinoTipo: 'individuo' | 'organizacion'
  montoCop: number
  recurrencia: 'unico' | 'mensual'
  consentimiento: boolean
  notas?: string | null
}

/** Fund a programa (§21b.4). `actorId` becomes `creado_por`, checked against auth.uid() by RLS. */
export async function crearApadrinamiento(
  client: PoolClient,
  entrada: NuevoApadrinamientoPrograma,
  actorId: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into programa_apadrinamientos
       (programa_id, etiqueta, padrino_nombre, padrino_contacto, padrino_tipo, monto_cop,
        recurrencia, consentimiento, consentimiento_en, creado_por, notas)
     values ($1, $2, $3, $4, $5, $6, $7, $8, case when $8 then now() else null end, $9, $10)
     returning id`,
    [
      entrada.programaId,
      entrada.etiqueta,
      entrada.padrinoNombre,
      entrada.padrinoContacto ?? null,
      entrada.padrinoTipo,
      entrada.montoCop,
      entrada.recurrencia,
      entrada.consentimiento,
      actorId,
      entrada.notas ?? null,
    ],
  )
  return rows[0]!.id
}

export async function actualizarApadrinamiento(
  client: PoolClient,
  id: string,
  cambios: { estado?: EstadoPrograma; consentimiento?: boolean },
): Promise<void> {
  const sets: string[] = []
  const params: unknown[] = []
  const poner = (col: string, valor: unknown) => {
    params.push(valor)
    sets.push(`${col} = $${params.length}`)
  }
  if (cambios.estado !== undefined) poner('estado', cambios.estado)
  if (cambios.consentimiento !== undefined) {
    poner('consentimiento', cambios.consentimiento)
    // Turning consent on stamps the time; turning it off keeps the prior stamp (audit trail).
    sets.push(`consentimiento_en = case when $${params.length} then now() else consentimiento_en end`)
  }
  if (sets.length === 0) return
  params.push(id)
  await client.query(
    `update programa_apadrinamientos set ${sets.join(', ')} where id = $${params.length}`,
    params,
  )
}

export type NuevaAplicacion = {
  programaId: string
  apadrinamientoId?: string | null
  jornadaId?: string | null
  montoAplicadoCop: number
  concepto?: string | null
}

/** Apply spend against a programa's budget — the immutable ledger write (AC2/AC5). */
export async function aplicarFondos(
  client: PoolClient,
  entrada: NuevaAplicacion,
  actorId: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into programa_aplicaciones
       (programa_id, apadrinamiento_id, jornada_id, monto_aplicado_cop, concepto, aplicado_por)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [
      entrada.programaId,
      entrada.apadrinamientoId ?? null,
      entrada.jornadaId ?? null,
      entrada.montoAplicadoCop,
      entrada.concepto ?? null,
      actorId,
    ],
  )
  return rows[0]!.id
}

export { CADENCIAS_PROGRAMA, ESTADOS_PROGRAMA }
