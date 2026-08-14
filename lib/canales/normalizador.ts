import {
  type Catalogo,
  extraer,
  PROPUESTA_NULA,
  type PropuestaExtractor,
  UMBRAL,
} from '@/lib/normalizador'

/**
 * The seam between intake and the normalizer (M4).
 *
 * Intake never calls the extractor directly: it holds this port, so the thing that turns
 * «manden mercados» into `codigo_item = 11` can be swapped — for a better lexicon, for a
 * model behind a flag, for a stub in a test — without the intake path changing shape.
 *
 * 2.12 is the rule the seam exists to honour: **returning null must be cheaper than
 * guessing.** The threshold is a floor on confidence, not a tie-breaker between candidates.
 */

/** Re-exported so callers do not have to know the extractor's module layout. */
export type PropuestaNormalizador = PropuestaExtractor

export const UMBRAL_CONFIANZA = UMBRAL

export type EntradaNormalizador = {
  /** Free text, or a transcript. Null when the message was audio we have not transcribed. */
  texto: string | null
  /** Injected, never read from the wall clock — same discipline as the matcher. */
  ahora?: Date
}

export interface NormalizadorPort {
  proponer(entrada: EntradaNormalizador): Promise<PropuestaNormalizador>
}

export const PROPUESTA_VACIA: PropuestaNormalizador = {
  ...PROPUESTA_NULA,
  motivos: [],
  versionLexico: 'ninguna',
}

/**
 * The real one: lexicon + rules over a catalogue snapshot.
 *
 * The catalogue is passed in rather than read here, because it is data a coordinator edits
 * (2.8) and because it keeps the extractor pure and therefore testable without Postgres.
 */
export function normalizadorLexico(catalogo: Catalogo): NormalizadorPort {
  return {
    async proponer(entrada) {
      return extraer(entrada.texto, { catalogo, ahora: entrada.ahora ?? new Date() })
    },
  }
}

/**
 * The one that declines to answer.
 *
 * Kept after M4 shipped, because it is how a test pins the clarification path without
 * depending on what the lexicon happens to know today: a fixture whose wording the lexicon
 * later learns would otherwise silently stop exercising that branch.
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
