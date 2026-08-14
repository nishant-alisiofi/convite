import { emparejar } from '@/lib/matching/persistencia'
import { vencerOfertas } from '@/lib/matching/vencimientos'
import { temporadaVigente } from '@/lib/temporada'
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
}
