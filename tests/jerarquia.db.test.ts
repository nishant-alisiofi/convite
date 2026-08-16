import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The organisation hierarchy (docs/tipos-de-usuario-y-accesos.md §2.4, §2.5, §4), against the
 * real database.
 *
 * Every case runs as the `authenticated` Postgres role with a JWT claim set, exactly how a
 * signed-in session reaches Postgres through `conSesion()` — the same harness as
 * tests/rls.db.test.ts. Proving the actions boundary any other way (say, by checking the UI
 * hides a button) would prove nothing: RLS and the SECURITY DEFINER helpers are the boundary.
 *
 * Everything happens inside one transaction that is always rolled back, and each case runs
 * inside a savepoint so a refusal that aborts the statement does not poison the next assertion.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

let pool: Pool
let client: PoolClient

/** Deterministic ids so a failure names a role, not a uuid. Distinct from rls.db.test.ts. */
const ID = {
  adminCentro: '00000000-0000-4000-9000-0000000000a1',
  plataforma: '00000000-0000-4000-9000-0000000000a2',
  coordinador: '00000000-0000-4000-9000-0000000000a3',
} as const

type Actor = keyof typeof ID

/** The seed organisation (approved by the 0034 backfill) and a freshly requested pending one. */
const ORG = { a: '', b: '' }

/** Correos seeded on the allowlist so the cross-org read has something to see. */
const CORREO = {
  enOrgB: 'jerarquia-orgb@convite.test',
  enOrgA: 'jerarquia-orga@convite.test',
  plataformaNueva: 'jerarquia-plataforma-nueva@convite.test',
}

beforeAll(async () => {
  if (!url) return
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  })
  client = await pool.connect()
  await client.query('begin')

  const { rows } = await client.query<{ id: string }>(
    'select id from organizaciones order by creado_en limit 1',
  )
  ORG.a = rows[0]!.id

  // A second organisation, requested and still pending — the shape /solicitar-centro creates.
  const { rows: b } = await client.query<{ id: string }>(
    `insert into organizaciones (nombre, estado_aprobacion)
       values ('Centro solicitado (prueba jerarquía)', 'pendiente')
     returning id`,
  )
  ORG.b = b[0]!.id

  // Staff: a centre admin and a coordinador in org A (neither platform), and a platform admin.
  await client.query(
    `insert into usuarios (id, rol_staff, organizacion_id, es_plataforma) values
       ($1, 'admin', $4, false),
       ($2, 'admin', $4, true),
       ($3, 'coordinador', $4, false)`,
    [ID.adminCentro, ID.plataforma, ID.coordinador, ORG.a],
  )

  // Allowlist rows so «who can see across organisations» has something to distinguish.
  await client.query(
    `insert into invitaciones_staff (correo, rol_staff, organizacion_id) values
       ($1, 'admin', $2),
       ($3, 'verificador', $4)`,
    [CORREO.enOrgB, ORG.b, CORREO.enOrgA, ORG.a],
  )

  // A platform invitation, so the auth-invariant case can prove the flag flows through
  // vincular_usuario_staff() the same way a role does.
  await client.query(
    `insert into invitaciones_staff (correo, rol_staff, organizacion_id, es_plataforma)
       values ($1, 'admin', $2, true)`,
    [CORREO.plataformaNueva, ORG.a],
  )
})

afterAll(async () => {
  if (!url) return
  await client.query('rollback')
  client.release()
  await pool.end()
})

/** Runs `fn` as a signed-in session for `actor`, then unwinds to before it. */
async function como<T>(actor: Actor, fn: () => Promise<T>): Promise<T> {
  await client.query('savepoint sesion')
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: ID[actor], role: 'authenticated', email: `${actor}@convite.test` }),
  ])
  await client.query('set local role authenticated')
  try {
    return await fn()
  } finally {
    await client.query('rollback to savepoint sesion')
  }
}

/** Runs `fn` as a brand-new sign-in that proved a specific address — for vincular_usuario_staff. */
async function comoNuevoIngreso<T>(uid: string, correo: string, fn: () => Promise<T>): Promise<T> {
  await client.query('savepoint ingreso')
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: uid, role: 'authenticated', email: correo }),
  ])
  await client.query('set local role authenticated')
  try {
    return await fn()
  } finally {
    await client.query('rollback to savepoint ingreso')
  }
}

/** True when the statement was refused — by a missing grant, a WITH CHECK, or RLS filtering to zero. */
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

async function decidir(org: string, decision: string): Promise<string> {
  const { rows } = await client.query<{ convite_decidir_centro: string }>(
    'select convite_decidir_centro($1, $2)',
    [org, decision],
  )
  return rows[0]!.convite_decidir_centro
}

async function estadoDe(org: string): Promise<string | null> {
  const { rows } = await client.query<{ estado_aprobacion: string }>(
    'select estado_aprobacion from organizaciones where id = $1',
    [org],
  )
  return rows[0]?.estado_aprobacion ?? null
}

async function contar(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await client.query<{ n: string }>(sql, params)
  return Number(rows[0]!.n)
}

conBase('aprobación de centros (§2.4, §4)', () => {
  it('un admin de plataforma aprueba un centro pendiente, y queda en auditoría', async () => {
    await como('plataforma', async () => {
      expect(await decidir(ORG.b, 'aprobada')).toBe('aprobada')
      expect(await estadoDe(ORG.b)).toBe('aprobada')

      const filas = await contar(
        `select count(*)::text as n from auditoria
          where entidad = 'organizaciones' and entidad_id = $1 and accion = 'organizacion.aprobada'`,
        [ORG.b],
      )
      expect(filas).toBe(1)
    })
  })

  it('un admin de plataforma también puede rechazar', async () => {
    await como('plataforma', async () => {
      expect(await decidir(ORG.b, 'rechazada')).toBe('rechazada')
      expect(await estadoDe(ORG.b)).toBe('rechazada')
    })
  })

  it('un admin de CENTRO no puede aprobar: no es del tier de plataforma', async () => {
    await como('adminCentro', async () => {
      expect(await decidir(ORG.b, 'aprobada')).toBe('sin_permiso')
    })
    // Y el centro sigue pendiente, visto con el rol dueño fuera de la sesión.
    expect(await estadoDe(ORG.b)).toBe('pendiente')
  })

  it('un coordinador tampoco puede aprobar', async () => {
    await como('coordinador', async () => {
      expect(await decidir(ORG.b, 'aprobada')).toBe('sin_permiso')
    })
  })

  it('no se re-decide un centro que ya fue decidido', async () => {
    await como('plataforma', async () => {
      // Org A ya está aprobada (backfill de 0034), así que no se puede volver a decidir.
      expect(await decidir(ORG.a, 'rechazada')).toBe('ya_decidida')
      expect(await estadoDe(ORG.a)).toBe('aprobada')
    })
  })

  it('una decisión que no es aprobar ni rechazar se rechaza', async () => {
    await como('plataforma', async () => {
      expect(await decidir(ORG.b, 'suspendida')).toBe('decision_invalida')
      expect(await estadoDe(ORG.b)).toBe('pendiente')
    })
  })
})

conBase('el admin de centro invita solo dentro de su organización (§2.4)', () => {
  it('invita a un trabajador en su propia org', async () => {
    await como('adminCentro', async () => {
      const { rowCount } = await client.query(
        `insert into invitaciones_staff (correo, rol_staff, organizacion_id)
           values ('nuevo-trabajador@convite.test', 'verificador', $1)`,
        [ORG.a],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('NO puede invitar en otra organización', async () => {
    await como('adminCentro', async () => {
      expect(
        await rechazado(
          `insert into invitaciones_staff (correo, rol_staff, organizacion_id)
             values ('intruso-en-orgb@convite.test', 'verificador', $1)`,
          [ORG.b],
        ),
      ).toBe(true)
    })
  })
})

conBase('ver a través de organizaciones (§2.5)', () => {
  it('un admin de plataforma ve las invitaciones de otra organización', async () => {
    await como('plataforma', async () => {
      const enOrgB = await contar(
        'select count(*)::text as n from invitaciones_staff where organizacion_id = $1',
        [ORG.b],
      )
      expect(enOrgB).toBeGreaterThan(0)
    })
  })

  it('un admin de centro NO ve las invitaciones de otra organización, solo las suyas', async () => {
    await como('adminCentro', async () => {
      const enOrgB = await contar(
        'select count(*)::text as n from invitaciones_staff where organizacion_id = $1',
        [ORG.b],
      )
      expect(enOrgB).toBe(0)

      const enOrgA = await contar(
        'select count(*)::text as n from invitaciones_staff where organizacion_id = $1',
        [ORG.a],
      )
      expect(enOrgA).toBeGreaterThan(0)
    })
  })
})

conBase('un admin de centro no puede escalar al tier de plataforma (§2.5)', () => {
  it('no puede crear una invitación con es_plataforma = true', async () => {
    await como('adminCentro', async () => {
      expect(
        await rechazado(
          `insert into invitaciones_staff (correo, rol_staff, organizacion_id, es_plataforma)
             values ('escalada@convite.test', 'admin', $1, true)`,
          [ORG.a],
        ),
      ).toBe(true)
    })
  })

  it('un admin de plataforma sí puede crear una invitación de plataforma', async () => {
    await como('plataforma', async () => {
      const { rowCount } = await client.query(
        `insert into invitaciones_staff (correo, rol_staff, organizacion_id, es_plataforma)
           values ('otro-plataforma@convite.test', 'admin', $1, true)`,
        [ORG.a],
      )
      expect(rowCount).toBe(1)
    })
  })
})

conBase('el tier de plataforma sigue exigiendo invitación, aunque el ingreso sea abierto (§2.5/§4)', () => {
  it('un admin de plataforma solo nace de una invitación que lleve el flag', async () => {
    const uid = randomUUID()
    await comoNuevoIngreso(uid, CORREO.plataformaNueva, async () => {
      // Probó posesión y su invitación lleva es_plataforma: se crea la fila con el flag puesto.
      const { rows } = await client.query<{ vincular_usuario_staff: string }>(
        'select vincular_usuario_staff()',
      )
      expect(rows[0]!.vincular_usuario_staff).toBe('creado')

      const { rows: u } = await client.query<{ es_plataforma: boolean }>(
        'select es_plataforma from usuarios where id = $1',
        [uid],
      )
      expect(u[0]?.es_plataforma).toBe(true)
    })
  })

  it('sin invitación ahora hay fila, pero es un admin normal y NUNCA plataforma (ingreso abierto)', async () => {
    const uid = randomUUID()
    await comoNuevoIngreso(uid, 'nadie-jerarquia@convite.test', async () => {
      const { rows } = await client.query<{ vincular_usuario_staff: string }>(
        'select vincular_usuario_staff()',
      )
      expect(rows[0]!.vincular_usuario_staff).toBe('creado')

      const { rows: u } = await client.query<{
        rol_staff: string
        es_plataforma: boolean
        organizacion_id: string
      }>('select rol_staff, es_plataforma, organizacion_id from usuarios where id = $1', [uid])
      // El ingreso abierto crea un admin por defecto...
      expect(u[0]?.rol_staff).toBe('admin')
      // ...pero el tier de plataforma es una elevación, jamás el valor por defecto.
      expect(u[0]?.es_plataforma).toBe(false)
      // ...y cae en la organización activa más antigua (ORG.a, la semilla aprobada por 0034).
      expect(u[0]?.organizacion_id).toBe(ORG.a)
    })
  })
})
