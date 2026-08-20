import type { Pool, PoolClient } from 'pg'
import type { ManejadorJob } from '@/lib/jobs/tipos'
import { encolar } from '@/lib/jobs/cola'
import { COPIA } from '../salidas'
import type { ProveedorSms } from '../sms/driver'
import { proveedorSmsActivo } from '../sms/infobip'

/**
 * The Adaptive Retry Protocol (PRD-15, Supplement v4 §6.1).
 *
 * Weak 2G produces two related failure modes for a callback: the outbound leg drops before
 * any webhook confirms it, or the callback only reaches the front of the queue hours after
 * the person has moved out of coverage. Neither is something a confirmed Infobip event
 * shape can be built against today (the same gap voz/infobip.ts's header documents for DTMF
 * and recording-ready events) — so the trigger this module uses is not a guessed webhook
 * field, it is a *timeout*: `revisarLlamadaMarcando` runs a fixed window after a callback is
 * placed and asks the one question that needs no provider-specific parsing at all — "did
 * anything ever move this call out of `marcando`?" If not, that IS the failure signal, drop
 * or otherwise.
 *
 * The rest follows directly from §6.1's text: wait 5 minutes, then retry once via SMS — not
 * a second immediate voice call — and never past a 2-hour TTL measured from the *original*
 * missed call, not from the callback attempt itself.
 */

/**
 * How long a callback may sit in `marcando` with no state change before it counts as a drop.
 * Long enough that a real, briefly-answered call would have produced *some* update if that
 * driving were built (it is not yet — see voz/trabajos.ts); short enough that the 5-minute
 * SMS wait still lands within a few minutes of the person actually giving up on the phone.
 */
export const ESPERA_CONFIRMAR_CALLBACK_SEG = 180

/** §6.1, verbatim: wait 5 minutes before the SMS retry, never a second immediate voice call. */
export const ESPERA_REINTENTO_SMS_MIN = 5

/** §6.1, verbatim: past 2 hours from the original missed call, do not ring — abandon instead. */
export const TTL_CALLBACK_HORAS = 2

/** Whether `ahora` still falls inside the TTL window measured from the original missed call. */
export function dentroDeTtl(origenIniciadaEn: Date, ahora: Date): boolean {
  const limiteMs = TTL_CALLBACK_HORAS * 3_600_000
  return ahora.getTime() - origenIniciadaEn.getTime() <= limiteMs
}

type FilaLlamada = {
  id: string
  tipo: string
  estado: string
  telefono: string
  llamada_origen_id: string | null
  sms_reintento_en: string | null
  iniciada_en: string
}

/**
 * The TTL clock reads the *original* missed call's `iniciada_en` (§6.1). A `devolucion` row
 * placed straight from `recibirLlamadaPerdida` (trabajos.ts) always carries that link; one
 * built by hand — the all-in-one test harness `devolverLlamada` uses, or any future caller
 * that does not yet know its origin — falls back to its own start time rather than crashing,
 * because "no TTL reference" must never mean "no TTL", only a more conservative one.
 */
async function origenIniciadaEn(ejecutor: Pool | PoolClient, fila: FilaLlamada): Promise<Date> {
  if (fila.llamada_origen_id) {
    const { rows } = await ejecutor.query<{ iniciada_en: string }>(
      'select iniciada_en from llamadas where id = $1',
      [fila.llamada_origen_id],
    )
    if (rows[0]) return new Date(rows[0].iniciada_en)
  }
  return new Date(fila.iniciada_en)
}

export type ResultadoRevision =
  | { accion: 'sin_cambios' }
  | { accion: 'reintento_programado'; llamadaId: string }
  | { accion: 'abandonada'; llamadaId: string; motivo: string }

/**
 * Runs `ESPERA_CONFIRMAR_CALLBACK_SEG` after a callback is placed (scheduled by
 * `llamarDeVuelta`, lib/canales/despachador.ts). If the row already moved past `marcando` —
 * blocked, connected, whatever — something else resolved it and there is nothing to do here.
 * Only a callback still sitting in `marcando` at this point is treated as failed.
 */
export async function revisarLlamadaMarcando(
  client: PoolClient,
  llamadaId: string,
  ahora: Date = new Date(),
): Promise<ResultadoRevision> {
  const { rows } = await client.query<FilaLlamada>(
    `select id, tipo, estado, telefono, llamada_origen_id, sms_reintento_en, iniciada_en
       from llamadas where id = $1`,
    [llamadaId],
  )
  const fila = rows[0]
  if (!fila || fila.tipo !== 'devolucion' || fila.estado !== 'marcando') {
    return { accion: 'sin_cambios' }
  }

  const { rowCount } = await client.query(
    `update llamadas set estado = 'fallida', finalizada_en = $2
       where id = $1 and estado = 'marcando'`,
    [llamadaId, ahora],
  )
  // Lost the race to something else that resolved the call between the select and here.
  if (!rowCount) return { accion: 'sin_cambios' }

  const origen = await origenIniciadaEn(client, fila)
  if (!dentroDeTtl(origen, ahora)) {
    return {
      accion: 'abandonada',
      llamadaId,
      motivo: `TTL de ${TTL_CALLBACK_HORAS}h vencido desde la llamada perdida original`,
    }
  }

  await encolar(
    client,
    'reintentar_sms_voz',
    { llamadaId },
    new Date(ahora.getTime() + ESPERA_REINTENTO_SMS_MIN * 60_000),
  )
  return { accion: 'reintento_programado', llamadaId }
}

export type ResultadoReintentoSms =
  | { estado: 'enviado'; llamadaId: string; idExterno: string }
  | { estado: 'ya_enviado'; llamadaId: string }
  | { estado: 'abandonado'; llamadaId: string; motivo: string }

/**
 * Runs 5 minutes after `revisarLlamadaMarcando` gives up on a callback. Sends the one allowed
 * SMS retry, or abandons it — never a second immediate voice call (§6.1). The TTL is checked
 * again here, not trusted to whoever scheduled the job: a queue running late under load must
 * still refuse to reach someone who has been out of coverage for two hours.
 */
export async function enviarReintentoSms(
  client: PoolClient,
  llamadaId: string,
  deps: { proveedorSms: ProveedorSms },
  ahora: Date = new Date(),
): Promise<ResultadoReintentoSms> {
  const { rows } = await client.query<FilaLlamada>(
    `select id, tipo, estado, telefono, llamada_origen_id, sms_reintento_en, iniciada_en
       from llamadas where id = $1`,
    [llamadaId],
  )
  const fila = rows[0]
  if (!fila || fila.estado !== 'fallida') return { estado: 'abandonado', llamadaId, motivo: 'la llamada ya no está en fallida' }
  if (fila.sms_reintento_en) return { estado: 'ya_enviado', llamadaId }

  const origen = await origenIniciadaEn(client, fila)
  if (!dentroDeTtl(origen, ahora)) {
    return {
      estado: 'abandonado',
      llamadaId,
      motivo: `TTL de ${TTL_CALLBACK_HORAS}h vencido desde la llamada perdida original`,
    }
  }

  const enviado = await deps.proveedorSms.enviar(fila.telefono, COPIA.reintentoLlamada)

  await client.query('update llamadas set sms_reintento_en = $2 where id = $1', [llamadaId, ahora])

  return { estado: 'enviado', llamadaId, idExterno: enviado.idExterno }
}

/** Built lazily, same posture as voz/infobip.ts's provider selection. */
function depsReintentoPorDefecto(): { proveedorSms: ProveedorSms } {
  return { proveedorSms: proveedorSmsActivo() }
}

export const MANEJADORES_REINTENTO_VOZ: Record<string, ManejadorJob> = {
  revisar_llamada_marcando: async (job, client) => {
    const { llamadaId } = job.payload as { llamadaId?: string }
    if (!llamadaId) throw new Error('revisar_llamada_marcando requiere llamadaId.')
    await revisarLlamadaMarcando(client, llamadaId)
  },
  reintentar_sms_voz: async (job, client) => {
    const { llamadaId } = job.payload as { llamadaId?: string }
    if (!llamadaId) throw new Error('reintentar_sms_voz requiere llamadaId.')
    await enviarReintentoSms(client, llamadaId, depsReintentoPorDefecto())
  },
}
