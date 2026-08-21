import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * PRD-29 against a real database: `pnpm db:up && pnpm db:reset && pnpm test`.
 *
 * Skipped when DATABASE_URL is absent so a clone with no Postgres still has a green suite. The
 * pure arithmetic is proven in tests/evaluaciones.test.ts; here we prove the parts that only the
 * database can: the RLS insert policies accept a signed write, the derivación invariant is
 * enforced by a check constraint, the bill of materials upserts one row per finding, the coverage
 * query aggregates, and the panel screen renders against real rows without leaking internals.
 *
 * Everything writes inside one transaction that is always rolled back. Only the session is faked;
 * `conSesion` still assumes the `authenticated` role and sets the JWT claims, so RLS applies
 * exactly as it does in production.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

let pool: Pool
let client: PoolClient

type SesionMock = {
  authId: string
  correo: string
  telefono: string | null
  rolStaff: string
  organizacionId: string
  esPlataforma: boolean
  estadoOrganizacion: string
  nivelAdmision: string | null
  organizacionDeclarada: boolean
  faseOrganizacion: string | null
}
let sesionActiva: SesionMock

vi.mock('@/lib/sesion', () => ({
  sesionActual: async () => sesionActiva,
  conSesion: async <T,>(_sesion: unknown, fn: (c: PoolClient) => Promise<T>): Promise<T> => {
    await client.query('savepoint eval')
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({
        sub: sesionActiva.authId,
        role: 'authenticated',
        email: sesionActiva.correo,
        ...(sesionActiva.esPlataforma ? { es_plataforma: true } : {}),
      }),
    ])
    await client.query('set local role authenticated')
    try {
      return await fn(client)
    } finally {
      await client.query('reset role').catch(() => {})
      await client.query('release savepoint eval').catch(() => {})
    }
  },
}))

// Imported after the mock is declared so the page picks up the mocked session helpers.
import {
  avanzarEvaluacionTecnica,
  bomDe,
  cobertura,
  crearEvaluacion,
  crearEvaluacionTecnica,
  crearHallazgo,
  crearPlantilla,
  filasCobertura,
  generarBom,
  guardarBom,
  listarEvaluacionesTecnicas,
  listarHallazgos,
  listarPlantillas,
} from '@/lib/evaluaciones'
import { conSesion } from '@/lib/sesion'

let comunidadId = ''
let comunidadNombre = ''
let plantillaViviendaId = ''
let hallazgoConviteId = ''

beforeAll(async () => {
  if (!url) return
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  })
  client = await pool.connect()
  await client.query('begin')

  // A real coordinator in an approved organisation — the identity every insert is signed against.
  const { rows: staff } = await client.query<{ id: string; organizacion_id: string; rol_staff: string }>(
    `select u.id, u.organizacion_id, u.rol_staff
       from usuarios u
       join organizaciones o on o.id = u.organizacion_id
      where u.rol_staff in ('coordinador', 'admin') and u.activo and o.estado_aprobacion = 'aprobada'
      order by u.creado_en
      limit 1`,
  )
  if (!staff[0]) throw new Error('No hay coordinador/admin sembrado. ¿Corrió `pnpm db:seed`?')
  sesionActiva = {
    authId: staff[0].id,
    correo: 'coordinador@convite.test',
    telefono: null,
    rolStaff: staff[0].rol_staff,
    organizacionId: staff[0].organizacion_id,
    esPlataforma: false,
    estadoOrganizacion: 'aprobada',
    nivelAdmision: 'ancla',
    organizacionDeclarada: true,
    faseOrganizacion: 'emergencia',
  }

  // A community in that organisation to hang the sweep and findings on.
  const com = await conSesion(sesionActiva, (c) =>
    c.query<{ id: string; nombre: string }>(
      `select id, nombre from comunidades where organizacion_id = $1 and activa order by nombre limit 1`,
      [sesionActiva.organizacionId],
    ),
  )
  if (!com.rows[0]) throw new Error('La organización sembrada no tiene comunidades.')
  comunidadId = com.rows[0].id
  comunidadNombre = com.rows[0].nombre

  // Two domains (AC #5): housing + water, both signed inserts through the RLS policy.
  plantillaViviendaId = await conSesion(
    sesionActiva,
    (c) =>
      crearPlantilla(
        c,
        {
          organizacionId: sesionActiva.organizacionId,
          dominio: 'vivienda',
          codigo: 'VIV-DBTEST',
          nombre: 'Reparación de vivienda (prueba)',
          materialesCop: 1_000_000,
          transporteCop: 300_000,
          asistenciaTecnicaCop: 200_000,
          manoDeObraDias: 10,
        },
        sesionActiva.authId,
      ),
    { escribe: true },
  )
  await conSesion(
    sesionActiva,
    (c) =>
      crearPlantilla(
        c,
        {
          organizacionId: sesionActiva.organizacionId,
          dominio: 'agua',
          codigo: 'AGUA-DBTEST',
          nombre: 'Rehabilitación de acueducto (prueba)',
          materialesCop: 500_000,
          transporteCop: 100_000,
          asistenciaTecnicaCop: 150_000,
          manoDeObraDias: 6,
        },
        sesionActiva.authId,
      ),
    { escribe: true },
  )

  // A sweep with a provenance and an expiry, and 40 of 100 houses assessed via three findings.
  const evaluacionId = await conSesion(
    sesionActiva,
    (c) =>
      crearEvaluacion(
        c,
        {
          organizacionId: sesionActiva.organizacionId,
          comunidadId,
          dominio: 'vivienda',
          evaluadorNombre: 'Cuadrilla de prueba',
          fechaVisita: '2026-08-01',
          totalEstimado: 100,
          venceEn: '2026-11-01',
        },
        sesionActiva.authId,
      ),
    { escribe: true },
  )

  hallazgoConviteId = await conSesion(
    sesionActiva,
    (c) =>
      crearHallazgo(
        c,
        {
          organizacionId: sesionActiva.organizacionId,
          comunidadId,
          dominio: 'vivienda',
          descripcion: 'Techo colapsado, dos aguas',
          severidad: 2,
          viaDeRespuesta: 'convite',
          evaluacionId,
        },
        sesionActiva.authId,
      ),
    { escribe: true },
  )
  await conSesion(
    sesionActiva,
    (c) =>
      crearHallazgo(
        c,
        {
          organizacionId: sesionActiva.organizacionId,
          comunidadId,
          dominio: 'salud',
          descripcion: 'Puesto de salud sin energía',
          viaDeRespuesta: 'derivacion',
          derivacionDestino: 'Secretaría de Salud departamental',
          evaluacionId,
        },
        sesionActiva.authId,
      ),
    { escribe: true },
  )
  await conSesion(
    sesionActiva,
    (c) =>
      crearHallazgo(
        c,
        {
          organizacionId: sesionActiva.organizacionId,
          comunidadId,
          dominio: 'vivienda',
          descripcion: 'Casa en pie, sin daño',
          viaDeRespuesta: 'sin_via',
          evaluacionId,
        },
        sesionActiva.authId,
      ),
    { escribe: true },
  )
}, 120_000)

afterAll(async () => {
  if (!url) return
  await client.query('rollback')
  client.release()
  await pool.end()
})

conBase('PRD-29 contra la base', () => {
  it('crea plantillas multidominio y las lee de vuelta (AC #5)', async () => {
    const plantillas = await conSesion(sesionActiva, (c) => listarPlantillas(c))
    const dominios = new Set(plantillas.map((p) => p.dominio))
    expect(dominios.has('vivienda')).toBe(true)
    expect(dominios.has('agua')).toBe(true)
  })

  it('registra un hallazgo por cada vía de respuesta (AC #6)', async () => {
    const hallazgos = await conSesion(sesionActiva, (c) => listarHallazgos(c))
    const vias = hallazgos.map((h) => h.viaDeRespuesta)
    expect(vias).toContain('convite')
    expect(vias).toContain('derivacion')
    expect(vias).toContain('sin_via')
    const derivada = hallazgos.find((h) => h.viaDeRespuesta === 'derivacion')
    expect(derivada?.derivacionDestino).toBe('Secretaría de Salud departamental')
  })

  it('la base rechaza una derivación sin destino, y un destino sin derivación (AC #6)', async () => {
    const rechazo = async (sqlText: string, params: unknown[]): Promise<string> =>
      conSesion(sesionActiva, async (c) => {
        await c.query('savepoint prueba')
        try {
          await c.query(sqlText, params)
          await c.query('rollback to savepoint prueba')
          throw new Error('la base aceptó una fila que debía rechazar')
        } catch (error) {
          await c.query('rollback to savepoint prueba')
          const msg = error instanceof Error ? error.message : String(error)
          if (msg.includes('debía rechazar')) throw error
          return msg
        }
      })

    const base = `insert into evaluacion_hallazgos
        (organizacion_id, comunidad_id, dominio, descripcion, via_de_respuesta, derivacion_destino, registrado_por)
       values ($1, $2, 'vivienda', 'x', $3, $4, $5)`
    const sinDestino = await rechazo(base, [
      sesionActiva.organizacionId,
      comunidadId,
      'derivacion',
      null,
      sesionActiva.authId,
    ])
    expect(sinDestino).toContain('evaluacion_hallazgos_derivacion_check')

    const destinoDeMas = await rechazo(base, [
      sesionActiva.organizacionId,
      comunidadId,
      'convite',
      'un mandato',
      sesionActiva.authId,
    ])
    expect(destinoDeMas).toContain('evaluacion_hallazgos_derivacion_check')
  })

  it('genera un presupuesto desde la plantilla y lo edita — un BoM por hallazgo (AC #1)', async () => {
    const plantillas = await conSesion(sesionActiva, (c) => listarPlantillas(c))
    const plantilla = plantillas.find((p) => p.id === plantillaViviendaId)!
    const propuesta = generarBom(plantilla, 2)

    await conSesion(
      sesionActiva,
      (c) =>
        guardarBom(
          c,
          {
            hallazgoId: hallazgoConviteId,
            organizacionId: sesionActiva.organizacionId,
            origen: 'plantilla',
            plantillaId: plantillaViviendaId,
            ...propuesta,
          },
          sesionActiva.authId,
        ),
      { escribe: true },
    )
    let bom = await conSesion(sesionActiva, (c) => bomDe(c, hallazgoConviteId))
    expect(bom?.materialesCop).toBe(1_000_000)
    expect(bom?.origen).toBe('plantilla')

    // Editing (the técnico adjusts) upserts the same row rather than adding a second.
    await conSesion(
      sesionActiva,
      (c) =>
        guardarBom(
          c,
          {
            hallazgoId: hallazgoConviteId,
            organizacionId: sesionActiva.organizacionId,
            origen: 'manual',
            plantillaId: plantillaViviendaId,
            materialesCop: 1_200_000,
            transporteCop: 300_000,
            asistenciaTecnicaCop: 200_000,
            manoDeObraDias: 12,
            materialesCubiertoCop: 400_000,
          },
          sesionActiva.authId,
        ),
      { escribe: true },
    )
    bom = await conSesion(sesionActiva, (c) => bomDe(c, hallazgoConviteId))
    expect(bom?.materialesCop).toBe(1_200_000)
    expect(bom?.materialesCubiertoCop).toBe(400_000)
    expect(bom?.origen).toBe('manual')

    const { rows } = await conSesion(sesionActiva, (c) =>
      c.query<{ n: string }>('select count(*) as n from hallazgo_bom where hallazgo_id = $1', [
        hallazgoConviteId,
      ]),
    )
    expect(Number(rows[0]!.n)).toBe(1)
  })

  it('calcula cobertura como evaluado sobre total, con su fecha (AC #3)', async () => {
    const filas = await conSesion(sesionActiva, (c) => filasCobertura(c))
    const cob = cobertura(filas)
    const vereda = cob.veredas.find((v) => v.comunidadId === comunidadId && v.dominio === 'vivienda')
    expect(vereda).toBeTruthy()
    expect(vereda!.evaluados).toBe(3)
    expect(vereda!.totalEstimado).toBe(100)
    expect(vereda!.fecha).toBe('2026-08-01')
  })

  it('crea una evaluación técnica y no la cuenta como barrido censal (FR-48 AC #1/#3)', async () => {
    const tecnicaId = await conSesion(
      sesionActiva,
      (c) =>
        crearEvaluacionTecnica(
          c,
          {
            organizacionId: sesionActiva.organizacionId,
            comunidadId,
            dominio: 'puente',
            asignadoA: 'Sebastián (técnico)',
            notas: 'Puente peatonal sobre la quebrada, reportado inestable.',
          },
          sesionActiva.authId,
        ),
      { escribe: true },
    )

    const tecnicas = await conSesion(sesionActiva, (c) => listarEvaluacionesTecnicas(c))
    const creada = tecnicas.find((t) => t.id === tecnicaId)
    expect(creada).toBeTruthy()
    expect(creada?.estado).toBe('solicitada')
    expect(creada?.asignadoA).toBe('Sebastián (técnico)')
    expect(creada?.dominio).toBe('puente')

    // Not a census sweep: it must not show up in the coverage rollup this org already has.
    const filas = await conSesion(sesionActiva, (c) => filasCobertura(c))
    expect(filas.some((f) => f.dominio === 'puente')).toBe(false)
  })

  it('avanza una evaluación técnica solicitada -> en curso -> completada con hallazgo (FR-48 AC #2)', async () => {
    const tecnicaId = await conSesion(
      sesionActiva,
      (c) =>
        crearEvaluacionTecnica(
          c,
          {
            organizacionId: sesionActiva.organizacionId,
            comunidadId,
            dominio: 'agua',
            asignadoA: 'Comité de agua (prueba)',
          },
          sesionActiva.authId,
        ),
      { escribe: true },
    )

    await conSesion(
      sesionActiva,
      (c) =>
        avanzarEvaluacionTecnica(c, {
          id: tecnicaId,
          organizacionId: sesionActiva.organizacionId,
          estado: 'en_curso',
        }),
      { escribe: true },
    )
    let tecnicas = await conSesion(sesionActiva, (c) => listarEvaluacionesTecnicas(c))
    expect(tecnicas.find((t) => t.id === tecnicaId)?.estado).toBe('en_curso')

    await conSesion(
      sesionActiva,
      (c) =>
        avanzarEvaluacionTecnica(c, {
          id: tecnicaId,
          organizacionId: sesionActiva.organizacionId,
          estado: 'completada',
          detalle: 'Bomba revisada: sello dañado, requiere repuesto.',
        }),
      { escribe: true },
    )
    tecnicas = await conSesion(sesionActiva, (c) => listarEvaluacionesTecnicas(c))
    const completada = tecnicas.find((t) => t.id === tecnicaId)
    expect(completada?.estado).toBe('completada')
    expect(completada?.detalle).toBe('Bomba revisada: sello dañado, requiere repuesto.')
  })

  it('dibuja la pantalla de evaluaciones con datos reales, sin filtrar entrañas', async () => {
    const { default: Evaluaciones } = await import('@/app/(panel)/evaluaciones/page')
    const marcado = renderToStaticMarkup(
      await (Evaluaciones as (p: never) => Promise<React.ReactElement>)({
        searchParams: Promise.resolve({}),
      } as never),
    )
    expect(marcado).toContain('Evaluaciones')
    expect(marcado).toContain('Cobertura')
    expect(marcado).toContain(comunidadNombre)
    expect(marcado).toContain('Secretaría de Salud departamental')
    for (const pista of ['[object Object]', 'undefined</', '>NaN<', 'Invalid Date', 'TypeError', 'node_modules']) {
      expect(marcado.includes(pista), `la pantalla mostró «${pista}»`).toBe(false)
    }
  })
})
