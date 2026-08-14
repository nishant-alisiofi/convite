import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { rescatarJobsColgados, TIPOS_IDEMPOTENTES } from '@/lib/jobs/reaper'
import {
  agrupacionesDeDanos,
  comunidadesEnSilencio,
  comunidadesNuncaVistas,
  HORAS_AGRUPACION_DANOS,
} from '@/lib/observabilidad/silencio'

/**
 * Silence, damage clusters, and reclaiming work a dead worker was holding.
 *
 * The through-line: all three are things that fail by being invisible. Nobody reports that a
 * community went quiet, that three landslides were one storm, or that a job vanished with the
 * process carrying it — those only exist if something goes looking.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

let pool: Pool
let client: PoolClient
let organizacion: string

/**
 * Deliberately two months after the seed runs. Nothing here deletes or rewinds seeded rows —
 * that would lock records the matcher's suite is using and make both files flaky — so the
 * clock is moved instead: from here, every seeded signal is old, and each case controls
 * recency by inserting exactly the message it is about.
 */
const AHORA = new Date('2026-10-14T15:00:00Z')
const haceDias = (d: number) => new Date(AHORA.getTime() - d * 86_400_000)
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
})

/** Puts a community in a known state: one inbound message, N days ago. */
async function ultimoContacto(codigo: string, dias: number): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'select id from comunidades where codigo = $1',
    [codigo],
  )
  const comunidad = rows[0]!.id
  const { rows: contactos } = await client.query<{ id: string }>(
    'select id from contactos where comunidad_id = $1 limit 1',
    [comunidad],
  )
  // Several seeded communities have no contacts at all, which is a real state — they are the
  // never-heard-from ones — but it makes them useless for a silence case.
  if (!contactos[0]) throw new Error(`La comunidad ${codigo} no tiene contactos sembrados.`)

  await client.query(
    `insert into mensajes (organizacion_id, proveedor, direccion, canal, contacto_id, creado_en)
     values ($1, 'whatsapp_cloud', 'entrante', 'whatsapp', $2, $3)`,
    [organizacion, contactos[0]!.id, haceDias(dias)],
  )
  return comunidad
}

conBase('el silencio es una señal (Sección 9.8)', () => {
  it('avisa de una comunidad tier alto que pasó su intervalo', async () => {
    // Winandó is tier 4 — radio relay only — and the seed checks on it more often precisely
    // because it is the one most likely to go dark without anybody noticing.
    const { rows: intervalo } = await client.query<{ intervalo_chequeo_dias: number; tier: number }>(
      `select intervalo_chequeo_dias, tier_conectividad as tier from comunidades where codigo = 'WIN'`,
    )
    await ultimoContacto('WIN', intervalo[0]!.intervalo_chequeo_dias + 5)

    const silenciosas = await comunidadesEnSilencio(client, AHORA)
    const win = silenciosas.find((c) => c.codigo === 'WIN')

    expect(win).toBeTruthy()
    expect(win!.tier).toBe(intervalo[0]!.tier)
    expect(win!.diasEnSilencio).toBeGreaterThan(win!.intervaloDias)
    // The channel that last worked, which is where a check-in should go (2.14).
    expect(win!.ultimoCanal).toBe('whatsapp')
  })

  it('NO avisa de una comunidad que escribió ayer', async () => {
    await ultimoContacto('TAG', 1)
    const silenciosas = await comunidadesEnSilencio(client, AHORA)
    expect(silenciosas.find((c) => c.codigo === 'TAG')).toBeUndefined()
  })

  it('cuenta cualquier señal, no solo un reporte', async () => {
    // Somebody confirming a delivery is as alive as somebody asking for food. Counting only
    // reports would flag a community that talks to us every day.
    const { rows } = await client.query<{ intervalo_chequeo_dias: number }>(
      `select intervalo_chequeo_dias from comunidades where codigo = 'PAC'`,
    )
    await ultimoContacto('PAC', rows[0]!.intervalo_chequeo_dias + 3)
    expect((await comunidadesEnSilencio(client, AHORA)).some((c) => c.codigo === 'PAC')).toBe(true)

    const { rows: contactos } = await client.query<{ id: string }>(
      `select c.id from contactos c join comunidades co on co.id = c.comunidad_id
        where co.codigo = 'PAC' limit 1`,
    )
    await client.query(
      `insert into mensajes (organizacion_id, proveedor, direccion, canal, contacto_id, creado_en)
       values ($1, 'sms_simulador', 'entrante', 'sms', $2, $3)`,
      [organizacion, contactos[0]!.id, haceDias(0)],
    )
    expect((await comunidadesEnSilencio(client, AHORA)).some((c) => c.codigo === 'PAC')).toBe(false)
  })

  it('no confunde «nunca hemos sabido de ellos» con «se callaron»', async () => {
    // On day one that is the whole basin, and alerting on it would make the health check red
    // from the moment it is switched on — which is how a check becomes one everyone ignores.
    const nunca = await comunidadesNuncaVistas(client, AHORA)
    const silenciosas = await comunidadesEnSilencio(client, AHORA)

    expect(nunca).toBeGreaterThan(0)
    for (const c of silenciosas) expect(c.diasEnSilencio).toBeGreaterThan(0)
  })
})

conBase('tres daños en el mismo sitio son un evento, no tres filas', () => {
  /** Files `cuantos` verified damage reports in one community. */
  async function danosVerificados(codigo: string, cuantos: number, severidad: number | null) {
    const { rows } = await client.query<{ id: string }>(
      'select id from comunidades where codigo = $1',
      [codigo],
    )
    const { rows: usuarios } = await client.query<{ id: string }>('select id from usuarios limit 1')
    for (let i = 0; i < cuantos; i++) {
      await client.query(
        `insert into reportes (organizacion_id, tipo, canal, comunidad_id, codigo_item, severidad,
                               estado, verificado_por, verificado_en, creado_en)
         values ($1, 'dano', 'whatsapp', $2, '91', $3, 'VERIFICADO', $4, $5, $5)`,
        [organizacion, rows[0]!.id, severidad, usuarios[0]!.id, haceMin(60 + i)],
      )
    }
  }

  it('guarda silencio con dos', async () => {
    await danosVerificados('TAG', 2, 2)
    const grupos = await agrupacionesDeDanos(client, AHORA)
    expect(grupos.find((g) => g.comunidades.includes('Tagachí'))).toBeUndefined()
  })

  it('con tres es UNA alerta, con la severidad más alta', async () => {
    await danosVerificados('TAG', 2, 1)
    await danosVerificados('TAG', 1, 3)

    const grupos = await agrupacionesDeDanos(client, AHORA)
    const grupo = grupos.find((g) => g.comunidades.includes('Tagachí'))

    expect(grupo).toBeTruthy()
    expect(grupo!.danos).toBe(3)
    // One row for the event, not one per report — three landslides along the same stretch of
    // river in two days is a storm, and reading it as three tickets arrives late.
    expect(grupos.filter((g) => g.comunidades.includes('Tagachí'))).toHaveLength(1)
    expect(grupo!.severidadMaxima).toBe(3)
  })

  it('no cuenta daños sin verificar: eso son tres personas preocupadas', async () => {
    // 2.1. An unverified cluster is a phone call, not an alert that reroutes boats.
    const { rows } = await client.query<{ id: string }>(
      `select id from comunidades where codigo = 'TAG'`,
    )
    for (let i = 0; i < 4; i++) {
      await client.query(
        `insert into reportes (organizacion_id, tipo, canal, comunidad_id, codigo_item, estado, creado_en)
         values ($1, 'dano', 'whatsapp', $2, '91', 'RECIBIDO', $3)`,
        [organizacion, rows[0]!.id, haceMin(30)],
      )
    }
    expect(await agrupacionesDeDanos(client, AHORA)).toEqual([])
  })

  it('se olvida honestamente cuando pasa la ventana', async () => {
    await danosVerificados('TAG', 3, 2)
    expect((await agrupacionesDeDanos(client, AHORA)).length).toBeGreaterThan(0)

    // Same rows, read three days later: the storm is over and the alert is gone on its own,
    // because it was derived rather than stored.
    const despues = new Date(AHORA.getTime() + (HORAS_AGRUPACION_DANOS + 24) * 3_600_000)
    expect(await agrupacionesDeDanos(client, despues)).toEqual([])
  })
})

conBase('reclamar lo que un worker muerto se llevó', () => {
  async function jobColgado(tipo: string, minutos: number): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `insert into jobs (tipo, estado, tomado_en, intentos) values ($1, 'corriendo', $2, 1)
       returning id`,
      [tipo, haceMin(minutos)],
    )
    return rows[0]!.id
  }

  it('devuelve a la cola un tipo que se declaró idempotente', async () => {
    const id = await jobColgado('descargar_media', 40)
    const resultado = await rescatarJobsColgados(client, 15, AHORA)

    expect(resultado.rescatados).toBe(1)
    const { rows } = await client.query<{ estado: string; intentos: number; ultimo_error: string }>(
      'select estado, intentos, ultimo_error from jobs where id = $1',
      [id],
    )
    expect(rows[0]!.estado).toBe('pendiente')
    // The attempt is NOT rolled back: a job that hangs its worker every time would otherwise
    // be reclaimed forever instead of eventually exhausting its retries.
    expect(rows[0]!.intentos).toBe(1)
    expect(rows[0]!.ultimo_error).toContain('worker murió')
  })

  it('NO toca un tipo que no se declaró, aunque lleve horas colgado', async () => {
    // Reclaiming turns the queue into at-least-once, and that is a promise the handler has to
    // be able to keep. Anything that sends stays out until dedup at the send layer is proven.
    const id = await jobColgado('procesar_webhook_whatsapp', 120)
    const resultado = await rescatarJobsColgados(client, 15, AHORA)

    expect(resultado.rescatados).toBe(0)
    expect(resultado.dejados).toBe(1)
    const { rows } = await client.query<{ estado: string }>(
      'select estado from jobs where id = $1',
      [id],
    )
    expect(rows[0]!.estado).toBe('corriendo')
  })

  it('deja en paz un job que apenas arrancó', async () => {
    await jobColgado('descargar_media', 2)
    expect((await rescatarJobsColgados(client, 15, AHORA)).rescatados).toBe(0)
  })

  it('cada tipo idempotente dice por qué lo es', () => {
    // Written down so the list cannot grow quietly: the reason is the review.
    expect(TIPOS_IDEMPOTENTES.length).toBeGreaterThan(0)
    for (const t of TIPOS_IDEMPOTENTES) {
      expect(t.porque.length, t.tipo).toBeGreaterThan(40)
    }
    // Nothing that sends is on the list.
    expect(TIPOS_IDEMPOTENTES.map((t) => t.tipo)).not.toContain('procesar_webhook_whatsapp')
  })
})
