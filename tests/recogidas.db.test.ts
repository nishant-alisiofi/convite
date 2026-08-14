import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { planearRecogida } from '@/lib/recogidas/plan'

/**
 * M8 acceptance: «six offers in three neighbourhoods produce one ordered run».
 *
 * The seeded donations sit two apiece in Yesquita, Roma and Niño Jesús — about a kilometre
 * between barrios and under a hundred metres within one. What this asserts is that they
 * come back as one numbered run rather than six errands, and that the order is the one a
 * driver should actually drive.
 *
 * Everything runs inside a transaction that is always rolled back.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

const COORDINADOR = '00000000-0000-4000-8000-000000000001'
const DESPACHADOR = '00000000-0000-4000-8000-000000000003'
const VERIFICADORA = '00000000-0000-4000-8000-000000000002'

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

async function bodega(): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `select id from nodos where nombre = 'Bodega Central Quibdó'`,
  )
  return rows[0]!.id
}

conBase('la vuelta de recogida', () => {
  it('seis ofrecimientos en tres barrios dan una sola vuelta ordenada', async () => {
    await client.query('savepoint caso')
    const nodo = await bodega()

    const plan = await como(COORDINADOR, () => planearRecogida(client, nodo))

    expect(plan.paradas).toHaveLength(6)
    expect(plan.grupos).toBe(3)
    // Una vuelta: las paradas van numeradas de corrido, no seis mandados sueltos.
    expect(plan.paradas.map((p) => p.orden)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('cada barrio se recorre de una vez, sin volver sobre lo andado', async () => {
    await client.query('savepoint caso')
    const nodo = await bodega()

    const grupos = (await como(COORDINADOR, () => planearRecogida(client, nodo))).paradas.map(
      (p) => p.grupo,
    )
    // Los grupos aparecen en bloques contiguos: 1,1,2,2,3,3 y nunca 1,2,1.
    const bloques = grupos.filter((g, i) => i === 0 || grupos[i - 1] !== g)
    expect(bloques).toEqual([...new Set(grupos)])
    expect(bloques).toHaveLength(3)
  })

  it('lo perecedero encabeza la vuelta: fija la hora de salida', async () => {
    await client.query('savepoint caso')
    const nodo = await bodega()

    const plan = await como(COORDINADOR, () => planearRecogida(client, nodo))
    const primero = plan.paradas[0]!
    expect(primero.perecedero).toBe(true)
    expect(primero.ofrecidoPor).toBe('Restaurante El Sabor Chocoano')
    // Y su barrio entero se recoge de primero, no solo su parada.
    expect(plan.paradas[1]!.grupo).toBe(primero.grupo)
  })

  it('después de lo perecedero, primero lo más cerca', async () => {
    await client.query('savepoint caso')
    const nodo = await bodega()

    const plan = await como(COORDINADOR, () => planearRecogida(client, nodo))
    const distanciaMinimaPorGrupo = [1, 2, 3].map((g) =>
      Math.min(...plan.paradas.filter((p) => p.grupo === g).map((p) => p.metrosAlNodo)),
    )
    // El grupo 1 lo puso el vencimiento; entre el 2 y el 3 manda la distancia.
    expect(distanciaMinimaPorGrupo[1]!).toBeLessThan(distanciaMinimaPorGrupo[2]!)
  })

  it('un ofrecimiento fuera del alcance no entra en la vuelta', async () => {
    await client.query('savepoint caso')
    const nodo = await bodega()

    // Bellavista está a más de cien kilómetros: es una entrega, no una recogida en pueblo.
    await client.query(
      `insert into ofertas (contacto_id, texto_original, codigo_item, cantidad, estado,
                            necesita_recogida, ubicacion, ubicacion_fuente, ubicacion_precision_m)
       select id, 'tengo diez mercados por acá lejos', '11', 10, 'DISPONIBLE', true,
              st_setsrid(st_makepoint(-76.8917, 6.5561), 4326), 'gps', 0
         from contactos where telefono = '+573000000010'`,
    )

    const plan = await como(COORDINADOR, () => planearRecogida(client, nodo))
    expect(plan.paradas).toHaveLength(6)
  })
})

conBase('quién puede ver dónde vive quien dona', () => {
  it('un coordinador que planea la vuelta ve la dirección', async () => {
    await client.query('savepoint caso')
    const nodo = await bodega()

    const plan = await como(COORDINADOR, () => planearRecogida(client, nodo))
    expect(plan.paradas.every((p) => p.direccion !== null)).toBe(true)
  })

  it('un despachador no obtiene ni la vuelta', async () => {
    await client.query('savepoint caso')
    const nodo = await bodega()

    // 2.16: una dirección junto a un nombre y «tiene mercado» es un blanco. La función no
    // devuelve nada, así que ni siquiera se entera de cuántos ofrecimientos hay.
    const plan = await como(DESPACHADOR, () => planearRecogida(client, nodo))
    expect(plan.paradas).toHaveLength(0)
  })

  it('una verificadora tampoco', async () => {
    await client.query('savepoint caso')
    const nodo = await bodega()

    const plan = await como(VERIFICADORA, () => planearRecogida(client, nodo))
    expect(plan.paradas).toHaveLength(0)
  })
})
