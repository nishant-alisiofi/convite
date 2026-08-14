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

  it('siembra 13 comunidades con centroide declarado', async () => {
    const { rows } = await client.query<{ n: string; fuentes: string[] }>(
      `select count(*)::text as n, array_agg(distinct ubicacion_fuente) as fuentes from comunidades`,
    )
    expect(rows[0]!.n).toBe('13')
    expect(rows[0]!.fuentes).toEqual(['centroide'])
  })

  it('siembra el catálogo completo', async () => {
    const { rows } = await client.query<{ n: string }>('select count(*)::text as n from catalogo_items')
    expect(rows[0]!.n).toBe('26')
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
    const origen = await unId('comunidades', "codigo = 'QBD'")
    const destino = await unId('comunidades', "codigo = 'BTA'")
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
})

conBase('2.4 — el borde público es de la base de datos', () => {
  it('la vista pública no expone ubicación, nombre ni teléfono', async () => {
    const { rows } = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'mapa_publico'`,
    )
    const columnas = rows.map((r) => r.column_name).sort()
    expect(columnas).toEqual(['agrupador', 'atendidos', 'familia_label', 'municipio', 'pendientes'])
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
