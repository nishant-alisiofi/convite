import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * PRD-35 (§29.3b) — the three deferred pieces, against the real database: the manual zeroth
 * channel, the shared-gazetteer correction desk, and the aggregate coordination read layer.
 *
 * What this proves, in the doctrine's own terms:
 *   1. A report can enter with no channel at all — `canal = 'manual'`, born RECIBIDO, carrying the
 *      person who typed it — and only from a staff role, only for the caller's own community.
 *   2. The shared registry is corrected by proposal: proposing is bounded by RLS, and accepting
 *      stamps `verificado_en` on the shared row (or creates one), gated to a coordinador/admin of
 *      the owning org. Another organisation can neither see nor resolve a proposal that is not its.
 *   3. The aggregate layer shows coverage, municipality-level demand and closed legs across every
 *      organisation, and every tier may read it.
 *
 * Skipped when DATABASE_URL is absent. Everything writes inside a transaction that is rolled back.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

const ORG_A = '00000000-0000-4000-b000-0000000000d1'
const ORG_B = '00000000-0000-4000-b000-0000000000d2'
const COM1 = '00000000-0000-4000-b000-0000000000e1' // org A, unverified, covered by a jornada
const COM2 = '00000000-0000-4000-b000-0000000000e2' // org A, unverified, uncovered
const COM_B = '00000000-0000-4000-b000-0000000000e3' // org B
const REGION = '00000000-0000-4000-b000-0000000000f1'
const JORNADA = '00000000-0000-4000-b000-0000000000f2'

const ID = {
  adminA: '00000000-0000-4000-b000-0000000000a1',
  coordA: '00000000-0000-4000-b000-0000000000a2',
  verifA: '00000000-0000-4000-b000-0000000000a3',
  lecturaA: '00000000-0000-4000-b000-0000000000a4',
  coordB: '00000000-0000-4000-b000-0000000000b2',
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
       values ($1, 'Org A · prueba registro', 'aprobada'),
              ($2, 'Org B · prueba registro', 'aprobada')`,
    [ORG_A, ORG_B],
  )

  await client.query(
    `insert into regiones (id, nombre, departamento, tipo)
       values ($1, 'RegPrueba', 'Chocó', 'rural')`,
    [REGION],
  )

  // A catalogue item so a pedido (demand) can be created for the aggregate layer.
  await client.query(
    `insert into catalogo_items (codigo, familia, familia_label, item_label, tipo)
       values ('11', '1', 'Alimentos', 'Mercado', 'necesidad')
     on conflict (codigo) do nothing`,
  )

  await client.query(
    `insert into comunidades (id, organizacion_id, codigo, nombre, tipo, municipio, tier_conectividad)
       values ($1, $4, 'REG-COM1', 'Coord Uno', 'vereda', 'MuniPrueba', 2),
              ($2, $4, 'REG-COM2', 'Coord Dos', 'vereda', 'MuniPrueba', 2),
              ($3, $5, 'REG-COMB', 'Ajena B',   'vereda', 'MuniB',      2)`,
    [COM1, COM2, COM_B, ORG_A, ORG_B],
  )

  await client.query(
    `insert into usuarios (id, rol_staff, organizacion_id) values
       ($1, 'admin', $6), ($2, 'coordinador', $6), ($3, 'verificador', $6),
       ($4, 'lectura', $6), ($5, 'coordinador', $7)`,
    [ID.adminA, ID.coordA, ID.verifA, ID.lecturaA, ID.coordB, ORG_A, ORG_B],
  )

  // Coverage: an active jornada reaching COM1 (COM2 is left uncovered on purpose).
  await client.query(
    `insert into jornadas (id, codigo, tipo, organizacion_id, titulo, region_id, estado)
       values ($1, 'REG-JOR1', 'distribucion', $2, 'Brigada de prueba', $3, 'planificada')`,
    [JORNADA, ORG_A, REGION],
  )
  await client.query(
    `insert into jornada_paradas (jornada_id, comunidad_id, orden) values ($1, $2, 0)`,
    [JORNADA, COM1],
  )

  // Demand: one open pedido in COM1. A pedido is only born of a verified report (2.1), so the
  // report is verified with a name and a time before it becomes a pedido.
  const { rows: rep } = await client.query<{ id: string }>(
    `insert into reportes (organizacion_id, tipo, canal, comunidad_id, codigo_item, estado, verificado_por, verificado_en)
       values ($1, 'necesidad', 'whatsapp', $2, '11', 'VERIFICADO', $3, now()) returning id`,
    [ORG_A, COM1, ID.verifA],
  )
  await client.query(
    `insert into pedidos (reporte_id, comunidad_id, codigo_item, familias, estado)
       values ($1, $2, '11', 5, 'ABIERTO')`,
    [rep[0]!.id, COM1],
  )

  // A closed route leg for the aggregate layer.
  await client.query(
    `insert into rutas (origen_id, destino_id, modo, fuente, activa, desactivada_por, desactivada_en, notas)
       values ($1, $2, 'carretera', 'manual', false, $3, now(), 'Derrumbe reportado')`,
    [COM1, COM2, ID.adminA],
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

/** Inserts a proposal as the owner (bypassing RLS) so a resolve can act on it in the same escena. */
async function propuestaCorreccion(
  comunidad: string,
  campos: { nombre?: string; existeReal?: boolean } = {},
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into registro_propuestas
       (tipo_propuesta, comunidad_id, organizacion_id, propuesto_por, nombre_propuesto, existe_real, motivo)
     values ('correccion', $1, $2, $3, $4, $5, 'motivo de prueba')
     returning id`,
    [comunidad, ORG_A, ID.coordA, campos.nombre ?? null, campos.existeReal ?? null],
  )
  return rows[0]!.id
}

conBase('el canal manual es la puerta cero (§29.3b)', () => {
  it('ahora «manual» es un canal válido en reportes', async () => {
    await escenario(async () => {
      const { rowCount } = await client.query(
        `insert into reportes (organizacion_id, tipo, canal, comunidad_id)
           values ($1, 'sin_clasificar', 'manual', $2)`,
        [ORG_A, COM1],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('un coordinador registra un reporte manual: nace RECIBIDO, canal manual, con su nombre', async () => {
    await escenario(async () => {
      await como('coordA', async () => {
        const { rows } = await client.query<{ reporte_id: string; folio: number }>(
          `select reporte_id, folio from registrar_reporte_manual($1, null, null, null, 'llegó por teléfono')`,
          [COM1],
        )
        const reporteId = rows[0]!.reporte_id
        expect(rows[0]!.folio).toBeGreaterThan(0)

        const { rows: rep } = await client.query<{
          canal: string
          estado: string
          tipo: string
          capturado_por: string | null
        }>(
          `select canal, estado, tipo, payload_crudo->>'capturado_por' as capturado_por
             from reportes where id = $1`,
          [reporteId],
        )
        expect(rep[0]!.canal).toBe('manual')
        expect(rep[0]!.estado).toBe('RECIBIDO')
        expect(rep[0]!.tipo).toBe('sin_clasificar')
        expect(rep[0]!.capturado_por).toBe(ID.coordA)
      })
    })
  })

  it('con un ítem del catálogo, deriva el tipo y guarda el código', async () => {
    await escenario(async () => {
      await como('coordA', async () => {
        const { rows } = await client.query<{ reporte_id: string }>(
          `select reporte_id from registrar_reporte_manual($1, '11', 5, 2, 'cinco mercados')`,
          [COM1],
        )
        const { rows: rep } = await client.query<{
          tipo: string
          codigo_item: string | null
          familias: number | null
        }>(`select tipo, codigo_item, familias from reportes where id = $1`, [rows[0]!.reporte_id])
        expect(rep[0]!.tipo).toBe('necesidad')
        expect(rep[0]!.codigo_item).toBe('11')
        expect(rep[0]!.familias).toBe(5)
      })
    })
  })

  it('un rol de lectura no puede registrar un reporte manual', async () => {
    await como('lecturaA', async () => {
      expect(
        await rechazado(`select registrar_reporte_manual($1, null, null, null, 'algo')`, [COM1]),
      ).toBe(true)
    })
  })

  it('no se puede registrar en una comunidad de otra organización', async () => {
    await como('coordA', async () => {
      expect(
        await rechazado(`select registrar_reporte_manual($1, null, null, null, 'algo')`, [COM_B]),
      ).toBe(true)
    })
  })
})

conBase('el registro común se corrige por propuesta (§29.3b)', () => {
  it('un coordinador propone una corrección; un rol de lectura no', async () => {
    await escenario(async () => {
      await como('coordA', async () => {
        const { rowCount } = await client.query(
          `insert into registro_propuestas
             (tipo_propuesta, comunidad_id, organizacion_id, propuesto_por, nombre_propuesto, motivo)
           values ('correccion', $1, $2, $3, 'Coord Uno (corregido)', 'el nombre estaba mal escrito')`,
          [COM1, ORG_A, ID.coordA],
        )
        expect(rowCount).toBe(1)
      })
      await como('lecturaA', async () => {
        expect(
          await rechazado(
            `insert into registro_propuestas
               (tipo_propuesta, comunidad_id, organizacion_id, propuesto_por, nombre_propuesto, motivo)
             values ('correccion', $1, $2, $3, 'X', 'motivo')`,
            [COM1, ORG_A, ID.lecturaA],
          ),
        ).toBe(true)
      })
    })
  })

  it('aceptar una corrección aplica el cambio y marca verificado_en', async () => {
    await escenario(async () => {
      const id = await propuestaCorreccion(COM1, { nombre: 'Nombre Nuevo' })
      await como('coordA', async () => {
        const { rows } = await client.query<{ r: string }>(
          `select convite_resolver_propuesta_registro($1, true, null) as r`,
          [id],
        )
        expect(rows[0]!.r).toBe('aceptada')
        const { rows: c } = await client.query<{ nombre: string; verificado: boolean }>(
          `select nombre, (verificado_en is not null) as verificado from comunidades where id = $1`,
          [COM1],
        )
        expect(c[0]!.nombre).toBe('Nombre Nuevo')
        expect(c[0]!.verificado).toBe(true)
      })
    })
  })

  it('una corrección de existencia (no existe) desactiva la comunidad', async () => {
    await escenario(async () => {
      const id = await propuestaCorreccion(COM2, { existeReal: false })
      await como('coordA', async () => {
        const { rows } = await client.query<{ r: string }>(
          `select convite_resolver_propuesta_registro($1, true, null) as r`,
          [id],
        )
        expect(rows[0]!.r).toBe('aceptada')
        const { rows: c } = await client.query<{ activa: boolean; verificado: boolean }>(
          `select activa, (verificado_en is not null) as verificado from comunidades where id = $1`,
          [COM2],
        )
        expect(c[0]!.activa).toBe(false)
        expect(c[0]!.verificado).toBe(true)
      })
    })
  })

  it('rechazar deja la comunidad intacta', async () => {
    await escenario(async () => {
      const id = await propuestaCorreccion(COM1, { nombre: 'No Aplicar' })
      await como('coordA', async () => {
        const { rows } = await client.query<{ r: string }>(
          `select convite_resolver_propuesta_registro($1, false, 'no procede') as r`,
          [id],
        )
        expect(rows[0]!.r).toBe('rechazada')
        const { rows: c } = await client.query<{ nombre: string; verificado: boolean }>(
          `select nombre, (verificado_en is not null) as verificado from comunidades where id = $1`,
          [COM1],
        )
        expect(c[0]!.nombre).toBe('Coord Uno')
        expect(c[0]!.verificado).toBe(false)
      })
    })
  })

  it('aceptar una propuesta «nueva» crea la comunidad, ya verificada', async () => {
    await escenario(async () => {
      const { rows: pr } = await client.query<{ id: string }>(
        `insert into registro_propuestas
           (tipo_propuesta, organizacion_id, propuesto_por, nombre_propuesto, municipio_propuesto, tipo_comunidad_propuesto, motivo)
         values ('nueva', $1, $2, 'Pueblo Nuevo', 'MuniPrueba', 'vereda', 'no estaba en el registro')
         returning id`,
        [ORG_A, ID.coordA],
      )
      await como('coordA', async () => {
        const { rows } = await client.query<{ r: string }>(
          `select convite_resolver_propuesta_registro($1, true, null) as r`,
          [pr[0]!.id],
        )
        expect(rows[0]!.r).toBe('aceptada')
        const { rows: c } = await client.query<{ organizacion_id: string; verificado: boolean }>(
          `select organizacion_id, (verificado_en is not null) as verificado
             from comunidades where nombre = 'Pueblo Nuevo' and municipio = 'MuniPrueba'`,
        )
        expect(c).toHaveLength(1)
        expect(c[0]!.organizacion_id).toBe(ORG_A)
        expect(c[0]!.verificado).toBe(true)
      })
    })
  })

  it('un coordinador de otra organización no puede resolver una propuesta ajena', async () => {
    await escenario(async () => {
      const id = await propuestaCorreccion(COM1, { nombre: 'Ajeno' })
      await como('coordB', async () => {
        const { rows } = await client.query<{ r: string }>(
          `select convite_resolver_propuesta_registro($1, true, null) as r`,
          [id],
        )
        expect(rows[0]!.r).toBe('sin_permiso')
      })
    })
  })

  it('RLS: otra organización no ve una propuesta que no es suya', async () => {
    await escenario(async () => {
      const id = await propuestaCorreccion(COM1, { nombre: 'Privada' })
      await como('coordB', async () => {
        const { rows } = await client.query<{ n: string }>(
          `select count(*)::text as n from registro_propuestas where id = $1`,
          [id],
        )
        expect(rows[0]!.n).toBe('0')
      })
    })
  })

  it('RLS activo, y anon no alcanza registro_propuestas', async () => {
    const { rows: rls } = await client.query<{ relrowsecurity: boolean }>(
      `select c.relrowsecurity from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'registro_propuestas'`,
    )
    expect(rls[0]!.relrowsecurity).toBe(true)

    const { rows: grants } = await client.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where grantee = 'anon' and table_schema = 'public' and table_name = 'registro_propuestas'`,
    )
    expect(grants).toHaveLength(0)
  })
})

conBase('la capa de coordinación agregada (§29.3b)', () => {
  it('marca cubierta la comunidad con jornada y sin cubrir la que no la tiene', async () => {
    const { rows } = await client.query<{ comunidad: string; cubierta: boolean }>(
      `select comunidad, cubierta from convite_coordinacion_comunidades()
        where comunidad in ('Coord Uno', 'Coord Dos')`,
    )
    const mapa = new Map(rows.map((r) => [r.comunidad, r.cubierta]))
    expect(mapa.get('Coord Uno')).toBe(true)
    expect(mapa.get('Coord Dos')).toBe(false)
  })

  it('cuenta la demanda por municipio', async () => {
    const { rows } = await client.query<{ municipio: string; pendientes: string }>(
      `select municipio, pendientes from convite_coordinacion_demanda() where municipio = 'MuniPrueba'`,
    )
    expect(rows).toHaveLength(1)
    expect(Number(rows[0]!.pendientes)).toBeGreaterThanOrEqual(1)
  })

  it('FR-45: /coordinacion puede acotar la demanda a una de las tres familias', async () => {
    // El pedido sembrado es codigo '11' (Mercado y alimentos → familia_ayuda = 'alimentos').
    const alimentos = await client.query<{ pendientes: string }>(
      `select pendientes from convite_coordinacion_demanda('alimentos') where municipio = 'MuniPrueba'`,
    )
    expect(alimentos.rows).toHaveLength(1)
    expect(Number(alimentos.rows[0]!.pendientes)).toBeGreaterThanOrEqual(1)

    // Ninguna necesidad sembrada aquí es construcción — el municipio no aparece para esa familia.
    const construccion = await client.query<{ municipio: string }>(
      `select municipio from convite_coordinacion_demanda('construccion') where municipio = 'MuniPrueba'`,
    )
    expect(construccion.rows).toHaveLength(0)

    // null (o sin argumento) sigue leyendo todas las familias, igual que antes del filtro.
    const todas = await client.query<{ pendientes: string }>(
      `select pendientes from convite_coordinacion_demanda(null) where municipio = 'MuniPrueba'`,
    )
    expect(todas.rows).toHaveLength(1)
    expect(todas.rows[0]!.pendientes).toBe(alimentos.rows[0]!.pendientes)
  })

  it('lista los tramos reportados cerrados por nombre de comunidad', async () => {
    const { rows } = await client.query<{ origen: string; destino: string }>(
      `select origen, destino from convite_coordinacion_tramos_cerrados() where origen = 'Coord Uno'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.destino).toBe('Coord Dos')
  })

  it('cualquier nivel la puede leer, incluso un rol de lectura', async () => {
    await como('lecturaA', async () => {
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from convite_coordinacion_comunidades()`,
      )
      expect(Number(rows[0]!.n)).toBeGreaterThan(0)
    })
  })
})
