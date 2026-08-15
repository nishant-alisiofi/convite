import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Every panel screen, rendered with real rows.
 *
 * The panel sits behind a Supabase session that a local clone has not got, so until now
 * seven of these screens had never been looked at by anybody — only typechecked and covered
 * at the data layer. That gap is exactly where the bugs the harnesses caught lived: labels
 * covering the accuracy circles, a map that never fitted its bounds, a manifest routing a
 * boat past Las Mercedes and back. None of those fail a test; all of them are obvious on
 * sight.
 *
 * So the session is mocked — and only the session. Everything else is real: the actual page
 * components, the actual queries, the actual seeded basin. Each page is awaited (they are
 * async server components whose children are all synchronous), rendered to static markup,
 * asserted to have produced something, and written to `.data/vista-pantallas/` for a
 * screenshot pass.
 *
 * It doubles as the smoke test none of these screens had: proof that each one renders
 * against real data without throwing.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

const SALIDA = '.data/vista-pantallas'
const COORDINADOR = '00000000-0000-4000-8000-000000000001'

let pool: Pool
let client: PoolClient
let envioId = ''

/**
 * The only thing faked is who is signed in — the session itself is real.
 *
 * `conSesion` assumes the caller's role and sets their JWT claims so RLS applies, and this
 * does the same rather than handing over the owner connection. That is not pedantry: the
 * pickup screen reads through `recogidas_sugeridas()`, which is SECURITY DEFINER and gated
 * on `convite_es(['coordinador','admin'])`. With no claims set that gate is false and the
 * function returns nothing, so an owner connection renders an empty screen and the harness
 * reports a bug that does not exist — and would hide one that does.
 *
 * A savepoint keeps the role change from leaking into the surrounding transaction.
 */
vi.mock('@/lib/sesion', () => ({
  sesionActual: async () => ({
    authId: COORDINADOR,
    correo: 'coordinador@convite.test',
    rolStaff: 'coordinador',
    organizacionId: '',
  }),
  conSesion: async <T,>(_sesion: unknown, fn: (c: PoolClient) => Promise<T>): Promise<T> => {
    await client.query('savepoint pantalla')
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: COORDINADOR, role: 'authenticated', email: 'coordinador@convite.test' }),
    ])
    await client.query('set local role authenticated')
    try {
      return await fn(client)
    } finally {
      await client.query('reset role').catch(() => {})
      await client.query('release savepoint pantalla').catch(() => {})
    }
  },
}))

function css(): string {
  const dir = '.next/static/css'
  if (!existsSync(dir)) throw new Error('No hay CSS compilado. Corra `pnpm build` antes.')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(`${dir}/${f}`, 'utf8'))
    .join('\n')
}

function guardar(nombre: string, marcado: string): void {
  mkdirSync(SALIDA, { recursive: true })
  writeFileSync(
    `${SALIDA}/${nombre}.html`,
    `<!doctype html><html lang="es-CO"><head><meta charset="utf-8">
<title>Convite · ${nombre}</title><style>${css()}</style></head>
<body><div class="mx-auto max-w-6xl px-6 py-8">${marcado}</div></body></html>`,
  )
}

/** Renders a page component the way Next would, and keeps the markup for a human to look at. */
async function pintar(
  nombre: string,
  pagina: (props: never) => Promise<React.ReactElement>,
  props: unknown = {},
): Promise<string> {
  const elemento = await pagina(props as never)
  const marcado = renderToStaticMarkup(elemento)
  guardar(nombre, marcado)
  return marcado
}

beforeAll(async () => {
  if (!url) return
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  })
  client = await pool.connect()
  await client.query('begin')

  // A classified basin with one shipment on it, so the screens have something to show.
  const { emparejar } = await import('@/lib/matching/persistencia')
  await emparejar(client, { temporada: 'lluvias' })

  const { crearEnvio, ponerParada, ordenarPorRecorrido } = await import('@/lib/despacho/plan')
  const { rows: caps } = await client.query<{ id: string }>(
    `select id from capacidades where estado = 'OFRECIDA' order by sale_en limit 1`,
  )
  const envio = await crearEnvio(client, caps[0]!.id, COORDINADOR)
  envioId = (envio as { id: string }).id

  const { rows: pedidos } = await client.query<{ id: string; familias: number }>(
    `select p.id, p.familias from pedidos p join comunidades c on c.id = p.comunidad_id
      where c.codigo in ('TAG', 'MER') and p.estado in ('LISTO', 'SIN_CAPACIDAD')`,
  )
  for (const [i, p] of pedidos.entries()) {
    await ponerParada(client, envioId, p.id, i === 0 ? p.familias : Math.max(1, p.familias - 5))
  }
  await ordenarPorRecorrido(client, envioId, 'lluvias')
}, 120_000)

afterAll(async () => {
  if (!url) return
  await client.query('rollback')
  client.release()
  await pool.end()
})

/**
 * Nothing on a rendered screen should show React's or Postgres's internals.
 *
 * Deliberately not matching on «error» — this is a Spanish interface and the word appears in
 * ordinary copy («ponerla mal no da error: simplemente deja comunidades fuera del alcance»).
 * A check that fires on the product's own prose is a check people learn to silence.
 */
function sinEntrañas(marcado: string, nombre: string): void {
  for (const pista of [
    '[object Object]',
    'undefined</',
    '>NaN<',
    'Invalid Date',
    'TypeError',
    'at async',
    'node_modules',
    'syntax error at or near',
  ]) {
    expect(marcado.includes(pista), `${nombre} mostró «${pista}»`).toBe(false)
  }
}

conBase('cada pantalla del panel se dibuja con datos reales', () => {
  it('el tablero', async () => {
    const { default: Tablero } = await import('@/app/(panel)/tablero/page')
    const marcado = await pintar('tablero', Tablero as never)
    expect(marcado).toContain('Tablero')
    sinEntrañas(marcado, 'tablero')
  })

  it('la verificación', async () => {
    const { default: Verificacion } = await import('@/app/(panel)/verificacion/page')
    const marcado = await pintar('verificacion', Verificacion as never, {
      searchParams: Promise.resolve({}),
    })
    expect(marcado).toContain('Verificación')
    sinEntrañas(marcado, 'verificacion')
  })

  it('las rutas', async () => {
    const { default: Rutas } = await import('@/app/(panel)/rutas/page')
    const marcado = await pintar('rutas', Rutas as never, { searchParams: Promise.resolve({}) })
    expect(marcado).toContain('Rutas')
    sinEntrañas(marcado, 'rutas')
  })

  it('las rutas, confirmando un cierre', async () => {
    const { rows } = await client.query<{ id: string }>(
      `select r.id from rutas r join comunidades o on o.id = r.origen_id
         join comunidades d on d.id = r.destino_id
        where o.codigo = 'MER' and d.codigo = 'WIN' and r.temporada = 'lluvias'`,
    )
    const { default: Rutas } = await import('@/app/(panel)/rutas/page')
    const marcado = await pintar('rutas-cierre', Rutas as never, {
      searchParams: Promise.resolve({ cerrar: rows[0]!.id }),
    })
    // La consecuencia tiene que estar en pantalla antes del botón.
    expect(marcado).toContain('Winandó')
    sinEntrañas(marcado, 'rutas-cierre')
  })

  it('las recogidas', async () => {
    const { default: Recogidas } = await import('@/app/(panel)/recogidas/page')
    const marcado = await pintar('recogidas', Recogidas as never, {
      searchParams: Promise.resolve({}),
    })
    expect(marcado).toContain('Recogidas')
    sinEntrañas(marcado, 'recogidas')
  })

  it('los envíos', async () => {
    const { default: Envios } = await import('@/app/(panel)/envios/page')
    const marcado = await pintar('envios', Envios as never, {
      searchParams: Promise.resolve({}),
    })
    expect(marcado).toContain('Envíos')
    sinEntrañas(marcado, 'envios')
  })

  it('el plan de un envío', async () => {
    const { default: Envio } = await import('@/app/(panel)/envios/[id]/page')
    const marcado = await pintar('envio-plan', Envio as never, {
      params: Promise.resolve({ id: envioId }),
      searchParams: Promise.resolve({}),
    })
    expect(marcado).toContain('Paradas')
    // Un envío con recorte no sale sin que quede escrito el criterio.
    expect(marcado).toContain('cómo se repartió'.toLowerCase())
    /*
     * Y si ya no queda nada por subir, el bloque entero desaparece. Un encabezado con su
     * explicación y una lista vacía debajo se lee como una pantalla rota — se vio así en
     * el primer render, con las dos únicas paradas posibles ya en el plan.
     */
    expect(marcado).not.toContain('Lo que este viaje podría llevar')
    sinEntrañas(marcado, 'envio-plan')
  })

  it('los ajustes', async () => {
    const { default: Ajustes } = await import('@/app/(panel)/ajustes/page')
    const marcado = await pintar('ajustes', Ajustes as never, {
      searchParams: Promise.resolve({}),
    })
    expect(marcado).toContain('Temporada')
    sinEntrañas(marcado, 'ajustes')
  })

  it('el estado del sistema', async () => {
    const { default: Estado } = await import('@/app/(panel)/estado/page')
    const marcado = await pintar('estado', Estado as never)
    expect(marcado).toContain('Estado')
    sinEntrañas(marcado, 'estado')
  })

  it('la página pública', async () => {
    const { default: Respuesta } = await import('@/app/respuesta/page')
    const marcado = await pintar('publica', Respuesta as never)
    expect(marcado).toContain('Convite')
    // 2.4 otra vez, esta vez sobre el HTML que de verdad se emite.
    expect(marcado).not.toContain('Bellavista')
    expect(marcado).not.toContain('Bojayá')
    sinEntrañas(marcado, 'publica')
  })
})
