import { z } from 'zod'
import { esquemaSobreEntrante, type SobreEntrante, VERSION_CONTRATO } from '../tipos'
import { segmentar } from './segmentos'

/**
 * SMS, through the same port as everything else.
 *
 * Decision D1 puts SMS in v1, and 2.13 ranks it the least fragile channel we have: it
 * store-and-forwards, it survives one bar, and it costs the receiver nothing to keep. D2 —
 * which aggregator — is not answered, and is a procurement question with weeks of lead time,
 * so this ships against a simulator exactly as M5 shipped against recorded Meta payloads.
 *
 * The inbound side does no parsing beyond translation. The printed card's code syntax
 * («22 12 3») is read by the normalizer, not here: an adapter does not classify (contract
 * §4), and putting it in the normalizer means someone who learned the codes can use them on
 * WhatsApp too, which people do.
 */

export const PROVEEDOR_SMS_SIMULADOR = 'sms_simulador'

/** Colombian aggregators hand over roughly this. Nothing here is Meta-shaped. */
export const esquemaPayloadSms = z.object({
  /** The aggregator's message id: `MessageSid`, `id_mensaje`, whatever they call it. */
  id: z.string().min(1),
  de: z.string().min(1),
  texto: z.string(),
  recibidoEn: z.string().datetime({ offset: true }).nullish(),
})

export type PayloadSms = z.input<typeof esquemaPayloadSms>

function aE164(numero: string): string {
  const limpio = numero.replace(/[^\d+]/g, '')
  if (limpio.startsWith('+')) return limpio
  // Colombian mobiles are ten digits; short codes and already-prefixed numbers pass through.
  return limpio.length === 10 ? `+57${limpio}` : `+${limpio}`
}

export function recibirSms(payload: unknown, ahora = new Date()): SobreEntrante {
  const p = esquemaPayloadSms.parse(payload)

  return esquemaSobreEntrante.parse({
    version: VERSION_CONTRATO,
    proveedor: PROVEEDOR_SMS_SIMULADOR,
    canal: 'sms',
    tipo: 'texto_libre',
    idExterno: p.id,
    recibidoEn: p.recibidoEn ? new Date(p.recibidoEn) : ahora,
    telefono: aE164(p.de),
    comunidadCodigo: null,
    // SMS carries no media and no pin. A location arrives as words, and the normalizer is
    // where words become anything.
    contenido: { texto: p.texto, media: [] },
    ubicacion: null,
    payloadCrudo: payload as Record<string, unknown>,
  })
}

export type SmsEnviado = {
  /** The aggregator's id for what we sent, so a delivery receipt can find it later. */
  idExterno: string
  segmentos: number
}

/**
 * What an aggregator adapter has to implement (D2).
 *
 * Deliberately one method. Every provider we have looked at — Hablame, Masivian, InfoBip, a
 * carrier short code — differs in auth and in the shape of a delivery receipt, and in
 * nothing else that matters to us.
 */
export interface ProveedorSms {
  enviar(a: string, cuerpo: string): Promise<SmsEnviado>
}

/**
 * The provider that costs nothing and reaches nobody.
 *
 * It still refuses a message of more than one segment, because the point of a simulator is
 * that what passes here would have passed there — a driver that quietly accepts a
 * three-segment body teaches us nothing until the invoice arrives.
 */
export function proveedorSmsSimulador(): ProveedorSms & { enviados: SmsEnviado[] } {
  const enviados: SmsEnviado[] = []
  let n = 0

  return {
    enviados,
    async enviar(a, cuerpo) {
      const medida = segmentar(cuerpo)
      if (!medida.cabeEnUno) {
        throw new Error(
          `El simulador rechaza ${medida.segmentos} segmentos (${medida.alfabeto}): un SMS sale en uno.`,
        )
      }
      n += 1
      const enviado = { idExterno: `sim-sms-${a.slice(-4)}-${n}`, segmentos: medida.segmentos }
      enviados.push(enviado)
      return enviado
    },
  }
}
