import { ESTADOS_COMPRA_LOCAL, type EstadoCompraLocal } from '@/db/schema/compra-local'

/**
 * PRD-9 — the six-step traceability chain as a state machine (PRD v3 §24 / §30).
 *
 *   autorización → responsable → recibo → verificación → distribución → evidencia
 *
 * `AUTORIZADA` already carries the responsable (step 2 is a field, not a state); `COMPRADA` folds
 * in the receipt (step 3); `CERRADA` the closing documentary/photographic evidence (step 6). The
 * chain advances one step at a time and never skips — the database enforces the same shape with
 * its state checks, and this module is the pure mirror the panel and the tests reason over without
 * a Postgres instance in sight.
 */

/** The chain in order. `CANCELADA` is off to the side — reachable from any non-terminal step. */
export const CADENA_COMPRA_LOCAL = [
  'AUTORIZADA',
  'COMPRADA',
  'VERIFICADA',
  'DISTRIBUIDA',
  'CERRADA',
] as const satisfies readonly EstadoCompraLocal[]

/** The plain-Spanish step each state represents, for the panel's chain view. */
export const PASO_COMPRA_LOCAL: Record<EstadoCompraLocal, string> = {
  AUTORIZADA: 'Autorización',
  COMPRADA: 'Recibo de compra',
  VERIFICADA: 'Verificación de materiales',
  DISTRIBUIDA: 'Distribución',
  CERRADA: 'Evidencia y cierre',
  CANCELADA: 'Cancelada',
}

/**
 * What advancing INTO a state requires, so a screen can name the evidence before it is asked for.
 * Mirrors the state checks in migration 0049 — kept here as guidance, never as the guard.
 */
export const REQUISITO_COMPRA_LOCAL: Record<EstadoCompraLocal, string | null> = {
  AUTORIZADA: null,
  COMPRADA: 'Se necesita el recibo de la compra y quién la hizo.',
  VERIFICADA: 'Se necesita quién verificó que los materiales llegaron.',
  DISTRIBUIDA: 'Se necesita quién distribuyó lo comprado.',
  CERRADA: 'Se necesita la evidencia fotográfica o documental para cerrar.',
  CANCELADA: null,
}

export function esTerminal(estado: EstadoCompraLocal): boolean {
  return estado === 'CERRADA' || estado === 'CANCELADA'
}

/** The next step in the chain, or null at the end (or once cancelled). */
export function siguienteEstado(estado: EstadoCompraLocal): EstadoCompraLocal | null {
  if (estado === 'CANCELADA') return null
  const i = CADENA_COMPRA_LOCAL.indexOf(estado as (typeof CADENA_COMPRA_LOCAL)[number])
  if (i < 0 || i >= CADENA_COMPRA_LOCAL.length - 1) return null
  return CADENA_COMPRA_LOCAL[i + 1]!
}

/**
 * Whether a transition is allowed: forward exactly one step along the chain, or a cancellation of
 * anything not already terminal. Everything else — skipping a step, moving backwards, reviving a
 * closed purchase — is refused. This is the traceability guarantee: a purchase cannot appear
 * distributed without having been bought and verified first.
 */
export function transicionValida(desde: EstadoCompraLocal, hacia: EstadoCompraLocal): boolean {
  if (desde === hacia) return false
  if (esTerminal(desde)) return false
  if (hacia === 'CANCELADA') return true
  return siguienteEstado(desde) === hacia
}

/** The ordered chain a given purchase has completed, for a progress display. */
export function pasosCompletados(estado: EstadoCompraLocal): EstadoCompraLocal[] {
  if (estado === 'CANCELADA') return ['AUTORIZADA']
  const i = CADENA_COMPRA_LOCAL.indexOf(estado as (typeof CADENA_COMPRA_LOCAL)[number])
  return i < 0 ? [] : CADENA_COMPRA_LOCAL.slice(0, i + 1)
}

export { ESTADOS_COMPRA_LOCAL }
export type { EstadoCompraLocal }
