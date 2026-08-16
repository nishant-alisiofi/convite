import type { PoolClient } from 'pg'

/**
 * Reading the connection points for the "where can I go" surface (§5.9).
 *
 * A connection point is where a person from a low- or no-signal community walks to in order to
 * send a report or hear an answer. What the coordinator needs to see is not bandwidth — it is
 * whether the place is safe, private, reachable, powered, whether one can stay, and what it
 * costs, together with the communities it answers for. The coordinates never come back here:
 * the map marker is drawn from a separate located query, and this surface only says whether a
 * point is placed at all (`ubicado`).
 *
 * These are deliberately NOT joined to `nodos`. Supply and connectivity are kept apart so the
 * one place a person controls both never hides that they do.
 */

/** How a point does on a judged dimension, or `desconocido` when nobody has said yet. */
export type Nivel = 'alto' | 'medio' | 'bajo' | 'desconocido'
export type Costo = 'gratuito' | 'bajo' | 'medio' | 'alto' | 'desconocido'

export type PuntoConexion = {
  id: string
  nombre: string
  tipo: string
  /** Whether the point has a declared location. Coordinates themselves are never returned here. */
  ubicado: boolean
  tieneSenal: boolean
  internetDisponible: boolean
  vendePines: boolean
  atendido: boolean
  seguridad: Nivel
  privacidad: Nivel
  permanencia: Nivel
  accesibilidad: Nivel
  energia: Nivel
  costo: Costo
  notas: string | null
  /** Names of the communities this point serves, alphabetical. */
  comunidades: string[]
}

/** Every active connection point the caller may see, each with the communities it serves. */
export async function puntosDeConexion(client: PoolClient): Promise<PuntoConexion[]> {
  const { rows } = await client.query<{
    id: string
    nombre: string
    tipo: string
    ubicado: boolean
    tiene_senal: boolean
    internet_disponible: boolean
    vende_pines: boolean
    atendido: boolean
    seguridad: Nivel
    privacidad: Nivel
    permanencia: Nivel
    accesibilidad: Nivel
    energia: Nivel
    costo: Costo
    notas: string | null
    comunidades: string[]
  }>(
    `select p.id,
            p.nombre,
            p.tipo,
            p.ubicacion is not null as ubicado,
            p.tiene_senal,
            p.internet_disponible,
            p.vende_pines,
            p.atendido,
            p.seguridad,
            p.privacidad,
            p.permanencia,
            p.accesibilidad,
            p.energia,
            p.costo,
            p.notas,
            coalesce(
              array_agg(c.nombre order by c.nombre) filter (where c.id is not null),
              '{}'
            ) as comunidades
       from puntos_conexion p
       left join puntos_conexion_comunidades pc on pc.punto_id = p.id
       left join comunidades c on c.id = pc.comunidad_id
      where p.activo
      group by p.id
      order by p.nombre`,
  )

  return rows.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    tipo: r.tipo,
    ubicado: r.ubicado,
    tieneSenal: r.tiene_senal,
    internetDisponible: r.internet_disponible,
    vendePines: r.vende_pines,
    atendido: r.atendido,
    seguridad: r.seguridad,
    privacidad: r.privacidad,
    permanencia: r.permanencia,
    accesibilidad: r.accesibilidad,
    energia: r.energia,
    costo: r.costo,
    notas: r.notas,
    comunidades: r.comunidades,
  }))
}
