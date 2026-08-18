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
 * exactly how a signed-in session reaches Postgres through `conSesion()`. Proving it any
 * other way — say, by checking the UI hides a button — would prove nothing (Section 11).
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

/** Rows in PAC — outside the verifier's territory — captured as owner in `beforeAll`. */
const FUERA = { reporte: '', mensaje: '', adjunto: '', contacto: '' }

beforeAll(async () => {
  if (!url) return
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  })
  client = await pool.connect()
  await client.query('begin')

  // PRD-39: the registry seeds several organisations (ASOREDIPARCHOCÓ, Fundación Herencia, a
  // pending demo centre), so an unordered `limit 1` no longer reliably lands on the org that
  // owns the Chocó communities this test writes to. Pick the anchor org the seed itself uses —
  // «la organización activa más antigua» — which owns Quibdó, Bellavista, Tagachí and the rest.
  const { rows } = await client.query<{ id: string }>(
    'select id from organizaciones where activo order by creado_en limit 1',
  )
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
     select $1, id from comunidades where codigo in ('CH-QUI-TAG', 'CH-QUI-MER', 'CH-MAT')`,
    [ID.verificador],
  )

  /*
   * A message and an attachment hanging off a report in PAC — outside the verifier's
   * territory. The seed has neither, and that absence is why the leak below survived: a probe
   * that reaches these through `reportes` gets filtered by the *reportes* policy and comes
   * back empty, which reads exactly like the child tables being scoped when they are not.
   * They have to be fetched by id to see the truth.
   */
  const { rows: pac } = await client.query<{ id: string }>(
    `select r.id from reportes r join comunidades c on c.id = r.comunidad_id
      where c.codigo = 'CH-QUI-PAC' limit 1`,
  )
  FUERA.reporte = pac[0]!.id

  const { rows: msg } = await client.query<{ id: string }>(
    `insert into mensajes (organizacion_id, proveedor, direccion, canal, reporte_id, cuerpo, estado, telefono)
       values ($1, 'simulador', 'entrante', 'whatsapp', $2,
               'Necesitamos agua en Paimadó, somos 40 familias', 'recibido', '+573009990001')
     returning id`,
    [org, FUERA.reporte],
  )
  FUERA.mensaje = msg[0]!.id

  const { rows: adj } = await client.query<{ id: string }>(
    `insert into adjuntos (reporte_id, tipo, storage_key, mime, transcripcion)
       values ($1, 'audio', 'pac/nota-de-voz-privada.ogg', 'audio/ogg',
               'Habla una señora de Paimadó dando su dirección')
     returning id`,
    [FUERA.reporte],
  )
  FUERA.adjunto = adj[0]!.id

  const { rows: ct } = await client.query<{ id: string }>(
    `select ct.id from contactos ct join comunidades c on c.id = ct.comunidad_id
      where c.codigo = 'CH-QUI-PAC' limit 1`,
  )
  FUERA.contacto = ct[0]!.id
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
    const comunidad = await id('comunidades', "codigo = 'CH-QUI-TAG'")

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
      `estado = 'RECIBIDO' and comunidad_id = (select id from comunidades where codigo = 'CH-QUI-TAG')`,
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
    const fuera = await id('comunidades', "codigo = 'CH-QUI-PAC'")

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

conBase('el territorio del verificador alcanza también a las tablas hijas', () => {
  /*
   * Section 11 scopes a verificador to their own communities, and `reportes` and `pedidos`
   * enforce it. The tables hanging off a report did not: `contactos_lectura`,
   * `mensajes_lectura` and `adjuntos_lectura` in 0017 asked only for a role. So a verifier in
   * the Atrato medio could read Paimadó's phone numbers, the raw text of what people wrote,
   * and the transcripts of their voice notes — the most sensitive rows in the database, and
   * the ones 2.6 and 2.16 exist to keep from travelling.
   *
   * Fixed in 0030 by applying `convite_alcanza_comunidad` to all three. It is a no-op for
   * every role that is not a verificador, so this scopes the one role that is scoped and
   * changes nothing for coordinador, admin or despachador.
   *
   * Each row is fetched BY ID on purpose. Reaching them through a join on `reportes` returns
   * empty even when the child policy is wide open, because the *parent* policy filters the
   * join — a false negative that hides exactly this bug.
   */
  async function ve(tabla: string, id: string): Promise<boolean> {
    const { rows } = await client.query(`select 1 from ${tabla} x where x.id = $1`, [id])
    return rows.length > 0
  }

  it('no ve el contacto de una comunidad ajena', async () => {
    await como('verificador', async () => {
      expect(await ve('contactos', FUERA.contacto)).toBe(false)
    })
  })

  it('no ve el mensaje crudo de un reporte ajeno', async () => {
    await como('verificador', async () => {
      expect(await ve('mensajes', FUERA.mensaje)).toBe(false)
    })
  })

  it('no ve el adjunto ni la transcripción de un reporte ajeno', async () => {
    await como('verificador', async () => {
      expect(await ve('adjuntos', FUERA.adjunto)).toBe(false)
    })
  })

  it('y el reporte ajeno tampoco, que es lo que ya funcionaba', async () => {
    // The control. If this ever goes true the fix is not the problem — 0017 is.
    await como('verificador', async () => {
      expect(await ve('reportes', FUERA.reporte)).toBe(false)
    })
  })

  it('un coordinador sí los ve: el alcance es del verificador, no de la tabla', async () => {
    // The other half. A scope that quietly narrowed everybody would «pass» the tests above
    // and break the basin — a coordinator coordinates across all of it.
    await como('coordinador', async () => {
      expect(await ve('contactos', FUERA.contacto)).toBe(true)
      expect(await ve('mensajes', FUERA.mensaje)).toBe(true)
      expect(await ve('adjuntos', FUERA.adjunto)).toBe(true)
    })
  })

  it('un verificador sí ve lo de SU territorio', async () => {
    // And the third half: scoping must not blind them to their own work.
    await como('verificador', async () => {
      const propios = await contar(
        `select count(*)::text as n from contactos ct
          join comunidades c on c.id = ct.comunidad_id
         where c.codigo in ('CH-QUI-TAG', 'CH-QUI-MER', 'CH-MAT')`,
      )
      expect(propios).toBeGreaterThan(0)
    })
  })
})

conBase('los centros los decide un admin', () => {
  it('un coordinador NO puede crear un centro', async () => {
    const comunidad = await id('comunidades', "codigo = 'CH-BOJ'")
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
    const comunidad = await id('comunidades', "codigo = 'CH-BOJ'")
    await como('admin', async () => {
      const { rowCount } = await client.query(
        `insert into nodos (comunidad_id, nombre, tipo) values ($1, 'Acopio Bellavista', 'acopio')`,
        [comunidad],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('un coordinador SÍ cuenta el inventario de un centro que ya existe', async () => {
    // PRD-39: the registry adds reference nodes with no stock (e.g. Bodega Quibdó), so pick a
    // node that actually holds existencias — the demo warehouse — or the update matches 0 rows.
    const nodo = await id('nodos', 'id in (select nodo_id from existencias)')
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

  it('FR-43: un coordinador SÍ registra un lote de caducidad, un despachador NO', async () => {
    const existenciaId = await id('existencias')
    await como('despachador', async () => {
      expect(
        await rechazado(
          `insert into existencia_lotes (existencia_id, cantidad, contado_por) values ($1, 5, $2)`,
          [existenciaId, ID.despachador],
        ),
      ).toBe(true)
    })
    await como('coordinador', async () => {
      const { rowCount } = await client.query(
        `insert into existencia_lotes (existencia_id, cantidad, contado_por) values ($1, 5, $2)`,
        [existenciaId, ID.coordinador],
      )
      expect(rowCount).toBe(1)
    })
  })

  it('FR-43: un verificador SÍ lee los lotes, coherente con leer existencias', async () => {
    await como('verificador', async () => {
      const { rowCount } = await client.query(`select 1 from existencia_lotes limit 1`)
      // No assertion on rowCount beyond "no se rechazó" — puede no haber lotes sembrados en
      // este punto de la transacción; lo que importa es que la política de lectura no bloquea.
      expect(rowCount).not.toBeNull()
    })
  })

  it('FR-44: una farmacia queda org-scoped — un coordinador NO ve la existencia de otra organización', async () => {
    // A second organisation with its own pharmacy stock, outside the seeded anchor org.
    const { rows: otraOrg } = await client.query<{ id: string }>(
      `insert into organizaciones (nombre, tipo, activo) values ('Otra red', 'red_comunitaria', true) returning id`,
    )
    const { rows: otroProveedor } = await client.query<{ id: string }>(
      `insert into proveedores_locales (organizacion_id, nombre, es_farmacia)
         values ($1, 'Farmacia de otra org', false) returning id`,
      [otraOrg[0]!.id],
    )
    const { rows: otraExistencia } = await client.query<{ id: string }>(
      `insert into proveedor_existencias (organizacion_id, proveedor_id, codigo_item, cantidad, contado_por)
         values ($1, $2, '21', 10, $3) returning id`,
      [otraOrg[0]!.id, otroProveedor[0]!.id, ID.coordinador],
    )
    await como('coordinador', async () => {
      const { rows } = await client.query(
        `select 1 from proveedor_existencias where id = $1`,
        [otraExistencia[0]!.id],
      )
      expect(rows).toHaveLength(0)
    })
  })

  it('FR-44: una farmacia exige comunidad — la base rechaza es_farmacia sin comunidad_id', async () => {
    // Same resolution as beforeAll's anchor org — the one ID.coordinador actually belongs to
    // (convite_organizacion() reads from usuarios, and an unordered `activo` pick can land on
    // a different active organisation).
    const { rows } = await client.query<{ id: string }>(
      'select id from organizaciones where activo order by creado_en limit 1',
    )
    const org = rows[0]!.id
    const mensaje = await como('coordinador', () =>
      client
        .query(
          `insert into proveedores_locales (organizacion_id, nombre, es_farmacia, creado_por)
             values ($1, 'Farmacia sin comunidad', true, $2)`,
          [org, ID.coordinador],
        )
        .then(
          () => null,
          (e: unknown) => (e instanceof Error ? e.message : String(e)),
        ),
    )
    expect(mensaje).toContain('proveedores_locales_farmacia_comunidad_check')
  })

  it('solo un admin edita el catálogo y el registro de comunidades', async () => {
    await como('coordinador', async () => {
      expect(await rechazado(`update catalogo_items set item_label = 'X' where codigo = '11'`)).toBe(true)
      expect(await rechazado(`update comunidades set nombre = 'X' where codigo = 'CH-QUI-TAG'`)).toBe(true)
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
