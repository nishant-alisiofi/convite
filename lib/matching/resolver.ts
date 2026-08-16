import {
  dentroDeVentanaTransito,
  exigeCadenaFrio,
  grafoCadenaFrio,
  nodoGuardaCadenaFrio,
} from './cadena-frio'
import { type Fuente, ofertasParaPedido } from './fuentes'
import { Grafo } from './grafo'
import {
  type ContextoFrase,
  motivoListo,
  motivoNoEsCarga,
  motivoSinCapacidad,
  motivoSinExistencia,
  motivoSinRuta,
  motivoSinRutaCadenaFrio,
  motivoSinRutaConExistencia,
} from './motivos'
import type {
  CapacidadGrafo,
  ContextoEmparejamiento,
  ExistenciaGrafo,
  NodoGrafo,
  PedidoAResolver,
  Resolucion,
} from './tipos'

/**
 * The matching engine (Section 8).
 *
 * A pure function: hand it a request and a snapshot of the basin, get back which of the
 * three sides is missing. It never mutates stock, never commits capacity, never deactivates
 * a route. Its whole output is a classification, a sentence, and — when everything aligns —
 * a *proposal* for a human to confirm (non-negotiable 2.1).
 *
 * Resolution short-circuits in the order the spec sets out, because the order is the point:
 * telling someone "no hay ruta" when in fact there is a route and no donation sends them to
 * argue with the wrong person.
 */
export function resolver(
  pedido: PedidoAResolver,
  contexto: ContextoEmparejamiento,
  grafoPrecalculado?: Grafo,
): Resolucion {
  // PRD-33 §24: a cold-chain item resolves against a graph restricted to the legs that can
  // preserve it, so an open boat is simply not in the graph. Everything below is the same
  // resolver — reachability, waypoints, ordering — run over fewer edges, not a forked path.
  // Ordinary items keep the memoised full graph, so nothing that matched before changes.
  const requisito = pedido.requisitoAlmacenamiento ?? null
  const conCadenaFrio = exigeCadenaFrio(requisito)
  const grafo = conCadenaFrio
    ? grafoCadenaFrio(contexto.rutas, contexto.temporada)
    : (grafoPrecalculado ?? new Grafo(contexto.rutas, contexto.temporada))
  const comunidad = contexto.nombresComunidad.get(pedido.comunidadId) ?? 'la comunidad'
  const frase: ContextoFrase = {
    pedido,
    comunidad,
    ahora: contexto.ahora,
    diasParaConteoViejo: contexto.diasParaConteoViejo,
  }

  // 0. Some needs are not cargo. Psychosocial support is met by a person travelling, and
  // running it through a stock check would park it in SIN_EXISTENCIA forever.
  if (!pedido.entregable) {
    return { estado: 'ABIERTO', motivo: motivoNoEsCarga(pedido, comunidad) }
  }

  // 1. Which supply nodes can reach the community by active routes this season?
  const nodosActivos = contexto.nodos.filter((n) => n.activo)
  let nodosQueLlegan = nodosActivos.filter((n) => grafo.llega(n.comunidadId, pedido.comunidadId))

  // PRD-33 §24: for a cold-chain item the source must also be able to *hold* it, and the path
  // must keep it within its open-transit window. Anything else would be proposing to spoil
  // insulin, so it is excluded here rather than surfaced as a plan.
  if (conCadenaFrio && requisito) {
    nodosQueLlegan = nodosQueLlegan.filter(
      (n) =>
        nodoGuardaCadenaFrio(n) &&
        dentroDeVentanaTransito(grafo.costoCrudo(n.comunidadId, pedido.comunidadId), requisito),
    )
  }

  if (nodosQueLlegan.length === 0) {
    // A distinct stuck-state: the community may be perfectly reachable, just not by a route that
    // keeps the medicine cold. Never propose an invalid route (AC2) — say why, and mark it so the
    // board can tell it apart from an ordinary «community cut off».
    if (conCadenaFrio) {
      return {
        estado: 'SIN_RUTA',
        cadenaFrioBloqueada: true,
        motivo: motivoSinRutaCadenaFrio(comunidad),
      }
    }
    return { estado: 'SIN_RUTA', motivo: motivoSinRuta(comunidad, contexto.temporada) }
  }

  // 2. Is there enough of this item within reach — in a warehouse OR in somebody's house?
  //
  // Checking `ofertas` here is not an optimisation. Node inventory goes uncounted for days
  // in the first week of a response, and a matcher that reads only `existencias` will
  // report "nobody has this" on a page that simultaneously lists eight people offering
  // exactly that. Section 8 forbids reaching SIN_EXISTENCIA without having looked.
  const conStock = existenciasDe(pedido, nodosQueLlegan, contexto.existencias)
  const suficientes = conStock.filter((x) => x.existencia.cantidad >= pedido.familias)

  // Prefer the node that is quickest to the community. `nodo_sugerido` has to survive a
  // coordinator asking "why that warehouse?".
  suficientes.sort(
    (a, b) => minutosA(grafo, a.nodo, pedido) - minutosA(grafo, b.nodo, pedido),
  )

  const desdeNodo: Fuente[] = suficientes.map((x) => ({
    tipo: 'nodo',
    nodo: x.nodo,
    existencia: x.existencia,
  }))

  const desdeOfertas: Fuente[] = ofertasParaPedido(
    pedido,
    contexto.ofertas,
    nodosQueLlegan,
    contexto.radioRecogidaM,
    contexto.ahora,
  ).map((x) => ({ tipo: 'oferta', nodo: x.nodo, oferta: x.oferta }))

  // Non-negotiable 2.15: a perishable outranks everything, irrespective of the request's
  // urgency, because the alternative is throwing away cooked food while blankets ship.
  const perecederas = desdeOfertas.filter((f) => f.tipo === 'oferta' && f.oferta.perecedero)
  const restoOfertas = desdeOfertas.filter((f) => !(f.tipo === 'oferta' && f.oferta.perecedero))
  const fuentes: Fuente[] = [...perecederas, ...desdeNodo, ...restoOfertas]

  if (fuentes.length === 0) {
    // Genuinely nothing in reach. Is it missing, or is it stranded on the far side?
    const alAlcance = mayorExistencia(conStock)
    const nodosLejanos = nodosActivos.filter((n) => !nodosQueLlegan.includes(n))
    const varado = mayorExistencia(existenciasDe(pedido, nodosLejanos, contexto.existencias))

    if (varado && varado.existencia.cantidad >= pedido.familias) {
      const fuenteVarada: Fuente = {
        tipo: 'nodo',
        nodo: varado.nodo,
        existencia: varado.existencia,
      }
      return {
        estado: 'SIN_RUTA',
        motivo: motivoSinRutaConExistencia(fuenteVarada, frase),
        nodoId: varado.nodo.id,
      }
    }

    return {
      estado: 'SIN_EXISTENCIA',
      motivo: motivoSinExistencia(
        frase,
        alAlcance
          ? {
              nombreNodo: alAlcance.nodo.nombre,
              cantidad: alAlcance.existencia.cantidad,
              contadoEn: alAlcance.existencia.contadoEn,
            }
          : null,
      ),
      // Still worth naming the closest stocked node: it is where the donation should land.
      nodoId: alAlcance?.nodo.id,
    }
  }

  // 3. Is anybody actually travelling? Almost always the thin side.
  const limite = new Date(contexto.ahora.getTime() + contexto.horizonteDias * 86_400_000)
  const nodoPorId = new Map(contexto.nodos.map((n) => [n.id, n]))

  for (const fuente of fuentes) {
    const candidatas = contexto.capacidades
      .filter((c) => c.estado === 'OFRECIDA')
      .filter((c) => c.saleEn >= contexto.ahora && c.saleEn <= limite)
      .filter((c) => c.cupoFamilias >= pedido.familias)
      // The boat has to leave from the node holding the goods, or the proposal is "load it
      // in Quibdó, using a lancha that departs from Tagachí".
      .filter((c) => c.origenNodoId === fuente.nodo.id)
      // A boat that leaves after the food spoils is not a plan (2.15). Without this the
      // engine cheerfully proposes shipping Saturday's cooked lunches on Sunday's lancha.
      .filter((c) => llegaAntesDeVencer(c, fuente))
      .filter((c) => sirve(c, pedido.comunidadId, nodoPorId, grafo))
      .sort((a, b) => a.saleEn.getTime() - b.saleEn.getTime())

    const capacidad = candidatas[0]
    if (!capacidad) continue

    return {
      estado: 'LISTO',
      motivo: motivoListo(
        fuente,
        frase,
        capacidad.contactoNombre,
        capacidad.saleEn,
        capacidad.hastaComunidadId !== pedido.comunidadId,
      ),
      nodoId: fuente.nodo.id,
      ofertaId: fuente.tipo === 'oferta' ? fuente.oferta.id : undefined,
      capacidadId: capacidad.id,
    }
  }

  // 4. Supply is there and reachable; nobody is going.
  const mejor = fuentes[0]!
  return {
    estado: 'SIN_CAPACIDAD',
    motivo: motivoSinCapacidad(mejor, frase, contexto.horizonteDias),
    nodoId: mejor.nodo.id,
    ofertaId: mejor.tipo === 'oferta' ? mejor.oferta.id : undefined,
  }
}

/** Perishable goods have to still be good when the transport leaves (2.15). */
function llegaAntesDeVencer(capacidad: CapacidadGrafo, fuente: Fuente): boolean {
  if (fuente.tipo !== 'oferta' || !fuente.oferta.venceEn) return true
  return capacidad.saleEn < fuente.oferta.venceEn
}

function minutosA(grafo: Grafo, nodo: NodoGrafo, pedido: PedidoAResolver): number {
  return grafo.costoCrudo(nodo.comunidadId, pedido.comunidadId) ?? Number.MAX_SAFE_INTEGER
}

function mayorExistencia(
  candidatos: { nodo: NodoGrafo; existencia: ExistenciaGrafo }[],
): { nodo: NodoGrafo; existencia: ExistenciaGrafo } | null {
  return candidatos.reduce<{ nodo: NodoGrafo; existencia: ExistenciaGrafo } | null>(
    (a, b) => (a === null || b.existencia.cantidad > a.existencia.cantidad ? b : a),
    null,
  )
}

function existenciasDe(
  pedido: PedidoAResolver,
  nodos: readonly NodoGrafo[],
  existencias: readonly ExistenciaGrafo[],
): { nodo: NodoGrafo; existencia: ExistenciaGrafo }[] {
  const resultado: { nodo: NodoGrafo; existencia: ExistenciaGrafo }[] = []
  for (const nodo of nodos) {
    const existencia = existencias.find(
      (e) => e.nodoId === nodo.id && e.codigoItem === pedido.codigoItem,
    )
    if (existencia) resultado.push({ nodo, existencia })
  }
  return resultado
}

/**
 * Does this trip reach the community — either as its destination, or as a stop it could
 * make on the way? A lancha bound for Bellavista passes Tagachí, and proposing that drop is
 * exactly the kind of thing a coordinator should be shown and allowed to refuse.
 */
function sirve(
  capacidad: CapacidadGrafo,
  comunidadId: string,
  nodoPorId: Map<string, NodoGrafo>,
  grafo: Grafo,
): boolean {
  if (capacidad.hastaComunidadId === comunidadId) return true
  const origen = nodoPorId.get(capacidad.origenNodoId)
  if (!origen) return false
  return grafo.sirveDePaso(origen.comunidadId, comunidadId, capacidad.hastaComunidadId)
}
