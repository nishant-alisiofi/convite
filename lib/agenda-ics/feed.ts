import { getPool } from '@/db/client'
import { ETIQUETA_TIPO_JORNADA } from '@/lib/jornadas'
import type { TipoJornada } from '@/db/schema/vocabulario'
import type { EventoAgenda } from './ics'

/**
 * The data behind the Agenda feed — PRD-34 §28.1, sourced from what the basin already has: the
 * jornadas of PRD-30 and the shipments of the despacho layer. Citas (§27b.2 / FR-17) join this the
 * day their table lands; there is deliberately no table for them yet, so this reads the two event
 * kinds that exist today and no more — see `eventosDeAgenda`.
 *
 * Two properties matter more than completeness:
 *
 *   - **It never leaks.** The reads run as the membership's own user with RLS in force (0017 /
 *     0043 / the despacho policies), exactly as `conSesion` does for the panel — so the feed can
 *     never contain a row the person is not entitled to. The row *shapes* selected here carry only
 *     a code, a type, a status and a date: no name, no phone, no coordinate, no community, no free
 *     text. `ics.limpiarSensible` scrubs even those on the way out.
 *
 *   - **Its titles obey §28.1.** «folio · tipo», never the person or the condition, built by the
 *     pure mappers below so the rule can be tested without a database.
 */

/** A membership that has passed the token check and is still good for a feed. */
export type MembresiaFeed = {
  id: string
  usuarioId: string
  organizacionId: string
  rol: string
}

const ETIQUETA_MODO: Record<string, string> = {
  lancha: 'Lancha',
  chalupa: 'Chalupa',
  carretera: 'Carretera',
  trocha: 'Trocha',
  avioneta: 'Avioneta',
}

/** The row shape read from `jornadas` — dates pre-formatted to `YYYYMMDD` to sidestep timezones. */
export type FilaJornada = {
  id: string
  codigo: string
  tipo: string
  estado: string
  inicio: string
  fin: string | null
}

/** The row shape read from `envios`. `salida_programada` is an absolute instant. */
export type FilaEnvio = {
  id: string
  codigo: string
  modo: string
  estado: string
  salida_programada: Date
}

/** A jornada as a whole-day event. Title is «folio · tipo» and nothing else (§28.1). */
export function jornadaAEvento(fila: FilaJornada): EventoAgenda {
  const tipo = ETIQUETA_TIPO_JORNADA[fila.tipo as TipoJornada] ?? fila.tipo
  return {
    clase: 'dia',
    uid: `jornada-${fila.id}@convite`,
    resumen: `${fila.codigo} · ${tipo}`,
    inicio: fila.inicio,
    fin: fila.fin ?? undefined,
    estado: 'CONFIRMED',
  }
}

/** A shipment as a timed event at the fixed Bogotá offset. Title is «folio · Envío (modo)». */
export function envioAEvento(fila: FilaEnvio): EventoAgenda {
  const modo = ETIQUETA_MODO[fila.modo] ?? fila.modo
  return {
    clase: 'hora',
    uid: `envio-${fila.id}@convite`,
    resumen: `${fila.codigo} · Envío (${modo})`,
    inicio: fila.salida_programada,
    estado: 'CONFIRMED',
  }
}

/**
 * The membership a token points at, if it is still good for a feed.
 *
 * Read with the pool (the owner role), the way `sesionActual` reads the staff record: the HMAC
 * token has already authenticated the caller, so this lookup is the identity read, not a
 * user-scoped query. `activa` is the only state that serves — a `suspendida` or `terminada`
 * membership (offboarding, §29.6) returns null and the feed goes dark — and an expired grant
 * (`vence_en`) does the same.
 */
export async function membresiaActivaParaFeed(membresiaId: string): Promise<MembresiaFeed | null> {
  const { rows } = await getPool().query<{
    id: string
    usuario_id: string
    organizacion_id: string
    rol: string
  }>(
    `select id, usuario_id, organizacion_id, rol
       from membresias
      where id = $1
        and estado = 'activa'
        and (vence_en is null or vence_en > now())`,
    [membresiaId],
  )
  const fila = rows[0]
  if (!fila) return null
  return {
    id: fila.id,
    usuarioId: fila.usuario_id,
    organizacionId: fila.organizacion_id,
    rol: fila.rol,
  }
}

/**
 * The events this membership's feed should carry, read under RLS as the membership's user.
 *
 * The transaction assumes the `authenticated` role and the user's `sub`, exactly like `conSesion`,
 * and is rolled back (a feed only ever reads). RLS is the boundary; on top of it, jornadas are
 * narrowed to this membership's organisation so a person with memberships in two organisations gets
 * a feed per membership rather than the union. Shipments have no organisation column — their RLS
 * policy already scopes them to what the user may see — so they are left to the policy and not
 * re-filtered here.
 */
export async function eventosDeAgenda(m: MembresiaFeed): Promise<EventoAgenda[]> {
  const client = await getPool().connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: m.usuarioId, role: 'authenticated' }),
    ])
    await client.query('set local role authenticated')

    const eventos: EventoAgenda[] = []

    const jornadas = await client.query<FilaJornada>(
      `select id,
              codigo,
              tipo,
              estado,
              to_char(fecha_inicio, 'YYYYMMDD') as inicio,
              to_char(fecha_fin, 'YYYYMMDD') as fin
         from jornadas
        where organizacion_id = $1
          and fecha_inicio is not null
          and estado not in ('borrador', 'cancelada')
        order by fecha_inicio`,
      [m.organizacionId],
    )
    for (const fila of jornadas.rows) eventos.push(jornadaAEvento(fila))

    const envios = await client.query<FilaEnvio>(
      `select id, codigo, modo, estado, salida_programada
         from envios
        where salida_programada is not null
          and estado <> 'CANCELADO'
        order by salida_programada`,
    )
    for (const fila of envios.rows) eventos.push(envioAEvento(fila))

    await client.query('rollback')
    return eventos
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
