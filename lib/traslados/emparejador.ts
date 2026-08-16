import { Grafo } from '@/lib/matching/grafo'
import type {
  CapacidadGrafo,
  NodoGrafo,
  RutaGrafo,
  TemporadaActual,
} from '@/lib/matching/tipos'

/**
 * PRD-8 — matching a person to a seat (PRD v3 §25).
 *
 * The whole point of this module is that it does NOT fork the goods matcher. It reuses the
 * *capacity path*: the same `CapacidadGrafo` a boat/road/plane already publishes, and the same
 * route `Grafo` the resolver walks. A person who needs to reach care is demand; a vehicle going
 * that way with a free seat is capacity. What changes from goods is only the unit — seats and a
 * time window instead of weight/volume — and that the record carries a person, not a quantity.
 *
 * This deliberately mirrors step 3 of `lib/matching/resolver.ts` (the capacity filter): departs
 * from the origin, has cupo for everyone travelling, is `OFRECIDA`, leaves inside the window, and
 * either terminates at or passes through the destination. That filter lives inside the resolver as
 * a private helper we cannot import without editing the (shared, frozen) matcher, so it is
 * reproduced here over the identical types — same representation, same graph, one extra dimension
 * (a window with two ends rather than a single horizon).
 *
 * Pure, like the resolver: hand it a request and a snapshot, get back a verdict and a sentence.
 * No database, so the three states are as cheap to pin down as the goods ones.
 */

/** A person's trip as the matcher sees it. Seats + a window; the PII lives elsewhere. */
export type SolicitudTraslado = {
  id: string
  origenComunidadId: string
  destinoComunidadId: string
  /** Seats needed: the person plus anyone accompanying them. */
  personas: number
  /** Earliest and latest a departure still serves this person. */
  ventanaDesde: Date
  ventanaHasta: Date
}

export type ContextoTraslado = {
  ahora: Date
  temporada: TemporadaActual
  rutas: RutaGrafo[]
  nodos: NodoGrafo[]
  capacidades: CapacidadGrafo[]
  /** Community id → name, for the sentences. */
  nombresComunidad: Map<string, string>
}

export type ResolucionTraslado = {
  /** Reuses the goods vocabulary where the shape is identical. */
  estado: 'LISTO' | 'SIN_CAPACIDAD' | 'SIN_RUTA'
  /** Plain Spanish, shown verbatim (Section 8). */
  motivo: string
  /** The proposed vehicle, when there is one. A human still confirms (2.1). */
  capacidadId?: string
}

/** «1 persona» / «3 personas» — the seat count spoken the way a coordinator would. */
function frasePersonas(n: number): string {
  return n === 1 ? '1 persona' : `${n} personas`
}

function nombre(contexto: ContextoTraslado, comunidadId: string): string {
  return contexto.nombresComunidad.get(comunidadId) ?? 'el destino'
}

/**
 * Does this trip reach the destination — as where it ends, or as a stop on the way? Identical in
 * intent to `resolver.ts`'s `sirve`: a lancha bound for Bellavista passes Tagachí, and proposing
 * that seat is exactly what a coordinator should be shown and allowed to refuse. Uses only the
 * graph's public API (`sirveDePaso`), so no route logic is duplicated.
 */
function sirve(
  capacidad: CapacidadGrafo,
  destinoComunidadId: string,
  nodoPorId: Map<string, NodoGrafo>,
  grafo: Grafo,
): boolean {
  if (capacidad.hastaComunidadId === destinoComunidadId) return true
  const origen = nodoPorId.get(capacidad.origenNodoId)
  if (!origen) return false
  return grafo.sirveDePaso(origen.comunidadId, destinoComunidadId, capacidad.hastaComunidadId)
}

/**
 * Match one person-transport request against the capacity going that way in the window.
 *
 * Order matches the resolver's, and for the same reason: telling someone «no hay quién los lleve»
 * when in fact there is no path at all sends them to argue with the wrong person. So route first,
 * then seats.
 */
export function emparejarTraslado(
  solicitud: SolicitudTraslado,
  contexto: ContextoTraslado,
  grafoPrecalculado?: Grafo,
): ResolucionTraslado {
  const grafo = grafoPrecalculado ?? new Grafo(contexto.rutas, contexto.temporada)
  const origen = nombre(contexto, solicitud.origenComunidadId)
  const destino = nombre(contexto, solicitud.destinoComunidadId)

  // 1. Is there any path from origin to destination this season?
  if (!grafo.llega(solicitud.origenComunidadId, solicitud.destinoComunidadId)) {
    return {
      estado: 'SIN_RUTA',
      motivo: `No hay paso de ${origen} a ${destino} en esta temporada. Hay que abrir un camino o esperar el cambio de temporada.`,
    }
  }

  // 2. Is anybody with a free seat travelling that way inside the window? Reuses exactly the
  // capacity filter from resolver step 3, one dimension wider (a window, not a single horizon).
  const nodoPorId = new Map(contexto.nodos.map((n) => [n.id, n]))
  const candidata = contexto.capacidades
    .filter((c) => c.estado === 'OFRECIDA')
    .filter((c) => c.saleEn >= solicitud.ventanaDesde && c.saleEn <= solicitud.ventanaHasta)
    .filter((c) => c.cupoFamilias >= solicitud.personas)
    // The vehicle has to leave from the person's own community, or the proposal is «take the boat
    // from Quibdó» to someone who is in Tagachí.
    .filter((c) => nodoPorId.get(c.origenNodoId)?.comunidadId === solicitud.origenComunidadId)
    .filter((c) => sirve(c, solicitud.destinoComunidadId, nodoPorId, grafo))
    .sort((a, b) => a.saleEn.getTime() - b.saleEn.getTime())[0]

  if (candidata) {
    const cuando = candidata.saleEn.toLocaleDateString('es-CO', { day: '2-digit', month: 'long' })
    const quien = candidata.contactoNombre ?? 'un transportista'
    const dePaso = candidata.hastaComunidadId !== solicitud.destinoComunidadId
    return {
      estado: 'LISTO',
      motivo: dePaso
        ? `${quien} sale para ${nombre(contexto, candidata.hastaComunidadId)} el ${cuando} y pasa por ${destino}. Tiene cupo para llevar ${frasePersonas(solicitud.personas)}.`
        : `${quien} viaja de ${origen} a ${destino} el ${cuando} y tiene cupo para llevar ${frasePersonas(solicitud.personas)}.`,
      capacidadId: candidata.id,
    }
  }

  // 3. There is a path, but nobody with a seat is going in the window.
  return {
    estado: 'SIN_CAPACIDAD',
    motivo: `Hay camino de ${origen} a ${destino}, pero nadie con cupo para ${frasePersonas(solicitud.personas)} viaja para allá en las fechas pedidas.`,
  }
}
