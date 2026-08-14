import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { emparejar } from '@/lib/matching/persistencia'
import { CLAVE_TEMPORADA, fijarTemporada, temporadaVigente } from '@/lib/temporada'

/**
 * M8: the season stops being an environment variable.
 *
 * The reason this needs a database test rather than a unit test is that the whole point of
 * the change is the audit row and the RLS rule around it — neither of which exists outside
 * Postgres. And the reachability half is the actual risk: getting the season wrong raises
 * no error anywhere, it just quietly removes Winandó from the basin.
 *
 * Everything runs inside a transaction that is always rolled back.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

/** The seeded staff. Reusing them keeps the test honest about the real role set. */
const ADMIN = '00000000-0000-4000-8000-000000000004'
const COORDINADOR = '00000000-0000-4000-8000-000000000001'

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

/** Runs `fn` as a signed-in staff session, exactly as `conSesion` does in the app. */
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

conBase('la temporada como ajuste auditado', () => {
  it('arranca sembrada en lluvias y sin dueño', async () => {
    await client.query('savepoint caso')
    const { rows } = await client.query<{ valor: string; actualizado_por: string | null }>(
      `select valor, actualizado_por from configuracion where clave = $1`,
      [CLAVE_TEMPORADA],
    )
    expect(rows[0]!.valor).toBe('lluvias')
    // El valor por defecto no es la decisión de nadie.
    expect(rows[0]!.actualizado_por).toBeNull()
  })

  it('un admin la cambia y queda una fila de auditoría con su nombre', async () => {
    await client.query('savepoint caso')
    // `auditoria` es acumulativa por diseño, así que la aserción es sobre lo que añade
    // este cambio y no sobre el total histórico. Se compara por id y no por fecha porque
    // dentro de una transacción `now()` es la hora en que empezó la transacción, igual
    // para todas las filas que escriba el caso.
    const previas = await client.query<{ id: string }>(
      `select id from auditoria where accion = 'configuracion.cambio'`,
    )
    const yaVistas = previas.rows.map((f) => f.id)

    await como(ADMIN, () => fijarTemporada(client, 'seca', ADMIN))

    expect(await temporadaVigente(client)).toBe('seca')

    const { rows } = await client.query<{
      actor_id: string
      antes: { valor: string }
      despues: { valor: string }
    }>(
      `select actor_id, antes, despues from auditoria
        where accion = 'configuracion.cambio' and not (id = any($1::uuid[]))`,
      [yaVistas],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.actor_id).toBe(ADMIN)
    expect(rows[0]!.antes.valor).toBe('lluvias')
    expect(rows[0]!.despues.valor).toBe('seca')
  })

  it('un coordinador NO la cambia', async () => {
    await client.query('savepoint caso')
    await como(COORDINADOR, async () => {
      const { rowCount } = await client.query(
        `update configuracion set valor = 'seca', actualizado_por = $1 where clave = $2`,
        [COORDINADOR, CLAVE_TEMPORADA],
      )
      expect(rowCount).toBe(0)
    })
    expect(await temporadaVigente(client)).toBe('lluvias')
  })

  it('un admin no puede firmar el cambio con el nombre de otro', async () => {
    await client.query('savepoint caso')
    await como(ADMIN, async () => {
      // `actualizado_por = auth.uid()` en la política: se firma lo propio y nada más (2.1).
      // Un WITH CHECK que no se cumple levanta error, no filtra filas en silencio.
      await expect(
        client.query(
          `update configuracion set valor = 'seca', actualizado_por = $1 where clave = $2`,
          [COORDINADOR, CLAVE_TEMPORADA],
        ),
      ).rejects.toThrow(/row-level security/)
    })
  })

  it('la base rechaza una temporada que no existe', async () => {
    await client.query('savepoint caso')
    await expect(
      client.query(`update configuracion set valor = 'verano' where clave = $1`, [
        CLAVE_TEMPORADA,
      ]),
    ).rejects.toThrow(/configuracion_temporada_check/)
  })

  it('sin fila cae al entorno en vez de reventar', async () => {
    await client.query('savepoint caso')
    await client.query(`delete from configuracion where clave = $1`, [CLAVE_TEMPORADA])
    // Sin CONVITE_TEMPORADA en el entorno de pruebas, el respaldo es lluvias.
    expect(await temporadaVigente(client)).toBe('lluvias')
  })
})

conBase('cambiar la temporada cambia lo que el motor cree alcanzable', () => {
  /**
   * Winandó es el caso: se llega por el caño desde Las Mercedes, y esa chalupa solo existe
   * en `lluvias`. En `seca` no hay fila ninguna, así que la comunidad queda incomunicada —
   * y esa es exactamente la diferencia que un ajuste mal puesto esconde.
   */
  async function estadoDeWinando(): Promise<string> {
    const { rows } = await client.query<{ estado: string }>(
      `select p.estado
         from pedidos p join comunidades c on c.id = p.comunidad_id
        where c.codigo = 'WIN'`,
    )
    return rows[0]!.estado
  }

  it('en lluvias Winandó se alcanza; en seca queda SIN_RUTA', async () => {
    await client.query('savepoint caso')

    await emparejar(client, { temporada: await temporadaVigente(client) })
    const enLluvias = await estadoDeWinando()
    expect(enLluvias).not.toBe('SIN_RUTA')

    await como(ADMIN, () => fijarTemporada(client, 'seca', ADMIN))
    await emparejar(client, { temporada: await temporadaVigente(client) })

    expect(await estadoDeWinando()).toBe('SIN_RUTA')
  })
})
