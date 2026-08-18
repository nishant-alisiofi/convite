import type { PoolClient } from 'pg'

/**
 * FR-42 — fast person/beneficiary search over `contactos`.
 *
 * A coordinator in the field needs to find one person fast — by partial name, by phone, by
 * community — often on a weak connection. Section 11's rule holds here exactly as everywhere
 * else in the panel: this module runs no role check of its own. It queries under `conSesion()`
 * like every other read, so a result is exactly what the caller's RLS scope on `contactos` and
 * `comunidades` (migration 0017) already allows them to see on Comunidades or Verificación —
 * never wider. `contactos` carries no address column, so there is nothing here to leak that
 * those screens do not already show.
 *
 * Matching is accent- and case-insensitive (`normaliza_busqueda()`, migration 0055) and
 * indexed: `nombre_normalizado` / `telefono_digitos` on `contactos` and `nombre_normalizado` on
 * `comunidades` are generated columns backed by a GIN trigram index each, so a substring match
 * is an index scan, not a sequential one.
 */

/** Below this, a partial match is mostly noise — a single letter matches almost everyone. */
export const LONGITUD_MINIMA_BUSQUEDA = 2

/** Enough for a coordinator to scan on a phone screen without turning this into a report. */
const LIMITE_RESULTADOS = 25

export type ResultadoPersona = {
  id: string
  nombre: string | null
  telefono: string
  rol: string
  canalPreferido: string
  activo: boolean
  ultimoContactoEn: Date | null
  comunidadId: string | null
  comunidadNombre: string | null
  comunidadCodigo: string | null
  comunidadMunicipio: string | null
}

/**
 * Partial name, phone (local or E.164) or community name, matched against whichever of
 * `contactos.nombre_normalizado`, `contactos.telefono_digitos` or
 * `comunidades.nombre_normalizado` the term hits.
 *
 * `digitos` is computed here rather than inside the query so an all-letters term (no digits at
 * all) never turns into `LIKE '%%'` against `telefono_digitos` — that pattern matches every
 * row, which would silently widen a name search into "everyone with a phone number".
 */
export async function buscarPersonas(
  client: PoolClient,
  termino: string,
): Promise<ResultadoPersona[]> {
  const consulta = termino.trim()
  if (consulta.length < LONGITUD_MINIMA_BUSQUEDA) return []

  const digitos = consulta.replace(/\D/g, '')

  const { rows } = await client.query<ResultadoPersona>(
    `select co.id, co.nombre, co.telefono, co.rol,
            co.canal_preferido as "canalPreferido",
            co.activo,
            co.ultimo_contacto_en as "ultimoContactoEn",
            c.id       as "comunidadId",
            c.nombre   as "comunidadNombre",
            c.codigo   as "comunidadCodigo",
            c.municipio as "comunidadMunicipio"
       from contactos co
       left join comunidades c on c.id = co.comunidad_id
      where co.nombre_normalizado like '%' || normaliza_busqueda($1) || '%'
         or (c.nombre_normalizado like '%' || normaliza_busqueda($1) || '%')
         or ($2 <> '' and co.telefono_digitos like '%' || $2 || '%')
      order by co.nombre nulls last, co.telefono
      limit ${LIMITE_RESULTADOS}`,
    [consulta, digitos],
  )
  return rows
}

export type ReporteDePersona = {
  id: string
  folio: number
  tipo: string
  estado: string
  descripcion: string | null
  detalleLibre: string | null
  creadoEn: Date
}

export type PersonaDetalle = ResultadoPersona & {
  idioma: string
  aceptaLlamadas: boolean
  reportes: ReporteDePersona[]
}

/**
 * One person's own record plus their community and their most recent reports — the two
 * destinations AC #3 asks a search result to link to. `reportes` comes back empty rather than
 * erroring for a caller whose role cannot read `reportes` (a `lectura` session, or a
 * `verificador` outside their territory): RLS on that table (0017/0034) filters the join the
 * same way it filters a direct `select`, so this never surfaces a report the caller could not
 * already reach from Verificación.
 */
export async function personaPorId(
  client: PoolClient,
  id: string,
): Promise<PersonaDetalle | null> {
  const { rows } = await client.query<ResultadoPersona & { idioma: string; aceptaLlamadas: boolean }>(
    `select co.id, co.nombre, co.telefono, co.rol,
            co.canal_preferido as "canalPreferido",
            co.activo,
            co.idioma,
            co.acepta_llamadas as "aceptaLlamadas",
            co.ultimo_contacto_en as "ultimoContactoEn",
            c.id       as "comunidadId",
            c.nombre   as "comunidadNombre",
            c.codigo   as "comunidadCodigo",
            c.municipio as "comunidadMunicipio"
       from contactos co
       left join comunidades c on c.id = co.comunidad_id
      where co.id = $1`,
    [id],
  )
  const persona = rows[0]
  if (!persona) return null

  const { rows: reportes } = await client.query<ReporteDePersona>(
    `select id, folio, tipo, estado, descripcion, detalle_libre as "detalleLibre",
            creado_en as "creadoEn"
       from reportes
      where contacto_id = $1
      order by creado_en desc
      limit 10`,
    [id],
  )

  return { ...persona, reportes }
}
