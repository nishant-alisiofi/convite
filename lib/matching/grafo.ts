import type { RutaGrafo, TemporadaActual } from './tipos'

/**
 * Reachability over the `rutas` table — never over a Google API call (Section 7.3).
 *
 * Edges are directed: goods flow from a node's community towards the community that asked,
 * and upstream is not the same trip as downstream. A route applies this season if it is
 * `todo_el_ano` or if its `temporada` is the one we are resolving for; a leg that simply
 * has no row for the current season is impassable, which is how Winandó goes quiet in
 * summer rather than acquiring an imaginary detour.
 *
 * Results are memoised per graph instance, so a sweep over hundreds of pedidos runs one
 * traversal per supply node rather than one per request (Section 8).
 */

/** Cost assumed for a leg nobody has timed. Only orders paths; never quoted to a human. */
const MINUTOS_DESCONOCIDOS = 24 * 60

export type Llegada = {
  /** Minutes along the cheapest known path. */
  minutos: number
  /** False when some leg on that path has no recorded duration — do not quote it. */
  cierto: boolean
}

export class Grafo {
  private readonly salientes = new Map<string, RutaGrafo[]>()
  private readonly memo = new Map<string, Map<string, Llegada>>()

  constructor(rutas: readonly RutaGrafo[], temporada: TemporadaActual) {
    for (const ruta of rutas) {
      if (!ruta.activa) continue
      if (ruta.temporada !== 'todo_el_ano' && ruta.temporada !== temporada) continue
      const lista = this.salientes.get(ruta.origenId)
      if (lista) lista.push(ruta)
      else this.salientes.set(ruta.origenId, [ruta])
    }
  }

  /** Every community reachable from `origen`, with the cheapest known travel time. */
  desde(origen: string): Map<string, Llegada> {
    const cacheado = this.memo.get(origen)
    if (cacheado) return cacheado

    const mejor = new Map<string, Llegada>([[origen, { minutos: 0, cierto: true }]])
    // Small graphs (tens of communities), so a linear scan beats a heap and keeps this
    // readable for whoever debugs a route that "should" be open.
    const pendientes = new Set<string>([origen])

    while (pendientes.size > 0) {
      let actual: string | null = null
      let costoActual = Number.POSITIVE_INFINITY
      for (const candidato of pendientes) {
        const llegada = mejor.get(candidato)!
        if (llegada.minutos < costoActual) {
          costoActual = llegada.minutos
          actual = candidato
        }
      }
      if (actual === null) break
      pendientes.delete(actual)

      const llegadaActual = mejor.get(actual)!
      for (const ruta of this.salientes.get(actual) ?? []) {
        const costo = llegadaActual.minutos + (ruta.minutos ?? MINUTOS_DESCONOCIDOS)
        const cierto = llegadaActual.cierto && ruta.minutos !== null
        const previo = mejor.get(ruta.destinoId)
        if (!previo || costo < previo.minutos) {
          mejor.set(ruta.destinoId, { minutos: costo, cierto })
          pendientes.add(ruta.destinoId)
        }
      }
    }

    this.memo.set(origen, mejor)
    return mejor
  }

  llega(origen: string, destino: string): boolean {
    return this.desde(origen).has(destino)
  }

  /** Travel time origen→destino, or null when unreachable or when some leg is untimed. */
  minutosEntre(origen: string, destino: string): number | null {
    const llegada = this.desde(origen).get(destino)
    if (!llegada || !llegada.cierto) return null
    return llegada.minutos
  }

  /** Path cost including legs nobody has timed. For ordering only — never shown. */
  costoCrudo(origen: string, destino: string): number | null {
    return this.desde(origen).get(destino)?.minutos ?? null
  }

  /**
   * Whether a trip from `origen` to `hasta` could serve `escala` on the way.
   *
   * This has to be an *on-the-path* test, not "reaches and is reached". The river graph is
   * strongly connected — every downstream leg has an upstream twin — so the loose version
   * claims a lancha bound for Tagachí can serve Bellavista, meaning ninety minutes past the
   * destination and back up again. Instead: the detour through `escala` must cost no more
   * than going straight there.
   *
   * Still only a proposal for a human to accept or refuse (2.1) — it says the stop is on
   * the way, not that the boat will make it.
   */
  sirveDePaso(origen: string, escala: string, hasta: string, toleranciaMin = 0): boolean {
    const ida = this.costoCrudo(origen, escala)
    const resto = this.costoCrudo(escala, hasta)
    const directo = this.costoCrudo(origen, hasta)
    if (ida === null || resto === null || directo === null) return false
    return ida + resto <= directo + toleranciaMin
  }
}
