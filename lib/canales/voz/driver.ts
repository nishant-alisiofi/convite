import { z } from 'zod'

/**
 * Voice, provider-agnostic.
 *
 * The shape is the same bet as SMS: one thin interface an aggregator adapter implements once
 * D2 is answered, and a simulator that lets the whole flow be built and tested tonight.
 *
 * `rechazar` is not a nicety. Section 4.3's promise is that reporting costs the caller
 * nothing: they ring, we hang up WITHOUT answering — an unanswered call is billed to nobody
 * — and then we ring back on our own account. A provider adapter that answers first to
 * "be polite" charges a person with no balance for asking for help.
 */

export const PROVEEDOR_VOZ_SIMULADOR = 'voz_simulador'

export const esquemaLlamadaEntrante = z.object({
  /** The provider's call id. Idempotency key, exactly like a `wamid`. */
  id: z.string().min(1),
  de: z.string().min(1),
  recibidaEn: z.string().datetime({ offset: true }).nullish(),
})

export type LlamadaEntrante = z.input<typeof esquemaLlamadaEntrante>

export type LlamadaSaliente = {
  idExterno: string
}

export interface ProveedorVoz {
  /** Hang up without answering, so the caller is never billed. */
  rechazar(idLlamada: string): Promise<void>
  /** Ring them back. This is the call we pay for. */
  llamar(a: string): Promise<LlamadaSaliente>
}

export function aE164(numero: string): string {
  const limpio = numero.replace(/[^\d+]/g, '')
  if (limpio.startsWith('+')) return limpio
  return limpio.length === 10 ? `+57${limpio}` : `+${limpio}`
}

export type LlamadaSimulada = { a: string; idExterno: string }

/**
 * The provider that dials nobody and bills nothing.
 *
 * It records rejections separately from callbacks because the test that matters is «did we
 * hang up before answering», and a simulator that collapsed the two would let a provider
 * adapter that answers first pass.
 */
export function proveedorVozSimulador(): ProveedorVoz & {
  rechazadas: string[]
  llamadas: LlamadaSimulada[]
} {
  const rechazadas: string[] = []
  const llamadas: LlamadaSimulada[] = []
  let n = 0

  return {
    rechazadas,
    llamadas,
    async rechazar(idLlamada) {
      rechazadas.push(idLlamada)
    },
    async llamar(a) {
      n += 1
      const salida = { a, idExterno: `sim-voz-${a.slice(-4)}-${n}` }
      llamadas.push(salida)
      return salida
    },
  }
}
