import type { Pool, PoolClient } from 'pg'
import { presupuestoVoz } from '@/lib/canales/topes'

/**
 * Is the system actually working, or is it just up?
 *
 * PRD §6 names the failure this exists to catch: «a silently failing matcher looks exactly
 * like a quiet week». Nothing throws when the worker dies. The webhooks keep returning 200,
 * the Tablero keeps rendering, and reports pile up in a queue nobody is draining — and the
 * first person to notice is a coordinator wondering why Bellavista went quiet.
 *
 * So this answers the honest question rather than the easy one. A health check that returns
 * 200 because the process is running is a health check that reports "fine" during exactly
 * the outage that matters here.
 *
 * Everything is counted, never cached. Same discipline as the link telemetry and the spend
 * caps: a number nobody can re-derive is a number nobody can trust.
 *
 * Nothing in here is a coordinate, a community name, or a phone number. That is deliberate —
 * this is the one route that answers without a session, so 2.4 applies to it hardest.
 */

/** A job claimed this long ago and still 'corriendo' means the worker died holding it. */
export const MINUTOS_JOB_COLGADO = 15
/** Work due this long ago and still pending means nothing is running the queue at all. */
export const MINUTOS_JOB_ATRASADO = 10
/** Outbound queued this long means either nobody reappeared or the sender is broken. */
export const HORAS_SALIDA_VIEJA = 48
/** Depth above zero and nothing finished in this long is a stalled queue, not a quiet one. */
export const MINUTOS_SIN_PROCESAR = 15
/**
 * PRD §6's day-one metric. Past this, «a person is missing, not automation» — verification is
 * a human action by design (2.1), so a rising median is a staffing signal and not a bug.
 */
export const HORAS_MEDIANA_VERIFICACION = 24

export type EstadoSalud = {
  ok: boolean
  base: { conectada: boolean; migraciones: number }
  jobs: {
    pendientes: number
    corriendo: number
    fallidos: number
    /** Claimed and never finished — work that is silently lost. */
    colgados: number
    /** Seconds the oldest overdue job has been waiting. */
    atrasoSeg: number
    /** Minutes since anything last finished. Null when nothing has ever run. */
    sinProcesarMin: number | null
  }
  salidas: { encoladas: number; masViejaHoras: number }
  verificacion: {
    /** Median RECIBIDO→VERIFICADO over the last week, in hours. Null with nothing verified. */
    medianaHoras: number | null
    pendientes: number
    /** Age of the oldest report nobody has looked at yet. */
    masViejoHoras: number
  }
  voz: { usadosMin: number; presupuestoMin: number; porcentaje: number; alerta: boolean; agotado: boolean }
  /** Plain Spanish, one line per problem. Empty means healthy. */
  alertas: string[]
}

export async function estadoSistema(
  ejecutor: Pool | PoolClient,
  ahora: Date = new Date(),
): Promise<EstadoSalud> {
  const alertas: string[] = []

  const { rows: migraciones } = await ejecutor.query<{ n: string }>(
    'select count(*) as n from _migraciones',
  )

  const { rows: jobs } = await ejecutor.query<{
    pendientes: string
    corriendo: string
    fallidos: string
    colgados: string
    atraso_seg: string | null
    sin_procesar_seg: string | null
  }>(
    `select
       count(*) filter (where estado = 'pendiente')                                as pendientes,
       count(*) filter (where estado = 'corriendo')                                as corriendo,
       count(*) filter (where estado = 'fallido')                                  as fallidos,
       count(*) filter (
         where estado = 'corriendo'
           and tomado_en < $1::timestamptz - make_interval(mins => $2)
       )                                                                           as colgados,
       coalesce(
         max(extract(epoch from ($1::timestamptz - correr_en)))
           filter (where estado = 'pendiente' and correr_en <= $1::timestamptz),
         0
       )                                                                           as atraso_seg,
       -- The jobs_tocar trigger stamps actualizado_en on every update, so the most recently
       -- finished job is when the worker last did anything at all.
       min(extract(epoch from ($1::timestamptz - actualizado_en)))
         filter (where estado in ('hecho', 'fallido'))                             as sin_procesar_seg
       from jobs`,
    [ahora, MINUTOS_JOB_COLGADO],
  )

  const { rows: salidas } = await ejecutor.query<{ encoladas: string; mas_vieja_seg: string | null }>(
    `select
       count(*)                                                                    as encoladas,
       coalesce(max(extract(epoch from ($1::timestamptz - creado_en))), 0)         as mas_vieja_seg
       from salidas_pendientes
      where enviado_en is null`,
    [ahora],
  )

  // PRD §6's day-one metric, plus the trap underneath it: a median over verified reports
  // says nothing if verification stopped entirely — with nobody verifying, the median is
  // null and a dashboard reading only that looks healthy. So the queue depth and the age of
  // the oldest untouched report are measured beside it.
  const { rows: verificacion } = await ejecutor.query<{
    mediana_seg: string | null
    pendientes: string
    mas_viejo_seg: string | null
  }>(
    `select
       (select percentile_cont(0.5) within group (order by extract(epoch from (verificado_en - creado_en)))
          from reportes
         where verificado_en is not null
           and creado_en >= $1::timestamptz - interval '7 days')                    as mediana_seg,
       count(*) filter (where estado = 'RECIBIDO')                                  as pendientes,
       coalesce(max(extract(epoch from ($1::timestamptz - creado_en)))
         filter (where estado = 'RECIBIDO'), 0)                                     as mas_viejo_seg
       from reportes`,
    [ahora],
  )

  const voz = await presupuestoVoz(ejecutor, ahora)

  const estado: EstadoSalud = {
    ok: true,
    base: { conectada: true, migraciones: Number(migraciones[0]!.n) },
    jobs: {
      pendientes: Number(jobs[0]!.pendientes),
      corriendo: Number(jobs[0]!.corriendo),
      fallidos: Number(jobs[0]!.fallidos),
      colgados: Number(jobs[0]!.colgados),
      atrasoSeg: Math.round(Number(jobs[0]!.atraso_seg ?? 0)),
      sinProcesarMin:
        jobs[0]!.sin_procesar_seg === null
          ? null
          : Math.round(Number(jobs[0]!.sin_procesar_seg) / 60),
    },
    salidas: {
      encoladas: Number(salidas[0]!.encoladas),
      masViejaHoras: Number((Number(salidas[0]!.mas_vieja_seg ?? 0) / 3600).toFixed(1)),
    },
    verificacion: {
      medianaHoras:
        verificacion[0]!.mediana_seg === null
          ? null
          : Number((Number(verificacion[0]!.mediana_seg) / 3600).toFixed(1)),
      pendientes: Number(verificacion[0]!.pendientes),
      masViejoHoras: Number((Number(verificacion[0]!.mas_viejo_seg ?? 0) / 3600).toFixed(1)),
    },
    voz: {
      usadosMin: voz.usadosMin,
      presupuestoMin: voz.presupuestoMin,
      porcentaje: voz.porcentaje,
      alerta: voz.alerta,
      agotado: voz.agotado,
    },
    alertas,
  }

  // ── What counts as unhealthy ────────────────────────────────────────────────────────────
  if (estado.jobs.atrasoSeg > MINUTOS_JOB_ATRASADO * 60) {
    alertas.push(
      `la cola lleva ${Math.round(estado.jobs.atrasoSeg / 60)} minutos sin correr: ` +
        `${estado.jobs.pendientes} job(s) esperando`,
    )
  }
  if (estado.jobs.colgados > 0) {
    // Nothing retries these: `tomarUno` only ever claims 'pendiente', so a job left at
    // 'corriendo' is work that is gone rather than work that is late.
    alertas.push(
      `${estado.jobs.colgados} job(s) llevan más de ${MINUTOS_JOB_COLGADO} min en 'corriendo': ` +
        'el worker murió con ellos y nadie los va a reintentar',
    )
  }
  // The stall the brief asks for: work waiting while nothing finishes. Note this cannot be
  // a scheduled job — a queue cannot report its own death, because the job that would raise
  // the alarm is queued behind the same stall. It is computed here, where a monitor pulling
  // the endpoint sees it even when nothing on this machine is running.
  if (
    estado.jobs.pendientes > 0 &&
    estado.jobs.sinProcesarMin !== null &&
    estado.jobs.sinProcesarMin > MINUTOS_SIN_PROCESAR
  ) {
    alertas.push(
      `la cola está detenida: ${estado.jobs.pendientes} job(s) esperando y nada terminado ` +
        `hace ${estado.jobs.sinProcesarMin} minutos`,
    )
  }
  if (estado.jobs.fallidos > 0) {
    alertas.push(`${estado.jobs.fallidos} job(s) agotaron sus reintentos`)
  }
  if (estado.salidas.masViejaHoras > HORAS_SALIDA_VIEJA) {
    alertas.push(
      `hay respuestas encoladas desde hace ${estado.salidas.masViejaHoras} h sin salir`,
    )
  }
  // 2.1: nothing reaches `pedidos` without a human action, so this is the one number that
  // measures people rather than machinery.
  if (
    estado.verificacion.medianaHoras !== null &&
    estado.verificacion.medianaHoras > HORAS_MEDIANA_VERIFICACION
  ) {
    alertas.push(
      `la verificación tarda ${estado.verificacion.medianaHoras} h en mediana: ` +
        'falta una persona, no automatización',
    )
  }
  if (estado.verificacion.masViejoHoras > HORAS_MEDIANA_VERIFICACION * 2) {
    alertas.push(
      `hay un reporte sin verificar desde hace ${estado.verificacion.masViejoHoras} h`,
    )
  }
  if (voz.agotado) {
    alertas.push('presupuesto de voz agotado: las devoluciones automáticas están apagadas')
  } else if (voz.alerta) {
    alertas.push(`presupuesto de voz al ${Math.round(voz.porcentaje * 100)}%`)
  }

  estado.ok = alertas.length === 0
  return estado
}
