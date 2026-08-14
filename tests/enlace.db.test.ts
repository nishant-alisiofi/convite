import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  anotarActividad,
  anotarMedia,
  cargarPerfil,
  COPIA,
  comoConfirmar,
  despachar,
  entregarPendientes,
  queSolicitar,
  recalcularEnlace,
  segmentar,
} from '@/lib/canales'

/**
 * M6 acceptance, against a real database.
 *
 * «A contact whose messages never reach `delivered` stops being offered voice notes and gets
 * a one-segment SMS instead; five queued messages deliver as one digest when they
 * reappear.» Both are below, plus the rule underneath them: the policy applies to every
 * queued row, whoever queued it.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

let pool: Pool
let client: PoolClient
let rosa: string
let organizacion: string

const AHORA = new Date('2026-08-14T15:00:00Z')
const HACE_TRES_DIAS = new Date(AHORA.getTime() - 3 * 86_400_000)

beforeAll(async () => {
  if (!url) return
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  })
  client = await pool.connect()
  await client.query('begin')

  const { rows } = await client.query<{ id: string }>(
    `select id from contactos where telefono = '+573000000001'`,
  )
  rosa = rows[0]!.id
  const { rows: orgs } = await client.query<{ id: string }>('select id from organizaciones limit 1')
  organizacion = orgs[0]!.id

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

/** Writes an outbound message with a given final state, as a delivery receipt would leave it. */
async function salienteCon(estado: string, creadoEn: Date, n = 1): Promise<void> {
  for (let i = 0; i < n; i++) {
    await client.query(
      `insert into mensajes (organizacion_id, proveedor, proveedor_mensaje_id, direccion, canal,
                             contacto_id, cuerpo, estado, creado_en)
       values ($1, 'whatsapp_cloud', $2, 'saliente', 'whatsapp', $3, 'aviso', $4, $5)`,
      [organizacion, `wamid.${estado}.${creadoEn.getTime()}.${i}`, rosa, estado, creadoEn],
    )
  }
}

const ventana = { ultimoEntranteEn: AHORA, ahora: AHORA }

conBase('2.14 — la calidad del enlace se mide, no se declara', () => {
  it('sin nada que medir queda en null, que no es lo mismo que malo', async () => {
    const medicion = await recalcularEnlace(client, rosa, AHORA)
    expect(medicion.calidadEnlace).toBeNull()
    expect(medicion.medidas).toBe(0)
  })

  it('cuenta entregado y leído como que sí llegó', async () => {
    await salienteCon('entregado', HACE_TRES_DIAS, 3)
    await salienteCon('leido', HACE_TRES_DIAS, 1)
    expect((await recalcularEnlace(client, rosa, AHORA)).calidadEnlace).toBe(1)
  })

  it('cuenta fallido como que no llegó', async () => {
    await salienteCon('entregado', HACE_TRES_DIAS, 1)
    await salienteCon('fallido', HACE_TRES_DIAS, 3)
    expect((await recalcularEnlace(client, rosa, AHORA)).calidadEnlace).toBe(0.25)
  })

  it('un mensaje viejo atascado en «enviado» cuenta como perdido', async () => {
    // The acceptance case in miniature. Waiting for a `fallido` that never arrives would
    // leave somebody on WhatsApp forever, because no news from a provider is not good news.
    await salienteCon('enviado', HACE_TRES_DIAS, 4)
    expect((await recalcularEnlace(client, rosa, AHORA)).calidadEnlace).toBe(0)
  })

  it('un mensaje recién enviado todavía no es evidencia de nada', async () => {
    // Otherwise every send would drag the score down for the minutes before it lands.
    await salienteCon('enviado', new Date(AHORA.getTime() - 60_000), 4)
    const medicion = await recalcularEnlace(client, rosa, AHORA)
    expect(medicion.medidas).toBe(0)
    expect(medicion.calidadEnlace).toBeNull()
  })

  it('anota la hora del día en que sí hubo señal', async () => {
    // Usually tracks when there is power, which is what makes it worth having.
    await anotarActividad(client, rosa, new Date('2026-08-14T23:30:00Z')) // 18:30 en Bogotá
    await anotarActividad(client, rosa, new Date('2026-08-15T00:15:00Z')) // 19:15 en Bogotá
    await anotarActividad(client, rosa, new Date('2026-08-16T00:45:00Z')) // 19:45 en Bogotá

    const { rows } = await client.query<{ ventana_actividad: Record<string, number> }>(
      'select ventana_actividad from contactos where id = $1',
      [rosa],
    )
    expect(rows[0]!.ventana_actividad).toEqual({ '18': 1, '19': 2 })
  })

  it('una subida lograda queda marcada para siempre', async () => {
    // One success proves the path exists; a later failure is a bad afternoon, not a retraction.
    await anotarMedia(client, rosa, true)
    await anotarMedia(client, rosa, false)
    expect((await cargarPerfil(client, rosa)).mediaExitosa).toBe(true)
  })
})

conBase('aceptación: a quien nunca le llega, se le deja de pedir audio', () => {
  it('deja de ofrecer nota de voz y contesta por SMS de un segmento', async () => {
    // PRD §4 M6 verbatim. Rosa had managed an upload once and her link looked fine, so she
    // was being offered voice notes; then five messages in a row never reached her.
    await anotarMedia(client, rosa, true)
    await salienteCon('entregado', HACE_TRES_DIAS, 2)
    await recalcularEnlace(client, rosa, AHORA)
    expect(queSolicitar(await cargarPerfil(client, rosa)).pedir).toBe('nota_de_voz')

    await salienteCon('enviado', HACE_TRES_DIAS, 8)
    await recalcularEnlace(client, rosa, AHORA)

    const perfil = await cargarPerfil(client, rosa)
    expect(perfil.calidadEnlace).toBeLessThan(0.4)
    expect(queSolicitar(perfil).pedir).toBe('sms_o_llamada')

    const plan = comoConfirmar(perfil, 'whatsapp')
    expect(plan.canal).toBe('sms')
    expect(plan.unSoloSegmento).toBe(true)

    // And what actually gets queued is the short body, in one segment.
    const resultado = await despachar(
      client,
      {
        contactoId: rosa,
        cuerpo: COPIA.folio(472),
        cuerpoCorto: COPIA.folioSms(472),
        canalEntrada: 'whatsapp',
      },
      ventana,
    )
    expect(resultado.canal).toBe('sms')
    expect(resultado.cuerpo).toBe(COPIA.folioSms(472))
    expect(resultado.segmentos).toBe(1)
  })

  it('se niega a encolar un SMS que no cabe, en vez de triplicar la cuenta en silencio', async () => {
    await salienteCon('enviado', HACE_TRES_DIAS, 5)
    await recalcularEnlace(client, rosa, AHORA)

    await expect(
      despachar(
        client,
        { contactoId: rosa, cuerpo: 'x'.repeat(400), canalEntrada: 'sms' },
        ventana,
      ),
    ).rejects.toThrow(/un segmento/)
  })
})

conBase('aceptación: cinco mensajes encolados salen como un solo digesto', () => {
  it('los junta en uno cuando la persona reaparece', async () => {
    // 2.14. Somebody out of coverage for a week who finally gets a bar should not have their
    // battery spent on five notifications — and on prepaid, five inbound messages cost them
    // money to receive.
    await client.query(
      `update contactos set calidad_enlace = 0.9, media_exitosa = true where id = $1`,
      [rosa],
    )

    for (let i = 1; i <= 5; i++) {
      await despachar(
        client,
        { contactoId: rosa, cuerpo: `Aviso ${i} sobre su reporte.`, canalEntrada: 'whatsapp' },
        ventana,
      )
    }

    const digesto = await entregarPendientes(client, rosa, 'whatsapp', AHORA)

    expect(digesto).not.toBeNull()
    expect(digesto!.incluidas).toBe(5)
    expect(digesto!.pendientes).toBe(0)
    for (let i = 1; i <= 5; i++) expect(digesto!.cuerpo).toContain(`Aviso ${i}`)

    // ONE outbound message, not five.
    const { rows } = await client.query<{ n: string }>(
      `select count(*) as n from mensajes
        where contacto_id = $1 and direccion = 'saliente' and estado = 'encolado'`,
      [rosa],
    )
    expect(Number(rows[0]!.n)).toBe(1)

    // And nothing is left owing.
    const { rows: quedan } = await client.query<{ n: string }>(
      `select count(*) as n from salidas_pendientes where contacto_id = $1 and enviado_en is null`,
      [rosa],
    )
    expect(Number(quedan[0]!.n)).toBe(0)
  })

  it('en SMS manda lo que cabe en un segmento y deja el resto encolado', async () => {
    await salienteCon('enviado', HACE_TRES_DIAS, 5)
    await recalcularEnlace(client, rosa, AHORA)

    for (let i = 1; i <= 5; i++) {
      await despachar(
        client,
        { contactoId: rosa, cuerpo: `Aviso numero ${i} sobre su reporte pendiente.`, canalEntrada: 'sms' },
        ventana,
      )
    }

    const digesto = await entregarPendientes(client, rosa, 'sms', AHORA)

    expect(digesto!.canal).toBe('sms')
    expect(segmentar(digesto!.cuerpo).cabeEnUno).toBe(true)
    // Truncating mid-sentence would be worse than waiting: the rest stays queued.
    expect(digesto!.incluidas).toBeLessThan(5)
    expect(digesto!.pendientes).toBeGreaterThan(0)
  })

  it('no dice nada cuando no se debe nada', async () => {
    expect(await entregarPendientes(client, rosa, 'whatsapp', AHORA)).toBeNull()
  })
})

conBase('la política se aplica a toda fila encolada, la escriba quien la escriba', () => {
  it('enruta también lo que encoló el vencimiento de ofertas', async () => {
    // `vencerOfertas` predates M6 and writes its lapse notice straight to the queue with
    // canal_sugerido null, on purpose — its comment says the outbound policy decides channel
    // and timing. This is that promise being kept: the row is routed at delivery time.
    await salienteCon('enviado', HACE_TRES_DIAS, 5)
    await recalcularEnlace(client, rosa, AHORA)

    await client.query(
      `insert into salidas_pendientes (contacto_id, cuerpo, prioridad, canal_sugerido)
       values ($1, $2, 4, null)`,
      [rosa, 'Convite: no alcanzamos a recoger lo que ofrecio y ya se vencio.'],
    )

    const digesto = await entregarPendientes(client, rosa, 'whatsapp', AHORA)

    // Queued with no channel, delivered by SMS because that is what reaches her now.
    expect(digesto!.canal).toBe('sms')
    expect(segmentar(digesto!.cuerpo).cabeEnUno).toBe(true)
  })

  it('guarda la plantilla que haría falta si sale fuera de la ventana', async () => {
    await client.query(`update contactos set calidad_enlace = 0.9 where id = $1`, [rosa])

    await despachar(
      client,
      {
        contactoId: rosa,
        cuerpo: COPIA.folio(472),
        plantilla: 'reporte_recibido',
        canalEntrada: 'whatsapp',
      },
      ventana,
    )

    const { rows } = await client.query<{ plantilla: string; canal_sugerido: string }>(
      'select plantilla, canal_sugerido from salidas_pendientes where contacto_id = $1',
      [rosa],
    )
    expect(rows[0]!.plantilla).toBe('reporte_recibido')
    expect(rows[0]!.canal_sugerido).toBe('whatsapp')
  })

  it('encola igual cuando la ventana está cerrada: rechazar no es descartar', async () => {
    await client.query(`update contactos set calidad_enlace = 0.9 where id = $1`, [rosa])

    const resultado = await despachar(
      client,
      { contactoId: rosa, cuerpo: 'Un aviso cualquiera.', canalEntrada: 'whatsapp' },
      { ultimoEntranteEn: new Date(AHORA.getTime() - 48 * 3_600_000), ahora: AHORA },
    )

    // The window says no, and the row is queued anyway — it rides out on their next inbound
    // message (2.14). Dropping it would lose a folio somebody is waiting on.
    expect(resultado.decision.permitido).toBe(false)
    const { rows } = await client.query<{ n: string }>(
      'select count(*) as n from salidas_pendientes where contacto_id = $1',
      [rosa],
    )
    expect(Number(rows[0]!.n)).toBe(1)
  })
})
