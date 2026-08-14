import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { rutasAfectadasPor } from '@/lib/verificacion/danos'

/**
 * M11, panel side: a damage report points at the legs it might be about, and never closes
 * one by itself.
 *
 * Section 9.3 is a rule about authority, not about plumbing — «un solo reporte falso o
 * exagerado no puede» cut a basin off. So the assertion that matters is the negative one:
 * looking at the affected routes changes nothing.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

const COORDINADOR = '00000000-0000-4000-8000-000000000001'

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

/** The seeded damage report: «bajó una palizada grande y tapó el paso antes de Tagachí». */
async function elDano(): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `select id from reportes where tipo = 'dano' and estado = 'RECIBIDO' limit 1`,
  )
  return rows[0]!.id
}

conBase('el daño y los tramos', () => {
  it('ofrece los tramos que tocan esa comunidad, en ambos sentidos', async () => {
    await client.query('savepoint caso')
    const dano = await elDano()
    const rutas = await como(COORDINADOR, () => rutasAfectadasPor(client, dano, 'lluvias'))

    expect(rutas.length).toBeGreaterThan(0)
    // El daño es en Tagachí, así que todo lo ofrecido lo toca por un extremo o el otro.
    for (const r of rutas) {
      expect(r.origen === 'Tagachí' || r.destino === 'Tagachí').toBe(true)
    }
  })

  it('cerrar el cuello de Tagachí no incomunica a nadie, porque Tagachí tiene acopio propio', async () => {
    await client.query('savepoint caso')
    const dano = await elDano()
    const rutas = await como(COORDINADOR, () => rutasAfectadasPor(client, dano, 'lluvias'))

    const cuello = rutas.find((r) => r.origen === 'Las Mercedes' && r.destino === 'Tagachí')
    expect(cuello).toBeDefined()

    /*
     * El seed llama a este tramo el cuello de botella, y en la práctica lo es: por ahí pasa
     * todo lo que sale de Quibdó hacia abajo. Pero «incomunicada» se mide como lo mide el
     * emparejador — desde CUALQUIER comunidad con nodo activo — y Tagachí tiene su propio
     * acopio, así que desde ahí se sigue alcanzando Beté y Bellavista.
     *
     * Se afirma tal cual, y no se ajusta la medida para que el aviso suene más grave: si
     * esta pantalla dijera «deja sin paso a Beté» y el emparejador después no marcara
     * SIN_RUTA, el aviso sería mentira. Lo que sí queda escondido detrás de un acopio de 18
     * mercados contados hace 19 días es harina de otro costal, y es un aviso de inventario
     * viejo (2.3), no de alcance.
     */
    expect(cuello!.dejaSinPaso).toEqual([])
  })

  it('cuando un cierre sí incomunica, lo dice antes de confirmar', async () => {
    await client.query('savepoint caso')

    // Un daño reportado desde Las Mercedes: por ahí sale el caño a Winandó, que en lluvias
    // es la única entrada y en seca no existe.
    const { rows } = await client.query<{ id: string }>(
      `insert into reportes (organizacion_id, tipo, canal, comunidad_id, codigo_item,
                             severidad, descripcion, estado)
       select o.id, 'dano', 'whatsapp', c.id, '92', 3,
              'Se tapó el caño con palos y basura.', 'RECIBIDO'
         from organizaciones o, comunidades c where c.codigo = 'MER' limit 1
       returning id`,
    )

    const rutas = await como(COORDINADOR, () =>
      rutasAfectadasPor(client, rows[0]!.id, 'lluvias'),
    )
    const alCano = rutas.find((r) => r.destino === 'Winandó' || r.origen === 'Winandó')
    expect(alCano).toBeDefined()
    expect(alCano!.dejaSinPaso).toEqual(['Winandó'])
  })

  it('mirar los tramos no cierra ninguno', async () => {
    await client.query('savepoint caso')
    const antes = await client.query<{ n: string }>(
      `select count(*)::text as n from rutas where activa`,
    )

    const dano = await elDano()
    await como(COORDINADOR, () => rutasAfectadasPor(client, dano, 'lluvias'))

    const despues = await client.query<{ n: string }>(
      `select count(*)::text as n from rutas where activa`,
    )
    // 2.1: el reporte llega, una persona lo verifica, y ahí se cierra el tramo. Nunca solo.
    expect(despues.rows[0]!.n).toBe(antes.rows[0]!.n)
  })

  it('no ofrece tramos ya cerrados', async () => {
    await client.query('savepoint caso')
    const dano = await elDano()
    const rutas = await como(COORDINADOR, () => rutasAfectadasPor(client, dano, 'lluvias'))
    const uno = rutas[0]!

    await client.query(
      `update rutas set activa = false, desactivada_por = $2, desactivada_en = now()
        where id = $1`,
      [uno.id, COORDINADOR],
    )

    const despues = await como(COORDINADOR, () => rutasAfectadasPor(client, dano, 'lluvias'))
    expect(despues.map((r) => r.id)).not.toContain(uno.id)
  })
})
