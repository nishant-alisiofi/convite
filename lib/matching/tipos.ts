import type {
  EstadoCapacidad,
  EstadoOferta,
  EstadoPedido,
  Modo,
  Temporada,
} from '@/db/schema/vocabulario'
// The pickup domain owns this number; the matcher borrows it so the two cannot disagree
// about what "collectable" means. Constants only — nothing here reaches a database.
import { ALCANCE_RECOGIDA_M } from '@/lib/recogidas/plan'

/**
 * Inputs and outputs of the matching engine.
 *
 * Everything here is plain data. The core resolver never touches the database — it is
 * handed a snapshot and returns a verdict, which is what makes the five states testable
 * without a Postgres instance anywhere in sight (Section 8).
 */

/** The season we are resolving for. `todo_el_ano` is a property of a route, never a query. */
export type TemporadaActual = Exclude<Temporada, 'todo_el_ano'>

export type RutaGrafo = {
  id: string
  origenId: string
  destinoId: string
  modo: Modo
  /** Null means nobody has timed this leg. Reachable, duration unknown — not zero. */
  minutos: number | null
  temporada: Temporada
  activa: boolean
}

export type NodoGrafo = {
  id: string
  nombre: string
  comunidadId: string
  activo: boolean
  /** Null when nobody has located it yet — a real case in the seed, not an oversight. */
  lat: number | null
  lon: number | null
}

export type ExistenciaGrafo = {
  nodoId: string
  codigoItem: string
  cantidad: number
  /** Non-negotiable 2.3: carried through to the UI, and into the `motivo` when it is old. */
  contadoEn: Date
}

/**
 * Supply held by an individual rather than counted at a node.
 *
 * Section 8: never report SIN_EXISTENCIA without having looked here. Node inventory goes
 * stale within days; in the first week of a response the goods are in people's houses.
 */
export type OfertaGrafo = {
  id: string
  ofrecidoPor: string | null
  codigoItem: string | null
  /** Null when the sender never said. Not zero, and never invented (2.12). */
  cantidad: number | null
  estado: EstadoOferta
  perecedero: boolean
  venceEn: Date | null
  /** Null when nobody has placed it on a map yet. */
  lat: number | null
  lon: number | null
  /** Falls back to the offerer's community when there is no pin. */
  comunidadId: string | null
  necesitaRecogida: boolean
}

export type CapacidadGrafo = {
  id: string
  contactoNombre: string | null
  modo: Modo
  origenNodoId: string
  hastaComunidadId: string
  saleEn: Date
  cupoFamilias: number
  estado: EstadoCapacidad
}

export type PedidoAResolver = {
  id: string
  comunidadId: string
  codigoItem: string
  /** For the `motivo` sentence; the matcher itself never branches on the code (2.8). */
  itemLabel: string
  unidadSingular: string | null
  unidadPlural: string | null
  /** False for needs that are not cargo, e.g. apoyo psicosocial. */
  entregable: boolean
  familias: number
  urgencia: number
}

export type ContextoEmparejamiento = {
  temporada: TemporadaActual
  ahora: Date
  /** How far ahead a departure still counts as "somebody is going there". */
  horizonteDias: number
  /** A count older than this gets a caveat in the `motivo` (2.3). */
  diasParaConteoViejo: number
  /**
   * How far an offer may sit from a node and still be collectable, in metres.
   *
   * A coarse yes-or-no, and deliberately still straight-line: this is the pure resolver,
   * which never touches a database, and the question it asks is only "is this offer in the
   * same town as that node". Which stops to make and in what order is a different question
   * with a different answer — see lib/recogidas, where PostGIS clusters the offers into
   * neighbourhoods and orders one run over them.
   *
   * A radius is defensible inside a town in a way it never is across the basin: 7.3's ban
   * on straight-line distance is about river legs, where 5 km can mean 90 minutes upriver.
   */
  radioRecogidaM: number
  rutas: RutaGrafo[]
  nodos: NodoGrafo[]
  existencias: ExistenciaGrafo[]
  ofertas: OfertaGrafo[]
  capacidades: CapacidadGrafo[]
  /** Community id → name, for the sentences. */
  nombresComunidad: Map<string, string>
}

export type Resolucion = {
  estado: EstadoPedido
  /** Plain Spanish, shown verbatim in the UI (Section 8). */
  motivo: string
  nodoId?: string
  /** Set when the plan sources from an individual offer and includes a pickup leg. */
  ofertaId?: string
  capacidadId?: string
}

export const HORIZONTE_DIAS_POR_DEFECTO = 14
export const DIAS_PARA_CONTEO_VIEJO = 14
/**
 * Was 15 km, which inside Quibdó means the whole town and a good part of the road out of
 * it. Now the same reach the pickup planner uses, so the matcher cannot call an offer
 * collectable that no run would ever go and fetch.
 *
 * Real drive time would be better still and is not available: it needs a routing engine for
 * a territory where the roads are six pairs and the rest is river, which is the trade the
 * project already declined (PRD §3). What replaced the guess is not a better radius, it is
 * that the run itself is now planned over real distances in Postgres.
 */
export const RADIO_RECOGIDA_M = ALCANCE_RECOGIDA_M

/**
 * Pedido states the matcher is allowed to touch. Anything dispatched or closed is somebody
 * else's business — re-running the engine must never drag a shipment back into the queue.
 */
export const ESTADOS_QUE_EL_EMPAREJADOR_RESUELVE: readonly EstadoPedido[] = [
  'ABIERTO',
  'SIN_RUTA',
  'SIN_EXISTENCIA',
  'SIN_CAPACIDAD',
  'LISTO',
]
