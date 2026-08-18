import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buscarPersonas, LONGITUD_MINIMA_BUSQUEDA, personaPorId } from '@/lib/personas/busqueda'

/**
 * FR-42 acceptance, against the real database.
 *
 * «Searching a partial name returns matching people ... accent- and case-insensitive.»
 * «Searching a phone (local or E.164) returns the matching contact.»
 * «A result links to the person's reports / community; no PII is shown that the caller's role
 *  could not already see elsewhere.»
 * «Search returns quickly on the seeded dataset (indexed lookup, not a full scan).»
 *
 * Everything runs inside a transaction that is always rolled back.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

const COORDINADOR = '00000000-0000-4000-8000-000000000001'
const VERIFICADORA = '00000000-0000-4000-8000-000000000002'
const DESPACHADOR = '00000000-0000-4000-8000-000000000003'
const ADMIN = '00000000-0000-4000-8000-000000000004'
const LECTURA = '00000000-0000-4000-8000-000000000099'

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

  // A `lectura` session — same shape as rls.db.test.ts. contactos_lectura / comunidades_lectura
  // (0017) name neither this role, so it must come back with nothing, not a filtered version.
  const { rows } = await client.query<{ organizacion_id: string }>(
    'select organizacion_id from usuarios where id = $1',
    [COORDINADOR],
  )
  await client.query(
    `insert into usuarios (id, rol_staff, organizacion_id) values ($1, 'lectura', $2)`,
    [LECTURA, rows[0]!.organizacion_id],
  )
})

afterAll(async () => {
  if (!url) return
  await client.query('rollback')
  client.release()
  await pool.end()
})

afterEach(async () => {
  if (!url) return
  await client.query('rollback to savepoint caso').catch(() => {})
  await client.query('release savepoint caso').catch(() => {})
})

async function como<T>(usuarioId: string, fn: () => Promise<T>): Promise<T> {
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: usuarioId, role: 'authenticated', email: 'staff@convite.test' }),
  ])
  await client.query('set local role authenticated')
  try {
    return await fn()
  } finally {
    await client.query('reset role').catch(() => {})
  }
}

/** Marta Perea, +573000000003, comunidad Bellavista — seeded by db/seed/operacion.ts. */
async function marta(): Promise<{ id: string }> {
  const { rows } = await client.query<{ id: string }>(
    `select id from contactos where telefono = '+573000000003'`,
  )
  return rows[0]!
}

conBase('FR-42 — búsqueda de personas', () => {
  it('nombre parcial, sin tilde ni mayúscula, encuentra a la persona', async () => {
    await client.query('savepoint caso')
    const resultado = await como(COORDINADOR, () => buscarPersonas(client, 'marta'))
    expect(resultado.map((r) => r.nombre)).toContain('Marta Perea')
  })

  it('un término sin tilde encuentra un nombre que sí la lleva', async () => {
    // Élver Mosquera — searching the unaccented, lowercase form must still hit it.
    await client.query('savepoint caso')
    const resultado = await como(COORDINADOR, () => buscarPersonas(client, 'elver'))
    expect(resultado.map((r) => r.nombre)).toContain('Élver Mosquera')
  })

  it('el mismo término en mayúsculas encuentra lo mismo', async () => {
    await client.query('savepoint caso')
    const resultado = await como(COORDINADOR, () => buscarPersonas(client, 'MARTA'))
    expect(resultado.map((r) => r.nombre)).toContain('Marta Perea')
  })

  it('teléfono local (sin indicativo) encuentra el contacto', async () => {
    await client.query('savepoint caso')
    const resultado = await como(COORDINADOR, () => buscarPersonas(client, '3000000003'))
    expect(resultado.map((r) => r.telefono)).toContain('+573000000003')
  })

  it('teléfono en E.164 completo encuentra el mismo contacto', async () => {
    await client.query('savepoint caso')
    const resultado = await como(COORDINADOR, () => buscarPersonas(client, '+573000000003'))
    expect(resultado.map((r) => r.telefono)).toContain('+573000000003')
  })

  it('nombre de comunidad encuentra a quienes viven ahí', async () => {
    await client.query('savepoint caso')
    const resultado = await como(COORDINADOR, () => buscarPersonas(client, 'bellavista'))
    expect(resultado.some((r) => r.nombre === 'Marta Perea')).toBe(true)
    for (const r of resultado) {
      expect(r.comunidadNombre).toBe('Bellavista')
    }
  })

  it('menos del mínimo de caracteres no consulta la base — regresa vacío', async () => {
    await client.query('savepoint caso')
    const corto = 'm'.repeat(LONGITUD_MINIMA_BUSQUEDA - 1)
    const resultado = await como(COORDINADOR, () => buscarPersonas(client, corto))
    expect(resultado).toEqual([])
  })

  it('un término sin dígitos y sin coincidencia de nombre no regresa "todo el mundo"', async () => {
    // Regression: telefono_digitos LIKE '%' || '' || '%' matches every row when the digits
    // guard is missing. A nonsense, all-letters term must come back empty, not the full table.
    await client.query('savepoint caso')
    const resultado = await como(COORDINADOR, () =>
      buscarPersonas(client, 'zzzznombrequenoexiste'),
    )
    expect(resultado).toEqual([])
  })

  it('un resultado no trae más columnas que las que ya se ven en Comunidades/Verificación', async () => {
    // contactos no tiene columna de dirección — no hay nada de eso que exponer aquí. Esta
    // prueba deja constancia del contrato: si algún día se agrega una columna sensible, este
    // set falla y obliga a decidir a propósito si busqueda.ts la expone.
    await client.query('savepoint caso')
    const [resultado] = await como(COORDINADOR, () => buscarPersonas(client, 'marta'))
    expect(Object.keys(resultado!).sort()).toEqual(
      [
        'id',
        'nombre',
        'telefono',
        'rol',
        'canalPreferido',
        'activo',
        'ultimoContactoEn',
        'comunidadId',
        'comunidadNombre',
        'comunidadCodigo',
        'comunidadMunicipio',
      ].sort(),
    )
  })

  it('`lectura` no ve nada — ni contactos ni comunidades le pertenecen (0017)', async () => {
    await client.query('savepoint caso')
    const resultado = await como(LECTURA, () => buscarPersonas(client, 'marta'))
    expect(resultado).toEqual([])
  })

  for (const rol of [DESPACHADOR, ADMIN, VERIFICADORA]) {
    it(`rol staff permitido (${rol}) sí ve el resultado`, async () => {
      await client.query('savepoint caso')
      const resultado = await como(rol, () => buscarPersonas(client, 'marta'))
      expect(resultado.map((r) => r.nombre)).toContain('Marta Perea')
    })
  }

  it('personaPorId trae la comunidad y los reportes de la persona', async () => {
    await client.query('savepoint caso')
    const { id } = await marta()
    const detalle = await como(COORDINADOR, () => personaPorId(client, id))
    expect(detalle?.nombre).toBe('Marta Perea')
    expect(detalle?.comunidadNombre).toBe('Bellavista')
    expect(detalle?.reportes.length).toBeGreaterThan(0)
  })

  it('personaPorId no revienta con un id que no existe', async () => {
    await client.query('savepoint caso')
    const detalle = await como(COORDINADOR, () =>
      personaPorId(client, '00000000-0000-4000-0000-000000000000'),
    )
    expect(detalle).toBeNull()
  })

  it('el índice trigram existe sobre las tres columnas normalizadas', async () => {
    await client.query('savepoint caso')
    const { rows } = await client.query<{ indexname: string }>(
      `select indexname from pg_indexes
        where schemaname = 'public'
          and indexname in (
            'contactos_nombre_normalizado_trgm_idx',
            'contactos_telefono_digitos_trgm_idx',
            'comunidades_nombre_normalizado_trgm_idx'
          )`,
    )
    expect(rows.map((r) => r.indexname).sort()).toEqual(
      [
        'contactos_nombre_normalizado_trgm_idx',
        'contactos_telefono_digitos_trgm_idx',
        'comunidades_nombre_normalizado_trgm_idx',
      ].sort(),
    )
  })

  it('la búsqueda por nombre es un plan de índice, no un recorrido completo', async () => {
    // AC #4: "indexed lookup, not a full scan". The seeded table is tiny enough that the
    // planner's own cost model prefers a seq scan — the honest proof is that the trigram
    // index is a VALID, USABLE plan for this exact query shape, forced with enable_seqscan.
    await client.query('savepoint caso')
    await client.query('set local enable_seqscan = off')
    const { rows } = await client.query<{ 'QUERY PLAN': string }>(
      `explain select id from contactos
        where nombre_normalizado like '%' || normaliza_busqueda('mosquera') || '%'`,
    )
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n')
    expect(plan).toContain('contactos_nombre_normalizado_trgm_idx')
  })
})
