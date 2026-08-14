import { emparejar } from '@/lib/matching/persistencia'
import { vencerOfertas } from '@/lib/matching/vencimientos'
import type { TemporadaActual } from '@/lib/matching/tipos'
import type { ManejadorJob } from './tipos'

/**
 * Which season we resolve for.
 *
 * Chocó is one of the wettest places on earth, so `lluvias` is the normal state and the
 * safe default. This is a placeholder for a real answer: it should become a setting a
 * coordinator flips when the river drops, because getting it wrong silently changes which
 * communities the engine believes are reachable.
 */
export function temporadaActual(): TemporadaActual {
  return process.env.CONVITE_TEMPORADA === 'seca' ? 'seca' : 'lluvias'
}

export const MANEJADORES: Record<string, ManejadorJob> = {
  /** Full sweep. Cheap enough at basin scale, and immune to a missed trigger. */
  emparejar_todo: async (_job, client) => {
    // Expire first: a sweep that plans a run around food that spoiled overnight is worse
    // than one that finds nothing (2.15).
    await vencerOfertas(client)
    await emparejar(client, { temporada: temporadaActual() })
  },

  /** Hourly. Perishables leave the queue on their own and the offerer gets told. */
  vencer_ofertas: async (_job, client) => {
    await vencerOfertas(client)
  },

  /** One request, for when a single verification should feel immediate. */
  emparejar_pedido: async (job, client) => {
    const pedidoId = job.payload.pedidoId
    if (typeof pedidoId !== 'string') throw new Error('emparejar_pedido requiere pedidoId.')
    await emparejar(client, { temporada: temporadaActual(), pedidoId })
  },
}
