/**
 * The seam a speech-to-text provider plugs into.
 *
 * Deliberately unimplemented. Decision D8 is open: voice notes from the basin carry names,
 * locations and health details, and whether that audio may leave our infrastructure is a
 * protection question, not a procurement one. Self-hosted Whisper is the fallback if the
 * answer is no.
 *
 * So nothing here calls anything. The audio is downloaded, stripped, stored and queued; the
 * transcript stays null and the note waits in the audio inbox (M7) for a human to play it.
 * That is a working product — slower, but it never ships a household's medical details to a
 * vendor nobody agreed to.
 */

export type ResultadoTranscripcion = {
  texto: string
  /** 0..1, written to `adjuntos.transcripcion_confianza`. */
  confianza: number
}

export type AudioATranscribir = {
  /** Our own storage key, never a provider URL (2.6). */
  storageKey: string
  mime: string | null
  duracionSeg: number | null
}

export interface TranscripcionPort {
  /** Null means "not transcribed", which is a normal outcome and never an error. */
  transcribir(audio: AudioATranscribir): Promise<ResultadoTranscripcion | null>
}

/**
 * Returns null for everything.
 *
 * `reportes.detalle_libre` and `adjuntos.transcripcion` stay empty, the audio inbox shows
 * the note unplayed, and PRD §4 M4's rule holds trivially: the original is never
 * overwritten, because there is nothing to overwrite it with.
 */
export const transcripcionPendiente: TranscripcionPort = {
  async transcribir(): Promise<ResultadoTranscripcion | null> {
    return null
  },
}
