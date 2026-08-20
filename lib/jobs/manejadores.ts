import { emparejar } from '@/lib/matching/persistencia'
import { vencerOfertas } from '@/lib/matching/vencimientos'
import { temporadaVigente } from '@/lib/temporada'
import { enviarAlertasPendientes } from '@/lib/verificacion/sensibles'
import type { ManejadorJob } from './tipos'

/**
 * The season is read per run from `configuracion` (see lib/temporada.ts), not captured at
 * import time: an admin who flips it mid-response expects the next sweep to use the new
 * answer, not the one this process booted with.
 */
export const MANEJADORES: Record<string, ManejadorJob> = {
  /** Full sweep. Cheap enough at basin scale, and immune to a missed trigger. */
  emparejar_todo: async (_job, client) => {
    // Expire first: a sweep that plans a run around food that spoiled overnight is worse
    // than one that finds nothing (2.15).
    await vencerOfertas(client)
    await emparejar(client, { temporada: await temporadaVigente(client) })
  },

  /** Hourly. Perishables leave the queue on their own and the offerer gets told. */
  vencer_ofertas: async (_job, client) => {
    await vencerOfertas(client)
  },

  /** One request, for when a single verification should feel immediate. */
  emparejar_pedido: async (job, client) => {
    const pedidoId = job.payload.pedidoId
    if (typeof pedidoId !== 'string') throw new Error('emparejar_pedido requiere pedidoId.')
    await emparejar(client, { temporada: await temporadaVigente(client), pedidoId })
  },

  /**
   * PRD-49 §6.3: drains `alertas_proteccion` — every row `convite_marcar_reporte_sensible` (or
   * intake's own term match) wrote synchronously when a report was flagged. The flag and the
   * signal are immediate; this is only the network send, exactly as every other outbound message
   * in this codebase is queued and drained by a job rather than sent inline. A tick with zero
   * `contactos_proteccion` configured — the normal state today — sends nothing and errors on
   * nothing.
   */
  enviar_alertas_proteccion: async (_job, client) => {
    await enviarAlertasPendientes(client)
  },
}
