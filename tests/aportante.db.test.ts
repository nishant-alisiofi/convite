import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * FR-18 (§29.2–29.3b) — the transporter self-signup, against the real database. The same harness
 * as tests/membresias.db.test.ts: one transaction, always rolled back; every case runs as the
 * `authenticated` Postgres role with a JWT claim set, exactly how a signed-in session reaches
 * Postgres through conSesion(). The two facts this proves are the acceptance of FR-18:
 *
 *   1. a self-signed transporter (aportante, `lectura`, empty ceiling) CAN offer transport
 *      capacity, and
 *   2. that same transporter CANNOT see a household address by any route — RLS is the boundary,
 *      and it is untouched by this feature.
 *
 * Run: `pnpm db:up && pnpm db:reset && DATABASE_URL=… pnpm test aportante`.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

let pool: Pool
let client: PoolClient

/** The self-signing transporter's auth id (a fresh identity, like a real first sign-in). */
const TRANSP = randomUUID()
/** A coordinator in the anchor org, to contrast what a PII role sees against what the aportante sees. */
const COORD = '00000000-0000-4000-9000-0000000000f1'

let ANCHOR = ''
let TRANSP_ORG = ''
let OFERTA = '' // an offer carrying a household address, so "cannot see it" means something

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

/** True when a statement was refused — by a grant, a WITH CHECK, or RLS filtering to zero. */
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

  // The anchor organisation (the seed org) and a coordinator in it.
  const { rows: a } = await client.query<{ id: string }>(
    'select id from organizaciones order by creado_en limit 1',
  )
  ANCHOR = a[0]!.id
  await client.query(
    `insert into usuarios (id, rol_staff, organizacion_id) values ($1, 'coordinador', $2)`,
    [COORD, ANCHOR],
  )

  // An offer that carries a household address, so "the transporter cannot see it" is a real claim.
  const { rows: c } = await client.query<{ id: string }>(
    `insert into contactos (telefono, nombre, rol) values ('+573009998877', 'Doña Ana', 'reportante') returning id`,
  )
  const { rows: o } = await client.query<{ id: string }>(
    `insert into ofertas (contacto_id, texto_original, direccion_texto)
       values ($1, 'Tengo mantas para dar', 'Calle de la casa 45, barrio reservado') returning id`,
    [c[0]!.id],
  )
  OFERTA = o[0]!.id

  // ── The self-signup itself: possession is proven (we set the claim), then the aportante is
  //    created. These writes must PERSIST across the cases, so this is not inside a savepoint. ──
  await claims(TRANSP, 'transportista-fr18@convite.test')
  const resultado = await unVal<string>('select convite_autoregistrar_aportante() as r')
  if (resultado !== 'creado') throw new Error(`autoregistro devolvió ${resultado}, no creado`)

  // A standing capacity offer, so the read/anon cases have something real to see or be denied.
  await client.query(
    `insert into ofertas_transporte (usuario_id, organizacion_id, modo, area_cobertura, cupo_familias)
       select u.id, u.organizacion_id, 'lancha', 'Quibdó – Bojayá por el Atrato', 20
         from usuarios u where u.id = $1`,
    [TRANSP],
  )

  // Back to the owner role to inspect the rows the self-signup wrote.
  await client.query('reset role')
  const { rows: u } = await client.query<{ organizacion_id: string }>(
    'select organizacion_id from usuarios where id = $1',
    [TRANSP],
  )
  TRANSP_ORG = u[0]!.organizacion_id
})

afterAll(async () => {
  if (!url) return
  await client.query('rollback')
  client.release()
  await pool.end()
})

// ─────────────────────────────────────────────────────────────────────────────────────────────

conBase('el autoregistro deja un aportante lectura sin acceso a datos de comunidad', () => {
  it('crea la organización aportante con techo vacío y un usuario lectura', async () => {
    const fila = (
      await client.query<{
        rol_staff: string
        es_plataforma: boolean
        nivel_admision: string
        tipo: string
        estado_aprobacion: string
        activo: boolean
        techo: string
      }>(
        `select u.rol_staff, u.es_plataforma, o.nivel_admision, o.tipo, o.estado_aprobacion,
                o.activo, o.techo_permisos::text as techo
           from usuarios u join organizaciones o on o.id = u.organizacion_id
          where u.id = $1`,
        [TRANSP],
      )
    ).rows[0]!

    expect(fila.rol_staff).toBe('lectura')
    expect(fila.es_plataforma).toBe(false)
    expect(fila.nivel_admision).toBe('aportante')
    expect(fila.tipo).toBe('transportista')
    expect(fila.estado_aprobacion).toBe('aprobada')
    expect(fila.activo).toBe(true)
    // The ceiling is empty: no household addresses, no community reach, granted by construction.
    expect(fila.techo).toBe('{}')
  })

  it('la membresía reflejada es lectura y activa (una sola)', async () => {
    const n = await contar(
      `select count(*)::text from membresias
        where usuario_id = $1 and rol = 'lectura' and estado = 'activa'`,
      [TRANSP],
    )
    expect(n).toBe(1)
  })

  it('correr el autoregistro otra vez no crea una segunda cuenta (ya_existe)', async () => {
    await como(TRANSP, async () => {
      expect(await unVal<string>('select convite_autoregistrar_aportante() as r')).toBe('ya_existe')
    })
  })
})

conBase('un transportista autoregistrado NO ve direcciones de hogar (FR-18 AC #2)', () => {
  it('no ejerce ninguna capacidad de acceso a datos sensibles', async () => {
    await como(TRANSP, async () => {
      expect(await unVal<boolean>(`select convite_puede('direcciones_hogar') as r`)).toBe(false)
      expect(
        await unVal<boolean>(
          `select convite_es(array['coordinador','despachador','admin','verificador']) as r`,
        ),
      ).toBe(false)
    })
  })

  it('no ve ni una fila de ofertas — donde vive el texto de dirección', async () => {
    await como(TRANSP, async () => {
      expect(await contar('select count(*)::text from ofertas')).toBe(0)
      // The one guarded path to an address returns nothing for someone not on the run.
      expect(await contar('select count(*)::text from direccion_de_oferta($1)', [OFERTA])).toBe(0)
    })
  })

  it('un coordinador SÍ ve la oferta — así se sabe que la negación es por rol, no por vacío', async () => {
    await como(COORD, async () => {
      expect(await contar('select count(*)::text from ofertas')).toBeGreaterThanOrEqual(1)
    })
  })
})

conBase('un transportista autoregistrado SÍ puede ofrecer capacidad (FR-18 AC #1)', () => {
  it('ve su propio ofrecimiento y puede crear otro', async () => {
    await como(TRANSP, async () => {
      // The offer created at setup is visible to its owner.
      expect(
        await contar('select count(*)::text from ofertas_transporte where usuario_id = $1', [
          TRANSP,
        ]),
      ).toBe(1)

      // And they can add another for themselves.
      const { rowCount } = await client.query(
        `insert into ofertas_transporte (usuario_id, organizacion_id, modo, area_cobertura, cupo_familias)
           values ($1, $2, 'carretera', 'Quibdó – Yuto', 8)`,
        [TRANSP, TRANSP_ORG],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('no puede crear un ofrecimiento a nombre de otra persona (with check usuario_id = auth.uid())', async () => {
    await como(TRANSP, async () => {
      expect(
        await rechazado(
          `insert into ofertas_transporte (usuario_id, organizacion_id, modo, area_cobertura, cupo_familias)
             values ($1, $2, 'lancha', 'ruta ajena', 5)`,
          [COORD, ANCHOR],
        ),
      ).toBe(true)
    })
  })

  it('anon no alcanza los ofrecimientos de transporte', async () => {
    await client.query('savepoint anon')
    await client.query('set local role anon')
    // anon has no grant on the table at all → the read is refused outright.
    expect(await rechazado('select count(*) from ofertas_transporte')).toBe(true)
    await client.query('rollback to savepoint anon')
  })
})
