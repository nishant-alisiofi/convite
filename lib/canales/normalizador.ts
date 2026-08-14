import type { TipoReporte } from '@/db/schema/vocabulario'

/**
 * The seam M4 plugs into.
 *
 * Everything downstream of intake assumes a normalizer exists, and it does not yet — M4 is
 * gated on a corpus of real messages that has not been collected (PRD §7). Rather than let
 * that block M5, intake talks to this interface and ships with an implementation that never
 * claims to understand anything.
 *
 * 2.12 is the rule the whole seam exists to honour: **returning null must be cheaper than
 * guessing.** A wrong `codigo_item` sends a boat up a river with the wrong cargo; a null
 * sends a coordinator one question. The threshold is therefore a floor on confidence, not a
 * tie-breaker between candidates.
 */

export const UMBRAL_CONFIANZA = 0.7

export type PropuestaNormalizador = {
  /** `necesidad` or `dano`. Null when the text does not say, which is common and fine. */
  tipo: TipoReporte | null
  /** From the catalogue. Proposed, never fixed — a human or the threshold decides. */
  codigoItem: string | null
  cantidad: number | null
  unidad: string | null
  /** 0..1. Below UMBRAL_CONFIANZA nothing is assigned and the record goes to clarification. */
  confianza: number
}

export type EntradaNormalizador = {
  /** Free text, or a transcript. Null when the message was audio we have not transcribed. */
  texto: string | null
}

export interface NormalizadorPort {
  proponer(entrada: EntradaNormalizador): Promise<PropuestaNormalizador>
}

export const PROPUESTA_VACIA: PropuestaNormalizador = {
  tipo: null,
  codigoItem: null,
  cantidad: null,
  unidad: null,
  confianza: 0,
}

/**
 * The placeholder. Always below threshold, on purpose.
 *
 * This is not a stub that will be forgotten: while it is installed every intake takes the
 * clarification path, which means that path is the one exercised in production from day
 * one instead of being the rarely-trodden branch that breaks when it finally runs. When M4
 * lands it replaces this object and nothing else changes.
 */
export const normalizadorPendiente: NormalizadorPort = {
  async proponer(): Promise<PropuestaNormalizador> {
    return PROPUESTA_VACIA
  },
}

/** Whether a proposal is confident enough to be written onto the reporte. */
export function esConfiable(propuesta: PropuestaNormalizador): boolean {
  return propuesta.confianza >= UMBRAL_CONFIANZA && propuesta.codigoItem !== null
}
