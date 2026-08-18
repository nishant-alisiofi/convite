import { z } from 'zod'
import { type ProveedorSms, proveedorSmsSimulador, type SmsEnviado } from './driver'
import { segmentar } from './segmentos'

/**
 * The real SMS provider (PRD v3 §4.1.6): Infobip, the same account as voice — one provider,
 * two channels, one Colombian entity relationship instead of two.
 *
 * `POST /sms/3/messages` is the confirmed endpoint (base URL + auth header pattern from
 * https://www.infobip.com/docs/api; the `messages[].sender/destinations/content.text`
 * request shape and `messages[].messageId/status` response shape are Infobip's documented
 * SMS v3 contract — the live reference page did not render through automated fetch at the
 * time this was written, so verify the response's exact status-object fields against the
 * account's own OpenAPI spec before relying on delivery-status parsing beyond `messageId`).
 */

const RUTA_SMS = '/sms/3/messages'

export const PROVEEDOR_SMS_INFOBIP = 'infobip_sms'

export type ConfigSmsInfobip = {
  /** The account's personalised base URL, e.g. `https://xxxxxxxx.api.infobip.com`. No trailing slash. */
  baseUrl: string
  apiKey: string
  /** The registered sender id/number (`messages[].sender`). */
  remitente: string
}

const esquemaRespuesta = z.object({
  messages: z
    .array(
      z.object({
        messageId: z.string().optional(),
        to: z.string().optional(),
        status: z.object({ groupName: z.string().optional(), name: z.string().optional() }).optional(),
      }),
    )
    .optional(),
})

export function proveedorSmsInfobip(config: ConfigSmsInfobip): ProveedorSms {
  return {
    async enviar(a, cuerpo): Promise<SmsEnviado> {
      // Same guard the simulator holds itself to (sms/driver.ts): the point of that guard is
      // that what passes here would have passed there. The despachador already enforces this
      // before calling `.enviar()`, but a second caller — or a bug in that guard — must not
      // reach the aggregator and silently ship a three-segment bill.
      const medida = segmentar(cuerpo)
      if (!medida.cabeEnUno) {
        throw new Error(
          `Un SMS debe caber en un segmento: ${medida.segmentos} segmentos (${medida.alfabeto}).`,
        )
      }

      const respuesta = await fetch(`${config.baseUrl}${RUTA_SMS}`, {
        method: 'POST',
        headers: {
          authorization: `App ${config.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          messages: [
            {
              sender: config.remitente,
              // Infobip's MSISDN convention, same as the Calls API: digits, no leading plus.
              destinations: [{ to: a.replace(/^\+/, '') }],
              content: { text: cuerpo },
            },
          ],
        }),
        signal: AbortSignal.timeout(15_000),
      })

      const texto = await respuesta.text().catch(() => '')
      if (!respuesta.ok) {
        throw new Error(`Infobip SMS respondió ${respuesta.status}: ${texto.slice(0, 500)}`)
      }

      const cuerpoJson: unknown = texto ? JSON.parse(texto) : {}
      const mensaje = esquemaRespuesta.parse(cuerpoJson).messages?.[0]

      return {
        idExterno: mensaje?.messageId ?? 'sin-id',
        segmentos: medida.segmentos,
      }
    },
  }
}

/** Both halves needed, same contract as `envioVozInfobipConfigurado()`. */
export function envioSmsInfobipConfigurado(): boolean {
  return Boolean(
    process.env.INFOBIP_API_KEY && process.env.INFOBIP_BASE_URL && process.env.INFOBIP_SMS_SENDER,
  )
}

let proveedor: ProveedorSms | null = null

/** PRD-15 build item 6: real Infobip when configured, the simulator otherwise. */
export function proveedorSmsActivo(): ProveedorSms {
  if (proveedor) return proveedor
  if (envioSmsInfobipConfigurado()) {
    proveedor = proveedorSmsInfobip({
      baseUrl: process.env.INFOBIP_BASE_URL!.replace(/\/$/, ''),
      apiKey: process.env.INFOBIP_API_KEY!,
      remitente: process.env.INFOBIP_SMS_SENDER!,
    })
    return proveedor
  }
  proveedor = proveedorSmsSimulador()
  return proveedor
}

/** Only for tests: forget which provider was chosen, so env changes take effect. */
export function olvidarProveedorSms(): void {
  proveedor = null
}
