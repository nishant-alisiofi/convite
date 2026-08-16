import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * §5.9 connection points, against the real database.
 *
 * Two things this proves. First, the boundary: a connection point is org-scoped, coordinator-
 * written, read by any staff role in the same organisation and by nobody else — the same shape
 * as the inventory and route tables it sits beside. Second, and the reason the table exists at
 * all: `puntos_conexion` is SEPARATE from `nodos`, so connectivity and supply never converge
 * into one silent record even when one person runs both (§5.9).
 *
 * Skipped when DATABASE_URL is absent so a clone with no Postgres still has a green suite.
 * Everything writes inside a transaction that is always rolled back; the fixtures are created
 * here rather than leaned on from the seed, so the test says what it depends on.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

const ORG_A = '00000000-0000-4000-a000-0000000000a1'
const ORG_B = '00000000-0000-4000-a000-0000000000b1'
const COM_A = '00000000-0000-4000-a000-0000000000c1'
const COM_A2 = '00000000-0000-4000-a000-0000000000c2'
const PUNTO_A = '00000000-0000-4000-a000-0000000000f1'

const ID = {
  coordA: '00000000-0000-4000-a000-000000000001',
  adminA: '00000000-0000-4000-a000-000000000002',
  verifA: '00000000-0000-4000-a000-000000000003',
  lecturaA: '00000000-0000-4000-a000-000000000004',
  coordB: '00000000-0000-4000-a000-000000000005',
  intruso: '00000000-0000-4000-a000-000000000099',
} as const

type Rol = keyof typeof ID

let pool: Pool
let client: PoolClient

beforeAll(async () => {
  if (!url) return
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  })
  client = await pool.connect()
  await client.query('begin')

  await client.query(
    `insert into organizaciones (id, nombre, estado_aprobacion)
       values ($1, 'Org A · prueba conexión', 'aprobada'),
              ($2, 'Org B · prueba conexión', 'aprobada')`,
    [ORG_A, ORG_B],
  )

  await client.query(
    `insert into comunidades (id, organizacion_id, codigo, nombre, tipo, municipio)
       values ($1, $3, 'PCX-A', 'Comunidad A', 'vereda', 'Quibdó'),
              ($2, $3, 'PCX-A2', 'Comunidad A2', 'vereda', 'Quibdó')`,
    [COM_A, COM_A2, ORG_A],
  )

  await client.query(
    `insert into usuarios (id, rol_staff, organizacion_id) values
       ($1, 'coordinador', $6), ($2, 'admin', $6), ($3, 'verificador', $6),
       ($4, 'lectura', $6), ($5, 'coordinador', $7)`,
    [ID.coordA, ID.adminA, ID.verifA, ID.lecturaA, ID.coordB, ORG_A, ORG_B],
  )

  // A point in org A, with one served community. Created as owner so the visibility cases below
  // are about reading it, not about who could write it.
  await client.query(
    `insert into puntos_conexion
       (id, organizacion_id, nombre, tipo, tiene_senal, seguridad, privacidad,
        permanencia, accesibilidad, energia, costo, notas)
     values ($1, $2, 'Tienda del río', 'tienda', true, 'alto', 'bajo',
             'medio', 'bajo', 'medio', 'bajo', '2h en lancha; el dueño cobra por llamada')`,
    [PUNTO_A, ORG_A],
  )
  await client.query(
    `insert into puntos_conexion_comunidades (punto_id, comunidad_id) values ($1, $2)`,
    [PUNTO_A, COM_A],
  )
})

afterAll(async () => {
  if (!url) return
  await client.query('rollback')
  client.release()
  await pool.end()
})

/** Runs `fn` as a signed-in session for `rol`; unwinds to a savepoint so cases don't leak. */
async function como<T>(rol: Rol, fn: () => Promise<T>): Promise<T> {
  await client.query('savepoint sesion')
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: ID[rol], role: 'authenticated', email: `${rol}@convite.test` }),
  ])
  await client.query('set local role authenticated')
  try {
    return await fn()
  } finally {
    await client.query('rollback to savepoint sesion')
  }
}

/** True when the statement was refused — missing grant, WITH CHECK, RLS filter, or a constraint. */
async function rechazado(sql: string, params: unknown[] = []): Promise<boolean> {
  await client.query('savepoint intento')
  try {
    const { rowCount } = await client.query(sql, params)
    await client.query('rollback to savepoint intento')
    return rowCount === 0
  } catch {
    await client.query('rollback to savepoint intento')
    return true
  }
}

async function contar(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await client.query<{ n: string }>(sql, params)
  return Number(rows[0]!.n)
}

conBase('el punto de conexión es un registro aparte del nodo de suministro (§5.9)', () => {
  it('`puntos_conexion` y `nodos` son dos tablas distintas, no una fusionada', async () => {
    const { rows } = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name in ('puntos_conexion', 'nodos')
        order by table_name`,
    )
    expect(rows.map((r) => r.table_name)).toEqual(['nodos', 'puntos_conexion'])
  })

  it('un punto de conexión nunca aparece como nodo de suministro', async () => {
    const enNodos = await contar(`select count(*)::text as n from nodos where id = $1`, [PUNTO_A])
    expect(enNodos).toBe(0)
  })
})

conBase('el alcance del punto de conexión (org-scoped, escritura de coordinación)', () => {
  it('un coordinador crea un punto en su propia organización', async () => {
    await como('coordA', async () => {
      const { rowCount } = await client.query(
        `insert into puntos_conexion (organizacion_id, nombre, tipo, seguridad)
           values ($1, 'Muelle nuevo', 'muelle', 'medio')`,
        [ORG_A],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('un verificador lo lee, pero no lo escribe', async () => {
    await como('verifA', async () => {
      expect(
        await contar(
          `select count(*)::text as n from puntos_conexion where organizacion_id = $1`,
          [ORG_A],
        ),
      ).toBeGreaterThan(0)
      expect(
        await rechazado(
          `insert into puntos_conexion (organizacion_id, nombre) values ($1, 'No debería')`,
          [ORG_A],
        ),
      ).toBe(true)
    })
  })

  it('un coordinador no puede crear un punto en otra organización', async () => {
    await como('coordA', async () => {
      expect(
        await rechazado(
          `insert into puntos_conexion (organizacion_id, nombre) values ($1, 'Ajeno')`,
          [ORG_B],
        ),
      ).toBe(true)
    })
  })

  it('otra organización no ve el punto: el alcance es por organización', async () => {
    await como('coordB', async () => {
      expect(await contar(`select count(*)::text as n from puntos_conexion`)).toBe(0)
      expect(
        await contar(`select count(*)::text as n from puntos_conexion where id = $1`, [PUNTO_A]),
      ).toBe(0)
    })
  })

  it('`lectura` y una sesión sin invitación no ven ningún punto', async () => {
    await como('lecturaA', async () => {
      expect(await contar(`select count(*)::text as n from puntos_conexion`)).toBe(0)
    })
    await como('intruso', async () => {
      expect(await contar(`select count(*)::text as n from puntos_conexion`)).toBe(0)
    })
  })
})

conBase('las comunidades a las que sirve un punto', () => {
  it('un coordinador de la organización enlaza una comunidad', async () => {
    await como('coordA', async () => {
      const { rowCount } = await client.query(
        `insert into puntos_conexion_comunidades (punto_id, comunidad_id) values ($1, $2)`,
        [PUNTO_A, COM_A2],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('un coordinador de otra organización no enlaza nada al punto ajeno', async () => {
    await como('coordB', async () => {
      expect(
        await rechazado(
          `insert into puntos_conexion_comunidades (punto_id, comunidad_id) values ($1, $2)`,
          [PUNTO_A, COM_A2],
        ),
      ).toBe(true)
    })
  })

  it('un verificador de la organización ve el enlace ya existente', async () => {
    await como('verifA', async () => {
      expect(
        await contar(
          `select count(*)::text as n from puntos_conexion_comunidades where punto_id = $1`,
          [PUNTO_A],
        ),
      ).toBeGreaterThan(0)
    })
  })
})

conBase('los seis juicios y la ubicación se validan en la base (§5.9, 2.2)', () => {
  it('rechaza un nivel fuera del vocabulario', async () => {
    await como('coordA', async () => {
      expect(
        await rechazado(
          `insert into puntos_conexion (organizacion_id, nombre, seguridad)
             values ($1, 'Nivel malo', 'altísimo')`,
          [ORG_A],
        ),
      ).toBe(true)
    })
  })

  it('rechaza un costo fuera del vocabulario', async () => {
    await como('coordA', async () => {
      expect(
        await rechazado(
          `insert into puntos_conexion (organizacion_id, nombre, costo)
             values ($1, 'Costo malo', 'carísimo')`,
          [ORG_A],
        ),
      ).toBe(true)
    })
  })

  it('rechaza una coordenada sin fuente declarada (2.2)', async () => {
    await como('coordA', async () => {
      expect(
        await rechazado(
          `insert into puntos_conexion (organizacion_id, nombre, ubicacion)
             values ($1, 'Sin fuente', st_setsrid(st_makepoint(-76.65, 5.69), 4326))`,
          [ORG_A],
        ),
      ).toBe(true)
    })
  })
})

conBase('el piso de RLS del punto de conexión', () => {
  it('ambas tablas tienen RLS activo y anon no las alcanza', async () => {
    const { rows: rls } = await client.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in ('puntos_conexion', 'puntos_conexion_comunidades')
          and c.relrowsecurity
        order by c.relname`,
    )
    expect(rls.map((r) => r.relname)).toEqual(['puntos_conexion', 'puntos_conexion_comunidades'])

    const { rows: grants } = await client.query<{ table_name: string }>(
      `select table_name from information_schema.role_table_grants
        where grantee = 'anon' and table_schema = 'public'
          and table_name in ('puntos_conexion', 'puntos_conexion_comunidades')`,
    )
    expect(grants).toHaveLength(0)
  })
})
