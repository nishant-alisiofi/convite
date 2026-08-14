import type { ManejadorJob } from '@/lib/jobs/tipos'
import type { TipoAdjunto } from '@/db/schema/vocabulario'
import { almacenamientoLocal, type Almacenamiento } from './almacenamiento'
import { registrarEstado } from './bitacora'
import { type DepsIntake, recibirSobre, resolverOrganizacion } from './intake'
import { procesarMedia, type ProveedorMedia, proveedorMediaWhatsApp } from './media'
import { type TranscripcionPort, transcripcionPendiente } from './transcripcion'
import { interpretarWebhook, PROVEEDOR_WHATSAPP } from './whatsapp/payload'

/**
 * The media job.
 *
 * Runs out of band because the webhook has seconds and the download has none of the
 * guarantees: the provider ref expires in minutes, the link is bad, the file is large. A
 * failure here retries on the queue's backoff for about 29 hours (PRD §4 M5 asks for 24),
 * and the message and the reporte are already committed, so the worst case is a report with
 * no audio attached rather than a lost report.
 */

export type DepsMedia = {
  proveedor: ProveedorMedia
  almacenamiento: Almacenamiento
  transcripcion: TranscripcionPort
}

/**
 * Built lazily, so that a deployment with no WhatsApp token still boots and still runs every
 * other job — it only fails when a media job actually arrives, which cannot happen without a
 * WABA anyway (D3).
 */
export function depsMediaPorDefecto(): DepsMedia {
  const token = process.env.WHATSAPP_ACCESS_TOKEN
  if (!token) {
    throw new Error('WHATSAPP_ACCESS_TOKEN no está configurado: no se puede descargar media.')
  }
  return {
    proveedor: proveedorMediaWhatsApp(token),
    almacenamiento: almacenamientoLocal(),
    transcripcion: transcripcionPendiente,
  }
}

export function manejadorDescargarMedia(deps: DepsMedia): ManejadorJob {
  return async (job, client) => {
    const { reporteId, ref, tipo, mime, duracionSeg } = job.payload as {
      reporteId?: string
      ref?: string
      tipo?: TipoAdjunto
      mime?: string | null
      duracionSeg?: number | null
    }
    if (!reporteId || !ref || !tipo) {
      throw new Error('descargar_media requiere reporteId, ref y tipo.')
    }

    const guardada = await procesarMedia(ref, tipo, deps)

    const { rows } = await client.query<{ id: string }>(
      `insert into adjuntos
         (reporte_id, tipo, storage_key, mime, bytes, duracion_seg, hash_sha256, exif_removido)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id`,
      [
        reporteId,
        tipo,
        // Never the provider URL (2.6). adjuntos_no_url_proveedor_check is the backstop.
        guardada.storageKey,
        guardada.mime ?? mime ?? null,
        guardada.bytes,
        duracionSeg ?? null,
        guardada.hashSha256,
        guardada.exifRemovido,
      ],
    )
    const adjuntoId = rows[0]!.id

    if (tipo !== 'audio') return

    // Decision D8 is open, so this returns null and the note waits in the audio inbox (M7)
    // for a human to play it. Nothing leaves our infrastructure until somebody decides it may.
    const transcripcion = await deps.transcripcion.transcribir({
      storageKey: guardada.storageKey,
      mime: guardada.mime ?? mime ?? null,
      duracionSeg: duracionSeg ?? null,
    })
    if (!transcripcion) return

    await client.query(
      'update adjuntos set transcripcion = $2, transcripcion_confianza = $3 where id = $1',
      [adjuntoId, transcripcion.texto, transcripcion.confianza],
    )
  }
}

/**
 * The webhook, processed off the request.
 *
 * The route verifies the signature, parks the payload here and answers 200 — every provider
 * retries a slow or non-200 response, so doing the work inline buys duplicate deliveries
 * during exactly the minutes the database is struggling. Idempotency still holds if one
 * arrives twice: `registrarEntrante` refuses the second copy per message id (2.7).
 */
export function manejadorWebhookWhatsApp(deps: DepsIntake = {}): ManejadorJob {
  return async (job, client) => {
    const lote = interpretarWebhook(job.payload.webhook)
    if (lote.sobres.length === 0 && lote.estados.length === 0) return

    if (lote.sobres.length > 0) {
      const organizacionId = await resolverOrganizacion(client, lote.phoneNumberId)
      for (const sobre of lote.sobres) {
        await recibirSobre(client, sobre, organizacionId, deps)
      }
    }

    for (const estado of lote.estados) {
      await registrarEstado(client, PROVEEDOR_WHATSAPP, estado.idExterno, estado.estado)
    }
  }
}

/**
 * Handlers this module owns.
 *
 * Kept separate from `lib/jobs/manejadores.ts` and merged at the worker so the channel layer
 * registers its own jobs rather than the job module having to import the whole intake stack.
 */
export const MANEJADORES_CANALES: Record<string, ManejadorJob> = {
  procesar_webhook_whatsapp: manejadorWebhookWhatsApp(),
  descargar_media: async (job, client) => manejadorDescargarMedia(depsMediaPorDefecto())(job, client),
}
