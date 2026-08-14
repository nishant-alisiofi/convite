import type { Pool, PoolClient } from 'pg'

/**
 * The spend caps, checked before any callback is dialled.
 *
 * IVR is the only channel where a bug spends money on its own. A webhook loop on WhatsApp
 * writes rows; a webhook loop here dials two hundred numbers at Colombian mobile rates, at
 * night, with nobody watching. So the caps are not a nice-to-have added once the channel
 * works — nothing dials until they have said yes.
 *
 * Computed from `llamadas` rather than kept as counters, for the same reason `calidad_enlace`
 * is recomputed from `mensajes`: a number nobody can re-derive is a number nobody can trust,
 * and a counter that drifts here drifts money. Blocked calls are excluded from the counts —
 * a refusal must never itself push the next one over the line, or one block cascades into a
 * silent shutdown of the channel.
 *
 * Every refusal is written down. «We did not ring this person back» has to be explainable in
 * the morning.
 */

/** Two callbacks to the same number inside half an hour is already a loop. */
export const TOPE_POR_NUMERO_30MIN = 2
/** Five in a day is more than any real reporting pattern, and a cheap ceiling. */
export const TOPE_POR_NUMERO_DIA = 5
/** Warn the coordinator here, so the shutoff is never the first anyone hears of it. */
export const UMBRAL_ALERTA = 0.7

export const CLAVE_PRESUPUESTO = 'presupuesto_voz_minutos_dia'
/** Used only when the setting row is missing; 0024 seeds it. */
export const PRESUPUESTO_MINUTOS_POR_DEFECTO = 120

export type EstadoPresupuesto = {
  usadosMin: number
  presupuestoMin: number
  /** 0..1+, so a coordinator screen can render a bar that visibly overflows. */
  porcentaje: number
  /** True from 70% — the coordinator surface shows this. */
  alerta: boolean
  /** True when automatic callbacks are off for the rest of the day. */
  agotado: boolean
}

/** Bogotá midnight, in UTC. The day a coordinator means is the day they are living in. */
function inicioDelDia(ahora: Date): Date {
  const bogota = new Date(ahora.getTime() - 5 * 3_600_000)
  return new Date(
    Date.UTC(bogota.getUTCFullYear(), bogota.getUTCMonth(), bogota.getUTCDate(), 5, 0, 0),
  )
}

export async function presupuestoVoz(
  ejecutor: Pool | PoolClient,
  ahora: Date = new Date(),
): Promise<EstadoPresupuesto> {
  const { rows: ajustes } = await ejecutor.query<{ valor: string }>(
    'select valor from configuracion where clave = $1',
    [CLAVE_PRESUPUESTO],
  )
  const presupuestoMin = Number(ajustes[0]?.valor ?? PRESUPUESTO_MINUTOS_POR_DEFECTO)

  // Only outbound calls cost us anything: an inbound one was rejected unanswered.
  const { rows } = await ejecutor.query<{ segundos: string }>(
    `select coalesce(sum(duracion_seg), 0) as segundos
       from llamadas
      where tipo = 'devolucion'
        and estado not in ('bloqueada', 'rechazada')
        and iniciada_en >= $1`,
    [inicioDelDia(ahora)],
  )

  const usadosMin = Number(rows[0]!.segundos) / 60
  const porcentaje = presupuestoMin === 0 ? 1 : usadosMin / presupuestoMin

  return {
    usadosMin: Number(usadosMin.toFixed(2)),
    presupuestoMin,
    porcentaje: Number(porcentaje.toFixed(3)),
    alerta: porcentaje >= UMBRAL_ALERTA,
    agotado: porcentaje >= 1,
  }
}

export type VeredictoTope =
  | { permitido: true; presupuesto: EstadoPresupuesto }
  | { permitido: false; motivo: string; presupuesto: EstadoPresupuesto }

/**
 * May we ring this number right now?
 *
 * The order is cheapest-first, and the global budget is checked last on purpose: when it is
 * exhausted the answer is the same for everybody, and the per-number reasons are the ones a
 * coordinator can actually act on.
 */
export async function revisarTopes(
  ejecutor: Pool | PoolClient,
  telefono: string,
  ahora: Date = new Date(),
): Promise<VeredictoTope> {
  const { rows } = await ejecutor.query<{ ultima_media_hora: string; hoy: string }>(
    `select
       count(*) filter (where iniciada_en >= $2::timestamptz - interval '30 minutes')
         as ultima_media_hora,
       count(*) filter (where iniciada_en >= $3) as hoy
       from llamadas
      where telefono = $1
        and tipo = 'devolucion'
        and estado not in ('bloqueada', 'rechazada')`,
    [telefono, ahora, inicioDelDia(ahora)],
  )

  const enMediaHora = Number(rows[0]!.ultima_media_hora)
  const hoy = Number(rows[0]!.hoy)
  const presupuesto = await presupuestoVoz(ejecutor, ahora)

  if (enMediaHora >= TOPE_POR_NUMERO_30MIN) {
    return {
      permitido: false,
      motivo: `${enMediaHora} devoluciones a este número en 30 minutos (tope ${TOPE_POR_NUMERO_30MIN})`,
      presupuesto,
    }
  }
  if (hoy >= TOPE_POR_NUMERO_DIA) {
    return {
      permitido: false,
      motivo: `${hoy} devoluciones a este número hoy (tope ${TOPE_POR_NUMERO_DIA})`,
      presupuesto,
    }
  }
  if (presupuesto.agotado) {
    return {
      permitido: false,
      motivo:
        `presupuesto de voz agotado: ${presupuesto.usadosMin} de ${presupuesto.presupuestoMin} ` +
        'minutos. Las devoluciones automáticas quedan apagadas hasta mañana.',
      presupuesto,
    }
  }

  return { permitido: true, presupuesto }
}
