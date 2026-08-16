import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * PRD-11 — radio as an ingested fourth channel, against the real database.
 *
 * Three things this proves, in the doctrine's own terms (§2, §5.8):
 *   1. Radio is OFF by default. No attestation row means `convite_radio_permitido` is false and a
 *      relay cannot be recorded — the door is closed until someone opens it, with a name.
 *   2. An attestation EXPIRES, and while it is not vigente nothing ingests. Expired, not-safe and
 *      revoked are the same closed door; only a live, safe, unrevoked, unexpired row permits.
 *   3. A relay carries TWO people — the speaker and the operator who keyed it in — both recorded,
 *      and its report is second-hand, so it always needs a human verification before it becomes a
 *      pedido.
 *
 * Skipped when DATABASE_URL is absent so a clone with no Postgres still has a green suite.
 * Everything writes inside a transaction that is always rolled back; the fixtures are created
 * here rather than leaned on from the seed, so the test says what it depends on.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

const ORG_A = '00000000-0000-4000-b000-0000000000a1'
const ORG_B = '00000000-0000-4000-b000-0000000000b1'
const COM_ON = '00000000-0000-4000-b000-0000000000c1'
const COM_OFF = '00000000-0000-4000-b000-0000000000c2'
const COM_SCRATCH = '00000000-0000-4000-b000-0000000000c3'

const ID = {
  coordA: '00000000-0000-4000-b000-000000000001',
  adminA: '00000000-0000-4000-b000-000000000002',
  verifA: '00000000-0000-4000-b000-000000000003',
  lecturaA: '00000000-0000-4000-b000-000000000004',
  coordB: '00000000-0000-4000-b000-000000000005',
  intruso: '00000000-0000-4000-b000-000000000099',
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
       values ($1, 'Org A · prueba radio', 'aprobada'),
              ($2, 'Org B · prueba radio', 'aprobada')`,
    [ORG_A, ORG_B],
  )

  await client.query(
    `insert into comunidades (id, organizacion_id, codigo, nombre, tipo, municipio, tier_conectividad)
       values ($1, $4, 'RAD-ON', 'Playa Sola', 'vereda', 'Bajo Baudó', 4),
              ($2, $4, 'RAD-OFF', 'Río Seco', 'vereda', 'Bajo Baudó', 4),
              ($3, $4, 'RAD-SCR', 'Punta Cruz', 'vereda', 'Bajo Baudó', 4)`,
    [COM_ON, COM_OFF, COM_SCRATCH, ORG_A],
  )

  await client.query(
    `insert into usuarios (id, rol_staff, organizacion_id) values
       ($1, 'coordinador', $6), ($2, 'admin', $6), ($3, 'verificador', $6),
       ($4, 'lectura', $6), ($5, 'coordinador', $7)`,
    [ID.coordA, ID.adminA, ID.verifA, ID.lecturaA, ID.coordB, ORG_A, ORG_B],
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

/** Sets up and tears down an owner-level scenario in its own savepoint. */
async function escenario<T>(fn: () => Promise<T>): Promise<T> {
  await client.query('savepoint escena')
  try {
    return await fn()
  } finally {
    await client.query('rollback to savepoint escena')
  }
}

/** True when the statement was refused — a grant, a WITH CHECK, an RLS filter, a trigger, a check. */
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

async function permitido(comunidad: string, org: string): Promise<boolean> {
  const { rows } = await client.query<{ ok: boolean }>(
    `select convite_radio_permitido($1, $2) as ok`,
    [comunidad, org],
  )
  return rows[0]!.ok
}

/** Creates a canal=radio report as owner and returns its id, so a relay can reference it directly. */
async function reporteRadio(comunidad: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into reportes (organizacion_id, tipo, canal, comunidad_id)
       values ($1, 'sin_clasificar', 'radio', $2) returning id`,
    [ORG_A, comunidad],
  )
  return rows[0]!.id
}

const ATESTAR_VALIDA = (com: string) =>
  client.query(
    `insert into radio_permitido
       (organizacion_id, comunidad_id, atestado_por, red_descrita, uso_seguro, atestado_en, expira_en)
     values ($1, $2, $3, 'VHF marino de lancheros', true, now(), now() + interval '6 months')`,
    [ORG_A, com, ID.coordA],
  )

conBase('la radio está apagada por defecto (§2, §5.8)', () => {
  it('sin atestación, la comunidad no está habilitada', async () => {
    expect(await permitido(COM_OFF, ORG_A)).toBe(false)
  })

  it('un coordinador no puede registrar un relevo en una comunidad apagada', async () => {
    await como('coordA', async () => {
      const rechazo = await rechazado(
        `select registrar_relevo_radio($1, 'Élver Mosquera', 'Aristóbulo Mena', 'algo llegó')`,
        [COM_OFF],
      )
      expect(rechazo).toBe(true)
    })
  })

  it('ni siquiera un insert directo entra sin permiso: el gatillo lo bloquea', async () => {
    await escenario(async () => {
      const reporte = await reporteRadio(COM_OFF)
      const rechazo = await rechazado(
        `insert into radio_relevos
           (reporte_id, organizacion_id, comunidad_id, hablante, operador, capturado_por)
         values ($1, $2, $3, 'Élver', 'Aristóbulo', $4)`,
        [reporte, ORG_A, COM_OFF, ID.coordA],
      )
      expect(rechazo).toBe(true)
    })
  })
})

conBase('la atestación caduca, y mientras no esté vigente no ingiere nada', () => {
  it('una atestación vencida no habilita, aunque la red sea segura', async () => {
    await escenario(async () => {
      await client.query(
        `insert into radio_permitido
           (organizacion_id, comunidad_id, atestado_por, red_descrita, uso_seguro, atestado_en, expira_en)
         values ($1, $2, $3, 'VHF marino', true, now() - interval '7 months', now() - interval '1 month')`,
        [ORG_A, COM_SCRATCH, ID.coordA],
      )
      expect(await permitido(COM_SCRATCH, ORG_A)).toBe(false)
      await como('coordA', async () => {
        expect(
          await rechazado(
            `select registrar_relevo_radio($1, 'Élver', 'Aristóbulo', 'llegó por radio')`,
            [COM_SCRATCH],
          ),
        ).toBe(true)
      })
    })
  })

  it('una red existente pero de uso no seguro tampoco habilita', async () => {
    await escenario(async () => {
      await client.query(
        `insert into radio_permitido
           (organizacion_id, comunidad_id, atestado_por, red_descrita, uso_seguro)
         values ($1, $2, $3, 'VHF marino', false)`,
        [ORG_A, COM_SCRATCH, ID.coordA],
      )
      expect(await permitido(COM_SCRATCH, ORG_A)).toBe(false)
    })
  })

  it('una atestación revocada deja de habilitar', async () => {
    await escenario(async () => {
      await ATESTAR_VALIDA(COM_SCRATCH)
      expect(await permitido(COM_SCRATCH, ORG_A)).toBe(true)
      await client.query(
        `update radio_permitido set revocado_en = now(), revocado_por = $2
          where comunidad_id = $1`,
        [COM_SCRATCH, ID.coordA],
      )
      expect(await permitido(COM_SCRATCH, ORG_A)).toBe(false)
    })
  })

  it('una atestación viva, segura y sin vencer sí habilita, y entonces el relevo entra', async () => {
    await escenario(async () => {
      await ATESTAR_VALIDA(COM_ON)
      expect(await permitido(COM_ON, ORG_A)).toBe(true)
      const reporte = await reporteRadio(COM_ON)
      const { rowCount } = await client.query(
        `insert into radio_relevos
           (reporte_id, organizacion_id, comunidad_id, hablante, operador, capturado_por)
         values ($1, $2, $3, 'Élver', 'Aristóbulo', $4)`,
        [reporte, ORG_A, COM_ON, ID.coordA],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('el vencimiento no puede ser anterior a la atestación', async () => {
    await escenario(async () => {
      expect(
        await rechazado(
          `insert into radio_permitido
             (organizacion_id, comunidad_id, atestado_por, red_descrita, uso_seguro, atestado_en, expira_en)
           values ($1, $2, $3, 'VHF', true, now(), now() - interval '1 day')`,
          [ORG_A, COM_SCRATCH, ID.coordA],
        ),
      ).toBe(true)
    })
  })
})

conBase('un relevo trae dos personas y exige verificación (§5.8)', () => {
  it('registra al hablante y al operador, y nace de segunda mano y sin verificar', async () => {
    await escenario(async () => {
      await ATESTAR_VALIDA(COM_ON)
      await como('coordA', async () => {
        const { rows } = await client.query<{ reporte_id: string; folio: number }>(
          `select reporte_id, folio
             from registrar_relevo_radio($1, 'Custodia Palacios (partera)', 'Aristóbulo Mena (operador de radio)', 'pañales talla 2, dos familias')`,
          [COM_ON],
        )
        const reporteId = rows[0]!.reporte_id
        expect(rows[0]!.folio).toBeGreaterThan(0)

        // Two people, both recorded on the relay row.
        const { rows: rel } = await client.query<{ hablante: string; operador: string }>(
          `select hablante, operador from radio_relevos where reporte_id = $1`,
          [reporteId],
        )
        expect(rel[0]!.hablante).toBe('Custodia Palacios (partera)')
        expect(rel[0]!.operador).toBe('Aristóbulo Mena (operador de radio)')

        // The report is a radio report, second-hand, and unverified — waiting in the queue.
        const { rows: rep } = await client.query<{
          canal: string
          estado: string
          segunda_mano: boolean | null
          verificado_por: string | null
        }>(
          `select canal, estado, (payload_crudo->>'segunda_mano')::boolean as segunda_mano, verificado_por
             from reportes where id = $1`,
          [reporteId],
        )
        expect(rep[0]!.canal).toBe('radio')
        expect(rep[0]!.estado).toBe('RECIBIDO')
        expect(rep[0]!.segunda_mano).toBe(true)
        expect(rep[0]!.verificado_por).toBeNull()

        // Requires verification: it cannot become verified without a named verifier…
        expect(
          await rechazado(`update reportes set estado = 'VERIFICADO' where id = $1`, [reporteId]),
        ).toBe(true)
        // …but with a name and a time it can. That name is the whole point (2.1).
        const { rowCount } = await client.query(
          `update reportes set estado = 'VERIFICADO', verificado_por = $2, verificado_en = now()
            where id = $1`,
          [reporteId, ID.coordA],
        )
        expect(rowCount).toBe(1)
      })
    })
  })

  it('rechaza un relevo sin operador: un relevo nombra a las dos personas', async () => {
    await escenario(async () => {
      await ATESTAR_VALIDA(COM_ON)
      await como('coordA', async () => {
        expect(
          await rechazado(`select registrar_relevo_radio($1, 'Custodia', '', 'algo')`, [COM_ON]),
        ).toBe(true)
      })
    })
  })

  it('rechaza un relevo sin hablante', async () => {
    await escenario(async () => {
      await ATESTAR_VALIDA(COM_ON)
      await como('coordA', async () => {
        expect(
          await rechazado(`select registrar_relevo_radio($1, '', 'Aristóbulo', 'algo')`, [COM_ON]),
        ).toBe(true)
      })
    })
  })
})

conBase('el alcance por organización y el piso de RLS', () => {
  it('una atestación es de la organización que la hizo: otra no la ve', async () => {
    await escenario(async () => {
      await ATESTAR_VALIDA(COM_ON)
      await como('coordB', async () => {
        expect(
          await contar(`select count(*)::text as n from radio_permitido where comunidad_id = $1`, [
            COM_ON,
          ]),
        ).toBe(0)
      })
    })
  })

  it('un coordinador de otra organización no puede atestar en una comunidad ajena', async () => {
    await como('coordB', async () => {
      expect(
        await rechazado(
          `insert into radio_permitido (organizacion_id, comunidad_id, atestado_por, red_descrita, uso_seguro)
             values ($1, $2, $3, 'VHF', true)`,
          [ORG_A, COM_ON, ID.coordB],
        ),
      ).toBe(true)
    })
  })

  it('un rol de lectura no puede atestar', async () => {
    await como('lecturaA', async () => {
      expect(
        await rechazado(
          `insert into radio_permitido (organizacion_id, comunidad_id, atestado_por, red_descrita, uso_seguro)
             values ($1, $2, $3, 'VHF', true)`,
          [ORG_A, COM_ON, ID.lecturaA],
        ),
      ).toBe(true)
    })
  })

  it('ambas tablas tienen RLS activo y anon no las alcanza', async () => {
    const { rows: rls } = await client.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in ('radio_permitido', 'radio_relevos')
          and c.relrowsecurity
        order by c.relname`,
    )
    expect(rls.map((r) => r.relname)).toEqual(['radio_permitido', 'radio_relevos'])

    const { rows: grants } = await client.query<{ table_name: string }>(
      `select table_name from information_schema.role_table_grants
        where grantee = 'anon' and table_schema = 'public'
          and table_name in ('radio_permitido', 'radio_relevos')`,
    )
    expect(grants).toHaveLength(0)
  })
})
