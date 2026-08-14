import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { emparejar } from '@/lib/matching/persistencia'

/**
 * The persistence half of M2, against a real database:
 * `pnpm db:up && pnpm db:reset && pnpm test`.
 *
 * The pure resolver is covered in emparejador.test.ts. What matters here is the narrow set
 * of writes the engine is allowed to make — and, above all, the ones it is not (2.1).
 *
 * Everything runs inside a transaction that is always rolled back.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

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

async function unaFila<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const { rows } = await client.query<T>(sql, params)
  return rows[0] ?? null
}

conBase('el emparejador sobre la cuenca sembrada', () => {
  it('clasifica todos los pedidos abiertos y deja de haber ABIERTOs entregables', async () => {
    const resumen = await emparejar(client, { temporada: 'lluvias' })
    expect(resumen.evaluados).toBeGreaterThan(0)

    const restantes = await unaFila<{ n: string }>(
      `select count(*)::text as n
         from pedidos p join catalogo_items ci on ci.codigo = p.codigo_item
        where p.estado = 'ABIERTO' and ci.entregable`,
    )
    expect(restantes!.n).toBe('0')
  })

  it('le pone a cada pedido una frase que un coordinador puede leer', async () => {
    const { rows } = await client.query<{ motivo: string | null }>(
      `select motivo from pedidos where estado <> 'ENTREGADO'`,
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const fila of rows) {
      expect(fila.motivo).toBeTruthy()
      expect(fila.motivo).not.toMatch(/SIN_|undefined|null|NaN/)
    }
  })

  it('propone emparejamientos sin confirmarlos (2.1)', async () => {
    const sinConfirmar = await unaFila<{ n: string }>(
      `select count(*)::text as n from emparejamientos where confirmado_por is not null`,
    )
    expect(sinConfirmar!.n).toBe('0')

    const listos = await unaFila<{ n: string }>(
      `select count(*)::text as n from pedidos where estado = 'LISTO'`,
    )
    const propuestos = await unaFila<{ n: string }>(
      `select count(distinct pedido_id)::text as n from emparejamientos`,
    )
    expect(propuestos!.n).toBe(listos!.n)
  })

  it('no mueve existencias ni compromete capacidades', async () => {
    const antes = await unaFila<{ existencias: string; capacidades: string }>(
      `select (select coalesce(sum(cantidad), 0)::text from existencias) as existencias,
              (select count(*)::text from capacidades where estado = 'OFRECIDA') as capacidades`,
    )
    await emparejar(client, { temporada: 'lluvias' })
    const despues = await unaFila<{ existencias: string; capacidades: string }>(
      `select (select coalesce(sum(cantidad), 0)::text from existencias) as existencias,
              (select count(*)::text from capacidades where estado = 'OFRECIDA') as capacidades`,
    )
    expect(despues).toEqual(antes)
  })

  it('registra en auditoría los cambios de estado, sin actor', async () => {
    const { rows } = await client.query<{ actor_id: string | null }>(
      `select actor_id from auditoria where accion = 'emparejador.reclasifico'`,
    )
    expect(rows.length).toBeGreaterThan(0)
    // El emparejador no es una persona. Las filas que sí son decisión de alguien llevan id.
    for (const fila of rows) expect(fila.actor_id).toBeNull()
  })

  it('es idempotente: una segunda corrida no cambia nada', async () => {
    const segunda = await emparejar(client, { temporada: 'lluvias' })
    expect(segunda.cambiados).toBe(0)
  })
})

conBase('lo que el emparejador respeta', () => {
  it('no vuelve a tocar un pedido despachado', async () => {
    const pedido = await unaFila<{ id: string }>(
      `select id from pedidos where estado = 'LISTO' limit 1`,
    )
    if (!pedido) return

    await client.query(`update pedidos set estado = 'EN_CAMINO' where id = $1`, [pedido.id])
    await emparejar(client, { temporada: 'lluvias' })

    const despues = await unaFila<{ estado: string }>(`select estado from pedidos where id = $1`, [
      pedido.id,
    ])
    expect(despues!.estado).toBe('EN_CAMINO')
  })

  it('borra propuestas viejas pero nunca una confirmada', async () => {
    const propuesta = await unaFila<{ id: string; pedido_id: string }>(
      `select id, pedido_id from emparejamientos limit 1`,
    )
    if (!propuesta) return

    const usuario = await unaFila<{ id: string }>(`select id from usuarios limit 1`)
    await client.query(
      `update emparejamientos set confirmado_por = $2, confirmado_en = now() where id = $1`,
      [propuesta.id, usuario!.id],
    )

    // Cambia el mundo por debajo: se acaba la existencia que sostenía la propuesta.
    await client.query(`update existencias set cantidad = 0`)
    await emparejar(client, { temporada: 'lluvias' })

    const sigue = await unaFila<{ id: string }>(
      `select id from emparejamientos where id = $1`,
      [propuesta.id],
    )
    expect(sigue).not.toBeNull()
  })
})
