import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * PRD-9 — the six-step chain's closing evidence cannot skip ahead of verification, against the
 * real database. Same harness as tests/lanchero.db.test.ts: one transaction, always rolled back,
 * every case running as `authenticated` with a JWT claim set exactly like a signed-in session.
 *
 * The bug this pins down: `compra_local_evidencias_agrega` (0049) checked role + org, nothing
 * else, so a `foto`/`documento`/`acta` row — step 6's closing evidence — could be filed while a
 * purchase was still `AUTORIZADA` or `COMPRADA`, before verification (step 4) ever happened.
 * Migration 0060 adds the missing condition to the same policy.
 *
 * Run: `pnpm db:up && pnpm db:reset && DATABASE_URL=… pnpm test compra-local.db`.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

let pool: Pool
let client: PoolClient

const COORD = randomUUID()

let ANCHOR = ''
let RESPONSABLE = '' // contactos row, the territorial responsible (step 2)
let FONDO = ''
let COMPRA = '' // a compras_locales row, advanced through the chain per test

/** Point the current transaction at `uid` as a signed-in authenticated session (no savepoint). */
async function claims(uid: string, email = `${uid}@convite.test`): Promise<void> {
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: uid, role: 'authenticated', email }),
  ])
  await client.query('set local role authenticated')
}

/** Runs `fn` as `uid`, inside a savepoint that is always unwound (role and writes reset after). */
async function como<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await client.query('savepoint sesion')
  await claims(uid)
  try {
    return await fn()
  } finally {
    await client.query('rollback to savepoint sesion')
  }
}

/** True when a statement was refused — by a grant, a WITH CHECK, RLS, or a raised exception. */
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

beforeAll(async () => {
  if (!url) return
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  })
  client = await pool.connect()
  await client.query('begin')

  const { rows: a } = await client.query<{ id: string }>(
    'select id from organizaciones order by creado_en limit 1',
  )
  ANCHOR = a[0]!.id

  await client.query(`insert into usuarios (id, rol_staff, organizacion_id) values ($1, 'coordinador', $2)`, [
    COORD,
    ANCHOR,
  ])

  const { rows: r } = await client.query<{ id: string }>(
    `insert into contactos (telefono, nombre, rol) values ('+573001112300', 'Responsable de zona', 'coordinador')
     returning id`,
  )
  RESPONSABLE = r[0]!.id

  const { rows: f } = await client.query<{ id: string }>(
    `insert into fondos_compra (organizacion_id, nombre, techo_cop, creado_por)
     values ($1, 'Fondo de prueba PRD-9', 50000000, $2) returning id`,
    [ANCHOR, COORD],
  )
  FONDO = f[0]!.id
})

afterAll(async () => {
  if (!url) return
  await client.query('rollback')
  client.release()
  await pool.end()
})

/** A fresh compra, `AUTORIZADA`, for a test that needs to control its own advance through the chain. */
async function nuevaCompra(): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into compras_locales
       (organizacion_id, fondo_id, responsable_id, concepto, monto_autorizado_cop, autorizado_por)
     values ($1, $2, $3, 'Compra de prueba', 100000, $4) returning id`,
    [ANCHOR, FONDO, RESPONSABLE, COORD],
  )
  return rows[0]!.id
}

// ─────────────────────────────────────────────────────────────────────────────────────────────

conBase('compra_local_evidencias — PRD-9 la evidencia de cierre no se adelanta a la verificación', () => {
  it('AUTORIZADA: una foto de cierre se rechaza — todavía no hay ni recibo', async () => {
    await como(COORD, async () => {
      COMPRA = await nuevaCompra()
      expect(
        await rechazado(
          `insert into compra_local_evidencias (compra_id, tipo, referencia, subido_por)
           values ($1, 'foto', 'foto-adelantada.jpg', $2)`,
          [COMPRA, COORD],
        ),
      ).toBe(true)
    })
  })

  it('COMPRADA: una foto de cierre se sigue rechazando — los materiales no están verificados (AC repro)', async () => {
    await como(COORD, async () => {
      const compra = await nuevaCompra()
      await client.query(
        `update compras_locales
            set estado = 'COMPRADA', recibo_ref = 'REC-001', comprado_por = $2, comprado_en = now()
          where id = $1`,
        [compra, COORD],
      )
      expect(
        await rechazado(
          `insert into compra_local_evidencias (compra_id, tipo, referencia, subido_por)
           values ($1, 'foto', 'foto-adelantada.jpg', $2)`,
          [compra, COORD],
        ),
      ).toBe(true)
    })
  })

  it('COMPRADA: el recibo mismo SÍ se puede archivar — es la evidencia del paso 3, no del 6', async () => {
    await como(COORD, async () => {
      const compra = await nuevaCompra()
      await client.query(
        `update compras_locales
            set estado = 'COMPRADA', recibo_ref = 'REC-002', comprado_por = $2, comprado_en = now()
          where id = $1`,
        [compra, COORD],
      )
      const { rowCount } = await client.query(
        `insert into compra_local_evidencias (compra_id, tipo, referencia, subido_por)
         values ($1, 'recibo', 'REC-002', $2)`,
        [compra, COORD],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('VERIFICADA: la foto de cierre ya se puede archivar (AC — la evidencia solo entra tras verificar)', async () => {
    await como(COORD, async () => {
      const compra = await nuevaCompra()
      await client.query(
        `update compras_locales
            set estado = 'VERIFICADA', recibo_ref = 'REC-003', comprado_por = $2, comprado_en = now(),
                verificado_por = $2, verificado_en = now()
          where id = $1`,
        [compra, COORD],
      )
      const { rowCount } = await client.query(
        `insert into compra_local_evidencias (compra_id, tipo, referencia, subido_por)
         values ($1, 'foto', 'foto-a-tiempo.jpg', $2)`,
        [compra, COORD],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('DISTRIBUIDA: un documento de cierre también se acepta', async () => {
    await como(COORD, async () => {
      const compra = await nuevaCompra()
      await client.query(
        `update compras_locales
            set estado = 'DISTRIBUIDA', recibo_ref = 'REC-004', comprado_por = $2, comprado_en = now(),
                verificado_por = $2, verificado_en = now(), distribuido_por = $2, distribuido_en = now()
          where id = $1`,
        [compra, COORD],
      )
      const { rowCount } = await client.query(
        `insert into compra_local_evidencias (compra_id, tipo, referencia, subido_por)
         values ($1, 'documento', 'acta-distribucion.pdf', $2)`,
        [compra, COORD],
      )
      expect(rowCount).toBe(1)
    })
  })
})
