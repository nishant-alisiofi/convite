import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  comunidadesQueQuedanSinPaso,
  crearRuta,
  desactivarRuta,
  editarRuta,
  listarRutas,
  reactivarRuta,
} from '@/lib/rutas/editor'

/**
 * M8 acceptance: «a lancha route can be created and edited with no external call».
 *
 * The "no external call" half is asserted directly — `fetch` is stubbed and must never be
 * reached — because the whole reason this screen exists is that no provider has data for
 * the Atrato, and a well-meaning future edit that "enriches" a fluvial leg from a routing
 * API would be silently wrong rather than loudly broken (Section 7.3).
 *
 * Everything runs inside a transaction that is always rolled back.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

const COORDINADOR = '00000000-0000-4000-8000-000000000001'
const DESPACHADOR = '00000000-0000-4000-8000-000000000003'

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
  vi.restoreAllMocks()
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

async function comunidad(codigo: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `select id from comunidades where codigo = $1`,
    [codigo],
  )
  return rows[0]!.id
}

function tramo(origenId: string, destinoId: string) {
  return {
    origenId,
    destinoId,
    modo: 'lancha' as const,
    temporada: 'lluvias' as const,
    minutos: 80,
    distanciaM: null,
    costoEstimadoCop: 200000,
    notas: 'Subiendo por el brazo, con motor de 40.',
  }
}

conBase('el editor de rutas', () => {
  it('crea y edita un tramo de lancha sin llamar a nadie', async () => {
    await client.query('savepoint caso')
    const espia = vi.spyOn(globalThis, 'fetch')

    const bll = await comunidad('BLL')
    const pai = await comunidad('PAI')

    await como(COORDINADOR, async () => {
      expect(await crearRuta(client, tramo(bll, pai), COORDINADOR)).toEqual({ ok: true })
    })

    const creada = (await listarRutas(client)).find(
      (r) => r.origenId === bll && r.destinoId === pai,
    )!
    expect(creada.modo).toBe('lancha')
    expect(creada.minutos).toBe(80)
    // Nunca 'google': un tramo fluvial lo escribe quien conoce el río (7.3), y la base lo
    // hace cumplir con rutas_fluvial_manual_check.
    expect(creada.fuente).toBe('manual')

    await como(COORDINADOR, async () => {
      const cambio = { ...tramo(bll, pai), minutos: 95, notas: 'Con la creciente rinde menos.' }
      expect(await editarRuta(client, creada.id, cambio, COORDINADOR)).toEqual({ ok: true })
    })

    const editada = (await listarRutas(client)).find((r) => r.id === creada.id)!
    expect(editada.minutos).toBe(95)
    expect(editada.notas).toBe('Con la creciente rinde menos.')

    expect(espia).not.toHaveBeenCalled()
  })

  it('no deja duplicar el mismo tramo, modo y temporada', async () => {
    await client.query('savepoint caso')
    const bll = await comunidad('BLL')
    const pai = await comunidad('PAI')

    await como(COORDINADOR, async () => {
      await crearRuta(client, tramo(bll, pai), COORDINADOR)
      const segunda = await crearRuta(client, tramo(bll, pai), COORDINADOR)
      expect(segunda).toEqual({
        ok: false,
        error: 'Ya existe un tramo con ese origen, destino, modo y temporada.',
      })
    })
  })

  it('no deja un tramo que empieza y termina en el mismo sitio', async () => {
    await client.query('savepoint caso')
    const bll = await comunidad('BLL')

    await como(COORDINADOR, async () => {
      const resultado = await crearRuta(client, tramo(bll, bll), COORDINADOR)
      expect(resultado).toEqual({
        ok: false,
        error: 'El origen y el destino no pueden ser el mismo.',
      })
    })
  })

  it('un despachador no abre ni edita tramos', async () => {
    await client.query('savepoint caso')
    const bll = await comunidad('BLL')
    const pai = await comunidad('PAI')

    await como(DESPACHADOR, async () => {
      const creada = await crearRuta(client, tramo(bll, pai), DESPACHADOR)
      expect(creada.ok).toBe(false)
    })
  })
})

conBase('cerrar un tramo deja constancia de quién', () => {
  async function unTramoActivo(): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `select r.id from rutas r
         join comunidades o on o.id = r.origen_id
         join comunidades d on d.id = r.destino_id
        where o.codigo = 'MER' and d.codigo = 'WIN' and r.temporada = 'lluvias'`,
    )
    return rows[0]!.id
  }

  it('guarda quién lo cerró, cuándo y por qué', async () => {
    await client.query('savepoint caso')
    const id = await unTramoActivo()

    await como(COORDINADOR, async () => {
      expect(
        await desactivarRuta(client, id, 'Bajó una palizada y tapó el caño.', COORDINADOR),
      ).toEqual({ ok: true })
    })

    const cerrada = (await listarRutas(client)).find((r) => r.id === id)!
    expect(cerrada.activa).toBe(false)
    expect(cerrada.desactivadaPor).toBe(COORDINADOR)
    expect(cerrada.desactivadaEn).not.toBeNull()
    expect(cerrada.notas).toBe('Bajó una palizada y tapó el caño.')
  })

  it('no cierra un tramo sin decir por qué', async () => {
    await client.query('savepoint caso')
    const id = await unTramoActivo()

    await como(COORDINADOR, async () => {
      expect(await desactivarRuta(client, id, '   ', COORDINADOR)).toEqual({
        ok: false,
        error: 'Escriba por qué se cierra el tramo.',
      })
    })

    expect((await listarRutas(client)).find((r) => r.id === id)!.activa).toBe(true)
  })

  it('la base rechaza cerrar un tramo sin nombre, aunque nadie pase por el editor', async () => {
    await client.query('savepoint caso')
    const id = await unTramoActivo()
    // Non-negotiable 2.1 vive en la restricción, no en el formulario.
    await expect(
      client.query(`update rutas set activa = false where id = $1`, [id]),
    ).rejects.toThrow(/rutas_desactivacion_check/)
  })

  it('reabrir borra el cierre, y la historia queda en auditoría', async () => {
    await client.query('savepoint caso')
    const id = await unTramoActivo()

    await como(COORDINADOR, async () => {
      await desactivarRuta(client, id, 'Palizada.', COORDINADOR)
      expect(await reactivarRuta(client, id, COORDINADOR)).toEqual({ ok: true })
    })

    const reabierta = (await listarRutas(client)).find((r) => r.id === id)!
    expect(reabierta.activa).toBe(true)
    expect(reabierta.desactivadaPor).toBeNull()
    expect(reabierta.desactivadaEn).toBeNull()

    const { rows } = await client.query<{ accion: string }>(
      `select accion from auditoria where entidad = 'rutas' and entidad_id = $1 order by creado_en`,
      [id],
    )
    expect(rows.map((f) => f.accion)).toEqual(['ruta.desactivada', 'ruta.reactivada'])
  })
})

conBase('lo que cuesta cerrar un tramo', () => {
  it('avisa qué comunidad queda incomunicada antes de confirmar', async () => {
    await client.query('savepoint caso')
    // El caño a Winandó solo existe en lluvias y no hay otra forma de entrar.
    const { rows } = await client.query<{ id: string }>(
      `select r.id from rutas r
         join comunidades o on o.id = r.origen_id
         join comunidades d on d.id = r.destino_id
        where o.codigo = 'MER' and d.codigo = 'WIN' and r.temporada = 'lluvias'`,
    )

    expect(await comunidadesQueQuedanSinPaso(client, rows[0]!.id, 'lluvias')).toEqual(['Winandó'])
  })

  it('no alarma cuando queda otro camino', async () => {
    await client.query('savepoint caso')
    // Quibdó–Guayabal por carretera: Guayabal también se alcanza por Yuto.
    const { rows } = await client.query<{ id: string }>(
      `select r.id from rutas r
         join comunidades o on o.id = r.origen_id
         join comunidades d on d.id = r.destino_id
        where o.codigo = 'QBD' and d.codigo = 'GUY'`,
    )

    expect(await comunidadesQueQuedanSinPaso(client, rows[0]!.id, 'lluvias')).toEqual([])
  })
})
