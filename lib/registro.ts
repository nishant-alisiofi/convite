import type { PoolClient } from 'pg'

/**
 * The shared community gazetteer's correction desk (PRD-35, §29.3b).
 *
 * Communities are a common registry, seeded `verificado_en = NULL` on purpose — nothing counts as
 * verified until the territory says so. This is how the territory says so: a proposal corrects an
 * existing community (name / coordinate / existence) or proposes a new one, matched by name and
 * proximity against the registry before creation so «Bellavista» is never entered twice.
 *
 * Proposing is an ordinary authenticated INSERT bounded by RLS. Accepting one writes the shared
 * `comunidades` row and stamps `verificado_en`, which authenticated cannot do directly, so it goes
 * through the SECURITY DEFINER `convite_resolver_propuesta_registro` (migration 0052). Every
 * function here takes the RLS-bound client from `conSesion` (lib/sesion.ts).
 */

export type Coincidencia = {
  comunidadId: string
  nombre: string
  municipio: string
  distanciaM: number | null
  verificado: boolean
}

/**
 * Registry rows that look like a proposed community — matched by name (substring either way) and,
 * when a coordinate is given, by proximity. This is the duplicate guard: an org proposing a «nueva»
 * sees the existing rows it might mean before creating a second one. Reads across the whole shared
 * registry (comunidades is readable by every staff role, §29.3b) and returns only shared facts.
 */
export async function coincidencias(
  client: PoolClient,
  args: { nombre: string; lat?: number | null; lon?: number | null; radioM?: number; excluir?: string | null },
): Promise<Coincidencia[]> {
  const nombre = (args.nombre ?? '').trim()
  const lat = args.lat ?? null
  const lon = args.lon ?? null
  const radioM = args.radioM ?? 5000
  if (!nombre && (lat == null || lon == null)) return []

  const { rows } = await client.query<{
    id: string
    nombre: string
    municipio: string
    distancia_m: number | null
    verificado: boolean
  }>(
    `select c.id,
            c.nombre,
            c.municipio,
            case when $2::float8 is null or $3::float8 is null or c.ubicacion is null then null
                 else round(st_distance(c.ubicacion::geography,
                        st_setsrid(st_makepoint($3::float8, $2::float8), 4326)::geography))::int
            end as distancia_m,
            (c.verificado_en is not null) as verificado
       from comunidades c
      where c.activa
        and ($4::uuid is null or c.id <> $4::uuid)
        and (
          ($1 <> '' and (lower(c.nombre) like '%' || lower($1) || '%'
                         or lower($1) like '%' || lower(c.nombre) || '%'))
          or ($2::float8 is not null and $3::float8 is not null and c.ubicacion is not null
              and st_dwithin(c.ubicacion::geography,
                    st_setsrid(st_makepoint($3::float8, $2::float8), 4326)::geography, $5::float8))
        )
      order by distancia_m nulls last, c.nombre
      limit 10`,
    [nombre, lat, lon, args.excluir ?? null, radioM],
  )
  return rows.map((r) => ({
    comunidadId: r.id,
    nombre: r.nombre,
    municipio: r.municipio,
    distanciaM: r.distancia_m,
    verificado: r.verificado,
  }))
}

export type ComunidadRegistro = {
  id: string
  nombre: string
  municipio: string
  verificado: boolean
}

/** The caller's own-org communities, for the «correct an existing one» picker. */
export async function comunidadesDelRegistro(
  client: PoolClient,
  organizacionId: string,
): Promise<ComunidadRegistro[]> {
  const { rows } = await client.query<{
    id: string
    nombre: string
    municipio: string
    verificado: boolean
  }>(
    `select id, nombre, municipio, (verificado_en is not null) as verificado
       from comunidades
      where organizacion_id = $1 and activa
      order by (verificado_en is null) desc, municipio, nombre`,
    [organizacionId],
  )
  return rows
}

export type Propuesta = {
  id: string
  tipoPropuesta: 'correccion' | 'nueva'
  comunidadId: string | null
  comunidadActual: string | null
  comunidadMunicipio: string | null
  comunidadVerificada: boolean | null
  organizacion: string | null
  nombrePropuesto: string | null
  municipioPropuesto: string | null
  tipoComunidadPropuesto: string | null
  lat: number | null
  lon: number | null
  ubicacionPrecisionM: number | null
  existeReal: boolean | null
  motivo: string
  estado: 'pendiente' | 'aceptada' | 'rechazada'
  propuestoPorNombre: string | null
  creadoEn: Date
  resueltoEn: Date | null
  notaResolucion: string | null
}

/** Every proposal the caller may see (RLS decides), pending first. */
export async function propuestasVisibles(client: PoolClient): Promise<Propuesta[]> {
  const { rows } = await client.query<{
    id: string
    tipo_propuesta: 'correccion' | 'nueva'
    comunidad_id: string | null
    comunidad_actual: string | null
    comunidad_municipio: string | null
    comunidad_verificada: boolean | null
    organizacion: string | null
    nombre_propuesto: string | null
    municipio_propuesto: string | null
    tipo_comunidad_propuesto: string | null
    lat: number | null
    lon: number | null
    ubicacion_precision_m: number | null
    existe_real: boolean | null
    motivo: string
    estado: 'pendiente' | 'aceptada' | 'rechazada'
    propuesto_por_nombre: string | null
    creado_en: Date
    resuelto_en: Date | null
    nota_resolucion: string | null
  }>(
    `select pr.id,
            pr.tipo_propuesta,
            pr.comunidad_id,
            c.nombre                       as comunidad_actual,
            c.municipio                    as comunidad_municipio,
            (c.verificado_en is not null)  as comunidad_verificada,
            org.nombre                     as organizacion,
            pr.nombre_propuesto,
            pr.municipio_propuesto,
            pr.tipo_comunidad_propuesto,
            st_y(pr.ubicacion_propuesta::geometry) as lat,
            st_x(pr.ubicacion_propuesta::geometry) as lon,
            pr.ubicacion_precision_m,
            pr.existe_real,
            pr.motivo,
            pr.estado,
            ct.nombre                      as propuesto_por_nombre,
            pr.creado_en,
            pr.resuelto_en,
            pr.nota_resolucion
       from registro_propuestas pr
       left join comunidades c on c.id = pr.comunidad_id
       left join organizaciones org on org.id = pr.organizacion_id
       left join usuarios u on u.id = pr.propuesto_por
       left join contactos ct on ct.id = u.contacto_id
      order by (pr.estado = 'pendiente') desc, pr.creado_en desc
      limit 100`,
  )
  return rows.map((r) => ({
    id: r.id,
    tipoPropuesta: r.tipo_propuesta,
    comunidadId: r.comunidad_id,
    comunidadActual: r.comunidad_actual,
    comunidadMunicipio: r.comunidad_municipio,
    comunidadVerificada: r.comunidad_verificada,
    organizacion: r.organizacion,
    nombrePropuesto: r.nombre_propuesto,
    municipioPropuesto: r.municipio_propuesto,
    tipoComunidadPropuesto: r.tipo_comunidad_propuesto,
    lat: r.lat,
    lon: r.lon,
    ubicacionPrecisionM: r.ubicacion_precision_m,
    existeReal: r.existe_real,
    motivo: r.motivo,
    estado: r.estado,
    propuestoPorNombre: r.propuesto_por_nombre,
    creadoEn: r.creado_en,
    resueltoEn: r.resuelto_en,
    notaResolucion: r.nota_resolucion,
  }))
}

/**
 * Record a proposal. A correction points at an existing community and proposes at least one change;
 * a new-community proposal names the place and its municipality. A coordinate, when given, is stored
 * with source `manual` and the radius the proposer entered (2.2 — never a point without its radius).
 */
export async function crearPropuesta(
  client: PoolClient,
  args: {
    tipoPropuesta: 'correccion' | 'nueva'
    organizacionId: string
    propuestoPor: string
    comunidadId?: string | null
    nombrePropuesto?: string | null
    municipioPropuesto?: string | null
    tipoComunidadPropuesto?: string | null
    lat?: number | null
    lon?: number | null
    ubicacionPrecisionM?: number | null
    existeReal?: boolean | null
    motivo: string
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const motivo = (args.motivo ?? '').trim()
  if (!motivo) return { ok: false, error: 'Diga por qué propone esta corrección.' }

  const nombre = (args.nombrePropuesto ?? '').trim() || null
  const municipio = (args.municipioPropuesto ?? '').trim() || null
  const tipoComunidad = (args.tipoComunidadPropuesto ?? '').trim() || null
  const lat = args.lat ?? null
  const lon = args.lon ?? null
  const tienePunto = lat != null && lon != null
  const precision = args.ubicacionPrecisionM ?? null
  const existeReal = args.existeReal ?? null

  if (tienePunto && (precision == null || precision <= 0)) {
    return { ok: false, error: 'Una ubicación necesita su radio de precisión en metros (2.2).' }
  }

  if (args.tipoPropuesta === 'correccion') {
    if (!args.comunidadId) return { ok: false, error: 'Elija la comunidad a corregir.' }
    if (!nombre && !tienePunto && existeReal == null) {
      return { ok: false, error: 'Una corrección propone al menos un cambio: nombre, ubicación o existencia.' }
    }
  } else {
    if (!nombre) return { ok: false, error: 'Nombre la comunidad que propone.' }
    if (!municipio) return { ok: false, error: 'Diga en qué municipio queda.' }
  }

  try {
    await client.query(
      `insert into registro_propuestas
         (tipo_propuesta, comunidad_id, organizacion_id, propuesto_por,
          nombre_propuesto, municipio_propuesto, tipo_comunidad_propuesto,
          ubicacion_propuesta, ubicacion_fuente, ubicacion_precision_m, existe_real, motivo)
       values (
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7,
         case when $8::float8 is null or $9::float8 is null
              then null
              else st_setsrid(st_makepoint($9::float8, $8::float8), 4326) end,
         case when $8::float8 is null or $9::float8 is null then null else 'manual' end,
         case when $8::float8 is null or $9::float8 is null then null else $10::int end,
         $11,
         $12
       )`,
      [
        args.tipoPropuesta,
        args.tipoPropuesta === 'correccion' ? args.comunidadId : null,
        args.organizacionId,
        args.propuestoPor,
        nombre,
        args.tipoPropuesta === 'nueva' ? municipio : null,
        args.tipoPropuesta === 'nueva' ? tipoComunidad : null,
        lat,
        lon,
        precision,
        existeReal,
        motivo,
      ],
    )
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'No se pudo registrar la propuesta.' }
  }
}

const MENSAJE_RESOLUCION: Record<string, string> = {
  sin_sesion: 'La sesión expiró. Vuelva a entrar.',
  no_existe: 'Esa propuesta ya no existe.',
  ya_resuelta: 'Esa propuesta ya fue resuelta por alguien más.',
  sin_permiso: 'Su rol no puede resolver propuestas de esta comunidad.',
}

/**
 * Accept or reject a proposal. Accepting a correction applies the change and stamps
 * `verificado_en`; accepting a new-community proposal creates the community, already verified.
 * Delegates to the SECURITY DEFINER function, which enforces the coordinador/admin gate.
 */
export async function resolverPropuesta(
  client: PoolClient,
  args: { propuestaId: string; aceptar: boolean; nota?: string | null },
): Promise<{ ok: true; resultado: string } | { ok: false; error: string }> {
  try {
    const { rows } = await client.query<{ r: string }>(
      `select convite_resolver_propuesta_registro($1, $2, $3) as r`,
      [args.propuestaId, args.aceptar, (args.nota ?? '').trim() || null],
    )
    const r = rows[0]?.r ?? 'no_existe'
    if (r === 'aceptada' || r === 'rechazada') return { ok: true, resultado: r }
    return { ok: false, error: MENSAJE_RESOLUCION[r] ?? 'No se pudo resolver la propuesta.' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'No se pudo resolver la propuesta.' }
  }
}
