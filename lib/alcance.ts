import type { PoolClient } from 'pg'
import type { Modo, Temporada } from '@/db/schema/vocabulario'
import { Grafo } from '@/lib/matching/grafo'
import type { RutaGrafo, TemporadaActual } from '@/lib/matching/tipos'

/**
 * Which communities the engine believes can be reached, and what a change would do to that.
 *
 * Two operations in this system silently redraw the map of who is reachable: closing a leg,
 * and switching the season. Neither raises an error when it is wrong — the plans simply come
 * out different, and a community drops off the board with nothing to say why. So both ask
 * first, and both ask this module what the change would cost.
 *
 * Reachability is measured exactly as the matcher measures it: from the communities holding
 * active supply nodes, over active legs of the season in question. Anything looser would
 * warn about the wrong thing.
 */

type FilaRuta = {
  id: string
  origen_id: string
  destino_id: string
  modo: Modo
  minutos: number | null
  temporada: Temporada
  activa: boolean
}

export type Cuenca = {
  rutas: FilaRuta[]
  comunidadesConNodo: string[]
  nombres: Map<string, string>
}

export async function cargarCuenca(client: PoolClient): Promise<Cuenca> {
  const { rows: rutas } = await client.query<FilaRuta>(
    `select id, origen_id, destino_id, modo, minutos, temporada, activa from rutas`,
  )
  const { rows: nodos } = await client.query<{ comunidad_id: string }>(
    `select distinct comunidad_id from nodos where activo`,
  )
  const { rows: comunidades } = await client.query<{ id: string; nombre: string }>(
    `select id, nombre from comunidades where activa`,
  )

  return {
    rutas,
    comunidadesConNodo: nodos.map((n) => n.comunidad_id),
    nombres: new Map(comunidades.map((c) => [c.id, c.nombre])),
  }
}

/** Community ids reachable from somewhere holding supply, optionally with one leg removed. */
export function alcanzables(
  cuenca: Cuenca,
  temporada: TemporadaActual,
  opciones: { sinRuta?: string } = {},
): Set<string> {
  const rutas: RutaGrafo[] = cuenca.rutas.map((r) => ({
    id: r.id,
    origenId: r.origen_id,
    destinoId: r.destino_id,
    modo: r.modo,
    minutos: r.minutos,
    temporada: r.temporada,
    activa: r.activa && r.id !== opciones.sinRuta,
  }))

  const grafo = new Grafo(rutas, temporada)
  const vistas = new Set<string>()
  for (const comunidadId of cuenca.comunidadesConNodo) {
    for (const destino of grafo.desde(comunidadId).keys()) vistas.add(destino)
  }
  return vistas
}

/** Names of communities in `antes` that are missing from `despues`, alphabetically. */
export function perdidas(cuenca: Cuenca, antes: Set<string>, despues: Set<string>): string[] {
  return [...antes]
    .filter((id) => !despues.has(id))
    .map((id) => cuenca.nombres.get(id) ?? id)
    .sort()
}

/** What switching to `destino` would open up and cut off. */
export async function efectoDeLaTemporada(
  client: PoolClient,
  actual: TemporadaActual,
  destino: TemporadaActual,
): Promise<{ pierden: string[]; ganan: string[] }> {
  const cuenca = await cargarCuenca(client)
  const antes = alcanzables(cuenca, actual)
  const despues = alcanzables(cuenca, destino)

  return {
    pierden: perdidas(cuenca, antes, despues),
    ganan: perdidas(cuenca, despues, antes),
  }
}
