import type { ExistenciaGrafo, NodoGrafo, OfertaGrafo, PedidoAResolver } from './tipos'

/**
 * Where the goods for a request would come from.
 *
 * Two kinds, and the distinction matters all the way to the manifest: counted stock at a
 * node ships directly, while an individual's offer adds a pickup leg first (Section 8,
 * step 2).
 */
export type Fuente =
  | { tipo: 'nodo'; nodo: NodoGrafo; existencia: ExistenciaGrafo }
  | { tipo: 'oferta'; nodo: NodoGrafo; oferta: OfertaGrafo }

export function nodoDe(fuente: Fuente): NodoGrafo {
  return fuente.nodo
}

/** Metres between two WGS84 points. Only ever used inside a town — see `radioRecogidaM`. */
export function distanciaM(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6_371_000
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const lat1 = a.lat * rad
  const lat2 = b.lat * rad
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Can this offer realistically be collected into this node?
 *
 * Prefers a measured distance when both ends have been located; falls back to "same
 * community" when the offer has no pin, which is the common case for something dictated
 * over the phone. Never guesses a coordinate to make the sum work (2.2).
 */
export function esRecogible(
  oferta: OfertaGrafo,
  nodo: NodoGrafo,
  radioM: number,
): boolean {
  if (oferta.lat !== null && oferta.lon !== null && nodo.lat !== null && nodo.lon !== null) {
    return (
      distanciaM(
        { lat: oferta.lat, lon: oferta.lon },
        { lat: nodo.lat, lon: nodo.lon },
      ) <= radioM
    )
  }
  return oferta.comunidadId !== null && oferta.comunidadId === nodo.comunidadId
}

/**
 * Offers that could supply this request, best first.
 *
 * Non-negotiable 2.15: perishables sort above everything, by deadline ascending,
 * irrespective of the request's urgency. Cooked meals for tomorrow do not wait behind
 * blankets. After that, an offer whose quantity actually covers the need beats one that
 * does not, and a stated quantity beats an unstated one — but an unstated quantity is
 * still supply, and still keeps us from telling anyone "nobody has this".
 */
export function ofertasParaPedido(
  pedido: PedidoAResolver,
  ofertas: readonly OfertaGrafo[],
  nodosQueLlegan: readonly NodoGrafo[],
  radioM: number,
  ahora: Date,
): { oferta: OfertaGrafo; nodo: NodoGrafo }[] {
  const candidatas: { oferta: OfertaGrafo; nodo: NodoGrafo }[] = []

  for (const oferta of ofertas) {
    if (oferta.estado !== 'DISPONIBLE') continue
    if (oferta.codigoItem !== pedido.codigoItem) continue
    if (oferta.venceEn && oferta.venceEn <= ahora) continue
    // Must cover the need, on the same terms as node stock. An unstated quantity still
    // qualifies: we cannot rule it out, and inventing a number to rule it out would be the
    // same sin as inventing one to rule it in (2.12). Splitting one offer across several
    // requests is allocation, and allocation is a human decision.
    if (oferta.cantidad !== null && oferta.cantidad < pedido.familias) continue

    const nodo = nodosQueLlegan.find((n) => esRecogible(oferta, n, radioM))
    if (nodo) candidatas.push({ oferta, nodo })
  }

  return candidatas.sort((a, b) => {
    if (a.oferta.perecedero !== b.oferta.perecedero) return a.oferta.perecedero ? -1 : 1
    if (a.oferta.perecedero && b.oferta.perecedero) {
      return (a.oferta.venceEn?.getTime() ?? 0) - (b.oferta.venceEn?.getTime() ?? 0)
    }
    const alcanzaA = (a.oferta.cantidad ?? 0) >= pedido.familias ? 1 : 0
    const alcanzaB = (b.oferta.cantidad ?? 0) >= pedido.familias ? 1 : 0
    if (alcanzaA !== alcanzaB) return alcanzaB - alcanzaA
    return (b.oferta.cantidad ?? -1) - (a.oferta.cantidad ?? -1)
  })
}
