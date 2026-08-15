import { z } from 'zod'
import type { EstadoMensaje } from '@/db/schema/vocabulario'
import { esquemaSobreEntrante, type MediaSobre, type SobreEntrante, VERSION_CONTRATO } from '../tipos'

/**
 * Reading a WhatsApp Cloud API webhook.
 *
 * The parser is deliberately lenient. A provider payload is not ours to validate: Meta adds
 * fields without notice, and a strict schema that rejects an unknown key is a schema that
 * drops somebody's message the week Meta ships a feature. So unknown keys pass through,
 * anything we cannot represent is kept in `payloadCrudo`, and the envelope — which we do
 * own — is where validation is strict.
 *
 * One webhook can carry several messages across several entries. Meta batches, and a batch
 * arriving while the network was down is exactly when several are pending, so this returns
 * a list rather than assuming one. Each entry also carries its own `phone_number_id`, so a
 * batch is not addressed to one partner either — see `SobreDirigido`.
 */

export const PROVEEDOR_WHATSAPP = 'whatsapp_cloud'

const esquemaMensajeMeta = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    timestamp: z.string().min(1),
    type: z.string().min(1),
    text: z.object({ body: z.string() }).partial().optional(),
    audio: z
      .object({ id: z.string(), mime_type: z.string(), voice: z.boolean() })
      .partial()
      .optional(),
    image: z
      .object({ id: z.string(), mime_type: z.string(), caption: z.string() })
      .partial()
      .optional(),
    location: z
      .object({ latitude: z.number(), longitude: z.number() })
      .partial()
      .optional(),
  })
  .passthrough()

const esquemaEstadoMeta = z
  .object({
    id: z.string().min(1),
    status: z.string().min(1),
    timestamp: z.string().min(1),
    recipient_id: z.string().optional(),
  })
  .passthrough()

const esquemaWebhook = z
  .object({
    entry: z
      .array(
        z
          .object({
            changes: z
              .array(
                z
                  .object({
                    value: z
                      .object({
                        metadata: z
                          .object({ phone_number_id: z.string() })
                          .partial()
                          .optional(),
                        contacts: z.array(z.unknown()).optional(),
                        messages: z.array(esquemaMensajeMeta).optional(),
                        statuses: z.array(esquemaEstadoMeta).optional(),
                      })
                      .passthrough()
                      .optional(),
                  })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough()

/** Meta's delivery states, mapped onto `mensajes_estado_check`. */
const ESTADO_POR_STATUS: Record<string, EstadoMensaje> = {
  sent: 'enviado',
  delivered: 'entregado',
  read: 'leido',
  failed: 'fallido',
}

export type EstadoEntrante = {
  /** The `wamid` of the OUTBOUND message this callback is about. */
  idExterno: string
  estado: EstadoMensaje
  ocurridoEn: Date
}

/**
 * An envelope together with the WABA number it actually arrived on.
 *
 * The two travel as one because a webhook is not addressed to a single partner. Meta batches
 * across `entry[]`, and every `changes[].value.metadata` carries its own `phone_number_id`,
 * so one POST can hold WABA A's messages followed by WABA B's. Reading the number off the
 * batch instead of off the message is how every household in it ends up filed under the
 * first partner — a confidentiality failure the day a second WABA is enabled, and one that
 * would look like nothing at all in a log. Carrying it here makes that unrepresentable.
 */
export type SobreDirigido = {
  /** Routes to an organisation via `organizaciones.waba_phone_number_id` (0008). */
  phoneNumberId: string | null
  sobre: SobreEntrante
}

export type LoteWebhook = {
  sobres: SobreDirigido[]
  estados: EstadoEntrante[]
}

/** Meta sends `573001234567`; E.164 wants the plus. */
function aE164(from: string): string {
  return from.startsWith('+') ? from : `+${from}`
}

function fechaDe(timestamp: string): Date {
  return new Date(Number(timestamp) * 1000)
}

/**
 * Media we can describe. `adjuntos.tipo` is audio/foto/firma, so a document, a video or a
 * sticker has nowhere to live yet (open question in docs/contrato-evento-canonico.md §3).
 * Those messages are still logged and still become a reporte — the ref survives in
 * `payloadCrudo` — they just arrive with no media attached rather than being dropped.
 */
function mediaDe(mensaje: z.infer<typeof esquemaMensajeMeta>): MediaSobre[] {
  if (mensaje.type === 'audio' && mensaje.audio?.id) {
    return [
      {
        tipo: 'audio',
        refProveedor: mensaje.audio.id,
        // Meta sends `audio/ogg; codecs=opus`; the parameters are not ours to keep.
        mime: mensaje.audio.mime_type?.split(';')[0]?.trim(),
      },
    ]
  }
  if (mensaje.type === 'image' && mensaje.image?.id) {
    return [
      {
        tipo: 'foto',
        refProveedor: mensaje.image.id,
        mime: mensaje.image.mime_type?.split(';')[0]?.trim(),
      },
    ]
  }
  return []
}

function textoDe(mensaje: z.infer<typeof esquemaMensajeMeta>): string | null {
  if (mensaje.type === 'text') return mensaje.text?.body ?? null
  // A caption is what the person wrote, so it is text even though it rode on an image.
  if (mensaje.type === 'image') return mensaje.image?.caption ?? null
  return null
}

function ubicacionDe(mensaje: z.infer<typeof esquemaMensajeMeta>) {
  if (mensaje.type !== 'location') return null
  const { latitude, longitude } = mensaje.location ?? {}
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null
  // A WhatsApp pin is the one coordinate we do not have to approximate: gps, radius 0 (2.2).
  return { lat: latitude, lon: longitude, fuente: 'gps' as const, precisionM: 0 }
}

export function interpretarWebhook(payload: unknown): LoteWebhook {
  const raiz = esquemaWebhook.parse(payload)

  const sobres: SobreDirigido[] = []
  const estados: EstadoEntrante[] = []

  for (const entry of raiz.entry ?? []) {
    for (const cambio of entry.changes ?? []) {
      const valor = cambio.value
      if (!valor) continue
      // This change's own number, never the batch's first one.
      const phoneNumberId = valor.metadata?.phone_number_id ?? null

      for (const mensaje of valor.messages ?? []) {
        sobres.push({
          phoneNumberId,
          sobre: esquemaSobreEntrante.parse({
            version: VERSION_CONTRATO,
            proveedor: PROVEEDOR_WHATSAPP,
            canal: 'whatsapp',
            // The driver never classifies (contract §4). Everything arrives unclassified and
            // the normalizer proposes, which is the whole of 2.11 and 2.12.
            tipo: 'texto_libre',
            idExterno: mensaje.id,
            recibidoEn: fechaDe(mensaje.timestamp),
            telefono: aE164(mensaje.from),
            comunidadCodigo: null,
            contenido: { texto: textoDe(mensaje), media: mediaDe(mensaje) },
            ubicacion: ubicacionDe(mensaje),
            // The slice of the webhook that belongs to this message, plus the routing
            // metadata. A parser bug has to be recoverable from this alone.
            payloadCrudo: { metadata: valor.metadata ?? null, message: mensaje },
          }),
        })
      }

      for (const estado of valor.statuses ?? []) {
        const mapeado = ESTADO_POR_STATUS[estado.status]
        // An unknown status is skipped rather than guessed: `mensajes_estado_check` would
        // reject it anyway, and inventing 'entregado' from something we do not understand
        // would corrupt the link-quality signal M6 is built on.
        if (!mapeado) continue
        estados.push({
          idExterno: estado.id,
          estado: mapeado,
          ocurridoEn: fechaDe(estado.timestamp),
        })
      }
    }
  }

  return { sobres, estados }
}
