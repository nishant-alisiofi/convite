import type { PoolClient } from 'pg'
import {
  type EstadoJornada,
  ESTADOS_JORNADA,
  type TipoJornada,
  TIPOS_JORNADA,
} from '@/db/schema/vocabulario'
import { fechaSqlADia } from '@/lib/fechas'

/**
 * PRD-30 (§22) — jornadas: one occurrence, at a place, on a date, of a given type.
 *
 * The tables (jornadas / jornada_paradas) are delivered by PRD-37 (migration 0043); this is the
 * feature logic on top of them — listing, creating, editing (a diverging jornada is edited, never
 * deleted — §21b.5), and ordering the stops. Every function runs against the client `conSesion()`
 * hands it, so RLS (0043) is the real boundary: verificador/despachador/coordinador/admin read
 * within their organisation, coordinador/admin write. The panel gates the UI on top of that.
 *
 * A jornada is the container over the same matching engine — the engine does not change (§22).
 * Wiring a jornada's unmet requirements into the Bandeja stuck-states is a later step; this layer
 * is the occurrence, its place, its date and its stops.
 */

export const JORNADA_ROLES_LECTURA = ['verificador', 'despachador', 'coordinador', 'admin'] as const
export const JORNADA_ROLES_ESCRITURA = ['coordinador', 'admin'] as const

/** §D4: a coordinator never sees the raw enum. What each jornada type is, in one word. */
export const ETIQUETA_TIPO_JORNADA: Record<TipoJornada, string> = {
  distribucion: 'Distribución',
  brigada: 'Brigada',
  taller: 'Taller',
  formacion: 'Formación',
  evaluacion: 'Evaluación',
  obra: 'Obra',
}

/** What each type carries — the payload, so the create form can say what it is asking for (§22). */
export const PAYLOAD_TIPO_JORNADA: Record<TipoJornada, string> = {
  distribucion: 'Bienes',
  brigada: 'Personas con oficios',
  taller: 'Facilitador y materiales',
  formacion: 'Facilitador y materiales',
  evaluacion: 'Encuestador y una plantilla',
  obra: 'Materiales, mano de obra, asistencia técnica',
}

export const ETIQUETA_ESTADO_JORNADA: Record<EstadoJornada, string> = {
  borrador: 'Borrador',
  planificada: 'Planificada',
  en_curso: 'En curso',
  completada: 'Completada',
  cancelada: 'Cancelada',
  historico: 'Histórico',
}

/** The types that carry a persistent roster across sessions (§21b.3). */
export const TIPOS_CON_ROSTER: readonly TipoJornada[] = ['taller', 'formacion']

export type Jornada = {
  id: string
  codigo: string
  tipo: string
  titulo: string
  estado: string
  regionId: string
  regionNombre: string | null
  programaId: string | null
  programaTitulo: string | null
  fechaInicio: string | null
  fechaFin: string | null
  familiasAtendidas: number | null
  notas: string | null
  paradas: number
  creadoEn: Date
}

export type ParadaJornada = {
  id: string
  comunidadId: string
  comunidadNombre: string | null
  orden: number
  notas: string | null
}

type FilaJornada = {
  id: string
  codigo: string
  tipo: string
  titulo: string
  estado: string
  region_id: string
  region_nombre: string | null
  programa_id: string | null
  programa_titulo: string | null
  // `date` columns: `pg` hands these back as a local-midnight `Date`, not a string — see
  // `fechaSqlADia` in `lib/fechas.ts` (BUG-22).
  fecha_inicio: Date | string | null
  fecha_fin: Date | string | null
  familias_atendidas: number | null
  notas: string | null
  paradas: string
  creado_en: Date
}

function mapear(r: FilaJornada): Jornada {
  return {
    id: r.id,
    codigo: r.codigo,
    tipo: r.tipo,
    titulo: r.titulo,
    estado: r.estado,
    regionId: r.region_id,
    regionNombre: r.region_nombre,
    programaId: r.programa_id,
    programaTitulo: r.programa_titulo,
    fechaInicio: fechaSqlADia(r.fecha_inicio),
    fechaFin: fechaSqlADia(r.fecha_fin),
    familiasAtendidas: r.familias_atendidas,
    notas: r.notas,
    paradas: Number(r.paradas),
    creadoEn: r.creado_en,
  }
}

const SELECT_JORNADA = `
  select j.id, j.codigo, j.tipo, j.titulo, j.estado, j.region_id,
         r.nombre as region_nombre,
         j.programa_id, pr.titulo as programa_titulo,
         j.fecha_inicio, j.fecha_fin, j.familias_atendidas, j.notas,
         count(jp.id) as paradas,
         j.creado_en
    from jornadas j
    left join regiones r on r.id = j.region_id
    left join programas pr on pr.id = j.programa_id
    left join jornada_paradas jp on jp.jornada_id = j.id`

/** Every jornada the caller may see. `programaId` filters to one programa's occurrences. */
export async function listarJornadas(
  client: PoolClient,
  opciones: { programaId?: string } = {},
): Promise<Jornada[]> {
  const filtro = opciones.programaId ? `where j.programa_id = $1` : ``
  const params = opciones.programaId ? [opciones.programaId] : []
  const { rows } = await client.query<FilaJornada>(
    `${SELECT_JORNADA}
      ${filtro}
      group by j.id, r.nombre, pr.titulo
      order by j.fecha_inicio desc nulls last, j.creado_en desc`,
    params,
  )
  return rows.map(mapear)
}

export async function jornadaPorId(client: PoolClient, id: string): Promise<Jornada | null> {
  const { rows } = await client.query<FilaJornada>(
    `${SELECT_JORNADA}
      where j.id = $1
      group by j.id, r.nombre, pr.titulo`,
    [id],
  )
  return rows[0] ? mapear(rows[0]) : null
}

/** The ordered stops of a jornada. */
export async function paradasDe(client: PoolClient, jornadaId: string): Promise<ParadaJornada[]> {
  const { rows } = await client.query<{
    id: string
    comunidad_id: string
    comunidad_nombre: string | null
    orden: number
    notas: string | null
  }>(
    `select jp.id, jp.comunidad_id, c.nombre as comunidad_nombre, jp.orden, jp.notas
       from jornada_paradas jp
       left join comunidades c on c.id = jp.comunidad_id
      where jp.jornada_id = $1
      order by jp.orden`,
    [jornadaId],
  )
  return rows.map((r) => ({
    id: r.id,
    comunidadId: r.comunidad_id,
    comunidadNombre: r.comunidad_nombre,
    orden: r.orden,
    notas: r.notas,
  }))
}

export type NuevaJornada = {
  organizacionId: string
  tipo: TipoJornada
  titulo: string
  regionId: string
  programaId?: string | null
  fechaInicio?: string | null
  fechaFin?: string | null
  estado?: EstadoJornada
  notas?: string | null
}

/** `J-260816-3`: short enough to say over a bad phone line, mirroring the envío code (§despacho). */
async function siguienteCodigo(client: PoolClient): Promise<string> {
  const hoy = new Date()
  const dia = `${String(hoy.getUTCFullYear()).slice(2)}${String(hoy.getUTCMonth() + 1).padStart(2, '0')}${String(hoy.getUTCDate()).padStart(2, '0')}`
  const { rows } = await client.query<{ n: string }>(
    `select count(*)::text as n from jornadas where codigo like $1`,
    [`J-${dia}-%`],
  )
  return `J-${dia}-${Number(rows[0]!.n) + 1}`
}

/** Create a jornada. A draft by default (§23) — nothing is committed by drawing one. */
export async function crearJornada(client: PoolClient, entrada: NuevaJornada): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into jornadas
       (codigo, tipo, organizacion_id, titulo, region_id, programa_id,
        fecha_inicio, fecha_fin, estado, notas)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning id`,
    [
      await siguienteCodigo(client),
      entrada.tipo,
      entrada.organizacionId,
      entrada.titulo,
      entrada.regionId,
      entrada.programaId ?? null,
      entrada.fechaInicio ?? null,
      entrada.fechaFin ?? null,
      entrada.estado ?? 'borrador',
      entrada.notas ?? null,
    ],
  )
  return rows[0]!.id
}

export type CambioJornada = {
  titulo?: string
  estado?: EstadoJornada
  fechaInicio?: string | null
  fechaFin?: string | null
  familiasAtendidas?: number | null
  programaId?: string | null
  notas?: string | null
}

/**
 * Edit a jornada. §21b.5: a plan diverges from reality by being *edited*, not deleted — the
 * programa then shows planned vs actual. Only the fields present in `cambios` are touched.
 */
export async function actualizarJornada(
  client: PoolClient,
  id: string,
  cambios: CambioJornada,
): Promise<void> {
  const sets: string[] = []
  const params: unknown[] = []
  const poner = (col: string, valor: unknown) => {
    params.push(valor)
    sets.push(`${col} = $${params.length}`)
  }
  if (cambios.titulo !== undefined) poner('titulo', cambios.titulo)
  if (cambios.estado !== undefined) poner('estado', cambios.estado)
  if (cambios.fechaInicio !== undefined) poner('fecha_inicio', cambios.fechaInicio)
  if (cambios.fechaFin !== undefined) poner('fecha_fin', cambios.fechaFin)
  if (cambios.familiasAtendidas !== undefined) poner('familias_atendidas', cambios.familiasAtendidas)
  if (cambios.programaId !== undefined) poner('programa_id', cambios.programaId)
  if (cambios.notas !== undefined) poner('notas', cambios.notas)
  if (sets.length === 0) return
  params.push(id)
  await client.query(`update jornadas set ${sets.join(', ')} where id = $${params.length}`, params)
}

/** Add the next stop to a jornada, at the end of the run. */
export async function agregarParada(
  client: PoolClient,
  jornadaId: string,
  comunidadId: string,
  notas?: string | null,
): Promise<void> {
  const { rows } = await client.query<{ siguiente: number }>(
    `select coalesce(max(orden) + 1, 0) as siguiente from jornada_paradas where jornada_id = $1`,
    [jornadaId],
  )
  await client.query(
    `insert into jornada_paradas (jornada_id, comunidad_id, orden, notas)
     values ($1, $2, $3, $4)`,
    [jornadaId, comunidadId, rows[0]!.siguiente, notas ?? null],
  )
}

export async function quitarParada(client: PoolClient, paradaId: string): Promise<void> {
  await client.query(`delete from jornada_paradas where id = $1`, [paradaId])
}

export { ESTADOS_JORNADA, TIPOS_JORNADA }
