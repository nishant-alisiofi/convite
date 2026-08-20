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

/**
 * §6.2 (v4 supplement): a hard cap on IVR audio recordings, enforced at capture time — not
 * the noise-suppression step that later runs on the resulting audio before Whisper (PRD-14).
 * Controls both processing latency and storage cost. Passed on every `grabar()` call rather
 * than left as an implicit provider default, so the cap is visible in the request itself and
 * a test can assert it was actually sent, not merely documented.
 */
export const TOPE_GRABACION_SEG = 60

export interface ProveedorVoz {
  /**
   * Which adapter this is — `PROVEEDOR_VOZ_SIMULADOR`, `PROVEEDOR_VOZ_INFOBIP` (voz/infobip.ts),
   * or whatever comes after. Written into `llamadas.proveedor` by flujo.ts and despachador.ts
   * instead of a hardcoded constant, so a call placed against the real aggregator is not
   * permanently mislabelled as a simulator run once the credential is configured.
   */
  nombre: string
  /** Hang up without answering, so the caller is never billed. */
  rechazar(idLlamada: string): Promise<void>
  /** Ring them back. This is the call we pay for. */
  llamar(a: string): Promise<LlamadaSaliente>
  /**
   * Starts recording the answered callback leg, capped at `TOPE_GRABACION_SEG` (§6.2). Takes
   * no caller-supplied duration — the cap is not something a call site may raise.
   */
  grabar(idLlamada: string): Promise<void>
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
export type GrabacionSimulada = { idLlamada: string; topeSeg: number }

export function proveedorVozSimulador(): ProveedorVoz & {
  rechazadas: string[]
  llamadas: LlamadaSimulada[]
  grabaciones: GrabacionSimulada[]
} {
  const rechazadas: string[] = []
  const llamadas: LlamadaSimulada[] = []
  const grabaciones: GrabacionSimulada[] = []
  let n = 0

  return {
    nombre: PROVEEDOR_VOZ_SIMULADOR,
    rechazadas,
    llamadas,
    grabaciones,
    async rechazar(idLlamada) {
      rechazadas.push(idLlamada)
    },
    async llamar(a) {
      n += 1
      const salida = { a, idExterno: `sim-voz-${a.slice(-4)}-${n}` }
      llamadas.push(salida)
      return salida
    },
    async grabar(idLlamada) {
      grabaciones.push({ idLlamada, topeSeg: TOPE_GRABACION_SEG })
    },
  }
}
