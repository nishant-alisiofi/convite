import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Acceptance for M1, run against a real database: `pnpm db:up && pnpm db:reset && pnpm test`.
 *
 * Skipped when DATABASE_URL is absent so a clone with no Postgres still has a green suite.
 * Everything here writes inside a transaction that is always rolled back.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

let pool: Pool
let client: PoolClient

beforeAll(async () => {
  if (!url) return
  pool = new Pool({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false } })
  client = await pool.connect()
  await client.query('begin')
})

afterAll(async () => {
  if (!url) return
  await client.query('rollback')
  client.release()
  await pool.end()
})

/** Runs a statement expecting it to be rejected, then unwinds cleanly. */
async function esperaRechazo(sql: string, params: unknown[] = []): Promise<string> {
  await client.query('savepoint prueba')
  try {
    await client.query(sql, params)
    await client.query('rollback to savepoint prueba')
    throw new Error('La base aceptó una fila que debía rechazar.')
  } catch (error) {
    await client.query('rollback to savepoint prueba')
    const mensaje = error instanceof Error ? error.message : String(error)
    if (mensaje.includes('debía rechazar')) throw error
    return mensaje
  }
}

async function unId(tabla: string, where = 'true'): Promise<string> {
  const { rows } = await client.query<{ id: string }>(`select id from ${tabla} where ${where} limit 1`)
  const id = rows[0]?.id
  if (!id) throw new Error(`No hay filas en ${tabla}. ¿Corrió 'pnpm db:seed'?`)
  return id
}

conBase('la cuenca queda consultable', () => {
  it('tiene PostGIS', async () => {
    const { rows } = await client.query("select 1 from pg_extension where extname = 'postgis'")
    expect(rows).toHaveLength(1)
  })

  it('siembra una sola comunidad por lugar real, con fuente declarada (PRD-39)', async () => {
    // PRD-39: staging carries ONE community set — the real registry (sembrar:territorio) — and
    // the demo activity layers onto it. It used to carry the registry AND a parallel demo set,
    // so a real place appeared twice (two Quibdós, two Bellavistas). The guard is that no two
    // rows share (nombre, municipio): a duplicate real place would fail here immediately.
    const { rows } = await client.query<{
      n: string
      lugares: string
      codigos: string
      fuentes: string[]
      sin_fuente: string
    }>(
      `select count(*)::text as n,
              count(distinct (nombre, municipio))::text as lugares,
              count(distinct codigo)::text as codigos,
              array_agg(distinct ubicacion_fuente order by ubicacion_fuente) as fuentes,
              count(*) filter (where ubicacion is null or ubicacion_fuente is null)::text as sin_fuente
         from comunidades`,
    )
    // One row per real place, one row per code: zero duplicates.
    expect(rows[0]!.lugares).toBe(rows[0]!.n)
    expect(rows[0]!.codigos).toBe(rows[0]!.n)
    // The real registry (63 comunidades) plus the five river/coast places PRD-39 promoted into
    // it (Sivirú, Docampadó, Bebedó, Samurindó, Puerto Conto).
    expect(Number(rows[0]!.n)).toBe(68)
    // Non-negotiable 2.2: every stored point declares an honest source — nothing left blank.
    expect(Number(rows[0]!.sin_fuente)).toBe(0)
    for (const f of rows[0]!.fuentes) {
      expect(['centroide', 'gps', 'referida', 'manual']).toContain(f)
    }
    // The registry is centroids at heart; radio-relayed places carry a wider `referida` circle.
    expect(rows[0]!.fuentes).toContain('centroide')
  })

  it('siembra el catálogo completo', async () => {
    const { rows } = await client.query<{ n: string }>('select count(*)::text as n from catalogo_items')
    // The registry (sembrar:territorio) carries the full 34-item response catalogue of
    // ASOREDIPARCHOCÓ; the demo's CATALOGO_SEMILLA (26) is a subset upserted onto it by code,
    // so the unified database holds the registry's 34 with zero duplicates.
    expect(rows[0]!.n).toBe('34')
  })

  it('responde la pregunta que importa: qué hay y a qué distancia', async () => {
    const { rows } = await client.query(
      `select c.nombre, e.codigo_item, e.cantidad, e.contado_en, r.minutos, r.modo
         from existencias e
         join nodos n on n.id = e.nodo_id
         join comunidades c on c.id = n.comunidad_id
         join rutas r on r.origen_id = c.id
        where e.codigo_item = '11' and e.cantidad > 0 and r.activa
        limit 5`,
    )
    expect(rows.length).toBeGreaterThan(0)
  })
})

conBase('las no negociables están en la base, no en el frontend', () => {
  it('2.2 — rechaza una coordenada sin fuente declarada', async () => {
    const organizacionId = await unId('organizaciones')
    const mensaje = await esperaRechazo(
      `insert into reportes (organizacion_id, tipo, canal, ubicacion)
         values ($1, 'necesidad', 'whatsapp', st_setsrid(st_makepoint(-76.6, 5.7), 4326))`,
      [organizacionId],
    )
    expect(mensaje).toContain('reportes_ubicacion_declarada_check')
  })

  it('2.2 — rechaza un pin GPS con radio distinto de cero', async () => {
    const organizacionId = await unId('organizaciones')
    const mensaje = await esperaRechazo(
      `insert into reportes (organizacion_id, tipo, canal, ubicacion, ubicacion_fuente, ubicacion_precision_m)
         values ($1, 'necesidad', 'whatsapp', st_setsrid(st_makepoint(-76.6, 5.7), 4326), 'gps', 1000)`,
      [organizacionId],
    )
    expect(mensaje).toContain('reportes_gps_exacto_check')
  })

  it('2.5 — rechaza una foto sin EXIF removido', async () => {
    const reporteId = await unId('reportes')
    const mensaje = await esperaRechazo(
      `insert into adjuntos (reporte_id, tipo, storage_key, exif_removido)
         values ($1, 'foto', 'adjuntos/2026/foto.jpg', false)`,
      [reporteId],
    )
    expect(mensaje).toContain('adjuntos_exif_check')
  })

  it('2.6 — rechaza guardar la URL del proveedor en vez de nuestra llave', async () => {
    const reporteId = await unId('reportes')
    const mensaje = await esperaRechazo(
      `insert into adjuntos (reporte_id, tipo, storage_key)
         values ($1, 'audio', 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=abc')`,
      [reporteId],
    )
    expect(mensaje).toContain('adjuntos_no_url_proveedor_check')
  })

  it('2.7 — rechaza el mismo mensaje del proveedor dos veces', async () => {
    const organizacionId = await unId('organizaciones')
    await client.query(
      `insert into mensajes (organizacion_id, proveedor, proveedor_mensaje_id, direccion, canal)
         values ($1, 'whatsapp_cloud', 'wamid.PRUEBA', 'entrante', 'whatsapp')`,
      [organizacionId],
    )
    const mensaje = await esperaRechazo(
      `insert into mensajes (organizacion_id, proveedor, proveedor_mensaje_id, direccion, canal)
         values ($1, 'whatsapp_cloud', 'wamid.PRUEBA', 'entrante', 'whatsapp')`,
      [organizacionId],
    )
    expect(mensaje).toContain('mensajes_proveedor_id_key')
  })

  it('7.3 — rechaza un tramo fluvial derivado de Google', async () => {
    const origen = await unId('comunidades', "codigo = 'CH-QUI'")
    const destino = await unId('comunidades', "codigo = 'CH-QUI-TAN'")
    const mensaje = await esperaRechazo(
      `insert into rutas (origen_id, destino_id, modo, minutos, temporada, fuente)
         values ($1, $2, 'lancha', 40, 'todo_el_ano', 'google')`,
      [origen, destino],
    )
    expect(mensaje).toContain('rutas_fluvial_manual_check')
  })

  it('2.1 — rechaza un envío despachado sin nombre ni hora', async () => {
    const responsable = await unId('contactos', "rol = 'transportista'")
    const nodo = await unId('nodos')
    const mensaje = await esperaRechazo(
      `insert into envios (codigo, modo, responsable_id, origen_nodo_id, cupo_familias, estado)
         values ('ENV-PRUEBA', 'lancha', $1, $2, 30, 'DESPACHADO')`,
      [responsable, nodo],
    )
    expect(mensaje).toContain('envios_despacho_check')
  })

  it('2.3 — no admite una existencia sin fecha ni responsable de conteo', async () => {
    const nodo = await unId('nodos')
    const mensaje = await esperaRechazo(
      `insert into existencias (nodo_id, codigo_item, cantidad) values ($1, '11', 10)`,
      [nodo],
    )
    expect(mensaje).toMatch(/contado_en|contado_por/)
  })

  it('FR-45 — familia_ayuda solo admite alimentos/medicinas/construcción, o nada', async () => {
    const mensaje = await esperaRechazo(
      `update catalogo_items set familia_ayuda = 'ropa' where codigo = '11'`,
    )
    expect(mensaje).toContain('catalogo_items_familia_ayuda_check')
  })

  it('FR-45 — la familia de Vivienda (materiales) del catálogo real resuelve a construcción', async () => {
    const { rows } = await client.query<{ n: string }>(
      `select count(*)::text as n from catalogo_items where familia = '7' and familia_ayuda <> 'construccion'`,
    )
    expect(rows[0]!.n).toBe('0')
  })

  it('FR-45 — un daño no es un bien de ayuda: familia_ayuda se queda honesto en null', async () => {
    const { rows } = await client.query<{ n: string }>(
      `select count(*)::text as n from catalogo_items where tipo = 'dano' and familia_ayuda is not null`,
    )
    expect(rows[0]!.n).toBe('0')
  })

  it('FR-43 — un lote sin fecha es legítimo (2.3, BUG-23): fecha_caducidad no es NOT NULL', async () => {
    const existencia = await unId('existencias')
    const usuario = await unId('usuarios')
    const { rows } = await client.query<{ fecha_caducidad: Date | null }>(
      `insert into existencia_lotes (existencia_id, cantidad, contado_por)
         values ($1, 3, $2) returning fecha_caducidad`,
      [existencia, usuario],
    )
    expect(rows[0]!.fecha_caducidad).toBeNull()
  })

  it('FR-43 — un lote rechaza cantidad cero o negativa', async () => {
    const existencia = await unId('existencias')
    const usuario = await unId('usuarios')
    const mensaje = await esperaRechazo(
      `insert into existencia_lotes (existencia_id, cantidad, contado_por) values ($1, 0, $2)`,
      [existencia, usuario],
    )
    expect(mensaje).toContain('existencia_lotes_cantidad_check')
  })

  it('FR-44 — una farmacia solo lleva una fila de existencia por ítem', async () => {
    const usuario = await unId('usuarios')
    const { rows: proveedor } = await client.query<{ id: string; organizacion_id: string }>(
      `select id, organizacion_id from proveedores_locales where es_farmacia limit 1`,
    )
    if (proveedor.length === 0) throw new Error('No hay farmacia sembrada. ¿Corrió pnpm db:seed?')
    const mensaje = await esperaRechazo(
      `insert into proveedor_existencias (organizacion_id, proveedor_id, codigo_item, cantidad, contado_por)
         values ($1, $2, '21', 1, $3)`,
      [proveedor[0]!.organizacion_id, proveedor[0]!.id, usuario],
    )
    expect(mensaje).toContain('proveedor_existencias_proveedor_item_key')
  })
})

conBase('2.4 — el borde público es de la base de datos', () => {
  it('la vista pública no expone ubicación, nombre ni teléfono', async () => {
    const { rows } = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'mapa_publico'`,
    )
    const columnas = rows.map((r) => r.column_name).sort()
    // PRD D6 took `agrupador` out: municipality is as fine-grained as the public surface
    // gets, because a sub-municipal grouping is a handful of settlements.
    expect(columnas).toEqual(['atendidos', 'familia_label', 'municipio', 'pendientes'])
  })

  it('anon no alcanza ninguna tabla de Convite', async () => {
    // Se excluyen los objetos de una extensión: `spatial_ref_sys` y `geometry_columns` son
    // de PostGIS, pertenecen a supabase_admin y no podemos revocarles nada desde el rol
    // postgres. No contienen ninguna fila de Convite. Ver 0015 para cómo cerrarlos.
    const { rows } = await client.query<{ table_name: string }>(
      `select distinct g.table_name
         from information_schema.role_table_grants g
         join pg_class c on c.relname = g.table_name
         join pg_namespace n on n.oid = c.relnamespace and n.nspname = g.table_schema
        where g.grantee = 'anon'
          and g.table_schema = 'public'
          and not exists (
            select 1 from pg_depend d
             where d.classid = 'pg_class'::regclass
               and d.objid = c.oid
               and d.deptype = 'e'
          )
        order by g.table_name`,
    )
    expect(rows.map((r) => r.table_name)).toEqual(['mapa_publico'])
  })

  it('y sobre la vista pública solo puede leer', async () => {
    const { rows } = await client.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where grantee = 'anon' and table_schema = 'public' and table_name = 'mapa_publico'`,
    )
    expect(rows.map((r) => r.privilege_type)).toEqual(['SELECT'])
  })

  it('RLS está activo en todas las tablas base', async () => {
    // Excluye las tablas que pertenecen a una extensión: `spatial_ref_sys` es de PostGIS,
    // no nuestra, y no podemos ponerle RLS. Sí se le revocó el acceso a anon en 0013.
    const { rows } = await client.query<{ tablename: string }>(
      `select c.relname as tablename
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and not c.relrowsecurity
          and not exists (
            select 1 from pg_depend d
             where d.classid = 'pg_class'::regclass
               and d.objid = c.oid
               and d.deptype = 'e'
          )
        order by c.relname`,
    )
    expect(rows.map((r) => r.tablename)).toEqual([])
  })
})
