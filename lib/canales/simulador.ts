import { z } from 'zod'
import { CANALES, FUENTES_UBICACION, TIPOS_ADJUNTO } from '@/db/schema/vocabulario'
import { esquemaSobreEntrante, type SobreEntrante, TIPOS_EVENTO, VERSION_CONTRATO } from './tipos'

/**
 * The driver that needs no credential.
 *
 * PRD §3 puts two drivers behind the port: WhatsApp, and this. It exists so the pipeline can
 * be exercised — and demonstrated to the field team — long before decision D3 produces a
 * phone number id and a System User token, and so the tests that matter do not sit behind an
 * account nobody has yet.
 *
 * It is a real driver, not a mock: it emits through the same envelope, hits the same
 * idempotency index and answers to the same 24-hour rule. A fixture that this driver refuses
 * is a message production would also refuse.
 */

export const PROVEEDOR_SIMULADOR = 'simulador'

/**
 * The shape a person hand-writes to simulate an inbound message. Deliberately not
 * WhatsApp-shaped: reproducing Meta's envelope here would make this a second Meta driver,
 * and the point of the port is that the core never learns what a `wamid` is.
 */
export const esquemaPayloadSimulado = z.object({
  /** Becomes `idExterno`, so re-sending the same id is how you test a provider retry. */
  id: z.string().min(1),
  de: z.string().nullish(),
  canal: z.enum(CANALES).default('whatsapp'),
  /**
   * Left at `texto_libre` unless the fixture says otherwise. An adapter does not classify
   * (contract §4) — deciding that «necesitamos mercados» is a `necesidad` is the
   * normalizer's call, and M4 is gated on a corpus we do not have.
   */
  tipo: z.enum(TIPOS_EVENTO).default('texto_libre'),
  recibidoEn: z.string().datetime({ offset: true }).nullish(),
  comunidad: z.string().nullish(),
  texto: z.string().nullish(),
  media: z
    .array(
      z.object({
        tipo: z.enum(TIPOS_ADJUNTO),
        ref: z.string().min(1),
        mime: z.string().min(1).optional(),
        duracionSeg: z.number().int().positive().optional(),
      }),
    )
    .default([]),
  ubicacion: z
    .object({
      lat: z.number(),
      lon: z.number(),
      /**
       * Required, with no default. A simulated pin still has to say what kind of point it
       * is: defaulting it here would be this module inventing a precision, which is the one
       * thing 2.2 exists to stop.
       */
      fuente: z.enum(FUENTES_UBICACION),
      precisionM: z.number().int().nonnegative().optional(),
    })
    .nullish(),
})

export type PayloadSimulado = z.input<typeof esquemaPayloadSimulado>

/**
 * Translates a simulated payload into the canonical envelope.
 *
 * Throws on a payload that cannot be represented — the same failure a real driver has when a
 * provider sends something the contract has no room for, and better surfaced loudly here
 * than silently dropped.
 */
export function recibirSimulado(payload: unknown, ahora = new Date()): SobreEntrante {
  const p = esquemaPayloadSimulado.parse(payload)

  return esquemaSobreEntrante.parse({
    version: VERSION_CONTRATO,
    proveedor: PROVEEDOR_SIMULADOR,
    canal: p.canal,
    tipo: p.tipo,
    idExterno: p.id,
    recibidoEn: p.recibidoEn ? new Date(p.recibidoEn) : ahora,
    telefono: p.de ?? null,
    comunidadCodigo: p.comunidad ?? null,
    contenido: {
      texto: p.texto ?? null,
      media: p.media.map((m) => ({
        tipo: m.tipo,
        refProveedor: m.ref,
        mime: m.mime,
        duracionSeg: m.duracionSeg,
      })),
    },
    ubicacion: p.ubicacion ?? null,
    // The payload exactly as handed to us (contract §4). For the simulator that is a
    // formality; for a webhook it is the difference between debugging a parser bug and
    // guessing at it.
    payloadCrudo: payload as Record<string, unknown>,
  })
}
