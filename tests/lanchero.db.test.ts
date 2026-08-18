import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cargarBandeja } from '@/lib/verificacion/bandeja'

/**
 * FR-46 (lancha: costo y pago al lanchero) + PRD-47 (red de lancheros para relevo de datos),
 * against the real database. Same harness as tests/aportante.db.test.ts: one transaction, always
 * rolled back; every case runs as the `authenticated` Postgres role with a JWT claim set, exactly
 * how a signed-in session reaches Postgres through conSesion().
 *
 * Run: `pnpm db:up && pnpm db:reset && DATABASE_URL=… pnpm test lanchero`.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

let pool: Pool
let client: PoolClient

const COORD = randomUUID()
const DESPACHADOR = randomUUID()
const VERIFICADOR = randomUUID()
const LECTURA = randomUUID()

let ANCHOR = ''
let COM_A = '' // on the lanchero's route
let COM_B = '' // NOT on the lanchero's route — the vetting boundary
let LANCHERO = '' // contactos.rol = 'lanchero', registered for COM_A only
let NO_LANCHERO = '' // an ordinary contact, never registered as a lanchero
let TRASLADO = '' // a person-transport leg, for pagos_lanchero to attach to
let ENVIO: string | null = null // a goods-shipment leg, if the seed left one

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

async function unVal<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await client.query(sql, params)
  return Object.values(rows[0] ?? {})[0] as T
}

async function contar(sql: string, params: unknown[] = []): Promise<number> {
  return Number(await unVal<string>(sql, params))
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

  await client.query(
    `insert into usuarios (id, rol_staff, organizacion_id) values
       ($1, 'coordinador', $4), ($2, 'despachador', $4), ($3, 'verificador', $4)`,
    [COORD, DESPACHADOR, VERIFICADOR, ANCHOR],
  )
  await client.query(
    `insert into usuarios (id, rol_staff, organizacion_id) values ($1, 'lectura', $2)`,
    [LECTURA, ANCHOR],
  )

  const { rows: coms } = await client.query<{ id: string }>(
    `select id from comunidades where organizacion_id = $1 and activa order by nombre limit 2`,
    [ANCHOR],
  )
  if (coms.length < 2) throw new Error('Se necesitan al menos dos comunidades sembradas para esta prueba.')
  COM_A = coms[0]!.id
  COM_B = coms[1]!.id

  const { rows: t } = await client.query<{ id: string }>(
    `insert into traslados_persona
       (organizacion_id, persona_etiqueta, personas, motivo_categoria,
        origen_comunidad_id, destino_comunidad_id, ventana_desde, ventana_hasta, creado_por)
     values ($1, 'Prueba FR-46', 1, 'otro', $2, $3, now(), now() + interval '1 day', $4)
     returning id`,
    [ANCHOR, COM_A, COM_B, COORD],
  )
  TRASLADO = t[0]!.id

  const { rows: e } = await client.query<{ id: string }>('select id from envios limit 1')
  ENVIO = e[0]?.id ?? null

  const { rows: l } = await client.query<{ id: string }>(
    `insert into contactos (telefono, nombre, rol) values ('+573001112200', 'Don Lanchero', 'lanchero')
     returning id`,
  )
  LANCHERO = l[0]!.id
  await client.query(
    `insert into lancheros_comunidades (lanchero_contacto_id, comunidad_id) values ($1, $2)`,
    [LANCHERO, COM_A],
  )

  const { rows: nl } = await client.query<{ id: string }>(
    `insert into contactos (telefono, nombre, rol) values ('+573001112201', 'No es lanchero', 'reportante')
     returning id`,
  )
  NO_LANCHERO = nl[0]!.id
})

afterAll(async () => {
  if (!url) return
  await client.query('rollback')
  client.release()
  await pool.end()
})

// ─────────────────────────────────────────────────────────────────────────────────────────────

conBase('pagos_lanchero — FR-46 costo y pago al lanchero', () => {
  it('un coordinador registra el costo y el pago para un tramo (AC #1)', async () => {
    await como(COORD, async () => {
      const { rows } = await client.query<{ id: string; estado_pago: string }>(
        `insert into pagos_lanchero
           (organizacion_id, traslado_persona_id, lanchero_contacto_id, costo_total_cop,
            monto_lanchero_cop, creado_por)
         values ($1, $2, $3, 150000, 120000, $4)
         returning id, estado_pago`,
        [ANCHOR, TRASLADO, LANCHERO, COORD],
      )
      expect(rows[0]!.estado_pago).toBe('pendiente')
    })
  })

  it('exige exactamente un tramo — ninguno de los dos falla', async () => {
    expect(
      await rechazado(
        `insert into pagos_lanchero
           (organizacion_id, lanchero_contacto_id, monto_lanchero_cop, creado_por)
         values ($1, $2, 90000, $3)`,
        [ANCHOR, LANCHERO, COORD],
      ),
    ).toBe(true)
  })

  it('exige exactamente un tramo — los dos a la vez también falla', async () => {
    if (!ENVIO) return // el seed no dejó ningún envío; el caso de un solo tramo ya lo cubre.
    expect(
      await rechazado(
        `insert into pagos_lanchero
           (organizacion_id, envio_id, traslado_persona_id, lanchero_contacto_id,
            monto_lanchero_cop, creado_por)
         values ($1, $2, $3, $4, 90000, $5)`,
        [ANCHOR, ENVIO, TRASLADO, LANCHERO, COORD],
      ),
    ).toBe(true)
  })

  it('el monto para el lanchero debe ser mayor que cero', async () => {
    expect(
      await rechazado(
        `insert into pagos_lanchero
           (organizacion_id, traslado_persona_id, lanchero_contacto_id, monto_lanchero_cop, creado_por)
         values ($1, $2, $3, 0, $4)`,
        [ANCHOR, TRASLADO, LANCHERO, COORD],
      ),
    ).toBe(true)
  })

  it('un pago puede adjuntarse a un envío cuando hay uno sembrado', async () => {
    if (!ENVIO) return
    await como(DESPACHADOR, async () => {
      const { rowCount } = await client.query(
        `insert into pagos_lanchero
           (organizacion_id, envio_id, lanchero_contacto_id, monto_lanchero_cop, creado_por)
         values ($1, $2, $3, 80000, $4)`,
        [ANCHOR, ENVIO, LANCHERO, DESPACHADOR],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('verificador y lectura no ven pagos_lanchero — es escritorio de despacho, no lectura (RLS)', async () => {
    await como(VERIFICADOR, async () => {
      expect(await contar('select count(*)::text from pagos_lanchero')).toBe(0)
    })
    await como(LECTURA, async () => {
      expect(await contar('select count(*)::text from pagos_lanchero')).toBe(0)
    })
  })

  it('coordinador y despachador SÍ ven los pagos de su organización (contraste con RLS)', async () => {
    await como(COORD, async () => {
      await client.query(
        `insert into pagos_lanchero
           (organizacion_id, traslado_persona_id, lanchero_contacto_id, monto_lanchero_cop, creado_por)
         values ($1, $2, $3, 40000, $4)`,
        [ANCHOR, TRASLADO, LANCHERO, COORD],
      )
      expect(await contar('select count(*)::text from pagos_lanchero')).toBeGreaterThanOrEqual(1)
    })
  })

  it('marcar pagado exige quién y cuándo — un UPDATE crudo sin ellos falla el check (2.1)', async () => {
    const { rows } = await client.query<{ id: string }>(
      `insert into pagos_lanchero
         (organizacion_id, traslado_persona_id, lanchero_contacto_id, monto_lanchero_cop, creado_por)
       values ($1, $2, $3, 50000, $4) returning id`,
      [ANCHOR, TRASLADO, LANCHERO, COORD],
    )
    const id = rows[0]!.id
    expect(
      await rechazado(`update pagos_lanchero set estado_pago = 'pagado' where id = $1`, [id]),
    ).toBe(true)
  })

  it('marcar pagado con nombre y hora funciona, y el estado queda pagado (AC #2)', async () => {
    await como(COORD, async () => {
      const { rows } = await client.query<{ id: string }>(
        `insert into pagos_lanchero
           (organizacion_id, traslado_persona_id, lanchero_contacto_id, monto_lanchero_cop, creado_por)
         values ($1, $2, $3, 60000, $4) returning id`,
        [ANCHOR, TRASLADO, LANCHERO, COORD],
      )
      const id = rows[0]!.id
      await client.query(
        `update pagos_lanchero set estado_pago = 'pagado', pagado_por = $2, pagado_en = now() where id = $1`,
        [id, COORD],
      )
      expect(await unVal<string>('select estado_pago from pagos_lanchero where id = $1', [id])).toBe(
        'pagado',
      )
    })
  })
})

conBase('lancheros_comunidades + registrar_reporte_relevo — PRD-47 red de lancheros', () => {
  it('un despachador no puede registrar un relevo — no es el escritorio de intake (AC gate)', async () => {
    await como(DESPACHADOR, async () => {
      expect(
        await rechazado('select * from registrar_reporte_relevo($1, $2, null, 4, 2, $3, null)', [
          LANCHERO,
          COM_A,
          'Prueba',
        ]),
      ).toBe(true)
    })
  })

  it('el contacto debe estar registrado como lanchero', async () => {
    await como(COORD, async () => {
      expect(
        await rechazado('select * from registrar_reporte_relevo($1, $2, null, null, null, $3, null)', [
          NO_LANCHERO,
          COM_A,
          'Prueba',
        ]),
      ).toBe(true)
    })
  })

  it('la vetting boundary: un lanchero no puede relevar por una comunidad fuera de su ruta', async () => {
    await como(COORD, async () => {
      expect(
        await rechazado('select * from registrar_reporte_relevo($1, $2, null, null, null, $3, null)', [
          LANCHERO,
          COM_B,
          'Prueba fuera de ruta',
        ]),
      ).toBe(true)
    })
  })

  it('un coordinador SÍ releva un reporte por una comunidad de la ruta del lanchero (AC #2)', async () => {
    await como(COORD, async () => {
      const { rows } = await client.query<{ reporte_id: string; folio: number }>(
        `select reporte_id, folio from registrar_reporte_relevo($1, $2, null, 6, 2, $3, null)`,
        [LANCHERO, COM_A, 'Lo que trajo el lanchero'],
      )
      expect(rows[0]!.folio).toBeGreaterThan(0)

      const fila = (
        await client.query<{ canal: string; relevo_lanchero_id: string; comunidad_id: string }>(
          `select canal, relevo_lanchero_id, comunidad_id from reportes where id = $1`,
          [rows[0]!.reporte_id],
        )
      ).rows[0]!
      // The relay chain (AC #3): both who relayed it and the origin community are on the row.
      expect(fila.canal).toBe('relevo')
      expect(fila.relevo_lanchero_id).toBe(LANCHERO)
      expect(fila.comunidad_id).toBe(COM_A)
    })
  })

  it('la bandeja de verificación trae el nombre del lanchero que relevó (AC #3, PRD-47)', async () => {
    // The verifier card shows the origin community and the «relevo de lanchero» badge from the
    // report's own columns — this is the one field cargarBandeja has to join for, since a
    // relayed report carries no `contacto_id` (it is attributed to the lanchero, not a reporter).
    await como(COORD, async () => {
      await client.query(
        `select * from registrar_reporte_relevo($1, $2, null, 5, 2, $3, null)`,
        [LANCHERO, COM_A, 'Para la bandeja'],
      )
      const bandeja = await cargarBandeja(client)
      const fila = bandeja.pendientes.find((r) => r.canal === 'relevo' && r.detalleLibre === 'Para la bandeja')
      expect(fila).toBeDefined()
      expect(fila!.relevoLancheroNombre).toBe('Don Lanchero')
      // A relayed report never carries a reporting contact — the relaying lanchero is the only name.
      expect(fila!.contacto).toBeNull()
    })
  })

  it('un verificador también puede relevar — mismo escritorio que la entrada manual', async () => {
    await como(VERIFICADOR, async () => {
      const { rows } = await client.query<{ folio: number }>(
        `select folio from registrar_reporte_relevo($1, $2, null, null, null, $3, null)`,
        [LANCHERO, COM_A, 'Segundo relevo'],
      )
      expect(rows[0]!.folio).toBeGreaterThan(0)
    })
  })
})
