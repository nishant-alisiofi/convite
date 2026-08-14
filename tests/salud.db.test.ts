import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  estadoSistema,
  HORAS_SALIDA_VIEJA,
  MINUTOS_JOB_ATRASADO,
  MINUTOS_JOB_COLGADO,
} from '@/lib/observabilidad/salud'

/**
 * The health check, tested against the failures it exists to catch.
 *
 * PRD §6: «a silently failing matcher looks exactly like a quiet week». So the assertions
 * here are mostly about the endpoint refusing to say everything is fine — a health check
 * that only ever returns ok is worse than none, because it converts an outage into a green
 * dashboard somebody trusts.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

let pool: Pool
let client: PoolClient
let organizacion: string
let contacto: string

const AHORA = new Date('2026-08-14T15:00:00Z')
const haceMin = (m: number) => new Date(AHORA.getTime() - m * 60_000)

beforeAll(async () => {
  if (!url) return
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  })
  client = await pool.connect()
  await client.query('begin')
  const { rows } = await client.query<{ id: string }>('select id from organizaciones limit 1')
  organizacion = rows[0]!.id
  const { rows: contactos } = await client.query<{ id: string }>(
    `select id from contactos where telefono = '+573000000001'`,
  )
  contacto = contactos[0]!.id
  await client.query('savepoint caso')
})

afterAll(async () => {
  if (!url) return
  await client.query('rollback')
  client.release()
  await pool.end()
})

beforeEach(async () => {
  if (!url) return
  await client.query('rollback to savepoint caso')
  // The seed leaves a clean queue; each case creates exactly the failure it is about.
  await client.query('delete from jobs')
  await client.query('delete from salidas_pendientes')
})

conBase('el estado del sistema', () => {
  it('con la cola al día, dice que está bien', async () => {
    const estado = await estadoSistema(client, AHORA)

    expect(estado.ok).toBe(true)
    expect(estado.alertas).toEqual([])
    expect(estado.base.conectada).toBe(true)
    // Migrations are counted, so a half-deployed database is visible rather than implied.
    expect(estado.base.migraciones).toBeGreaterThan(20)
  })

  it('un job pendiente y recién vencido todavía no es una alarma', async () => {
    // The worker runs on a cron. A job that came due a minute ago is waiting, not stuck, and
    // a check that shouts about it teaches everyone to ignore it.
    await client.query(
      `insert into jobs (tipo, estado, correr_en) values ('emparejar_todo', 'pendiente', $1)`,
      [haceMin(2)],
    )
    const estado = await estadoSistema(client, AHORA)

    expect(estado.ok).toBe(true)
    expect(estado.jobs.pendientes).toBe(1)
  })

  it('detecta que nadie está corriendo la cola', async () => {
    // This is the quiet week. Nothing errors, nothing 500s, and reports pile up unmatched.
    await client.query(
      `insert into jobs (tipo, estado, correr_en) values ('emparejar_todo', 'pendiente', $1)`,
      [haceMin(MINUTOS_JOB_ATRASADO + 5)],
    )
    const estado = await estadoSistema(client, AHORA)

    expect(estado.ok).toBe(false)
    expect(estado.alertas.join(' ')).toContain('sin correr')
    expect(estado.jobs.atrasoSeg).toBeGreaterThan(MINUTOS_JOB_ATRASADO * 60)
  })

  it('detecta un job que se quedó colgado con el worker muerto', async () => {
    // `tomarUno` only ever claims 'pendiente', so a row left at 'corriendo' is work that is
    // gone, not work that is late. Nothing retries it, which is why it needs saying out loud.
    await client.query(
      `insert into jobs (tipo, estado, tomado_en) values ('descargar_media', 'corriendo', $1)`,
      [haceMin(MINUTOS_JOB_COLGADO + 5)],
    )
    const estado = await estadoSistema(client, AHORA)

    expect(estado.ok).toBe(false)
    expect(estado.jobs.colgados).toBe(1)
    expect(estado.alertas.join(' ')).toContain('nadie los va a reintentar')
  })

  it('un job que acaba de arrancar no cuenta como colgado', async () => {
    await client.query(
      `insert into jobs (tipo, estado, tomado_en) values ('descargar_media', 'corriendo', $1)`,
      [haceMin(1)],
    )
    const estado = await estadoSistema(client, AHORA)

    expect(estado.jobs.colgados).toBe(0)
    expect(estado.ok).toBe(true)
  })

  it('avisa de los jobs que agotaron sus reintentos', async () => {
    await client.query(
      `insert into jobs (tipo, estado, ultimo_error) values ('descargar_media', 'fallido', 'HTTP 404')`,
    )
    const estado = await estadoSistema(client, AHORA)

    expect(estado.ok).toBe(false)
    expect(estado.jobs.fallidos).toBe(1)
    expect(estado.alertas.join(' ')).toContain('reintentos')
  })

  it('avisa de respuestas encoladas que llevan días sin salir', async () => {
    // Either nobody has reappeared to piggyback on, or the sender is broken. Both are
    // somebody waiting on a folio that never came (2.14).
    await client.query(
      `insert into salidas_pendientes (contacto_id, cuerpo, creado_en) values ($1, $2, $3)`,
      [contacto, 'Recibimos su reporte.', haceMin((HORAS_SALIDA_VIEJA + 12) * 60)],
    )
    const estado = await estadoSistema(client, AHORA)

    expect(estado.ok).toBe(false)
    expect(estado.salidas.encoladas).toBe(1)
    expect(estado.alertas.join(' ')).toContain('encoladas')
  })

  it('lleva el presupuesto de voz al mismo tablero', async () => {
    await client.query(
      `insert into llamadas (organizacion_id, proveedor, telefono, tipo, estado, duracion_seg, iniciada_en)
       values ($1, 'voz_simulador', '+573000000002', 'devolucion', 'grabada', $2, $3)`,
      [organizacion, 100 * 60, haceMin(60)],
    )
    const estado = await estadoSistema(client, AHORA)

    // 100 of 120 minutes is past the 70% line but not yet off.
    expect(estado.voz.alerta).toBe(true)
    expect(estado.voz.agotado).toBe(false)
    expect(estado.ok).toBe(false)
    expect(estado.alertas.join(' ')).toContain('presupuesto de voz')
  })

  it('junta varias alarmas en vez de reportar solo la primera', async () => {
    // A morning where three things broke should read as three things.
    await client.query(
      `insert into jobs (tipo, estado, correr_en) values ('emparejar_todo', 'pendiente', $1)`,
      [haceMin(60)],
    )
    await client.query(
      `insert into jobs (tipo, estado, ultimo_error) values ('descargar_media', 'fallido', 'x')`,
    )
    const estado = await estadoSistema(client, AHORA)

    expect(estado.alertas.length).toBeGreaterThanOrEqual(2)
  })

  it('no devuelve nada que identifique a nadie', async () => {
    // The route is unauthenticated, so 2.4 applies to it hardest. Counts only.
    await client.query(
      `insert into salidas_pendientes (contacto_id, cuerpo) values ($1, 'Recibimos su reporte.')`,
      [contacto],
    )
    const estado = await estadoSistema(client, AHORA)
    const serializado = JSON.stringify(estado)

    expect(serializado).not.toContain('+5730')
    expect(serializado).not.toContain('Recibimos')
    expect(serializado).not.toContain(contacto)
    for (const clave of ['telefono', 'nombre', 'ubicacion', 'folio', 'cuerpo']) {
      expect(serializado, clave).not.toContain(clave)
    }
  })
})
