import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * PRD-30/PRD-31 against a real database — proving the part `tests/programas.test.ts` cannot see.
 *
 * BUG-22: `programas.fecha_inicio` / `jornadas.fecha_inicio` (Postgres `date`, no time, no
 * timezone) came back from a raw `client.query()` as a local-midnight `Date`, not the ISO string
 * every mapper types it as (no custom type parser is registered — see `db/client.ts`). The pure
 * `ventana()` tests never caught this because they call it with string literals directly; only a
 * real round trip through `pg` reproduces the `Date` object that turned into `Invalid Date`, and
 * — inside `feasibilidadDePrograma` — into `NaN` months that emptied the whole PRD-31 calendar.
 * This file proves the round trip: create with a date, read it back, and confirm it is a string
 * the rest of the app can actually use, plus the PRD-30 roster/attendance workflow this bug batch
 * added to the jornada detail screen.
 *
 * Skipped when DATABASE_URL is absent so a clone with no Postgres still has a green suite.
 * Everything writes inside one transaction that is always rolled back.
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
}
let sesionActiva: SesionMock

vi.mock('@/lib/sesion', () => ({
  sesionActual: async () => sesionActiva,
  conSesion: async <T,>(_sesion: unknown, fn: (c: PoolClient) => Promise<T>): Promise<T> => {
    await client.query('savepoint progtest')
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
      await client.query('release savepoint progtest').catch(() => {})
    }
  },
}))

// Imported after the mock is declared so the pages pick up the mocked session helpers.
import {
  agregarComunidad,
  agregarParticipante,
  crearPrograma,
  feasibilidadDePrograma,
  marcarAsistencia,
  participantesConAsistencia,
  programaPorId,
} from '@/lib/programas'
import { crearJornada, jornadaPorId, listarJornadas } from '@/lib/jornadas'
import { conSesion } from '@/lib/sesion'

let comunidadId = ''
let regionId = ''
let programaId = ''
let jornadaId = ''
let participanteId = ''

beforeAll(async () => {
  if (!url) return
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  })
  client = await pool.connect()
  await client.query('begin')

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
  }

  const com = await conSesion(sesionActiva, (c) =>
    c.query<{ id: string }>(
      `select id from comunidades where organizacion_id = $1 and activa order by nombre limit 1`,
      [sesionActiva.organizacionId],
    ),
  )
  if (!com.rows[0]) throw new Error('La organización sembrada no tiene comunidades.')
  comunidadId = com.rows[0].id

  const reg = await conSesion(sesionActiva, (c) =>
    c.query<{ id: string }>(`select id from regiones where activa order by nombre limit 1`),
  )
  if (!reg.rows[0]) throw new Error('No hay regiones sembradas.')
  regionId = reg.rows[0].id

  // A programa spanning a full calendar year — the case the QA staging run actually exercised
  // («set a monthly cadence for a year»), which is exactly the shape that tripped BUG-22/PRD-31.
  programaId = await conSesion(
    sesionActiva,
    (c) =>
      crearPrograma(
        c,
        {
          organizacionId: sesionActiva.organizacionId,
          titulo: 'Programa QA fechas (prueba)',
          objetivo: 'Probar que una fecha sobrevive un viaje real a Postgres',
          cadencia: 'mensual',
          fechaInicio: '2026-01-01',
          fechaFin: '2026-12-31',
          presupuestoComprometidoCop: 1_000_000,
        },
        sesionActiva.authId,
      ),
    { escribe: true },
  )
  await conSesion(sesionActiva, (c) => agregarComunidad(c, programaId, comunidadId, 10), {
    escribe: true,
  })

  jornadaId = await conSesion(
    sesionActiva,
    (c) =>
      crearJornada(c, {
        organizacionId: sesionActiva.organizacionId,
        tipo: 'formacion',
        titulo: 'Formación QA fechas (prueba)',
        regionId,
        programaId,
        fechaInicio: '2026-02-10',
        fechaFin: '2026-02-10',
      }),
    { escribe: true },
  )

  await conSesion(sesionActiva, (c) => agregarParticipante(c, programaId, 'Persona QA fechas', null), {
    escribe: true,
  })
  const participantes = await conSesion(sesionActiva, (c) =>
    participantesConAsistencia(c, programaId, jornadaId),
  )
  participanteId = participantes.find((p) => p.nombre === 'Persona QA fechas')!.id
}, 120_000)

afterAll(async () => {
  if (!url) return
  await client.query('rollback')
  client.release()
  await pool.end()
})

conBase('PRD-30/PRD-31 contra la base: fechas y roster', () => {
  it('un `date` de Postgres vuelve como YYYY-MM-DD, no como Date ni Invalid Date (BUG-22)', async () => {
    const programa = await conSesion(sesionActiva, (c) => programaPorId(c, programaId))
    expect(typeof programa!.fechaInicio).toBe('string')
    expect(programa!.fechaInicio).toBe('2026-01-01')
    expect(programa!.fechaFin).toBe('2026-12-31')
    expect(new Date(`${programa!.fechaInicio}T00:00:00Z`).toString()).not.toBe('Invalid Date')

    const jornada = await conSesion(sesionActiva, (c) => jornadaPorId(c, jornadaId))
    expect(typeof jornada!.fechaInicio).toBe('string')
    expect(jornada!.fechaInicio).toBe('2026-02-10')

    const jornadas = await conSesion(sesionActiva, (c) => listarJornadas(c, { programaId }))
    expect(jornadas[0]!.fechaInicio).toBe('2026-02-10')
  })

  it('el calendario de doce meses se calcula — no queda vacío por una fecha inválida (PRD-31 AC3)', async () => {
    const f = await conSesion(sesionActiva, (c) => feasibilidadDePrograma(c, programaId))
    expect(f.meses).toHaveLength(12)
    expect(f.meses[0]!.mes).toBe(0) // enero
    expect(f.meses[0]!.anio).toBe(2026)
    expect(f.meses[11]!.mes).toBe(11) // diciembre
    for (const m of f.meses) {
      expect(Number.isFinite(m.mes)).toBe(true)
      expect(Number.isFinite(m.anio)).toBe(true)
      expect(Number.isFinite(m.costoMesCop)).toBe(true)
    }
    expect(Number.isFinite(f.costoAnioCop)).toBe(true)
  })

  it('registra asistencia a una jornada y la puede corregir, sin guardar el motivo (PRD-30 AC4)', async () => {
    let roster = await conSesion(sesionActiva, (c) =>
      participantesConAsistencia(c, programaId, jornadaId),
    )
    expect(roster.find((p) => p.id === participanteId)!.asistioEnJornada).toBeNull()

    await conSesion(sesionActiva, (c) => marcarAsistencia(c, participanteId, jornadaId, true), {
      escribe: true,
    })
    roster = await conSesion(sesionActiva, (c) => participantesConAsistencia(c, programaId, jornadaId))
    expect(roster.find((p) => p.id === participanteId)!.asistioEnJornada).toBe(true)

    // Re-marking updates the same row (upsert), it does not add a second attendance record.
    await conSesion(sesionActiva, (c) => marcarAsistencia(c, participanteId, jornadaId, false), {
      escribe: true,
    })
    roster = await conSesion(sesionActiva, (c) => participantesConAsistencia(c, programaId, jornadaId))
    expect(roster.find((p) => p.id === participanteId)!.asistioEnJornada).toBe(false)

    const { rows } = await conSesion(sesionActiva, (c) =>
      c.query<{ n: string }>(
        'select count(*) as n from programa_asistencias where participante_id = $1 and jornada_id = $2',
        [participanteId, jornadaId],
      ),
    )
    expect(Number(rows[0]!.n)).toBe(1)
  })

  it('dibuja /programas con fechas legibles, sin Invalid Date ni NaN', async () => {
    const { default: Programas } = await import('@/app/(panel)/programas/page')
    const marcado = renderToStaticMarkup(
      await (Programas as (p: never) => Promise<React.ReactElement>)({
        searchParams: Promise.resolve({ ver: programaId }),
      } as never),
    )
    expect(marcado).toContain('Programa QA fechas (prueba)')
    expect(marcado).toContain('10/02/2026') // la jornada del programa, en dd/mm/yyyy
    for (const pista of ['Invalid Date', '>NaN<', '[object Object]', 'undefined</']) {
      expect(marcado.includes(pista), `la pantalla mostró «${pista}»`).toBe(false)
    }
  })

  it('dibuja /jornadas con el roster y la asistencia de la jornada, sin Invalid Date (PRD-30)', async () => {
    const { default: Jornadas } = await import('@/app/(panel)/jornadas/page')
    const marcado = renderToStaticMarkup(
      await (Jornadas as (p: never) => Promise<React.ReactElement>)({
        searchParams: Promise.resolve({ ver: jornadaId }),
      } as never),
    )
    expect(marcado).toContain('Formación QA fechas (prueba)')
    expect(marcado).toContain('10/02/2026')
    expect(marcado).toContain('Roster y asistencia')
    expect(marcado).toContain('Persona QA fechas')
    expect(marcado).toContain('no asistió')
    for (const pista of ['Invalid Date', '>NaN<', '[object Object]', 'undefined</']) {
      expect(marcado.includes(pista), `la pantalla mostró «${pista}»`).toBe(false)
    }
  })
})
