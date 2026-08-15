import { describe, expect, it } from 'vitest'
import {
  CABECERA_FIRMA,
  firmar,
  interpretarWebhook,
  PROVEEDOR_WHATSAPP,
  verificarFirma,
} from '@/lib/canales'
import {
  OTRO_PHONE_NUMBER_ID,
  PHONE_NUMBER_ID,
  WAMID_SALIENTE,
  WAMID_TEXTO,
  WAMID_WABA_DOS,
  WAMID_WABA_UNO,
  WEBHOOK_DOS_WABAS,
  WEBHOOK_ESTADO,
  WEBHOOK_FOTO,
  WEBHOOK_NOTA_DE_VOZ,
  WEBHOOK_TEXTO,
  WEBHOOK_TIPO_DESCONOCIDO,
  WEBHOOK_UBICACION,
} from './fixtures/whatsapp'

/**
 * The WhatsApp driver, against recorded payloads (PRD §4 M5). No account, no network, no
 * credentials — the signatures are computed locally with a secret invented right here.
 */

const SECRETO = 'un-app-secret-de-prueba'

const cuerpoDe = (webhook: unknown) => JSON.stringify(webhook)

/** The envelopes alone, for the cases that do not care which number they came in on. */
const sobresDe = (payload: unknown) => interpretarWebhook(payload).sobres.map((s) => s.sobre)

describe('la firma del webhook', () => {
  it('acepta un cuerpo firmado con el secreto correcto', () => {
    const cuerpo = cuerpoDe(WEBHOOK_TEXTO)
    expect(verificarFirma(cuerpo, firmar(cuerpo, SECRETO), SECRETO)).toEqual({ valida: true })
  })

  it('rechaza un cuerpo alterado después de firmar', () => {
    // The whole point. Someone intercepts the payload and adds a need that nobody reported.
    const original = cuerpoDe(WEBHOOK_TEXTO)
    const firma = firmar(original, SECRETO)
    const alterado = original.replace('12 familias', '400 familias')

    expect(alterado).not.toBe(original)
    expect(verificarFirma(alterado, firma, SECRETO).valida).toBe(false)
  })

  it('rechaza una firma hecha con otro secreto', () => {
    const cuerpo = cuerpoDe(WEBHOOK_TEXTO)
    expect(verificarFirma(cuerpo, firmar(cuerpo, 'otro-secreto'), SECRETO).valida).toBe(false)
  })

  it('rechaza cuando falta la cabecera', () => {
    const resultado = verificarFirma(cuerpoDe(WEBHOOK_TEXTO), null, SECRETO)
    expect(resultado.valida).toBe(false)
    if (!resultado.valida) expect(resultado.motivo).toContain(CABECERA_FIRMA)
  })

  it('rechaza una cabecera con formato raro', () => {
    const cuerpo = cuerpoDe(WEBHOOK_TEXTO)
    expect(verificarFirma(cuerpo, 'sha1=deadbeef', SECRETO).valida).toBe(false)
    expect(verificarFirma(cuerpo, 'deadbeef', SECRETO).valida).toBe(false)
  })

  it('falla cerrado si no hay secreto configurado', () => {
    // There is deliberately no "skip verification in development" flag: that flag is how an
    // unverified webhook reaches production.
    const cuerpo = cuerpoDe(WEBHOOK_TEXTO)
    expect(verificarFirma(cuerpo, firmar(cuerpo, SECRETO), undefined).valida).toBe(false)
  })

  it('firma sobre los bytes crudos, no sobre el objeto reserializado', () => {
    // JSON.parse + JSON.stringify reorders keys and drops whitespace. If the route ever
    // re-serialises before verifying, real signatures start failing for invisible reasons.
    const crudo = `{"b":1,  "a":2}`
    const reserializado = JSON.stringify(JSON.parse(crudo))

    expect(reserializado).not.toBe(crudo)
    expect(firmar(crudo, SECRETO)).not.toBe(firmar(reserializado, SECRETO))
  })
})

describe('interpretar el webhook', () => {
  it('saca el phone_number_id, que es como se enruta la organización', () => {
    expect(interpretarWebhook(WEBHOOK_TEXTO).sobres[0]!.phoneNumberId).toBe(PHONE_NUMBER_ID)
  })

  it('le deja a cada mensaje el número por el que llegó, no el del primer entry', () => {
    // Meta batches across entries and each one carries its own metadata. Keeping only the
    // first number files the second partner's households under the first partner (0008).
    const { sobres } = interpretarWebhook(WEBHOOK_DOS_WABAS)

    expect(sobres).toHaveLength(2)
    expect(sobres.map((s) => [s.sobre.idExterno, s.phoneNumberId])).toEqual([
      [WAMID_WABA_UNO, PHONE_NUMBER_ID],
      [WAMID_WABA_DOS, OTRO_PHONE_NUMBER_ID],
    ])
  })

  it('convierte el texto libre en un sobre sin clasificar', () => {
    const sobres = sobresDe(WEBHOOK_TEXTO)

    expect(sobres).toHaveLength(1)
    const sobre = sobres[0]!
    expect(sobre.proveedor).toBe(PROVEEDOR_WHATSAPP)
    expect(sobre.canal).toBe('whatsapp')
    expect(sobre.idExterno).toBe(WAMID_TEXTO)
    // The driver never classifies (contract §4): «manden mercados» is the normalizer's read.
    expect(sobre.tipo).toBe('texto_libre')
    expect(sobre.contenido.texto).toContain('mercados')
    expect(sobre.contenido.media).toEqual([])
    expect(sobre.ubicacion).toBeNull()
  })

  it('le pone el + al número que Meta manda sin él', () => {
    expect(sobresDe(WEBHOOK_TEXTO)[0]!.telefono).toBe('+573000000001')
  })

  it('lee el timestamp de Meta, que viene en segundos', () => {
    expect(sobresDe(WEBHOOK_TEXTO)[0]!.recibidoEn.toISOString()).toBe(
      '2026-08-13T19:02:11.000Z',
    )
  })

  it('trae la nota de voz como referencia del proveedor, sin los parámetros del mime', () => {
    const sobre = sobresDe(WEBHOOK_NOTA_DE_VOZ)[0]!

    expect(sobre.contenido.texto).toBeNull()
    expect(sobre.contenido.media).toEqual([
      { tipo: 'audio', refProveedor: '1129384756201928', mime: 'audio/ogg', duracionSeg: undefined },
    ])
  })

  it('toma el pie de foto como texto: es lo que la persona escribió', () => {
    const sobre = sobresDe(WEBHOOK_FOTO)[0]!

    expect(sobre.contenido.texto).toBe('Esto es lo que ha llegado hasta ahora.')
    expect(sobre.contenido.media[0]).toMatchObject({ tipo: 'foto', refProveedor: '9982736451029384' })
  })

  it('trata el pin como gps con radio 0', () => {
    // 2.2: the one coordinate we do not have to approximate.
    expect(sobresDe(WEBHOOK_UBICACION)[0]!.ubicacion).toMatchObject({
      lat: 5.6444,
      lon: -76.6089,
      fuente: 'gps',
      precisionM: 0,
    })
  })

  it('lee los acuses de entrega y no los confunde con mensajes', () => {
    const lote = interpretarWebhook(WEBHOOK_ESTADO)

    expect(lote.sobres).toEqual([])
    expect(lote.estados).toEqual([
      {
        idExterno: WAMID_SALIENTE,
        estado: 'entregado',
        ocurridoEn: new Date('2026-08-13T22:05:00.000Z'),
      },
    ])
  })

  it('no se cae con un webhook que no trae mensajes', () => {
    // Most webhook traffic is statuses. A driver that assumes `messages` exists crashes on
    // the majority of what Meta sends.
    expect(() => interpretarWebhook({ entry: [] })).not.toThrow()
    expect(sobresDe({})).toEqual([])
  })

  it('registra un tipo que no sabemos manejar en vez de botarlo', () => {
    // A document has nowhere to live in `adjuntos` yet, but the message is still a person
    // trying to tell us something. It arrives with no media and the ref survives in the raw
    // payload, so nothing is lost.
    const sobre = sobresDe(WEBHOOK_TIPO_DESCONOCIDO)[0]!

    expect(sobre.contenido.media).toEqual([])
    expect(sobre.contenido.texto).toBeNull()
    expect(JSON.stringify(sobre.payloadCrudo)).toContain('censo.pdf')
  })

  it('ignora un status que no conocemos en vez de inventarle un equivalente', () => {
    const lote = interpretarWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                statuses: [{ id: 'wamid.X', status: 'warp_speed', timestamp: '1786658700' }],
              },
            },
          ],
        },
      ],
    })
    expect(lote.estados).toEqual([])
  })
})
