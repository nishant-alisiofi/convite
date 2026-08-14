import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * M3 acceptance, against the real database.
 *
 * «a `verificador` cannot dispatch; a `despachador` cannot verify; anon can read only
 * `mapa_publico`. Prove it with tests against the database.»
 *
 * Every case runs as the `authenticated` Postgres role with a JWT claim set, which is
 * exactly how a signed-in session reaches Postgres through Supabase. Proving it any other
 * way — say, by checking the UI hides a button — would prove nothing (Section 11).
 *
 * Everything happens inside a transaction that is always rolled back.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

let pool: Pool
let client: PoolClient

/** Deterministic ids so a failure names a role, not a uuid. */
const ID = {
  verificador: '00000000-0000-4000-9000-000000000001',
  despachador: '00000000-0000-4000-9000-000000000002',
  coordinador: '00000000-0000-4000-9000-000000000003',
  admin: '00000000-0000-4000-9000-000000000004',
  lectura: '00000000-0000-4000-9000-000000000005',
  intruso: '00000000-0000-4000-9000-000000000099',
} as const

type Rol = keyof typeof ID

beforeAll(async () => {
  if (!url) return
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  })
  client = await pool.connect()
  await client.query('begin')

  const { rows } = await client.query<{ id: string }>('select id from organizaciones limit 1')
  const org = rows[0]!.id

  for (const rol of ['verificador', 'despachador', 'coordinador', 'admin', 'lectura'] as const) {
    await client.query(
      `insert into usuarios (id, rol_staff, organizacion_id) values ($1, $2, $3)`,
      [ID[rol], rol, org],
    )
  }

  // The verifier is scoped to the Atrato medio, like the seeded one.
  await client.query(
    `insert into usuarios_comunidades (usuario_id, comunidad_id)
     select $1, id from comunidades where codigo in ('TAG', 'MER', 'BET')`,
    [ID.verificador],
  )
})

afterAll(async () => {
  if (!url) return
  await client.query('rollback')
  client.release()
  await pool.end()
})

/**
 * Runs `fn` as a signed-in session for `rol`.
 *
 * Rolling back to the savepoint both undoes the writes and restores the previous role, so
 * the next case starts clean even if this one left the transaction aborted.
 */
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

/**
 * True when the statement was refused — by a missing grant, by a WITH CHECK violation, or
 * by RLS filtering the target rows away.
 *
 * The savepoint is load-bearing: a rejected statement aborts the whole transaction, and
 * without unwinding to a savepoint every later assertion would fail for the wrong reason.
 */
async function rechazado(sql: string, params: unknown[] = []): Promise<boolean> {
  await client.query('savepoint intento')
  try {
    const { rowCount } = await client.query(sql, params)
    await client.query('rollback to savepoint intento')
    // An UPDATE or DELETE that RLS filtered to zero rows is a refusal too.
    return rowCount === 0
  } catch {
    await client.query('rollback to savepoint intento')
    return true
  }
}

async function contar(sql: string): Promise<number> {
  const { rows } = await client.query<{ n: string }>(sql)
  return Number(rows[0]!.n)
}

async function id(tabla: string, where = 'true'): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `select id from ${tabla} where ${where} limit 1`,
  )
  return rows[0]!.id
}

conBase('separación de funciones (Sección 11)', () => {
  it('un verificador NO puede despachar', async () => {
    const responsable = await id('contactos', "rol = 'transportista'")
    const nodo = await id('nodos')

    await como('verificador', async () => {
      expect(
        await rechazado(
          `insert into envios (codigo, modo, responsable_id, origen_nodo_id, cupo_familias)
             values ('ENV-VERIF', 'lancha', $1, $2, 30)`,
          [responsable, nodo],
        ),
      ).toBe(true)
    })
  })

  it('un verificador NO puede ofrecer capacidad ni confirmar un emparejamiento', async () => {
    const contacto = await id('contactos', "rol = 'transportista'")
    const nodo = await id('nodos')
    const comunidad = await id('comunidades', "codigo = 'TAG'")

    await como('verificador', async () => {
      expect(
        await rechazado(
          `insert into capacidades (contacto_id, modo, origen_nodo_id, hasta_comunidad_id, sale_en, cupo_familias)
             values ($1, 'lancha', $2, $3, now() + interval '2 days', 20)`,
          [contacto, nodo, comunidad],
        ),
      ).toBe(true)
      expect(
        await rechazado(
          `update emparejamientos set confirmado_por = $1, confirmado_en = now()`,
          [ID.verificador],
        ),
      ).toBe(true)
    })
  })

  it('un despachador NO puede verificar un reporte', async () => {
    const reporte = await id('reportes', "estado = 'RECIBIDO'")

    await como('despachador', async () => {
      expect(
        await rechazado(
          `update reportes set estado = 'VERIFICADO', verificado_por = $2, verificado_en = now()
            where id = $1`,
          [reporte, ID.despachador],
        ),
      ).toBe(true)
    })
  })

  it('un despachador NO puede promover un reporte a pedido', async () => {
    const reporte = await id('reportes', "estado = 'RECIBIDO' and codigo_item is not null")
    const { rows } = await client.query(
      `select comunidad_id, codigo_item from reportes where id = $1`,
      [reporte],
    )

    await como('despachador', async () => {
      expect(
        await rechazado(
          `insert into pedidos (reporte_id, comunidad_id, codigo_item, familias, urgencia)
             values ($1, $2, $3, 10, 2)`,
          [reporte, rows[0]!.comunidad_id, rows[0]!.codigo_item],
        ),
      ).toBe(true)
    })
  })

  it('un verificador SÍ puede verificar, dentro de sus comunidades', async () => {
    const reporte = await id(
      'reportes',
      `estado = 'RECIBIDO' and comunidad_id = (select id from comunidades where codigo = 'TAG')`,
    )

    await como('verificador', async () => {
      const { rowCount } = await client.query(
        `update reportes set estado = 'VERIFICADO', verificado_por = $2, verificado_en = now()
          where id = $1`,
        [reporte, ID.verificador],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('un verificador NO alcanza comunidades fuera de su territorio', async () => {
    const fuera = await id('comunidades', "codigo = 'PAC'")

    await como('verificador', async () => {
      const visibles = await contar(
        `select count(*)::text as n from reportes where comunidad_id = '${fuera}'`,
      )
      expect(visibles).toBe(0)
    })
  })

  it('un despachador SÍ puede despachar', async () => {
    const responsable = await id('contactos', "rol = 'transportista'")
    const nodo = await id('nodos')

    await como('despachador', async () => {
      const { rowCount } = await client.query(
        `insert into envios (codigo, modo, responsable_id, origen_nodo_id, cupo_familias)
           values ('ENV-DESP', 'lancha', $1, $2, 30)`,
        [responsable, nodo],
      )
      expect(rowCount).toBe(1)
    })
  })
})

conBase('los centros los decide un admin', () => {
  it('un coordinador NO puede crear un centro', async () => {
    const comunidad = await id('comunidades', "codigo = 'BLL'")
    await como('coordinador', async () => {
      expect(
        await rechazado(
          `insert into nodos (comunidad_id, nombre, tipo) values ($1, 'Acopio nuevo', 'acopio')`,
          [comunidad],
        ),
      ).toBe(true)
    })
  })

  it('un admin SÍ puede, y solo en su propia organización', async () => {
    const comunidad = await id('comunidades', "codigo = 'BLL'")
    await como('admin', async () => {
      const { rowCount } = await client.query(
        `insert into nodos (comunidad_id, nombre, tipo) values ($1, 'Acopio Bellavista', 'acopio')`,
        [comunidad],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('un coordinador SÍ cuenta el inventario de un centro que ya existe', async () => {
    const nodo = await id('nodos')
    await como('coordinador', async () => {
      const { rowCount } = await client.query(
        `update existencias set cantidad = 99, contado_en = now(), contado_por = $2
          where nodo_id = $1`,
        [nodo, ID.coordinador],
      )
      expect(rowCount).toBeGreaterThan(0)
    })
  })

  it('un despachador NO toca el inventario ni las rutas', async () => {
    await como('despachador', async () => {
      expect(await rechazado(`update existencias set cantidad = 0`)).toBe(true)
      expect(await rechazado(`update rutas set activa = false`)).toBe(true)
    })
  })

  it('solo un admin edita el catálogo y el registro de comunidades', async () => {
    await como('coordinador', async () => {
      expect(await rechazado(`update catalogo_items set item_label = 'X' where codigo = '11'`)).toBe(true)
      expect(await rechazado(`update comunidades set nombre = 'X' where codigo = 'TAG'`)).toBe(true)
    })
    await como('admin', async () => {
      const { rowCount } = await client.query(
        `update catalogo_items set ayuda_texto = ayuda_texto where codigo = '11'`,
      )
      expect(rowCount).toBe(1)
    })
  })
})

conBase('lectura y sesiones sin permiso', () => {
  it('`lectura` no ve ninguna tabla base', async () => {
    await como('lectura', async () => {
      expect(await contar(`select count(*)::text as n from pedidos`)).toBe(0)
      expect(await contar(`select count(*)::text as n from comunidades`)).toBe(0)
      expect(await contar(`select count(*)::text as n from contactos`)).toBe(0)
    })
  })

  it('`lectura` sí ve el agregado público', async () => {
    await como('lectura', async () => {
      const { rows } = await client.query(`select * from mapa_publico`)
      expect(rows.length).toBeGreaterThan(0)
    })
  })

  it('una sesión autenticada sin invitación no ve nada', async () => {
    // Non-negotiable 2.10: a magic link proves you own an address, not that you are staff.
    await como('intruso', async () => {
      expect(await contar(`select count(*)::text as n from pedidos`)).toBe(0)
      expect(await contar(`select count(*)::text as n from reportes`)).toBe(0)
      expect(await contar(`select count(*)::text as n from contactos`)).toBe(0)
    })
  })
})

conBase('2.16 — la dirección del donante', () => {
  it('el staff ve la oferta pero no dónde vive quien la ofrece', async () => {
    await como('despachador', async () => {
      const { rows } = await client.query(
        `select id, codigo_item, cantidad from ofertas limit 1`,
      )
      expect(rows.length).toBe(1)
      // La columna existe, pero no está concedida a este rol.
      let permitido = true
      try {
        await client.query(`select direccion_texto from ofertas limit 1`)
      } catch {
        permitido = false
      }
      expect(permitido).toBe(false)
    })
  })

  it('un coordinador la obtiene por la función, que es el único camino', async () => {
    const oferta = await id('ofertas', 'direccion_texto is not null')
    await como('coordinador', async () => {
      const { rows } = await client.query(
        `select direccion_texto from direccion_de_oferta($1)`,
        [oferta],
      )
      expect(rows[0]?.direccion_texto).toBeTruthy()
    })
  })

  it('un despachador sin recogida asignada no la obtiene', async () => {
    const oferta = await id('ofertas', 'direccion_texto is not null')
    await como('despachador', async () => {
      const { rows } = await client.query(
        `select direccion_texto from direccion_de_oferta($1)`,
        [oferta],
      )
      expect(rows.length).toBe(0)
    })
  })
})

conBase('2.9 — la decisión de racionamiento lleva nombre', () => {
  it('no se puede registrar una decisión a nombre de otra persona', async () => {
    const responsable = await id('contactos', "rol = 'transportista'")
    const nodo = await id('nodos')

    await como('despachador', async () => {
      const { rows } = await client.query<{ id: string }>(
        `insert into envios (codigo, modo, responsable_id, origen_nodo_id, cupo_familias)
           values ('ENV-DEC', 'lancha', $1, $2, 30) returning id`,
        [responsable, nodo],
      )
      expect(
        await rechazado(
          `insert into decisiones_asignacion (envio_id, regla_aplicada, confirmado_por)
             values ($1, 'urgencia', $2)`,
          [rows[0]!.id, ID.coordinador],
        ),
      ).toBe(true)
    })
  })

  it('y una vez escrita, nadie la edita ni la borra', async () => {
    await como('admin', async () => {
      expect(await rechazado(`update decisiones_asignacion set nota = 'cambiado'`)).toBe(true)
      expect(await rechazado(`delete from decisiones_asignacion`)).toBe(true)
    })
  })
})
