import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  enviarReintentoSms,
  llamarDeVuelta,
  MANEJADORES_REINTENTO_VOZ,
  proveedorSmsSimulador,
  proveedorVozSimulador,
  recibirLlamadaPerdida,
  revisarLlamadaMarcando,
  TTL_CALLBACK_HORAS,
} from '@/lib/canales'

/**
 * The Adaptive Retry Protocol (PRD-15, Supplement v4 §6.1), against a real database.
 *
 * A callback that never moves out of `marcando` is what a dropped-before-the-webhook call
 * looks like from here — see voz/reintento.ts's header for why that timeout, not a parsed
 * event, is the trigger. From there: wait 5 minutes, retry once via SMS, never past the
 * 2-hour TTL measured from the original missed call.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

let pool: Pool
let client: PoolClient
let organizacion: string

const AHORA = new Date('2026-08-14T15:00:00Z')
const TELEFONO = '+573000000003'

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

/** Places a callback the way trabajos.ts does: a missed call, then the return dial. */
async function colocarDevolucion(): Promise<{ perdidaId: string; devolucionId: string }> {
  const proveedor = proveedorVozSimulador()
  const perdida = await recibirLlamadaPerdida(
    client,
    { id: `call-${Math.random()}`, de: '3000000003' },
    organizacion,
    { proveedor },
    AHORA,
  )
  const devolucion = await llamarDeVuelta(
    client,
    { telefono: TELEFONO, organizacionId: organizacion, llamadaOrigenId: perdida.llamadaId },
    { proveedor },
    AHORA,
  )
  if (devolucion.estado !== 'marcando') throw new Error('la devolución de prueba quedó bloqueada')
  return { perdidaId: perdida.llamadaId, devolucionId: devolucion.llamadaId }
}

conBase('marcar una llamada como fallida y programar el reintento', () => {
  it('colocar la devolución programa su propio revisar_llamada_marcando', async () => {
    const { devolucionId } = await colocarDevolucion()

    const { rows } = await client.query<{ payload: Record<string, unknown> }>(
      `select payload from jobs where tipo = 'revisar_llamada_marcando'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.payload).toMatchObject({ llamadaId: devolucionId })
  })

  it('una devolución que sigue en marcando pasa a fallida y programa el SMS', async () => {
    const { devolucionId } = await colocarDevolucion()

    const resultado = await revisarLlamadaMarcando(client, devolucionId, AHORA)
    expect(resultado).toEqual({ accion: 'reintento_programado', llamadaId: devolucionId })

    const { rows } = await client.query<{ estado: string }>(
      'select estado from llamadas where id = $1',
      [devolucionId],
    )
    expect(rows[0]!.estado).toBe('fallida')

    const { rows: trabajos } = await client.query<{ payload: Record<string, unknown> }>(
      `select payload from jobs where tipo = 'reintentar_sms_voz'`,
    )
    expect(trabajos).toHaveLength(1)
    expect(trabajos[0]!.payload).toMatchObject({ llamadaId: devolucionId })
  })

  it('una devolución que ya avanzó no se toca', async () => {
    const { devolucionId } = await colocarDevolucion()
    await client.query(`update llamadas set estado = 'grabada' where id = $1`, [devolucionId])

    const resultado = await revisarLlamadaMarcando(client, devolucionId, AHORA)
    expect(resultado).toEqual({ accion: 'sin_cambios' })

    const { rows } = await client.query<{ estado: string }>(
      'select estado from llamadas where id = $1',
      [devolucionId],
    )
    expect(rows[0]!.estado).toBe('grabada')
  })

  it('pasadas las 2 horas desde la llamada perdida original, se abandona sin programar nada', async () => {
    const { devolucionId } = await colocarDevolucion()
    const masDeDosHoras = new Date(AHORA.getTime() + (TTL_CALLBACK_HORAS * 3_600_000 + 60_000))

    const resultado = await revisarLlamadaMarcando(client, devolucionId, masDeDosHoras)
    expect(resultado.accion).toBe('abandonada')

    const { rows } = await client.query<{ n: string }>(
      `select count(*) as n from jobs where tipo = 'reintentar_sms_voz'`,
    )
    expect(Number(rows[0]!.n)).toBe(0)
  })
})

conBase('el reintento por SMS, una sola vez', () => {
  it('envía el SMS y marca sms_reintento_en', async () => {
    const { devolucionId } = await colocarDevolucion()
    await revisarLlamadaMarcando(client, devolucionId, AHORA)

    const sms = proveedorSmsSimulador()
    const cincoMin = new Date(AHORA.getTime() + 5 * 60_000)
    const resultado = await enviarReintentoSms(client, devolucionId, { proveedorSms: sms }, cincoMin)

    expect(resultado.estado).toBe('enviado')
    expect(sms.enviados).toHaveLength(1)

    const { rows } = await client.query<{ sms_reintento_en: string | null }>(
      'select sms_reintento_en from llamadas where id = $1',
      [devolucionId],
    )
    expect(rows[0]!.sms_reintento_en).not.toBeNull()
  })

  it('no lo manda dos veces', async () => {
    const { devolucionId } = await colocarDevolucion()
    await revisarLlamadaMarcando(client, devolucionId, AHORA)

    const sms = proveedorSmsSimulador()
    const cincoMin = new Date(AHORA.getTime() + 5 * 60_000)
    await enviarReintentoSms(client, devolucionId, { proveedorSms: sms }, cincoMin)
    const segundo = await enviarReintentoSms(client, devolucionId, { proveedorSms: sms }, cincoMin)

    expect(segundo).toEqual({ estado: 'ya_enviado', llamadaId: devolucionId })
    expect(sms.enviados).toHaveLength(1)
  })

  it('si el TTL vence mientras el job de 5 minutos espera, se abandona sin mandar nada', async () => {
    const { devolucionId } = await colocarDevolucion()
    await revisarLlamadaMarcando(client, devolucionId, AHORA)

    const sms = proveedorSmsSimulador()
    const pasadasDosHoras = new Date(AHORA.getTime() + (TTL_CALLBACK_HORAS * 3_600_000 + 60_000))
    const resultado = await enviarReintentoSms(client, devolucionId, { proveedorSms: sms }, pasadasDosHoras)

    expect(resultado.estado).toBe('abandonado')
    expect(sms.enviados).toHaveLength(0)
  })

  it('los manejadores registrados leen llamadaId del payload del job y hacen lo mismo', async () => {
    // `correrJobs` (lib/jobs/cola.ts) opens its own connection per job, which would run
    // outside this test's transaction — so this exercises MANEJADORES_REINTENTO_VOZ directly,
    // the same way lib/canales/voz/trabajos.ts's MANEJADORES_VOZ wires them into the worker.
    const { devolucionId } = await colocarDevolucion()

    await MANEJADORES_REINTENTO_VOZ.revisar_llamada_marcando!(
      { id: 'job-1', tipo: 'revisar_llamada_marcando', payload: { llamadaId: devolucionId }, intentos: 0, maxIntentos: 5 },
      client,
    )
    const { rows: tras1 } = await client.query<{ estado: string }>(
      'select estado from llamadas where id = $1',
      [devolucionId],
    )
    expect(tras1[0]!.estado).toBe('fallida')

    await MANEJADORES_REINTENTO_VOZ.reintentar_sms_voz!(
      { id: 'job-2', tipo: 'reintentar_sms_voz', payload: { llamadaId: devolucionId }, intentos: 0, maxIntentos: 5 },
      client,
    )
    const { rows: tras2 } = await client.query<{ sms_reintento_en: string | null }>(
      'select sms_reintento_en from llamadas where id = $1',
      [devolucionId],
    )
    expect(tras2[0]!.sms_reintento_en).not.toBeNull()
  })

  it('el manejador exige llamadaId en el payload', async () => {
    await expect(
      MANEJADORES_REINTENTO_VOZ.revisar_llamada_marcando!(
        { id: 'job-x', tipo: 'revisar_llamada_marcando', payload: {}, intentos: 0, maxIntentos: 5 },
        client,
      ),
    ).rejects.toThrow(/llamadaId/)
  })
})
