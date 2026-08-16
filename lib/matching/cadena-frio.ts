import { Grafo } from './grafo'
import type { NodoGrafo, RequisitoAlmacenamiento, RutaGrafo, TemporadaActual } from './tipos'

/**
 * Cold-chain route/node eligibility for the matcher (PRD-33 §24).
 *
 * The constraint is modelled on routes and nodes, never on the item code (2.8: nothing switches
 * on a code). A cold-chain item may only move over legs that can preserve it, and only from a
 * node that can hold it — and never for longer than its open-transit window. These are the small
 * pure predicates the resolver composes; the resolver itself stays a single code path, run over
 * a restricted graph rather than forked.
 */

/** A pedido requires cold chain when its item declares it. Ordinary items answer false. */
export function exigeCadenaFrio(requisito: RequisitoAlmacenamiento | null | undefined): boolean {
  return requisito?.cadenaFrio === true
}

/** A leg may carry a cold-chain item only if it has been assessed as apt (fail-closed). */
export function rutaAptaCadenaFrio(ruta: RutaGrafo): boolean {
  return ruta.aptaCadenaFrio === true
}

/** A node may hold a cold-chain item only if it has cold storage (fail-closed). */
export function nodoGuardaCadenaFrio(nodo: NodoGrafo): boolean {
  return nodo.aptaCadenaFrio === true
}

/** The subset of the route graph a cold-chain item may travel: the cold-chain-apt legs. */
export function rutasParaCadenaFrio(rutas: readonly RutaGrafo[]): RutaGrafo[] {
  return rutas.filter(rutaAptaCadenaFrio)
}

/**
 * A graph over only the cold-chain-apt legs. Handing this to the resolver in place of the full
 * graph is what makes cold chain reuse the existing engine: reachability, waypoints and ordering
 * all run unchanged over fewer edges, so an open boat simply is not in the graph.
 */
export function grafoCadenaFrio(rutas: readonly RutaGrafo[], temporada: TemporadaActual): Grafo {
  return new Grafo(rutasParaCadenaFrio(rutas), temporada)
}

/**
 * Is a path of `minutos` within the item's open-transit window?
 *
 * A null window means no time bound. A null cost means unreachable, which fails. An untimed leg
 * inflates the cost (Grafo.costoCrudo counts it as a full unknown day), so a path nobody has
 * timed fails the window too — the safe direction for insulin: do not send it over a leg whose
 * duration is a guess.
 */
export function dentroDeVentanaTransito(
  minutos: number | null,
  requisito: RequisitoAlmacenamiento,
): boolean {
  if (requisito.maxMinutosTransito === null) return true
  if (minutos === null) return false
  return minutos <= requisito.maxMinutosTransito
}
