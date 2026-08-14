import { z } from 'zod'
import {
  CANALES,
  FUENTES_UBICACION,
  PRECISION_POR_FUENTE,
  TIPOS_ADJUNTO,
} from '@/db/schema/vocabulario'

/**
 * The normalised inbound envelope (PRD §3, «the channel is a port»).
 *
 * Every driver has exactly two jobs: translate its native payload into this shape, and drop
 * duplicates. Nothing downstream knows which channels exist — that is the whole point, and
 * it is what lets a simulator with no credentials exercise the same path production will.
 *
 * Reconciled field by field against the real schema rather than against
 * docs/contrato-evento-canonico.md, which was written before the tables existed. Where the
 * two disagree the schema wins; the differences are called out below because the draft is
 * still the document the team reads.
 */

export const VERSION_CONTRATO = '0.1'

/**
 * `necesidad` and `dano` are `reportes.tipo` verbatim. The other two are port-level only:
 * `reportes_tipo_check` allows exactly those two, so neither a delivery confirmation nor an
 * unclassifiable message may ever become a `reporte`. They ride the envelope so the bitácora
 * keeps them and a human (M7) or the normalizer (M4) can decide later.
 *
 * 2.12: an envelope that cannot be classified is a first-class outcome, never an error.
 */
export const TIPOS_EVENTO = ['necesidad', 'dano', 'confirmacion_entrega', 'texto_libre'] as const

export type TipoEvento = (typeof TIPOS_EVENTO)[number]

/** E.164, the same shape the seed asserts. */
const TELEFONO = /^\+[1-9][0-9]{7,14}$/

/**
 * Media as the provider describes it, which is not yet media we hold.
 *
 * `refProveedor` is deliberately not called a storage key: WhatsApp media refs expire in
 * minutes, and `adjuntos.storage_key` carries a check constraint that rejects anything
 * looking like a URL (2.6). Downloading it and taking our own copy is M5's job; naming the
 * field this way makes wiring one straight into the other hard to do by accident.
 *
 * `tipo` is `TIPOS_ADJUNTO`, so it cannot describe something `adjuntos` has no room for.
 * The draft contract also lists `documento`, which has no home in the schema today.
 */
export const esquemaMedia = z.object({
  tipo: z.enum(TIPOS_ADJUNTO),
  refProveedor: z.string().min(1),
  mime: z.string().min(1).optional(),
  duracionSeg: z.number().int().positive().optional(),
})

/**
 * Non-negotiable 2.2, enforced at the boundary exactly as `reportes` enforces it: a point
 * with no declared source, or a source with no radius, is a coordinate whose precision we
 * invented. `fuente` is `FUENTES_UBICACION` — the draft's `pin_whatsapp`/`declarada` have no
 * equivalent in the database, and a WhatsApp pin is simply `gps`.
 *
 * `precisionM` may be left out for every source that has a documented default; `manual` has
 * none, so staff-placed points must say how accurate they are.
 */
export const esquemaUbicacion = z
  .object({
    lat: z.number().gte(-90).lte(90),
    lon: z.number().gte(-180).lte(180),
    fuente: z.enum(FUENTES_UBICACION),
    precisionM: z.number().int().nonnegative().optional(),
  })
  .transform((u) => ({
    ...u,
    precisionM: u.precisionM ?? PRECISION_POR_FUENTE[u.fuente] ?? null,
  }))
  .superRefine((u, ctx) => {
    if (u.precisionM === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['precisionM'],
        message: `La fuente '${u.fuente}' no tiene radio por defecto: hay que declararlo (2.2).`,
      })
      return
    }
    // Mirrors reportes_gps_exacto_check. A pin that claims a radius is not a pin.
    if (u.fuente === 'gps' && u.precisionM !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['precisionM'],
        message: 'Una ubicación gps tiene radio 0.',
      })
    }
  })

export const esquemaSobreEntrante = z.object({
  version: z.literal(VERSION_CONTRATO),

  /**
   * `proveedor` is not in the draft contract, and it has to be: the idempotency index the
   * schema actually ships is `(proveedor, proveedor_mensaje_id)`, not `(canal, id_externo)`.
   * One channel can have several providers — a WhatsApp number moved between BSPs is the
   * obvious case — so the driver names itself here.
   */
  proveedor: z.string().min(1),
  canal: z.enum(CANALES),
  tipo: z.enum(TIPOS_EVENTO),

  /** The provider's own message id. This is the idempotency key (2.7). */
  idExterno: z.string().min(1),

  /** When the driver received it, never when we got round to processing it. */
  recibidoEn: z.date(),

  /** Null on radio and paper, where there is no number to hold. */
  telefono: z.string().regex(TELEFONO, 'Teléfono debe ser E.164').nullable(),

  /** The code printed on the card. Resolving it to a community is the core's job. */
  comunidadCodigo: z.string().min(1).nullable(),

  contenido: z.object({
    /** Free text as the person wrote it, or a transcript when one already exists. */
    texto: z.string().nullable(),
    media: z.array(esquemaMedia),
  }),

  ubicacion: esquemaUbicacion.nullable(),

  /** Whatever the provider sent, untouched. A parser bug must be recoverable from this. */
  payloadCrudo: z.record(z.unknown()),
})

export type SobreEntrante = z.infer<typeof esquemaSobreEntrante>
export type UbicacionSobre = SobreEntrante['ubicacion']
export type MediaSobre = z.infer<typeof esquemaMedia>
