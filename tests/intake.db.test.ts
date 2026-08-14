import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  almacenamientoLocal,
  COPIA,
  manejadorDescargarMedia,
  manejadorWebhookWhatsApp,
  type NormalizadorPort,
  PROVEEDOR_WHATSAPP,
  type ProveedorMedia,
  transcripcionPendiente,
} from '@/lib/canales'
import type { Job } from '@/lib/jobs/tipos'
import {
  PHONE_NUMBER_ID,
  WAMID_SALIENTE,
  WAMID_TEXTO,
  WEBHOOK_ESTADO,
  WEBHOOK_NOTA_DE_VOZ,
  WEBHOOK_TEXTO,
} from './fixtures/whatsapp'

/**
 * M5 acceptance, against a real database.
 *
 * «A free-text message and a voice note produce the same `reporte` shape; a low-confidence
 * input triggers exactly one targeted question, not a menu; the same webhook payload twice
 * creates one row.» Each of those is a test below, plus the two rules underneath them:
 * the record is created on receipt (2.13) and the provider ref is never stored (2.6).
 *
 * Everything runs inside a transaction that is rolled back, on a savepoint per case so one
 * failure does not cascade.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

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
  // Declared here so the first `rollback to` in beforeEach has something to land on. A
  // failed ROLLBACK TO would itself abort the transaction and take the whole file with it.
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
  // Each case starts from the seeded basin and leaves nothing behind for the next one.
  // ROLLBACK TO does not release the savepoint, so it stays available for the next case.
  await client.query('rollback to savepoint caso')
})

const job = (payload: Record<string, unknown>): Job => ({
  id: '00000000-0000-4000-9000-0000000000ff',
  tipo: 'procesar_webhook_whatsapp',
  payload,
  intentos: 1,
  maxIntentos: 5,
})

/** Same webhook, different message id — a second message from the same person. */
function otroMensaje(base: typeof WEBHOOK_TEXTO, wamid: string, texto: string): unknown {
  const copia = structuredClone(base) as any
  const mensaje = copia.entry[0].changes[0].value.messages[0]
  mensaje.id = wamid
  mensaje.text = { body: texto }
  return copia
}

async function contar(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await client.query<{ n: string }>(sql, params)
  return Number(rows[0]!.n)
}

/** A normalizer that is sure, for the branch M4 will eventually take. */
const normalizadorSeguro: NormalizadorPort = {
  async proponer() {
    return { tipo: 'necesidad', codigoItem: '11', cantidad: 12, unidad: 'mercados', confianza: 0.95 }
  },
}

conBase('el webhook de WhatsApp', () => {
  it('crea el reporte al recibir, no al confirmar', async () => {
    // 2.13. If the person never answers, the report still exists and a coordinator can act.
    await manejadorWebhookWhatsApp()(job({ webhook: WEBHOOK_TEXTO }), client)

    const { rows } = await client.query<{
      estado: string
      tipo: string
      canal: string
      folio: number
      detalle_libre: string
      codigo_item: string | null
    }>(
      `select r.estado, r.tipo, r.canal, r.folio, r.detalle_libre, r.codigo_item
         from reportes r
         join mensajes m on m.reporte_id = r.id
        where m.proveedor_mensaje_id = $1`,
      [WAMID_TEXTO],
    )

    expect(rows).toHaveLength(1)
    const reporte = rows[0]!
    expect(reporte.estado).toBe('RECIBIDO')
    expect(reporte.canal).toBe('whatsapp')
    expect(reporte.folio).toBeGreaterThan(0)
    expect(reporte.detalle_libre).toContain('mercados')
    // The normalizer is M4 and stays below threshold, so nothing is assigned (2.12).
    expect(reporte.tipo).toBe('sin_clasificar')
    expect(reporte.codigo_item).toBeNull()
  })

  it('el mismo payload dos veces deja una sola fila', async () => {
    // Providers retry. This is the M5 acceptance line.
    await manejadorWebhookWhatsApp()(job({ webhook: WEBHOOK_TEXTO }), client)
    await manejadorWebhookWhatsApp()(job({ webhook: WEBHOOK_TEXTO }), client)

    expect(
      await contar('select count(*) as n from mensajes where proveedor_mensaje_id = $1', [
        WAMID_TEXTO,
      ]),
    ).toBe(1)
    expect(
      await contar(
        `select count(*) as n from reportes r
           join mensajes m on m.reporte_id = r.id
          where m.proveedor_mensaje_id = $1`,
        [WAMID_TEXTO],
      ),
    ).toBe(1)
  })

  it('el texto libre y la nota de voz producen la misma forma de reporte', async () => {
    await manejadorWebhookWhatsApp()(job({ webhook: WEBHOOK_TEXTO }), client)
    await manejadorWebhookWhatsApp()(job({ webhook: WEBHOOK_NOTA_DE_VOZ }), client)

    const { rows } = await client.query<{
      tipo: string
      estado: string
      canal: string
      contacto_id: string
      folio: number
    }>(
      `select r.tipo, r.estado, r.canal, r.contacto_id, r.folio
         from reportes r
         join mensajes m on m.reporte_id = r.id
        where m.proveedor_mensaje_id in ($1, $2)
        order by r.folio`,
      [WAMID_TEXTO, 'wamid.HBgMNTczMDAwMDAwMDAzFQIAEhggQjc3RTVBMUQ0RjAyQzMxMDIz'],
    )

    expect(rows).toHaveLength(2)
    const [texto, voz] = rows as [(typeof rows)[number], (typeof rows)[number]]
    // Same shape: the channel of arrival is not a difference in kind. Only the text differs,
    // and the voice note's arrives later as a transcript that never overwrites the original.
    expect(voz.tipo).toBe(texto.tipo)
    expect(voz.estado).toBe(texto.estado)
    expect(voz.canal).toBe(texto.canal)
    expect(texto.contacto_id).toBeTruthy()
    expect(voz.contacto_id).toBeTruthy()
  })

  it('una entrada de baja confianza dispara exactamente una pregunta, y no es un menú', async () => {
    await manejadorWebhookWhatsApp()(job({ webhook: WEBHOOK_TEXTO }), client)

    const { rows } = await client.query<{ cuerpo: string }>(
      `select s.cuerpo from salidas_pendientes s
         join contactos c on c.id = s.contacto_id
        where c.telefono = $1`,
      ['+573000000001'],
    )

    expect(rows).toHaveLength(1)
    const cuerpo = rows[0]!.cuerpo
    expect(cuerpo).toBe(COPIA.aclaracion)
    // 2.11 and PRD §2: no coded syntax, no numbered options. «Escriba así: 22 12 3» is
    // exactly what this replaced.
    expect(cuerpo).not.toMatch(/\b\d\s*[).]/)
    expect(cuerpo).not.toMatch(/\b22\s+12\s+3\b/)
    expect(cuerpo.toLowerCase()).not.toContain('opción')
  })

  it('no vuelve a preguntar mientras la aclaración siga viva', async () => {
    // Every round trip costs this person battery and money (Section 6.5). A second message
    // adds to what a coordinator reads; it does not earn a second question.
    await manejadorWebhookWhatsApp()(job({ webhook: WEBHOOK_TEXTO }), client)
    await manejadorWebhookWhatsApp()(
      job({ webhook: otroMensaje(WEBHOOK_TEXTO, 'wamid.SEGUNDO', 'y también toldillos') }),
      client,
    )

    expect(
      await contar(
        `select count(*) as n from salidas_pendientes s
           join contactos c on c.id = s.contacto_id
          where c.telefono = $1`,
        ['+573000000001'],
      ),
    ).toBe(1)
    // Both messages are still recorded, and both still made a reporte.
    expect(
      await contar('select count(*) as n from mensajes where proveedor_mensaje_id in ($1, $2)', [
        WAMID_TEXTO,
        'wamid.SEGUNDO',
      ]),
    ).toBe(2)
  })

  it('la conversación de aclaración dura días, no minutos', async () => {
    // 2.13: a reply arriving three days later must still attach to the right record.
    await manejadorWebhookWhatsApp()(job({ webhook: WEBHOOK_TEXTO }), client)

    const { rows } = await client.query<{ dias: number; flujo: string; paso: string }>(
      `select extract(epoch from (s.expira_en - s.creado_en)) / 86400 as dias, s.flujo, s.paso
         from conversaciones s
         join contactos c on c.id = s.contacto_id
        where c.telefono = $1`,
      ['+573000000001'],
    )

    expect(rows).toHaveLength(1)
    expect(Number(rows[0]!.dias)).toBeCloseTo(7, 1)
    expect(rows[0]!.paso).toBe('esperando_aclaracion')
  })

  it('con un normalizador seguro responde el folio y clasifica', async () => {
    await manejadorWebhookWhatsApp({ normalizador: normalizadorSeguro })(
      job({ webhook: WEBHOOK_TEXTO }),
      client,
    )

    const { rows } = await client.query<{ tipo: string; codigo_item: string; folio: number }>(
      `select r.tipo, r.codigo_item, r.folio from reportes r
         join mensajes m on m.reporte_id = r.id
        where m.proveedor_mensaje_id = $1`,
      [WAMID_TEXTO],
    )
    const reporte = rows[0]!
    expect(reporte.tipo).toBe('necesidad')
    expect(reporte.codigo_item.trim()).toBe('11')

    const { rows: salidas } = await client.query<{ cuerpo: string }>(
      `select s.cuerpo from salidas_pendientes s
         join contactos c on c.id = s.contacto_id
        where c.telefono = $1`,
      ['+573000000001'],
    )
    expect(salidas).toHaveLength(1)
    expect(salidas[0]!.cuerpo).toBe(COPIA.folio(reporte.folio))
    expect(salidas[0]!.cuerpo).toContain(String(reporte.folio))
  })

  it('enruta por phone_number_id cuando la organización lo tiene', async () => {
    await client.query('update organizaciones set waba_phone_number_id = $1', [PHONE_NUMBER_ID])
    await manejadorWebhookWhatsApp()(job({ webhook: WEBHOOK_TEXTO }), client)

    const { rows } = await client.query<{ organizacion_id: string }>(
      'select organizacion_id from mensajes where proveedor_mensaje_id = $1',
      [WAMID_TEXTO],
    )
    const { rows: orgs } = await client.query<{ id: string }>(
      'select id from organizaciones where waba_phone_number_id = $1',
      [PHONE_NUMBER_ID],
    )
    expect(rows[0]!.organizacion_id).toBe(orgs[0]!.id)
  })

  it('aplica el acuse de entrega al mensaje saliente que le corresponde', async () => {
    const { rows: orgs } = await client.query<{ id: string }>(
      'select id from organizaciones limit 1',
    )
    await client.query(
      `insert into mensajes (organizacion_id, proveedor, proveedor_mensaje_id, direccion, canal, estado)
       values ($1, $2, $3, 'saliente', 'whatsapp', 'enviado')`,
      [orgs[0]!.id, PROVEEDOR_WHATSAPP, WAMID_SALIENTE],
    )

    await manejadorWebhookWhatsApp()(job({ webhook: WEBHOOK_ESTADO }), client)

    const { rows } = await client.query<{ estado: string }>(
      'select estado from mensajes where proveedor_mensaje_id = $1',
      [WAMID_SALIENTE],
    )
    expect(rows[0]!.estado).toBe('entregado')
    // A callback is not a message: it must not manufacture a reporte.
    expect(await contar('select count(*) as n from reportes where canal = $1 and folio > 100000', ['whatsapp'])).toBe(0)
  })
})

conBase('la nota de voz y su media', () => {
  it('encola la descarga en vez de hacerla dentro del webhook', async () => {
    await manejadorWebhookWhatsApp()(job({ webhook: WEBHOOK_NOTA_DE_VOZ }), client)

    const { rows } = await client.query<{ payload: Record<string, unknown>; max_intentos: number }>(
      `select payload, max_intentos from jobs where tipo = 'descargar_media'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.payload).toMatchObject({ ref: '1129384756201928', tipo: 'audio' })
    // A 24-hour retry budget (PRD §4 M5), not the default five attempts.
    expect(rows[0]!.max_intentos).toBe(10)
  })

  it('guarda el adjunto con clave propia y nunca con la URL del proveedor', async () => {
    await manejadorWebhookWhatsApp()(job({ webhook: WEBHOOK_NOTA_DE_VOZ }), client)

    const { rows: pendientes } = await client.query<{ payload: Record<string, unknown> }>(
      `select payload from jobs where tipo = 'descargar_media'`,
    )
    const proveedor: ProveedorMedia = {
      async descargar() {
        return { bytes: Buffer.from('OggS-nota-de-voz'), mime: 'audio/ogg' }
      },
    }

    await manejadorDescargarMedia({
      proveedor,
      almacenamiento: almacenamientoLocal(await mkdtemp(join(tmpdir(), 'convite-intake-'))),
      transcripcion: transcripcionPendiente,
    })(
      { ...job(pendientes[0]!.payload), tipo: 'descargar_media' },
      client,
    )

    const { rows } = await client.query<{
      storage_key: string
      mime: string
      exif_removido: boolean
      transcripcion: string | null
    }>('select storage_key, mime, exif_removido, transcripcion from adjuntos')

    expect(rows).toHaveLength(1)
    const adjunto = rows[0]!
    // 2.6, and the constraint that backs it.
    expect(adjunto.storage_key).not.toMatch(/^https?:\/\//)
    expect(adjunto.storage_key).toMatch(/^audio\//)
    expect(adjunto.mime).toBe('audio/ogg')
    expect(adjunto.exif_removido).toBe(false)
    // D8 is open, so nothing was transcribed and nothing left our infrastructure.
    expect(adjunto.transcripcion).toBeNull()
  })
})
