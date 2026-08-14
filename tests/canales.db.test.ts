import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PROVEEDOR_SIMULADOR, recibirSimulado, registrarEntrante } from '@/lib/canales'
import { NOTA_DE_VOZ, TEXTO_LIBRE } from './fixtures/mensajes-entrantes'

/**
 * Non-negotiable 2.7, against the real index.
 *
 * The M5 acceptance line is «the same webhook payload twice creates one row», and the only
 * way to prove it is against the partial unique index in 0003 — a mock cannot fail the way
 * Postgres fails. Skipped without DATABASE_URL, and everything runs inside a transaction
 * that is always rolled back.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

let pool: Pool
let client: PoolClient
let organizacionId: string

beforeAll(async () => {
  if (!url) return
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  })
  client = await pool.connect()
  await client.query('begin')

  const { rows } = await client.query<{ id: string }>('select id from organizaciones limit 1')
  const id = rows[0]?.id
  if (!id) throw new Error("No hay ninguna organización. ¿Corrió 'pnpm db:seed'?")
  organizacionId = id
})

afterAll(async () => {
  if (!url) return
  await client.query('rollback')
  client.release()
  await pool.end()
})

async function contarPorIdExterno(idExterno: string): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    'select count(*) as n from mensajes where proveedor = $1 and proveedor_mensaje_id = $2',
    [PROVEEDOR_SIMULADOR, idExterno],
  )
  return Number(rows[0]!.n)
}

conBase('la bitácora descarta duplicados', () => {
  it('el mismo payload dos veces deja una sola fila', async () => {
    // Providers retry. This is the M5 acceptance line, and the reason the insert is the
    // check rather than a SELECT somebody remembered to write first.
    const sobre = recibirSimulado(TEXTO_LIBRE)

    const primero = await registrarEntrante(client, sobre, organizacionId)
    const segundo = await registrarEntrante(client, sobre, organizacionId)

    expect(primero.estado).toBe('registrado')
    expect(segundo.estado).toBe('duplicado')
    expect(await contarPorIdExterno(sobre.idExterno)).toBe(1)
  })

  it('dos mensajes distintos siguen siendo dos', async () => {
    const otro = recibirSimulado(NOTA_DE_VOZ)
    const resultado = await registrarEntrante(client, otro, organizacionId)

    expect(resultado.estado).toBe('registrado')
    expect(await contarPorIdExterno(otro.idExterno)).toBe(1)
  })

  it('guarda el sobre como mensaje entrante recibido', async () => {
    const sobre = recibirSimulado({ ...TEXTO_LIBRE, id: 'sim-tag-0009' })
    await registrarEntrante(client, sobre, organizacionId)

    const { rows } = await client.query<{
      direccion: string
      canal: string
      estado: string
      telefono: string
      cuerpo: string
      creado_en: Date
      payload: Record<string, unknown>
    }>(
      `select direccion, canal, estado, telefono, cuerpo, creado_en, payload
         from mensajes where proveedor = $1 and proveedor_mensaje_id = $2`,
      [PROVEEDOR_SIMULADOR, 'sim-tag-0009'],
    )

    const fila = rows[0]!
    expect(fila.direccion).toBe('entrante')
    expect(fila.canal).toBe('whatsapp')
    expect(fila.estado).toBe('recibido')
    expect(fila.telefono).toBe('+573000000001')
    expect(fila.cuerpo).toContain('mercados')
    // The moment the driver received it, not the moment we inserted the row.
    expect(fila.creado_en.toISOString()).toBe('2026-08-13T19:02:11.000Z')
    expect(fila.payload).toMatchObject({ id: 'sim-tag-0009' })
  })
})
