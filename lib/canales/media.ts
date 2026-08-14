import { createHash } from 'node:crypto'
import sharp from 'sharp'
import type { TipoAdjunto } from '@/db/schema/vocabulario'
import { type Almacenamiento, claveMedia } from './almacenamiento'

/**
 * Downloading media, stripping it, and storing our own copy.
 *
 * The order matters and is not negotiable. Download immediately, because a provider ref
 * expires in minutes. Strip before storing, because non-negotiable 2.5 is that no photo is
 * ever written un-stripped — a WhatsApp photo carries the GPS of the house it was taken in,
 * and in this territory that is the single most dangerous field in the system. Then store
 * under our own key, because 2.6 says a provider URL is a future 404.
 */

export type MediaDescargada = {
  bytes: Buffer
  mime: string | null
}

export interface ProveedorMedia {
  descargar(ref: string): Promise<MediaDescargada>
}

export type MediaGuardada = {
  storageKey: string
  mime: string | null
  bytes: number
  hashSha256: string
  /** Only ever true for a photo that actually went through the re-encode. */
  exifRemovido: boolean
}

const EXTENSION_POR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
}

export function extensionDe(mime: string | null, tipo: TipoAdjunto): string {
  if (mime && EXTENSION_POR_MIME[mime]) return EXTENSION_POR_MIME[mime]!
  return tipo === 'audio' ? 'bin' : 'jpg'
}

/**
 * Removes EXIF by re-encoding.
 *
 * sharp drops all metadata on output unless `withMetadata()` is called, so a plain decode
 * and re-encode is the strip. `rotate()` first, with no argument, applies whatever
 * orientation the EXIF declared and then discards the tag — without it, stripping metadata
 * silently turns every portrait photo sideways, which is how "we removed EXIF" becomes a
 * bug report about rotated images three weeks later.
 *
 * This is why `sharp` is a dependency: the alternative is hand-parsing JPEG APP1 segments,
 * and a partial EXIF parser that misses a vendor block is worse than none.
 */
export async function limpiarExif(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes).rotate().toBuffer()
}

/**
 * The whole pipeline for one attachment.
 *
 * Throws if the download fails — the caller is a job, and the job's retry is the backoff
 * (2.13: the message record is kept either way, so a failed download never loses the
 * report).
 */
export async function procesarMedia(
  ref: string,
  tipo: TipoAdjunto,
  deps: { proveedor: ProveedorMedia; almacenamiento: Almacenamiento },
): Promise<MediaGuardada> {
  const descargada = await deps.proveedor.descargar(ref)

  let bytes = descargada.bytes
  let exifRemovido = false
  if (tipo === 'foto') {
    bytes = await limpiarExif(bytes)
    exifRemovido = true
  }

  const storageKey = claveMedia(tipo, bytes, extensionDe(descargada.mime, tipo))
  await deps.almacenamiento.guardar(storageKey, bytes)

  return {
    storageKey,
    mime: descargada.mime,
    bytes: bytes.byteLength,
    hashSha256: createHash('sha256').update(bytes).digest('hex'),
    exifRemovido,
  }
}

/**
 * The real Cloud API driver: resolve the ref to a short-lived URL, then fetch it with the
 * same bearer token. Never exercised by the tests — they inject their own `ProveedorMedia`,
 * because a test suite that needs a Meta token is a test suite nobody runs.
 */
export function proveedorMediaWhatsApp(
  token: string,
  version = 'v21.0',
): ProveedorMedia {
  return {
    async descargar(ref) {
      const meta = await fetch(`https://graph.facebook.com/${version}/${ref}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!meta.ok) throw new Error(`No se pudo resolver el media ${ref}: HTTP ${meta.status}`)
      const { url, mime_type } = (await meta.json()) as { url?: string; mime_type?: string }
      if (!url) throw new Error(`El media ${ref} no trajo URL de descarga.`)

      const archivo = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!archivo.ok) throw new Error(`No se pudo descargar el media ${ref}: HTTP ${archivo.status}`)

      return {
        bytes: Buffer.from(await archivo.arrayBuffer()),
        mime: mime_type?.split(';')[0]?.trim() ?? null,
      }
    },
  }
}
