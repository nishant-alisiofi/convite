import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The per-user permission engine (PRD-16, §29.4–29.7) and organisation admission (PRD-35,
 * §29.3b), against the real database — the same harness as tests/jerarquia.db.test.ts and
 * tests/rls.db.test.ts. Every case runs as the `authenticated` Postgres role with a JWT claim
 * set, exactly how a signed-in session reaches Postgres through conSesion(). Proving the boundary
 * any other way would prove nothing: the SECURITY DEFINER helpers and the restrictive policies on
 * `membresias` ARE the boundary.
 *
 * Everything happens inside one transaction that is always rolled back; each case runs inside a
 * savepoint so a refusal that aborts the statement does not poison the next assertion.
 *
 * Run: `pnpm db:up && pnpm db:reset && DATABASE_URL=… pnpm test membresias`.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

let pool: Pool
let client: PoolClient

/** Deterministic ids so a failure names an actor, not a uuid. Distinct from the other db tests. */
const ID = {
  plataforma: '00000000-0000-4000-9000-0000000000b1',
  adminA: '00000000-0000-4000-9000-0000000000b2',
  adminLtd: '00000000-0000-4000-9000-0000000000b3',
  multiOrg: '00000000-0000-4000-9000-0000000000b4',
  emp1: '00000000-0000-4000-9000-0000000000b5',
  emp2: '00000000-0000-4000-9000-0000000000b6',
  driver: '00000000-0000-4000-9000-0000000000b7',
  enC: '00000000-0000-4000-9000-0000000000b8',
  dormido: '00000000-0000-4000-9000-0000000000b9',
  reciente: '00000000-0000-4000-9000-0000000000ba',
} as const

type Actor = keyof typeof ID

const ORG = { a: '', b: '', c: '' }
const COM = { a: '', b: '' }
const MEMB = { verifBdeMulti: '', coordAdeMulti: '', verifAdeDormido: '', verifAdeReciente: '' }
let NODO = ''
let CONTACTO_DRIVER = ''

beforeAll(async () => {
  if (!url) return
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  })
  client = await pool.connect()
  await client.query('begin')

  // The seed organisation is the anchor (rich ceiling). Two more orgs for the limited-ceiling and
  // vouch-target cases.
  const { rows: a } = await client.query<{ id: string }>(
    'select id from organizaciones order by creado_en limit 1',
  )
  ORG.a = a[0]!.id

  const { rows: b } = await client.query<{ id: string }>(
    `insert into organizaciones (nombre, estado_aprobacion, nivel_admision) values
       ('Org B (techo limitado, prueba membresías)', 'aprobada', 'avalada') returning id`,
  )
  ORG.b = b[0]!.id

  const { rows: c } = await client.query<{ id: string }>(
    `insert into organizaciones (nombre, estado_aprobacion) values
       ('Org C (objetivo de aval, prueba membresías)', 'pendiente') returning id`,
  )
  ORG.c = c[0]!.id

  const { rows: coms } = await client.query<{ id: string }>(
    'select id from comunidades order by codigo limit 2',
  )
  COM.a = coms[0]!.id
  COM.b = coms[1]!.id

  // Ceilings (§29.4). The anchor holds everything; Org B is a narrow one — assessment only, one
  // community, no dispatch, no delegation, no household addresses.
  await client.query(
    `update organizaciones set techo_permisos = $2::jsonb where id = $1`,
    [
      ORG.a,
      JSON.stringify({
        despacho: true,
        inventario_nodo: true,
        agendamiento: true,
        evaluacion: true,
        direcciones_hogar: true,
        puede_delegar: true,
        comunidades_alcance: 'todas',
      }),
    ],
  )
  await client.query(`update organizaciones set techo_permisos = $2::jsonb where id = $1`, [
    ORG.b,
    JSON.stringify({ evaluacion: true, comunidades_alcance: [COM.b] }),
  ])

  // Staff. Creating each usuarios row fires the reflect trigger, so each already has one membership
  // (its rol_staff in its home org) in `membresias`.
  await client.query(
    `insert into usuarios (id, rol_staff, organizacion_id, es_plataforma) values
       ($1, 'admin', $8, true),
       ($2, 'admin', $8, false),
       ($3, 'admin', $9, false),
       ($4, 'coordinador', $8, false),
       ($5, 'lectura', $8, false),
       ($6, 'lectura', $8, false),
       ($7, 'coordinador', $8, false)`,
    [ID.plataforma, ID.adminA, ID.adminLtd, ID.multiOrg, ID.emp1, ID.emp2, ID.driver, ORG.a, ORG.b],
  )
  await client.query(
    `insert into usuarios (id, rol_staff, organizacion_id, es_plataforma) values
       ($1, 'lectura', $4, false),
       ($2, 'lectura', $4, false),
       ($3, 'lectura', $4, false)`,
    [ID.enC, ID.dormido, ID.reciente, ORG.a],
  )
  // enC belongs to Org C, not A — its lectura row above is just a valid auth identity; give it a
  // real membership in C below.

  // adminA also administers Org B by membership, so it can delegate there (grandfathered: owner
  // insert bypasses the ceiling, exactly like a pre-existing admin the org already had).
  await client.query(
    `insert into membresias (usuario_id, organizacion_id, rol, estado) values ($1, $2, 'admin', 'activa')`,
    [ID.adminA, ORG.b],
  )

  // multiOrg: coordinador in A (from the trigger) AND verificador in B — different roles, different
  // orgs. Capture both ids.
  const { rows: mCoordA } = await client.query<{ id: string }>(
    `select id from membresias where usuario_id = $1 and organizacion_id = $2 and rol = 'coordinador'`,
    [ID.multiOrg, ORG.a],
  )
  MEMB.coordAdeMulti = mCoordA[0]!.id
  const { rows: mVerifB } = await client.query<{ id: string }>(
    `insert into membresias (usuario_id, organizacion_id, rol, comunidades_alcance, estado)
       values ($1, $2, 'verificador', array[$3]::uuid[], 'activa') returning id`,
    [ID.multiOrg, ORG.b, COM.b],
  )
  MEMB.verifBdeMulti = mVerifB[0]!.id

  // emp2 already holds an active verificador in A (for the separation-of-duties case).
  await client.query(
    `insert into membresias (usuario_id, organizacion_id, rol, estado) values ($1, $2, 'verificador', 'activa')`,
    [ID.emp2, ORG.a],
  )

  // enC: a verificador in Org C, so revoking C's vouch can be shown to make it inert.
  await client.query(
    `insert into membresias (usuario_id, organizacion_id, rol, comunidades_alcance, estado)
       values ($1, $2, 'verificador', array[$3]::uuid[], 'activa')`,
    [ID.enC, ORG.c, COM.a],
  )

  // Dormancy: two address-level verificador memberships in A — one idle 46 days, one fresh.
  const { rows: d } = await client.query<{ id: string }>(
    `insert into membresias (usuario_id, organizacion_id, rol, comunidades_alcance, estado, ultima_actividad_en)
       values ($1, $2, 'verificador', array[$3]::uuid[], 'activa', now() - interval '46 days') returning id`,
    [ID.dormido, ORG.a, COM.a],
  )
  MEMB.verifAdeDormido = d[0]!.id
  const { rows: r } = await client.query<{ id: string }>(
    `insert into membresias (usuario_id, organizacion_id, rol, comunidades_alcance, estado, ultima_actividad_en)
       values ($1, $2, 'verificador', array[$3]::uuid[], 'activa', now()) returning id`,
    [ID.reciente, ORG.a, COM.a],
  )
  MEMB.verifAdeReciente = r[0]!.id

  // A run held by the driver, so termination can be shown to cancel it (§29.6).
  const { rows: nodo } = await client.query<{ id: string }>('select id from nodos limit 1')
  NODO = nodo[0]!.id
  const { rows: cont } = await client.query<{ id: string }>(
    `insert into contactos (telefono, nombre, rol) values ('+573001112233', 'Chofer prueba', 'transportista') returning id`,
  )
  CONTACTO_DRIVER = cont[0]!.id
  await client.query('update usuarios set contacto_id = $2 where id = $1', [ID.driver, CONTACTO_DRIVER])
  await client.query(
    `insert into envios (codigo, modo, responsable_id, origen_nodo_id, cupo_familias, estado, despachado_por, despachado_en)
       values ('ENV-MEMB-PRUEBA', 'lancha', $1, $2, 30, 'DESPACHADO', $3, now())`,
    [CONTACTO_DRIVER, NODO, ID.plataforma],
  )
})

afterAll(async () => {
  if (!url) return
  await client.query('rollback')
  client.release()
  await pool.end()
})

/** Point the current transaction at `uid` as a signed-in authenticated session (no savepoint). */
async function claims(actor: Actor | string): Promise<void> {
  const uid = (ID as Record<string, string>)[actor as string] ?? (actor as string)
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: uid, role: 'authenticated', email: `${actor}@convite.test` }),
  ])
  await client.query('set local role authenticated')
}

/** Runs `fn` as `actor`, inside a savepoint that is always unwound. */
async function como<T>(actor: Actor, fn: () => Promise<T>): Promise<T> {
  await client.query('savepoint sesion')
  await claims(actor)
  try {
    return await fn()
  } finally {
    await client.query('rollback to savepoint sesion')
  }
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

async function unVal<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await client.query(sql, params)
  return Object.values(rows[0] ?? {})[0] as T
}

async function contar(sql: string, params: unknown[] = []): Promise<number> {
  return Number(await unVal<string>(sql, params))
}

async function llamar<T = string>(fn: string, params: unknown[]): Promise<T> {
  const marcas = params.map((_, i) => `$${i + 1}`).join(', ')
  const { rows } = await client.query(`select ${fn}(${marcas}) as r`, params)
  return (rows[0] as { r: T }).r
}

const capacidad = (org: string, cap: string) =>
  llamar<boolean>('convite_membresia_capacidad', [org, cap])
const puede = (cap: string) => llamar<boolean>('convite_puede', [cap])

// ─────────────────────────────────────────────────────────────────────────────────────────────

conBase('cada usuario existente quedó con exactamente una membresía (PRD-16 #4)', () => {
  it('el backfill no dejó ningún usuario sin membresía', async () => {
    const huerfanos = await contar(
      `select count(*)::text from usuarios u
        where not exists (select 1 from membresias m where m.usuario_id = u.id)`,
    )
    expect(huerfanos).toBe(0)
  })

  it('un alta de staff se refleja en membresías con su rol y su org (sin cambiar el ingreso)', async () => {
    const uid = randomUUID()
    await client.query('savepoint alta')
    await client.query(
      `insert into usuarios (id, rol_staff, organizacion_id) values ($1, 'despachador', $2)`,
      [uid, ORG.a],
    )
    const n = await contar(
      `select count(*)::text from membresias where usuario_id = $1 and organizacion_id = $2 and rol = 'despachador' and estado = 'activa'`,
      [uid, ORG.a],
    )
    await client.query('rollback to savepoint alta')
    expect(n).toBe(1)
  })
})

conBase('una persona en dos orgs tiene permisos distintos por org (PRD-16 #6)', () => {
  it('coordinador en A (con despacho) y verificador en B (sin despacho)', async () => {
    await como('multiOrg', async () => {
      // Dos membresías, dos roles, dos orgs.
      const n = await contar(
        'select count(*)::text from membresias where usuario_id = $1 and estado = $2',
        [ID.multiOrg, 'activa'],
      )
      expect(n).toBeGreaterThanOrEqual(2)

      // El permiso es el rol EXERCE cap ∧ el techo de la org lo concede — distinto por org.
      expect(await capacidad(ORG.a, 'despacho')).toBe(true) // coordinador + techo A concede
      expect(await capacidad(ORG.b, 'despacho')).toBe(false) // verificador no despacha; techo B no concede
      expect(await capacidad(ORG.b, 'evaluacion')).toBe(true) // verificador evalúa; techo B concede
      // La unión ve el despacho porque una de las orgs lo concede.
      expect(await puede('despacho')).toBe(true)
    })
  })
})

conBase('la delegación no puede escalar el techo (PRD-16 #7)', () => {
  it('un admin concede dentro del techo (despachador donde hay despacho)', async () => {
    await como('adminA', async () => {
      const { rowCount } = await client.query(
        `insert into membresias (usuario_id, organizacion_id, rol) values ($1, $2, 'despachador')`,
        [ID.emp1, ORG.a],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('un admin concede org_admin donde puede_delegar está puesto', async () => {
    await como('adminA', async () => {
      const { rowCount } = await client.query(
        `insert into membresias (usuario_id, organizacion_id, rol) values ($1, $2, 'admin')`,
        [ID.emp1, ORG.a],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('NO puede conceder alcance a una comunidad fuera del techo de la org', async () => {
    await como('adminA', async () => {
      // COM.a no está en el techo de B (solo COM.b). La base lo rechaza.
      expect(
        await rechazado(
          `insert into membresias (usuario_id, organizacion_id, rol, comunidades_alcance)
             values ($1, $2, 'verificador', array[$3]::uuid[])`,
          [ID.emp1, ORG.b, COM.a],
        ),
      ).toBe(true)
      // COM.b sí está en el techo: la misma concesión pasa.
      const { rowCount } = await client.query(
        `insert into membresias (usuario_id, organizacion_id, rol, comunidades_alcance)
           values ($1, $2, 'verificador', array[$3]::uuid[])`,
        [ID.emp1, ORG.b, COM.b],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('NO puede conceder una capacidad fuera del techo (despacho donde el techo no lo permite)', async () => {
    await como('adminA', async () => {
      expect(
        await rechazado(
          `insert into membresias (usuario_id, organizacion_id, rol) values ($1, $2, 'despachador')`,
          [ID.emp1, ORG.b],
        ),
      ).toBe(true)
    })
  })

  it('NO puede conceder org_admin cuando puede_delegar no está puesto', async () => {
    await como('adminA', async () => {
      expect(
        await rechazado(
          `insert into membresias (usuario_id, organizacion_id, rol) values ($1, $2, 'admin')`,
          [ID.emp1, ORG.b],
        ),
      ).toBe(true)
    })
  })

  it('NO puede conceder membresías en una org que no administra (nunca entre orgs)', async () => {
    // adminLtd administra B (es su org de casa), no A.
    await como('adminLtd', async () => {
      expect(
        await rechazado(
          `insert into membresias (usuario_id, organizacion_id, rol) values ($1, $2, 'verificador')`,
          [ID.emp1, ORG.a],
        ),
      ).toBe(true)
    })
  })
})

conBase('separación de deberes (PRD-16 #9, §29.7)', () => {
  it('quien ya es verificador no puede volverse despachador en la misma org', async () => {
    await como('adminA', async () => {
      // emp2 ya tiene verificador activo en A; el techo de A concede despacho, así que lo único
      // que puede rechazar esto es la separación de deberes.
      expect(
        await rechazado(
          `insert into membresias (usuario_id, organizacion_id, rol) values ($1, $2, 'despachador')`,
          [ID.emp2, ORG.a],
        ),
      ).toBe(true)
    })
  })

  it('quien es despachador no puede volverse verificador en la misma org', async () => {
    await como('adminA', async () => {
      const { rowCount } = await client.query(
        `insert into membresias (usuario_id, organizacion_id, rol) values ($1, $2, 'despachador')`,
        [ID.emp1, ORG.a],
      )
      expect(rowCount).toBe(1)
      expect(
        await rechazado(
          `insert into membresias (usuario_id, organizacion_id, rol) values ($1, $2, 'verificador')`,
          [ID.emp1, ORG.a],
        ),
      ).toBe(true)
    })
  })
})

conBase('el offboarding revoca el acceso (PRD-16 #8, §29.6)', () => {
  it('terminar una membresía la deja fuera del set activo en la siguiente petición', async () => {
    await client.query('savepoint term')
    await claims('adminA')
    expect(await llamar('convite_terminar_membresia', [MEMB.verifBdeMulti, 'baja voluntaria'])).toBe(
      'terminada',
    )
    // En una nueva sesión (misma transacción), multiOrg ya no ejerce evaluación en B — revocado a
    // la siguiente petición, sin caché.
    await claims('multiOrg')
    expect(await capacidad(ORG.b, 'evaluacion')).toBe(false)
    await client.query('rollback to savepoint term')
  })

  it('terminar cancela las corridas activas de la persona (nunca un envío con referencia muerta)', async () => {
    // La membresía de casa del chofer (coordinador en A).
    const membDriver = await unVal<string>(
      `select id from membresias where usuario_id = $1 and organizacion_id = $2 and rol = 'coordinador'`,
      [ID.driver, ORG.a],
    )
    await como('adminA', async () => {
      expect(await llamar('convite_terminar_membresia', [membDriver, 'terminación'])).toBe('terminada')
      const estado = await unVal<string>(
        `select estado from envios where codigo = 'ENV-MEMB-PRUEBA'`,
      )
      expect(estado).toBe('CANCELADO')
      // Y quedó auditado.
      const n = await contar(
        `select count(*)::text from auditoria where accion = 'envios.cancelados_por_baja' and entidad_id = $1`,
        [membDriver],
      )
      expect(n).toBe(1)
    })
  })

  it('suspender revoca; reactivar (un clic) vuelve a habilitar', async () => {
    const membVerifA = await unVal<string>(
      `select id from membresias where usuario_id = $1 and organizacion_id = $2 and rol = 'verificador'`,
      [ID.emp2, ORG.a],
    )
    await como('adminA', async () => {
      expect(await llamar('convite_suspender_membresia', [membVerifA, 'licencia'])).toBe('suspendida')
      expect(
        await unVal<string>('select estado from membresias where id = $1', [membVerifA]),
      ).toBe('suspendida')
      expect(await llamar('convite_reactivar_membresia', [membVerifA])).toBe('activa')
      expect(
        await unVal<string>('select estado from membresias where id = $1', [membVerifA]),
      ).toBe('activa')
    })
  })

  it('la latencia de 45 días auto-suspende una membresía con acceso a direcciones', async () => {
    await como('plataforma', async () => {
      const n = await llamar<number>('convite_suspender_membresias_inactivas', [])
      expect(Number(n)).toBeGreaterThanOrEqual(1)
      expect(
        await unVal<string>('select estado from membresias where id = $1', [MEMB.verifAdeDormido]),
      ).toBe('suspendida')
      // La reciente sobrevive: la latencia sólo cierra lo inactivo.
      expect(
        await unVal<string>('select estado from membresias where id = $1', [MEMB.verifAdeReciente]),
      ).toBe('activa')
    })
  })

  it('un no-plataforma no puede correr la barrida de latencia', async () => {
    await como('adminA', async () => {
      expect(Number(await llamar<number>('convite_suspender_membresias_inactivas', []))).toBe(-1)
    })
  })

  it('cada concesión y cada baja queda en auditoría (§29.6)', async () => {
    await como('adminA', async () => {
      const { rows } = await client.query<{ id: string }>(
        `insert into membresias (usuario_id, organizacion_id, rol) values ($1, $2, 'despachador') returning id`,
        [ID.emp1, ORG.a],
      )
      const memb = rows[0]!.id
      expect(
        await contar(
          `select count(*)::text from auditoria where accion = 'membresia.otorgada' and entidad_id = $1`,
          [memb],
        ),
      ).toBe(1)
      await llamar('convite_terminar_membresia', [memb, 'prueba auditoría'])
      expect(
        await contar(
          `select count(*)::text from auditoria where accion = 'membresia.terminada' and entidad_id = $1`,
          [memb],
        ),
      ).toBe(1)
    })
  })
})

conBase('admisión de organizaciones y avales (PRD-35, §29.3b)', () => {
  it('un ancla avala una org en minutos, con techo ≤ el suyo, y queda registrado', async () => {
    await como('adminA', async () => {
      const techo = JSON.stringify({ evaluacion: true, comunidades_alcance: [COM.a] })
      expect(await llamar('convite_avalar_organizacion', [ORG.c, 'La Diócesis avala a NRC', techo])).toBe(
        'avalada',
      )
      const { rows } = await client.query<{
        nivel_admision: string
        aval_motivo: string
        avalado_por: string
        estado_aprobacion: string
        activo: boolean
      }>(
        'select nivel_admision, aval_motivo, avalado_por, estado_aprobacion, activo from organizaciones where id = $1',
        [ORG.c],
      )
      expect(rows[0]!.nivel_admision).toBe('avalada')
      expect(rows[0]!.aval_motivo).toBe('La Diócesis avala a NRC')
      expect(rows[0]!.avalado_por).toBe(ORG.a)
      expect(rows[0]!.estado_aprobacion).toBe('aprobada')
      expect(rows[0]!.activo).toBe(true)
    })
  })

  it('un aval NO puede exceder el techo del avalador', async () => {
    // adminLtd vive en B, cuyo techo es sólo evaluación + COM.b. Pedir despacho excede.
    await como('adminLtd', async () => {
      const techo = JSON.stringify({ despacho: true })
      expect(await llamar('convite_avalar_organizacion', [ORG.c, 'intento', techo])).toBe('excede_techo')
    })
  })

  it('revocar el aval suspende la org y deja inertes sus membresías', async () => {
    await client.query('savepoint rev')
    // Aval como el ancla, con un techo que concede evaluación.
    await claims('adminA')
    expect(
      await llamar('convite_avalar_organizacion', [
        ORG.c,
        'aval de prueba',
        JSON.stringify({ evaluacion: true, comunidades_alcance: [COM.a] }),
      ]),
    ).toBe('avalada')

    // Con la org activa, enC (verificador en C) sí ejerce evaluación.
    await claims('enC')
    expect(await capacidad(ORG.c, 'evaluacion')).toBe(true)

    // El ancla revoca el aval.
    await claims('adminA')
    expect(await llamar('convite_revocar_aval', [ORG.c, 'incumplimiento del acuerdo'])).toBe('suspendida')
    expect(await unVal<boolean>('select activo from organizaciones where id = $1', [ORG.c])).toBe(false)

    // Ahora la membresía de enC en C queda fuera del set activo — sin caché, a la siguiente petición.
    await claims('enC')
    expect(await capacidad(ORG.c, 'evaluacion')).toBe(false)

    await client.query('rollback to savepoint rev')
  })

  it('la plataforma admite un aportante (lado oferta) sin datos de comunidad', async () => {
    await como('plataforma', async () => {
      expect(
        await llamar('convite_fijar_nivel_admision', [ORG.c, 'aportante', JSON.stringify({ despacho: true })]),
      ).toBe('aportante')
      // Un aportante con direcciones de hogar es un contrasentido: se rechaza.
      expect(
        await llamar('convite_fijar_nivel_admision', [
          ORG.c,
          'aportante',
          JSON.stringify({ direcciones_hogar: true }),
        ]),
      ).toBe('tier_sin_datos_comunidad')
      // Una observadora con alcance a comunidades también.
      expect(
        await llamar('convite_fijar_nivel_admision', [
          ORG.c,
          'observadora',
          JSON.stringify({ comunidades_alcance: [COM.a] }),
        ]),
      ).toBe('tier_sin_datos_comunidad')
    })
  })

  it('sólo la plataforma fija el nivel de admisión de ancla/aportante/observadora', async () => {
    await como('adminA', async () => {
      expect(
        await llamar('convite_fijar_nivel_admision', [ORG.c, 'ancla', JSON.stringify({})]),
      ).toBe('sin_permiso')
    })
  })
})
