/**
 * FR-43 — pure classification of a perishable lot's expiry, kept out of the page so it is
 * testable without a database (mirrors the split `lib/compra-local/estados.ts` makes for the
 * purchase chain).
 *
 * Non-negotiable 2.3 / BUG-23: a lot's date is what a coordinator entered, or it is unknown.
 * `sinFecha` is a first-class state here — never collapsed into "not urgent" or padded with a
 * guessed date.
 */

export const DIAS_VENTANA_CADUCIDAD = 7

export type EstadoCaducidad = 'vencido' | 'proximo' | 'vigente' | 'sinFecha'

export type LoteExistencia = {
  id: string
  cantidad: number
  /** Null = unknown — never a fabricated date (2.3, BUG-23). */
  fechaCaducidad: Date | null
}

/** Whole days between two dates, ignoring time of day (a lot expires on a calendar date). */
function diasEntre(desde: Date, hasta: Date): number {
  const a = Date.UTC(desde.getFullYear(), desde.getMonth(), desde.getDate())
  const b = Date.UTC(hasta.getFullYear(), hasta.getMonth(), hasta.getDate())
  return Math.round((b - a) / 86_400_000)
}

/**
 * `vencido` if the date has passed, `proximo` within the window (inclusive), `vigente` beyond
 * it, `sinFecha` when nobody has recorded one — the honest state, never treated as either
 * urgent or safe.
 */
export function clasificarCaducidad(
  fechaCaducidad: Date | null,
  hoy: Date = new Date(),
  ventanaDias: number = DIAS_VENTANA_CADUCIDAD,
): EstadoCaducidad {
  if (fechaCaducidad === null) return 'sinFecha'
  const dias = diasEntre(hoy, fechaCaducidad)
  if (dias < 0) return 'vencido'
  if (dias <= ventanaDias) return 'proximo'
  return 'vigente'
}

/**
 * Soonest expiry first; lots with no date sort last (nothing to prioritise, not "safe" — see
 * `clasificarCaducidad`). Ties keep their original order.
 */
export function ordenarPorCaducidad<T extends { fechaCaducidad: Date | null }>(lotes: readonly T[]): T[] {
  return [...lotes].sort((a, b) => {
    if (a.fechaCaducidad === null && b.fechaCaducidad === null) return 0
    if (a.fechaCaducidad === null) return 1
    if (b.fechaCaducidad === null) return -1
    return a.fechaCaducidad.getTime() - b.fechaCaducidad.getTime()
  })
}
