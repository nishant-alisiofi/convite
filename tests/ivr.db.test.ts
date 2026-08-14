import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  devolverLlamada,
  type Interaccion,
  llamarDeVuelta,
  presupuestoVoz,
  PROMPTS,
  type ProveedorVoz,
  proveedorVozSimulador,
  recibirLlamadaPerdida,
  revisarTopes,
  TOPE_POR_NUMERO_30MIN,
} from '@/lib/canales'

/**
 * M10 acceptance, against a real database.
 *
 * «A caller with zero balance and one bar of signal completes a report end to end with no
 * data session.» That is simulated here as the whole chain — missed call, rejected
 * unanswered, callback, menu, recording, reporte with a folio dictated back — plus the caps
 * that keep the channel from spending money on its own.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

let pool: Pool
let client: PoolClient
let organizacion: string

const AHORA = new Date('2026-08-14T15:00:00Z')
const TELEFONO = '+573000000002' // Élver, tier-4 Winandó: radio relay, no data session.

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

const grabacion: Interaccion = { tecla: '1', grabacionRef: 'rec-abc123', duracionSeg: 47 }

/** Writes a completed callback straight in, to set up cap and budget scenarios. */
async function devolucionPrevia(minutosAtras: number, duracionSeg = 60): Promise<void> {
  await client.query(
    `insert into llamadas (organizacion_id, proveedor, telefono, tipo, estado, duracion_seg, iniciada_en)
     values ($1, 'voz_simulador', $2, 'devolucion', 'grabada', $3, $4)`,
    [organizacion, TELEFONO, duracionSeg, new Date(AHORA.getTime() - minutosAtras * 60_000)],
  )
}

conBase('la llamada perdida no le cuesta nada a quien llama', () => {
  it('cuelga sin contestar y la deja registrada', async () => {
    const proveedor = proveedorVozSimulador()

    const perdida = await recibirLlamadaPerdida(
      client,
      { id: 'call-0001', de: '3000000002' },
      organizacion,
      { proveedor },
      AHORA,
    )

    // Rejected, never answered: an unanswered call is billed to nobody.
    expect(proveedor.rechazadas).toEqual(['call-0001'])
    expect(proveedor.llamadas).toEqual([])
    expect(perdida.telefono).toBe(TELEFONO)

    const { rows } = await client.query<{ tipo: string; estado: string; duracion_seg: number }>(
      'select tipo, estado, duracion_seg from llamadas where id = $1',
      [perdida.llamadaId],
    )
    expect(rows[0]).toMatchObject({ tipo: 'perdida', estado: 'rechazada', duracion_seg: 0 })
  })

  it('el mismo webhook dos veces deja una sola llamada', async () => {
    // 2.7: providers retry call webhooks exactly like message webhooks.
    const proveedor = proveedorVozSimulador()
    const uno = await recibirLlamadaPerdida(client, { id: 'call-0002', de: '3000000002' }, organizacion, { proveedor }, AHORA)
    const dos = await recibirLlamadaPerdida(client, { id: 'call-0002', de: '3000000002' }, organizacion, { proveedor }, AHORA)

    expect(dos.duplicada).toBe(true)
    expect(dos.llamadaId).toBe(uno.llamadaId)
    const { rows } = await client.query<{ n: string }>(
      `select count(*) as n from llamadas where proveedor_llamada_id = 'call-0002'`,
    )
    expect(Number(rows[0]!.n)).toBe(1)
  })
})

conBase('aceptación: un reporte completo sin sesión de datos', () => {
  it('perdida → devolución → menú → grabación → reporte con folio dictado', async () => {
    const proveedor = proveedorVozSimulador()

    await recibirLlamadaPerdida(client, { id: 'call-1', de: '3000000002' }, organizacion, { proveedor }, AHORA)
    const resultado = await devolverLlamada(
      client,
      { telefono: TELEFONO, organizacionId: organizacion },
      grabacion,
      { proveedor },
      AHORA,
    )

    expect(resultado.estado).toBe('grabada')
    if (resultado.estado !== 'grabada') return

    // We paid for exactly one outbound call.
    expect(proveedor.llamadas).toHaveLength(1)

    // The caller heard the welcome, the menu, the record prompt, and their folio dictated.
    expect(resultado.guion[0]).toBe(PROMPTS.bienvenida)
    expect(resultado.guion[1]).toBe(PROMPTS.menu)
    expect(resultado.guion[2]).toBe(PROMPTS.grabar)
    expect(resultado.guion.at(-1)).toContain('Repito')
    expect(resultado.folio).toBeGreaterThan(0)

    const { rows } = await client.query<{
      canal: string
      tipo: string
      estado: string
      codigo_item: string | null
      detalle_libre: string | null
    }>(
      'select canal, tipo, estado, codigo_item, detalle_libre from reportes where id = $1',
      [resultado.reporteId],
    )
    const reporte = rows[0]!
    expect(reporte.canal).toBe('ivr')
    // Key 1 said «pedir ayuda», so the type is known. WHAT they need waits for a transcript
    // that D8 has not authorised anyone to make, so the item stays null rather than guessed.
    expect(reporte.tipo).toBe('necesidad')
    expect(reporte.codigo_item).toBeNull()
    expect(reporte.detalle_libre).toBeNull()
    expect(reporte.estado).toBe('RECIBIDO')

    // The call row carries the keyed path and points at the report.
    const { rows: llamadas } = await client.query<{
      estado: string
      ruta_tecleada: string
      duracion_seg: number
      reporte_id: string
    }>('select estado, ruta_tecleada, duracion_seg, reporte_id from llamadas where id = $1', [
      resultado.llamadaId,
    ])
    expect(llamadas[0]).toMatchObject({
      estado: 'grabada',
      ruta_tecleada: '1',
      duracion_seg: 47,
      reporte_id: resultado.reporteId,
    })
  })

  it('la grabación entra al mismo pipeline de media que una nota de voz', async () => {
    const proveedor = proveedorVozSimulador()
    await devolverLlamada(
      client,
      { telefono: TELEFONO, organizacionId: organizacion },
      grabacion,
      { proveedor },
      AHORA,
    )

    const { rows } = await client.query<{ payload: Record<string, unknown>; max_intentos: number }>(
      `select payload, max_intentos from jobs where tipo = 'descargar_media'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.payload).toMatchObject({ ref: 'rec-abc123', tipo: 'audio' })
    expect(rows[0]!.max_intentos).toBe(10)
  })

  it('no le pide por escrito lo que acaba de decir en voz', async () => {
    // The bug this milestone surfaced: a recording with no transcript looked like an
    // unclear message, so intake asked «¿me cuenta qué necesita?» of somebody who had just
    // spent two minutes saying exactly that. The report waits for a human, not for them.
    const proveedor = proveedorVozSimulador()
    await devolverLlamada(
      client,
      { telefono: TELEFONO, organizacionId: organizacion },
      grabacion,
      { proveedor },
      AHORA,
    )

    const { rows } = await client.query<{ cuerpo: string }>(
      `select s.cuerpo from salidas_pendientes s
         join contactos c on c.id = s.contacto_id where c.telefono = $1`,
      [TELEFONO],
    )
    for (const fila of rows) expect(fila.cuerpo).not.toContain('¿Me cuenta qué necesita?')
    expect(rows.some((f) => /n[uú]mero/i.test(f.cuerpo))).toBe(true)
  })

  it('marcar 0 pasa a una persona sin abrir reporte', async () => {
    const proveedor = proveedorVozSimulador()
    const resultado = await devolverLlamada(
      client,
      { telefono: TELEFONO, organizacionId: organizacion },
      { tecla: '0', grabacionRef: null, duracionSeg: 8 },
      { proveedor },
      AHORA,
    )

    expect(resultado.estado).toBe('a_persona')
    if (resultado.estado !== 'a_persona') return
    expect(resultado.guion.at(-1)).toBe(PROMPTS.persona)
  })

  it('no colgarle a quien no marcó nada', async () => {
    // Pressing nothing is the menu failing, not the caller. Hanging up is the one
    // unacceptable outcome.
    const proveedor = proveedorVozSimulador()
    const resultado = await devolverLlamada(
      client,
      { telefono: TELEFONO, organizacionId: organizacion },
      { tecla: null, grabacionRef: null, duracionSeg: 12 },
      { proveedor },
      AHORA,
    )

    expect(resultado.estado).toBe('a_persona')
    if (resultado.estado !== 'a_persona') return
    expect(resultado.guion.at(-1)).toBe(PROMPTS.sinRespuesta)

    const { rows } = await client.query<{ ruta_tecleada: string }>(
      'select ruta_tecleada from llamadas where id = $1',
      [resultado.llamadaId],
    )
    // Recorded as an empty path, which is prompt-quality data: if many people abandon here,
    // that prompt is badly recorded.
    expect(rows[0]!.ruta_tecleada).toBe('')
  })
})

conBase('los topes de gasto, antes de marcar', () => {
  it('la tercera devolución en 30 minutos no ocurre, y queda registrada como bloqueada', async () => {
    await devolucionPrevia(5)
    await devolucionPrevia(20)

    const veredicto = await revisarTopes(client, TELEFONO, AHORA)
    expect(veredicto.permitido).toBe(false)

    const proveedor = proveedorVozSimulador()
    const resultado = await llamarDeVuelta(
      client,
      { telefono: TELEFONO, organizacionId: organizacion },
      { proveedor },
      AHORA,
    )

    expect(resultado.estado).toBe('bloqueada')
    // Nothing was dialled, so nothing was spent.
    expect(proveedor.llamadas).toEqual([])

    // And it is a row, not a silence: «why did nobody ring Élver back» has an answer.
    const { rows } = await client.query<{ estado: string; motivo_bloqueo: string; duracion_seg: number }>(
      'select estado, motivo_bloqueo, duracion_seg from llamadas where id = $1',
      [resultado.estado === 'bloqueada' ? resultado.llamadaId : ''],
    )
    expect(rows[0]!.estado).toBe('bloqueada')
    expect(rows[0]!.motivo_bloqueo).toContain(String(TOPE_POR_NUMERO_30MIN))
    expect(rows[0]!.duracion_seg).toBe(0)
  })

  it('un bloqueo no cuenta para el siguiente tope', async () => {
    // Otherwise one refusal cascades: the block itself pushes the next call over the line
    // and the channel shuts down silently for that number.
    await devolucionPrevia(5)
    await devolucionPrevia(20)
    const proveedor = proveedorVozSimulador()
    await llamarDeVuelta(client, { telefono: TELEFONO, organizacionId: organizacion }, { proveedor }, AHORA)

    // 31 minutes later the two real calls have aged out and only the block sits in between.
    const despues = new Date(AHORA.getTime() + 31 * 60_000)
    expect((await revisarTopes(client, TELEFONO, despues)).permitido).toBe(true)
  })

  it('el tope diario por número también corta', async () => {
    for (const minutos of [600, 500, 400, 300, 200]) await devolucionPrevia(minutos)
    const veredicto = await revisarTopes(client, TELEFONO, AHORA)

    expect(veredicto.permitido).toBe(false)
    if (veredicto.permitido) return
    expect(veredicto.motivo).toContain('hoy')
  })

  it('avisa al 70% del presupuesto y se apaga al 100%', async () => {
    // 120 minutes is the seeded budget. 84 is exactly 70%.
    await devolucionPrevia(300, 84 * 60)
    const alerta = await presupuestoVoz(client, AHORA)
    expect(alerta.porcentaje).toBeCloseTo(0.7, 2)
    expect(alerta.alerta).toBe(true)
    expect(alerta.agotado).toBe(false)

    await devolucionPrevia(200, 40 * 60)
    const agotado = await presupuestoVoz(client, AHORA)
    expect(agotado.agotado).toBe(true)

    // With the budget gone, a fresh number is refused too — the shutoff is global.
    const proveedor = proveedorVozSimulador()
    const resultado = await llamarDeVuelta(
      client,
      { telefono: '+573000000003', organizacionId: organizacion },
      { proveedor },
      AHORA,
    )
    expect(resultado.estado).toBe('bloqueada')
    expect(proveedor.llamadas).toEqual([])
    if (resultado.estado !== 'bloqueada') return
    expect(resultado.motivo).toContain('presupuesto')
  })

  it('las llamadas entrantes no gastan presupuesto', async () => {
    // They were rejected unanswered. Counting them would shut the channel down for calls
    // that cost nobody anything.
    const proveedor = proveedorVozSimulador()
    for (const id of ['a', 'b', 'c']) {
      await recibirLlamadaPerdida(client, { id, de: '3000000002' }, organizacion, { proveedor }, AHORA)
    }
    expect((await presupuestoVoz(client, AHORA)).usadosMin).toBe(0)
  })

  it('el presupuesto lo cambia un coordinador, no un deploy', async () => {
    await client.query(`update configuracion set valor = '10' where clave = $1`, [
      'presupuesto_voz_minutos_dia',
    ])
    await devolucionPrevia(60, 9 * 60)

    const estado = await presupuestoVoz(client, AHORA)
    expect(estado.presupuestoMin).toBe(10)
    expect(estado.alerta).toBe(true)
  })
})
