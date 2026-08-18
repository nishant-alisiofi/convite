import type { ManejadorJob } from '@/lib/jobs/tipos'
import { llamarDeVuelta } from '../despachador'
import { resolverOrganizacion } from '../intake'
import type { ProveedorVoz } from './driver'
import { recibirLlamadaPerdida } from './flujo'
import { proveedorVozActivo } from './infobip'
import { esLlamadaEntrante, interpretarWebhookVoz } from './payload'

/**
 * The voice webhook, processed off the request — the same contract
 * `manejadorWebhookWhatsApp` (../trabajos.ts) already holds: the route verifies, answers 200
 * and parks the payload; this is where the work happens, so a retried delivery finds
 * idempotency rather than a duplicate callback.
 *
 * Today this drives exactly the missed-call half of §4.1: an inbound ring is rejected before
 * answer supervision (so it costs the caller nothing — `recibirLlamadaPerdida`) and a
 * callback is placed on our own account, gated by the same spend caps every call goes
 * through (`llamarDeVuelta`, lib/canales/despachador.ts, checked against lib/canales/topes.ts
 * before anything is dialled).
 *
 * What this does NOT yet do: drive the live IVR once that callback is answered — play the
 * menu, capture the keypress, start the recording. §4.1.6 is explicit that "recordings/
 * dialogs/media streaming must be activated by an account manager", and the event shapes for
 * a DTMF capture or a finished recording are not published in enough detail to implement
 * against here without guessing at field names Infobip has not confirmed. Those event types
 * are logged and skipped rather than acted on — once the account has that turned on, driving
 * them is the natural next step, correlating by `proveedor_llamada_id` against the
 * `llamadas` row `llamarDeVuelta` already writes for the callback (`estado = 'marcando'`).
 */
export function manejadorWebhookVoz(deps: { proveedor: ProveedorVoz }): ManejadorJob {
  return async (job, client) => {
    const eventos = interpretarWebhookVoz(job.payload.webhook)

    for (const evento of eventos) {
      if (!esLlamadaEntrante(evento)) {
        if (evento.type) {
          console.info(`[voz] evento ${evento.type} recibido; sin manejo todavía (§4.1.6).`)
        }
        continue
      }
      if (!evento.callId || !evento.from) {
        console.warn('[voz] CALL_RECEIVED sin callId o from; se ignora.')
        continue
      }

      // A single active organisation today (see resolverOrganizacion's fallback in
      // ../intake.ts) — the same posture WhatsApp had before `waba_phone_number_id` existed.
      // Once more than one org has its own Infobip voice number, that resolution needs a
      // column analogous to `waba_phone_number_id` and the number the event arrived on.
      const organizacionId = await resolverOrganizacion(client, null)

      const perdida = await recibirLlamadaPerdida(
        client,
        { id: evento.callId, de: evento.from },
        organizacionId,
        deps,
      )
      // 2.7: a retried CALL_RECEIVED must not dial a second callback for the same ring.
      if (perdida.duplicada) continue

      await llamarDeVuelta(client, { telefono: perdida.telefono, organizacionId }, deps)
    }
  }
}

/** Built lazily so a deployment with no Infobip credentials still runs the simulator. */
function depsVozPorDefecto(): { proveedor: ProveedorVoz } {
  return { proveedor: proveedorVozActivo() }
}

export const MANEJADORES_VOZ: Record<string, ManejadorJob> = {
  procesar_webhook_voz: (job, client) => manejadorWebhookVoz(depsVozPorDefecto())(job, client),
}
