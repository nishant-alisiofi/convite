import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  estadoSistema,
  HORAS_MEDIANA_VERIFICACION,
  HORAS_SALIDA_VIEJA,
  MINUTOS_JOB_ATRASADO,
  MINUTOS_JOB_COLGADO,
  MINUTOS_SIN_PROCESAR,
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
  // Only the two tables these cases own. Deleting `reportes` here would be correct in
  // isolation and wrong in practice: vitest runs files in parallel, and holding locks on
  // rows the matcher's suite is using turns both files flaky for reasons neither describes.
  // The seed verifies nothing, so the verification cases can just add their own rows.
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

  it('detecta la cola detenida: hay trabajo y nada termina', async () => {
    // The stall the brief asks for. Note it cannot be a scheduled job: a queue cannot report
    // its own death, because the job that would raise the alarm is stuck behind the stall.
    await client.query(
      `insert into jobs (tipo, estado, correr_en, actualizado_en)
       values ('emparejar_todo', 'hecho', $1, $1)`,
      [haceMin(MINUTOS_SIN_PROCESAR + 20)],
    )
    await client.query(
      `insert into jobs (tipo, estado, correr_en) values ('descargar_media', 'pendiente', $1)`,
      [haceMin(2)],
    )

    const estado = await estadoSistema(client, AHORA)

    expect(estado.jobs.sinProcesarMin).toBeGreaterThan(MINUTOS_SIN_PROCESAR)
    expect(estado.ok).toBe(false)
    expect(estado.alertas.join(' ')).toContain('detenida')
  })

  it('una cola vacía que lleva rato quieta no es una cola detenida', async () => {
    // Nothing waiting means nothing wrong. A quiet night is allowed to look quiet.
    await client.query(
      `insert into jobs (tipo, estado, correr_en, actualizado_en)
       values ('emparejar_todo', 'hecho', $1, $1)`,
      [haceMin(600)],
    )
    const estado = await estadoSistema(client, AHORA)

    expect(estado.jobs.pendientes).toBe(0)
    expect(estado.alertas.join(' ')).not.toContain('detenida')
  })

  /** How many verified reports the median is already averaging over. */
  async function verificadosEnLaVentana(): Promise<number> {
    const { rows } = await client.query<{ n: string }>(
      `select count(*) as n from reportes
        where verificado_en is not null and creado_en >= $1::timestamptz - interval '7 days'`,
      [AHORA],
    )
    return Number(rows[0]!.n)
  }

  /** Adds `cuantos` reports that each took `horas` to verify. */
  async function verificadosQueTardaron(horas: number, cuantos: number): Promise<void> {
    const { rows: usuarios } = await client.query<{ id: string }>('select id from usuarios limit 1')
    for (let i = 0; i < cuantos; i++) {
      await client.query(
        `insert into reportes (organizacion_id, tipo, canal, estado, verificado_por, verificado_en, creado_en)
         values ($1, 'necesidad', 'whatsapp', 'VERIFICADO', $2, $3, $4)`,
        [organizacion, usuarios[0]!.id, AHORA, haceMin(horas * 60)],
      )
    }
  }

  it('mide la mediana de RECIBIDO a VERIFICADO', async () => {
    // PRD §6's day-one metric. The seed verifies its reports in the same instant they
    // arrive, so the baseline median is 0 — which is why this asserts the direction rather
    // than a fixed number: slow verifications must move it, whatever the seed happens to be.
    const antes = await estadoSistema(client, AHORA)
    expect(antes.verificacion.medianaHoras).not.toBeNull()

    await verificadosQueTardaron(6, (await verificadosEnLaVentana()) + 1)
    const despues = await estadoSistema(client, AHORA)

    expect(despues.verificacion.medianaHoras!).toBeGreaterThan(antes.verificacion.medianaHoras!)
    expect(despues.verificacion.medianaHoras!).toBeLessThanOrEqual(6)
  })

  it('avisa cuando la verificación tarda más de un día', async () => {
    // Enough slow ones to dominate whatever is already there, so the alert is about the
    // threshold and not about how big the seed is.
    await verificadosQueTardaron(
      HORAS_MEDIANA_VERIFICACION + 10,
      (await verificadosEnLaVentana()) + 1,
    )
    const estado = await estadoSistema(client, AHORA)

    expect(estado.verificacion.medianaHoras!).toBeGreaterThan(HORAS_MEDIANA_VERIFICACION)
    expect(estado.ok).toBe(false)
    expect(estado.alertas.join(' ')).toContain('falta una persona')
  })

  it('no se deja engañar por una mediana que se ve sana', async () => {
    // The trap under the metric, and the seed shows it perfectly: everything that was
    // verified was verified instantly, so the median reads 0 h — the healthiest number
    // possible — while a report nobody has touched in three days sits in the queue. A
    // dashboard reading only the median would show green through exactly that.
    await client.query(
      `insert into reportes (organizacion_id, tipo, canal, estado, creado_en)
       values ($1, 'necesidad', 'whatsapp', 'RECIBIDO', $2)`,
      [organizacion, haceMin(HORAS_MEDIANA_VERIFICACION * 3 * 60)],
    )
    const estado = await estadoSistema(client, AHORA)

    expect(estado.verificacion.medianaHoras!).toBeLessThan(HORAS_MEDIANA_VERIFICACION)
    expect(estado.verificacion.pendientes).toBeGreaterThan(0)
    expect(estado.ok).toBe(false)
    expect(estado.alertas.join(' ')).toContain('sin verificar')
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
