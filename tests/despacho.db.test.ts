import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { combinarOfertas, coberturaDePedido } from '@/lib/despacho/agregacion'
import { cargarManifiesto, croquisDe } from '@/lib/despacho/manifiesto'
import {
  candidatosParaEnvio,
  capacidadesOfrecidas,
  crearEnvio,
  despachar,
  ordenarPorRecorrido,
  ponerParada,
  registrarDecision,
} from '@/lib/despacho/plan'
import { emparejar } from '@/lib/matching/persistencia'

/**
 * M9 acceptance.
 *
 * The one that matters: «dispatching with insufficient supply is blocked until a
 * `decisiones_asignacion` row exists». Tested the way M7's guard was — from the most
 * privileged path there is, as the table owner, which is what `service_role` amounts to and
 * what every job and webhook runs as. A policy would not stop that. A trigger does.
 *
 * Everything runs inside a transaction that is always rolled back.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

const DESPACHADOR = '00000000-0000-4000-8000-000000000003'
const COORDINADOR = '00000000-0000-4000-8000-000000000001'
const VERIFICADORA = '00000000-0000-4000-8000-000000000002'
/** A transporter who can sign in: staff role `lectura`, linked to the boat's contact. */
const TRANSPORTISTA = '00000000-0000-4000-9000-000000000010'

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

  // The seeded boat's owner, given a login. Nothing in the seed does this because until now
  // there was nothing for a driver to look at.
  await client.query(
    `insert into usuarios (id, contacto_id, rol_staff, organizacion_id)
     select $1, ct.id, 'lectura', o.id
       from contactos ct, organizaciones o
      where ct.telefono = '+573000000004' limit 1`,
    [TRANSPORTISTA],
  )

  // Classify the seeded basin so there are requests with supply waiting on transport.
  await emparejar(client, { temporada: 'lluvias' })
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

async function laCapacidad(): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `select id from capacidades where estado = 'OFRECIDA' order by sale_en limit 1`,
  )
  return rows[0]!.id
}

async function pedidoEn(codigo: string): Promise<{ id: string; familias: number }> {
  const { rows } = await client.query<{ id: string; familias: number }>(
    `select p.id, p.familias from pedidos p join comunidades c on c.id = p.comunidad_id
      where c.codigo = $1 and p.estado in ('LISTO', 'SIN_CAPACIDAD') limit 1`,
    [codigo],
  )
  return rows[0]!
}

/** A plan that shorts Las Mercedes: the boat holds 40 and the two stops want 45. */
async function planConRecorte(): Promise<{ envioId: string; tag: string; mer: string }> {
  const capacidad = await laCapacidad()
  const tag = await pedidoEn('TAG')
  const mer = await pedidoEn('MER')

  const envio = await como(DESPACHADOR, () => crearEnvio(client, capacidad, DESPACHADOR))
  const envioId = (envio as { id: string }).id

  await como(DESPACHADOR, async () => {
    await ponerParada(client, envioId, tag.id, tag.familias)
    await ponerParada(client, envioId, mer.id, mer.familias - 5)
  })

  return { envioId, tag: tag.id, mer: mer.id }
}

conBase('el racionamiento se registra o el envío no sale', () => {
  it('la base bloquea el despacho con recorte, incluso como dueño de las tablas', async () => {
    await client.query('savepoint caso')
    const { envioId } = await planConRecorte()

    // Sin `set role`: dueño de las tablas, que se salta RLS por completo. Es lo que es
    // `service_role`, y lo que corre cualquier job o webhook.
    await expect(
      client.query(
        `update envios set estado = 'DESPACHADO', despachado_por = $2, despachado_en = now()
          where id = $1`,
        [envioId, DESPACHADOR],
      ),
    ).rejects.toThrow(/decisión de asignación/)
  })

  it('con la decisión registrada, sale', async () => {
    await client.query('savepoint caso')
    const { envioId } = await planConRecorte()

    await como(DESPACHADOR, async () => {
      expect(
        await registrarDecision(
          client,
          envioId,
          { regla: 'Urgencia primero, y luego los que llevan más días esperando.' },
          DESPACHADOR,
        ),
      ).toMatchObject({ ok: true })

      expect(await despachar(client, envioId, DESPACHADOR)).toEqual({ ok: true })
    })

    const { rows } = await client.query<{ estado: string; despachado_por: string }>(
      `select estado, despachado_por from envios where id = $1`,
      [envioId],
    )
    expect(rows[0]!.estado).toBe('DESPACHADO')
    expect(rows[0]!.despachado_por).toBe(DESPACHADOR)
  })

  it('un envío que alcanza para todos no necesita decisión', async () => {
    await client.query('savepoint caso')
    const capacidad = await laCapacidad()
    const tag = await pedidoEn('TAG')

    await como(DESPACHADOR, async () => {
      const envio = await crearEnvio(client, capacidad, DESPACHADOR)
      const envioId = (envio as { id: string }).id
      await ponerParada(client, envioId, tag.id, tag.familias)
      // Nadie recibe menos de lo que pidió, así que nadie fue postergado.
      expect(await despachar(client, envioId, DESPACHADOR)).toEqual({ ok: true })
    })
  })

  it('el bote no crece porque la cola sea larga', async () => {
    await client.query('savepoint caso')
    const capacidad = await laCapacidad()
    const tag = await pedidoEn('TAG')
    const mer = await pedidoEn('MER')

    await como(DESPACHADOR, async () => {
      const envio = await crearEnvio(client, capacidad, DESPACHADOR)
      const envioId = (envio as { id: string }).id
      // 30 + 15 = 45 sobre un cupo de 40, y nadie recortado: es aritmética, no reparto.
      await ponerParada(client, envioId, tag.id, tag.familias)
      await ponerParada(client, envioId, mer.id, mer.familias)

      const resultado = await despachar(client, envioId, DESPACHADOR)
      expect(resultado.ok).toBe(false)
      expect((resultado as { error: string }).error).toMatch(/cupo es/)
    })
  })

  it('no se despacha un envío vacío', async () => {
    await client.query('savepoint caso')
    const capacidad = await laCapacidad()

    await como(DESPACHADOR, async () => {
      const envio = await crearEnvio(client, capacidad, DESPACHADOR)
      const resultado = await despachar(client, (envio as { id: string }).id, DESPACHADOR)
      expect(resultado.ok).toBe(false)
      expect((resultado as { error: string }).error).toMatch(/vacío/)
    })
  })
})

conBase('la decisión de asignación es de quien la tomó, y nadie la toca después', () => {
  it('un despachador la firma con su nombre y no con el de otro', async () => {
    await client.query('savepoint caso')
    const { envioId } = await planConRecorte()

    await como(DESPACHADOR, async () => {
      await expect(
        client.query(
          `insert into decisiones_asignacion (envio_id, regla_aplicada, confirmado_por)
           values ($1, 'lo que sea', $2)`,
          [envioId, COORDINADOR],
        ),
      ).rejects.toThrow(/row-level security/)
    })
  })

  it('una verificadora no reparte: verificar y despachar son trabajos distintos', async () => {
    await client.query('savepoint caso')
    const { envioId } = await planConRecorte()

    await como(VERIFICADORA, async () => {
      const { rowCount } = await client.query(
        `insert into decisiones_asignacion (envio_id, regla_aplicada, confirmado_por)
         values ($1, 'urgencia', $2) on conflict do nothing`,
        [envioId, VERIFICADORA],
      ).catch(() => ({ rowCount: 0 }))
      expect(rowCount).toBe(0)
    })
  })

  it('nadie puede editarla ni borrarla después', async () => {
    await client.query('savepoint caso')
    const { envioId } = await planConRecorte()
    await como(DESPACHADOR, () =>
      registrarDecision(client, envioId, { regla: 'urgencia primero' }, DESPACHADOR),
    )

    for (const rol of [DESPACHADOR, COORDINADOR]) {
      await como(rol, async () => {
        // No existe política de UPDATE ni de DELETE: la ausencia es la función.
        const editado = await client.query(
          `update decisiones_asignacion set regla_aplicada = 'otra cosa' where envio_id = $1`,
          [envioId],
        )
        const borrado = await client.query(
          `delete from decisiones_asignacion where envio_id = $1`,
          [envioId],
        )
        expect(editado.rowCount).toBe(0)
        expect(borrado.rowCount).toBe(0)
      })
    }

    const { rows } = await client.query<{ regla_aplicada: string }>(
      `select regla_aplicada from decisiones_asignacion where envio_id = $1`,
      [envioId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.regla_aplicada).toBe('urgencia primero')
  })

  it('guarda a quién se postergó, leído del plan y no escrito a mano', async () => {
    await client.query('savepoint caso')
    const { envioId } = await planConRecorte()
    await como(DESPACHADOR, () =>
      registrarDecision(client, envioId, { regla: 'urgencia primero' }, DESPACHADOR),
    )

    const { rows } = await client.query<{
      pedidos_atendidos: { comunidad: string; asignadas: number; pedidas: number }[]
      pedidos_postergados: { comunidad: string }[]
    }>(
      `select pedidos_atendidos, pedidos_postergados from decisiones_asignacion where envio_id = $1`,
      [envioId],
    )

    const atendidos = rows[0]!.pedidos_atendidos
    expect(atendidos.length).toBe(2)
    // Las Mercedes queda registrada recibiendo menos de lo que pidió.
    expect(atendidos.some((a) => a.asignadas < a.pedidas)).toBe(true)
    // Y quienes ni siquiera subieron al bote quedan nombrados.
    expect(rows[0]!.pedidos_postergados.length).toBeGreaterThan(0)
  })
})

conBase('varios ofrecimientos cubren un pedido', () => {
  it('ocho personas con dos mercados cada una satisfacen un pedido de doce', async () => {
    await client.query('savepoint caso')

    const bll = await pedidoEn('BLL')
    await client.query(`update pedidos set familias = 12 where id = $1`, [bll.id])

    // Ocho vecinos ofreciendo dos cada uno: por separado ninguno alcanza.
    const ofertas: string[] = []
    for (let i = 0; i < 8; i += 1) {
      const { rows } = await client.query<{ id: string }>(
        `insert into ofertas (contacto_id, texto_original, codigo_item, cantidad, unidad, estado)
         select id, $1, '11', 2, 'mercados', 'DISPONIBLE' from contactos
          where telefono = '+573000000010'
         returning id`,
        [`tengo dos mercados para dar (${i})`],
      )
      ofertas.push(rows[0]!.id)
    }

    const antes = await como(COORDINADOR, () => coberturaDePedido(client, bll.id))
    expect(antes!.familias).toBe(12)
    expect(antes!.cubierto).toBe(0)
    expect(antes!.candidatas.length).toBeGreaterThanOrEqual(8)

    const resultado = await como(COORDINADOR, () =>
      combinarOfertas(
        client,
        bll.id,
        ofertas.slice(0, 6).map((ofertaId) => ({ ofertaId, cantidad: 2 })),
        COORDINADOR,
      ),
    )

    // Seis ofrecimientos de dos: doce familias, que es exactamente lo que se pidió.
    expect(resultado).toEqual({ ok: true, cubierto: 12 })

    const despues = await como(COORDINADOR, () => coberturaDePedido(client, bll.id))
    expect(despues!.cubierto).toBe(12)
    expect(despues!.cubierto).toBeGreaterThanOrEqual(despues!.familias)
  })

  it('cada ofrecimiento queda como su propia fila confirmada, con nombre', async () => {
    await client.query('savepoint caso')
    const bll = await pedidoEn('BLL')

    const ofertas: string[] = []
    for (let i = 0; i < 3; i += 1) {
      const { rows } = await client.query<{ id: string }>(
        `insert into ofertas (contacto_id, texto_original, codigo_item, cantidad, estado)
         select id, $1, '11', 2, 'DISPONIBLE' from contactos where telefono = '+573000000010'
         returning id`,
        [`dos mercados (${i})`],
      )
      ofertas.push(rows[0]!.id)
    }

    await como(COORDINADOR, () =>
      combinarOfertas(
        client,
        bll.id,
        ofertas.map((ofertaId) => ({ ofertaId, cantidad: 2 })),
        COORDINADOR,
      ),
    )

    const { rows } = await client.query<{ n: string; sin_firma: string }>(
      `select count(*)::text as n,
              count(*) filter (where confirmado_por is null)::text as sin_firma
         from emparejamientos where pedido_id = $1 and oferta_id is not null`,
      [bll.id],
    )
    // Antes esto era imposible: el índice único permitía una sola fila por pedido y viaje.
    expect(Number(rows[0]!.n)).toBe(3)
    // Escoger los ofrecimientos ES la confirmación humana: nadie los propuso.
    expect(rows[0]!.sin_firma).toBe('0')
  })
})

conBase('el manifiesto', () => {
  it('lleva las paradas en orden y sus cuatro dígitos', async () => {
    await client.query('savepoint caso')
    const { envioId } = await planConRecorte()

    await como(DESPACHADOR, async () => {
      await registrarDecision(client, envioId, { regla: 'urgencia primero' }, DESPACHADOR)
      await despachar(client, envioId, DESPACHADOR)
    })

    const manifiesto = await como(DESPACHADOR, () => cargarManifiesto(client, envioId))

    expect(manifiesto!.codigo).toMatch(/^E-\d{6}-\d+$/)
    expect(manifiesto!.paradas).toHaveLength(2)
    expect(manifiesto!.paradas.map((p) => p.orden)).toEqual([1, 2])
    for (const parada of manifiesto!.paradas) {
      expect(parada.codigoConfirmacion).toMatch(/^\d{4}$/)
    }
    // Únicos dentro del envío: se dictan por teléfono, no son una contraseña.
    const codigos = manifiesto!.paradas.map((p) => p.codigoConfirmacion)
    expect(new Set(codigos).size).toBe(codigos.length)
    // Y la regla con la que se repartió viaja en el papel.
    expect(manifiesto!.decision!.reglaAplicada).toBe('urgencia primero')
  })

  it('el croquis dibuja los centroides como círculos, también en papel', async () => {
    await client.query('savepoint caso')
    const { envioId } = await planConRecorte()
    await como(DESPACHADOR, async () => {
      await registrarDecision(client, envioId, { regla: 'urgencia' }, DESPACHADOR)
      await despachar(client, envioId, DESPACHADOR)
    })

    const manifiesto = await como(DESPACHADOR, () => cargarManifiesto(client, envioId))
    const croquis = croquisDe(manifiesto!)

    expect(croquis.puntos.length).toBeGreaterThanOrEqual(3)
    // El origen es un nodo ubicado a mano; las comunidades son centroides y llevan radio.
    const paradas = croquis.puntos.filter((p) => !p.esOrigen)
    expect(paradas.every((p) => p.radio > 0)).toBe(true)
  })
})

conBase('la ventana del transportista', () => {
  async function loQueVeElConductor(): Promise<{ paradas: number; codigos: number; comunidades: number }> {
    return como(TRANSPORTISTA, async () => {
      const paradas = await client.query(`select 1 from envio_items`)
      const codigos = await client.query(`select 1 from entregas`)
      const comunidades = await client.query(`select 1 from comunidades`)
      return {
        paradas: paradas.rowCount ?? 0,
        codigos: codigos.rowCount ?? 0,
        comunidades: comunidades.rowCount ?? 0,
      }
    })
  }

  it('antes de despachar no ve nada', async () => {
    await client.query('savepoint caso')
    await planConRecorte()

    // El envío existe y es suyo, pero todavía no ha salido: la ventana está cerrada.
    expect(await loQueVeElConductor()).toEqual({ paradas: 0, codigos: 0, comunidades: 0 })
  })

  it('mientras va en camino ve sus paradas, sus códigos y dónde queda cada una', async () => {
    await client.query('savepoint caso')
    const { envioId } = await planConRecorte()
    await como(DESPACHADOR, async () => {
      await registrarDecision(client, envioId, { regla: 'urgencia' }, DESPACHADOR)
      await despachar(client, envioId, DESPACHADOR)
    })

    const visto = await loQueVeElConductor()
    expect(visto.paradas).toBe(2)
    expect(visto.codigos).toBe(2)
    // Solo las comunidades a las que va, nunca la cuenca entera.
    expect(visto.comunidades).toBe(2)
  })

  it('al volver se le cierra', async () => {
    await client.query('savepoint caso')
    const { envioId } = await planConRecorte()
    await como(DESPACHADOR, async () => {
      await registrarDecision(client, envioId, { regla: 'urgencia' }, DESPACHADOR)
      await despachar(client, envioId, DESPACHADOR)
    })
    await client.query(`update envios set regreso_real = now() where id = $1`, [envioId])

    // Quien hizo un viaje en marzo no sigue sacando coordenadas en agosto.
    expect(await loQueVeElConductor()).toEqual({ paradas: 0, codigos: 0, comunidades: 0 })
  })
})

conBase('el planeador', () => {
  it('ofrece los pedidos que ese viaje puede servir, y no los demás', async () => {
    await client.query('savepoint caso')
    const capacidad = await laCapacidad()

    const candidatos = await como(DESPACHADOR, () =>
      candidatosParaEnvio(client, capacidad, 'lluvias'),
    )

    const comunidades = candidatos.map((c) => c.comunidad)
    // El bote va a Tagachí desde Quibdó; Las Mercedes queda en el camino.
    expect(comunidades).toContain('Tagachí')
    expect(comunidades).toContain('Las Mercedes')
    // Bellavista está noventa minutos más abajo: no está de paso.
    expect(comunidades).not.toContain('Bellavista')
  })

  it('avisa cuando lo que sostiene un pedido se vence antes de que el bote salga', async () => {
    await client.query('savepoint caso')
    const capacidad = await laCapacidad()
    const tag = await pedidoEn('TAG')

    // Una oferta perecedera que no llega a la salida del domingo (2.15).
    const { rows } = await client.query<{ id: string }>(
      `insert into ofertas (contacto_id, texto_original, codigo_item, cantidad, estado,
                            perecedero, vence_en)
       select id, 'almuerzos para mañana', '11', 40, 'DISPONIBLE', true, now() + interval '12 hours'
         from contactos where telefono = '+573000000011'
       returning id`,
    )
    await client.query(`update pedidos set oferta_sugerida = $2 where id = $1`, [
      tag.id,
      rows[0]!.id,
    ])

    const candidatos = await como(DESPACHADOR, () =>
      candidatosParaEnvio(client, capacidad, 'lluvias'),
    )
    const tagachi = candidatos.find((c) => c.pedidoId === tag.id)!
    expect(tagachi.venceAntesDeSalir).toBe(true)
  })

  it('lista las capacidades ofrecidas con su salida', async () => {
    await client.query('savepoint caso')
    const capacidades = await como(DESPACHADOR, () => capacidadesOfrecidas(client))
    expect(capacidades.length).toBeGreaterThan(0)
    expect(capacidades[0]!.cupoFamilias).toBeGreaterThan(0)
    expect(capacidades[0]!.saleEn).toBeInstanceOf(Date)
  })
})

conBase('el orden de las paradas', () => {
  it('sigue el recorrido y no el orden en que se agregaron', async () => {
    await client.query('savepoint caso')
    const capacidad = await laCapacidad()
    const tag = await pedidoEn('TAG')
    const mer = await pedidoEn('MER')

    await como(DESPACHADOR, async () => {
      const envio = await crearEnvio(client, capacidad, DESPACHADOR)
      const envioId = (envio as { id: string }).id

      // Agregadas por urgencia: Tagachí primero, que es como llega la cola.
      await ponerParada(client, envioId, tag.id, 20)
      await ponerParada(client, envioId, mer.id, 10)
      await ordenarPorRecorrido(client, envioId, 'lluvias')

      const { rows } = await client.query<{ codigo: string; orden_parada: number }>(
        `select c.codigo, ei.orden_parada
           from envio_items ei
           join pedidos p on p.id = ei.pedido_id
           join comunidades c on c.id = p.comunidad_id
          where ei.envio_id = $1 order by ei.orden_parada`,
        [envioId],
      )

      // Las Mercedes queda entre Quibdó y Tagachí: pasar de largo y devolverse es un viaje
      // que nadie hace. La urgencia decide quién sube al bote; la geografía, en qué orden.
      expect(rows.map((r) => r.codigo)).toEqual(['MER', 'TAG'])
    })
  })
})
