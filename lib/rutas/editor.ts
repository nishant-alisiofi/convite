import type { PoolClient } from 'pg'
import { z } from 'zod'
import { MODOS, TEMPORADAS, type Modo, type Temporada } from '@/db/schema/vocabulario'
import { Grafo } from '@/lib/matching/grafo'
import type { RutaGrafo, TemporadaActual } from '@/lib/matching/tipos'

/**
 * The river-route editor.
 *
 * Section 7.3: most of this basin is reachable only by boat and no provider has river data,
 * so the graph the matcher runs on is entered by people who know the river. That makes this
 * screen the one place where the reachability of thirteen communities is decided, and it
 * never calls anything — no Routes API, no geocoder, no distance service. `fuente` is
 * always `manual` here, which is also what the fluvial check constraint requires.
 *
 * Closing a leg is the dangerous operation. `MER→TAG` is a single row, and taking it out
 * cuts off Tagachí, Beté and Bellavista at once, so deactivation asks first, shows what it
 * costs, and writes down who decided it (2.1, Section 9.3).
 */

export type FilaRuta = {
  id: string
  origenId: string
  destinoId: string
  origen: string
  destino: string
  modo: Modo
  minutos: number | null
  distanciaM: number | null
  costoEstimadoCop: number | null
  temporada: Temporada
  fuente: string
  activa: boolean
  notas: string | null
  desactivadaPor: string | null
  desactivadaEn: Date | null
  desactivadaPorCorreo: string | null
}

export type OpcionComunidad = { id: string; nombre: string; codigo: string }

const numeroOpcional = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : Number(v)))
  .refine((v) => v === null || (Number.isFinite(v) && v > 0), 'Debe ser un número mayor que cero.')

export const esquemaRuta = z.object({
  origenId: z.string().uuid('Escoja un origen.'),
  destinoId: z.string().uuid('Escoja un destino.'),
  modo: z.enum(MODOS),
  temporada: z.enum(TEMPORADAS),
  minutos: numeroOpcional,
  distanciaM: numeroOpcional,
  costoEstimadoCop: numeroOpcional,
  notas: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v)),
})

export type EntradaRuta = z.infer<typeof esquemaRuta>

export async function listarRutas(client: PoolClient): Promise<FilaRuta[]> {
  const { rows } = await client.query(
    `select r.id, r.origen_id, r.destino_id, o.nombre as origen, d.nombre as destino,
            r.modo, r.minutos, r.distancia_m, r.costo_estimado_cop, r.temporada, r.fuente,
            r.activa, r.notas, r.desactivada_por, r.desactivada_en,
            u.id::text as desactivada_por_correo
       from rutas r
       join comunidades o on o.id = r.origen_id
       join comunidades d on d.id = r.destino_id
       left join usuarios u on u.id = r.desactivada_por
      order by r.activa desc, o.nombre, d.nombre, r.temporada`,
  )
  return rows.map((r) => ({
    id: r.id,
    origenId: r.origen_id,
    destinoId: r.destino_id,
    origen: r.origen,
    destino: r.destino,
    modo: r.modo,
    minutos: r.minutos,
    distanciaM: r.distancia_m,
    costoEstimadoCop: r.costo_estimado_cop === null ? null : Number(r.costo_estimado_cop),
    temporada: r.temporada,
    fuente: r.fuente,
    activa: r.activa,
    notas: r.notas,
    desactivadaPor: r.desactivada_por,
    desactivadaEn: r.desactivada_en,
    desactivadaPorCorreo: r.desactivada_por_correo,
  }))
}

export async function comunidadesParaRutas(client: PoolClient): Promise<OpcionComunidad[]> {
  const { rows } = await client.query<OpcionComunidad>(
    `select id, nombre, codigo from comunidades where activa order by nombre`,
  )
  return rows
}

export async function rutaPorId(client: PoolClient, id: string): Promise<FilaRuta | null> {
  const todas = await listarRutas(client)
  return todas.find((r) => r.id === id) ?? null
}

/** Postgres turns our constraints into messages a coordinator can act on. */
function traducirError(error: unknown): string {
  const codigo = (error as { code?: string })?.code
  const restriccion = (error as { constraint?: string })?.constraint

  if (codigo === '23505') return 'Ya existe un tramo con ese origen, destino, modo y temporada.'
  if (restriccion === 'rutas_no_bucle_check') return 'El origen y el destino no pueden ser el mismo.'
  if (restriccion === 'rutas_minutos_check') return 'Los minutos deben ser mayores que cero.'
  if (restriccion === 'rutas_fluvial_manual_check') {
    return 'Un tramo fluvial no puede venir de Google: lo escribe alguien que conoce el río.'
  }
  if (codigo === '42501' || codigo === '23514') {
    return 'La base rechazó el cambio. Revise los datos y sus permisos.'
  }
  return 'No se pudo guardar el tramo.'
}

export type Resultado = { ok: true } | { ok: false; error: string }

export async function crearRuta(
  client: PoolClient,
  entrada: EntradaRuta,
  actorId: string,
): Promise<Resultado> {
  try {
    const { rows } = await client.query<{ id: string }>(
      `insert into rutas (origen_id, destino_id, modo, minutos, distancia_m,
                          costo_estimado_cop, temporada, fuente, notas)
       values ($1, $2, $3, $4, $5, $6, $7, 'manual', $8)
       returning id`,
      [
        entrada.origenId,
        entrada.destinoId,
        entrada.modo,
        entrada.minutos,
        entrada.distanciaM,
        entrada.costoEstimadoCop,
        entrada.temporada,
        entrada.notas,
      ],
    )
    await auditar(client, actorId, 'ruta.creada', rows[0]!.id, null, entrada)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: traducirError(error) }
  }
}

export async function editarRuta(
  client: PoolClient,
  id: string,
  entrada: EntradaRuta,
  actorId: string,
): Promise<Resultado> {
  try {
    const antes = await rutaPorId(client, id)
    const { rowCount } = await client.query(
      `update rutas
          set origen_id = $2, destino_id = $3, modo = $4, minutos = $5, distancia_m = $6,
              costo_estimado_cop = $7, temporada = $8, notas = $9
        where id = $1`,
      [
        id,
        entrada.origenId,
        entrada.destinoId,
        entrada.modo,
        entrada.minutos,
        entrada.distanciaM,
        entrada.costoEstimadoCop,
        entrada.temporada,
        entrada.notas,
      ],
    )
    // RLS filters rather than raising: no rows touched means this session may not write here.
    if (rowCount === 0) return { ok: false, error: 'No tiene permiso para editar tramos.' }

    await auditar(client, actorId, 'ruta.editada', id, antes, entrada)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: traducirError(error) }
  }
}

/**
 * Closes a leg, with a name on it.
 *
 * `notas` is required rather than optional: a leg that is shut with no reason recorded is
 * one nobody can reopen with confidence three weeks later.
 */
export async function desactivarRuta(
  client: PoolClient,
  id: string,
  motivo: string,
  actorId: string,
): Promise<Resultado> {
  if (motivo.trim().length === 0) {
    return { ok: false, error: 'Escriba por qué se cierra el tramo.' }
  }

  try {
    const antes = await rutaPorId(client, id)
    const { rowCount } = await client.query(
      `update rutas
          set activa = false, desactivada_por = $2, desactivada_en = now(), notas = $3
        where id = $1 and activa`,
      [id, actorId, motivo.trim()],
    )
    if (rowCount === 0) {
      return { ok: false, error: 'No se pudo cerrar el tramo: ya estaba cerrado o no tiene permiso.' }
    }

    await auditar(client, actorId, 'ruta.desactivada', id, antes, { motivo: motivo.trim() })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: traducirError(error) }
  }
}

export async function reactivarRuta(
  client: PoolClient,
  id: string,
  actorId: string,
): Promise<Resultado> {
  try {
    const antes = await rutaPorId(client, id)
    // The closure columns describe the current closure, so reopening clears them. The
    // history of who closed it and why stays in `auditoria`, which nobody can edit.
    const { rowCount } = await client.query(
      `update rutas set activa = true, desactivada_por = null, desactivada_en = null
        where id = $1 and not activa`,
      [id],
    )
    if (rowCount === 0) {
      return { ok: false, error: 'No se pudo reabrir el tramo: ya estaba abierto o no tiene permiso.' }
    }

    await auditar(client, actorId, 'ruta.reactivada', id, antes, null)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: traducirError(error) }
  }
}

async function auditar(
  client: PoolClient,
  actorId: string,
  accion: string,
  rutaId: string,
  antes: unknown,
  despues: unknown,
): Promise<void> {
  await client.query(
    `insert into auditoria (actor_id, accion, entidad, entidad_id, antes, despues)
     values ($1, $2, 'rutas', $3, $4, $5)`,
    [actorId, accion, rutaId, antes ? JSON.stringify(antes) : null, despues ? JSON.stringify(despues) : null],
  )
}

/**
 * Which communities lose every way in if this leg closes.
 *
 * The answer a coordinator needs before confirming, and it is not obvious from the row:
 * closing `MER→TAG` reads like one leg between two places and in fact strands Tagachí, Beté
 * and Bellavista together, because everything downstream passes through it.
 *
 * Reachability is measured the way the matcher measures it — from the communities that hold
 * supply nodes, over active legs of the current season — so this says exactly what the
 * engine will conclude, not an approximation of it.
 */
export async function comunidadesQueQuedanSinPaso(
  client: PoolClient,
  rutaId: string,
  temporada: TemporadaActual,
): Promise<string[]> {
  const { rows: rutas } = await client.query<{
    id: string
    origen_id: string
    destino_id: string
    modo: Modo
    minutos: number | null
    temporada: Temporada
    activa: boolean
  }>(`select id, origen_id, destino_id, modo, minutos, temporada, activa from rutas`)

  const { rows: nodos } = await client.query<{ comunidad_id: string }>(
    `select distinct comunidad_id from nodos where activo`,
  )
  const { rows: comunidades } = await client.query<{ id: string; nombre: string }>(
    `select id, nombre from comunidades where activa`,
  )

  const aGrafo = (filas: typeof rutas): RutaGrafo[] =>
    filas.map((r) => ({
      id: r.id,
      origenId: r.origen_id,
      destinoId: r.destino_id,
      modo: r.modo,
      minutos: r.minutos,
      temporada: r.temporada,
      activa: r.activa,
    }))

  const alcanzables = (filas: typeof rutas): Set<string> => {
    const grafo = new Grafo(aGrafo(filas), temporada)
    const vistas = new Set<string>()
    for (const nodo of nodos) {
      for (const destino of grafo.desde(nodo.comunidad_id).keys()) vistas.add(destino)
    }
    return vistas
  }

  const antes = alcanzables(rutas)
  const despues = alcanzables(rutas.map((r) => (r.id === rutaId ? { ...r, activa: false } : r)))

  return comunidades
    .filter((c) => antes.has(c.id) && !despues.has(c.id))
    .map((c) => c.nombre)
    .sort()
}
