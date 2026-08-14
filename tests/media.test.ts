import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  almacenamientoLocal,
  claveMedia,
  extensionDe,
  limpiarExif,
  procesarMedia,
  type ProveedorMedia,
  validarClave,
} from '@/lib/canales'

/**
 * The media pipeline: download, strip, store.
 *
 * Non-negotiable 2.5 is the one that matters here. A WhatsApp photo carries the GPS of the
 * place it was taken, and in this territory that is the most dangerous field in the system —
 * so the test builds a real JPEG with real EXIF and asserts it comes out the other side
 * without any.
 */

let raiz: string

beforeAll(async () => {
  raiz = await mkdtemp(join(tmpdir(), 'convite-media-'))
})

afterAll(async () => {
  await rm(raiz, { recursive: true, force: true })
})

/** A small JPEG carrying EXIF, including a GPS-shaped tag. */
async function fotoConExif(): Promise<Buffer> {
  return sharp({
    create: { width: 32, height: 24, channels: 3, background: { r: 20, g: 90, b: 60 } },
  })
    .withExif({
      IFD0: { Make: 'Convite', Model: 'Prueba' },
      IFD3: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'W' },
    })
    .jpeg()
    .toBuffer()
}

describe('2.5 — nada se guarda con EXIF', () => {
  it('la foto de prueba efectivamente trae EXIF antes de limpiarla', async () => {
    // Without this the next test could pass against an image that never had metadata.
    const metadatos = await sharp(await fotoConExif()).metadata()
    expect(metadatos.exif).toBeDefined()
  })

  it('lo quita al reencodificar', async () => {
    const limpia = await limpiarExif(await fotoConExif())
    const metadatos = await sharp(limpia).metadata()

    expect(metadatos.exif).toBeUndefined()
    // Still a usable image, not just bytes with the tags scraped off.
    expect(metadatos.width).toBe(32)
    expect(metadatos.height).toBe(24)
  })
})

describe('2.6 — la clave de almacenamiento es nuestra', () => {
  it('rechaza una URL del proveedor', () => {
    // adjuntos_no_url_proveedor_check would refuse it too; this fails earlier and louder.
    expect(() => validarClave('https://lookaside.fbsbx.com/whatsapp/1234')).toThrow(/URL/)
    expect(() => validarClave('http://example.org/a.jpg')).toThrow(/URL/)
  })

  it('rechaza rutas que se salen de la raíz', () => {
    expect(() => validarClave('../../etc/passwd')).toThrow()
    expect(() => validarClave('/etc/passwd')).toThrow()
  })

  it('deriva la clave del contenido, así un reintento no deja copias huérfanas', () => {
    const bytes = Buffer.from('la misma nota de voz')
    expect(claveMedia('audio', bytes, 'ogg')).toBe(claveMedia('audio', bytes, 'ogg'))
    expect(claveMedia('audio', bytes, 'ogg')).not.toBe(
      claveMedia('audio', Buffer.from('otra cosa'), 'ogg'),
    )
    expect(claveMedia('audio', bytes, 'ogg')).toMatch(/^audio\/[0-9a-f]{2}\/[0-9a-f]{64}\.ogg$/)
  })

  it('elige la extensión por mime y no se queda sin una', () => {
    expect(extensionDe('audio/ogg', 'audio')).toBe('ogg')
    expect(extensionDe('image/jpeg', 'foto')).toBe('jpg')
    expect(extensionDe(null, 'audio')).toBe('bin')
  })

  it('guarda y lee de vuelta', async () => {
    const almacen = almacenamientoLocal(raiz)
    const bytes = Buffer.from('contenido')
    const clave = claveMedia('audio', bytes, 'ogg')

    expect(await almacen.existe(clave)).toBe(false)
    await almacen.guardar(clave, bytes)
    expect(await almacen.existe(clave)).toBe(true)
    expect((await almacen.leer(clave)).toString()).toBe('contenido')
  })
})

describe('el pipeline completo', () => {
  function proveedorDe(bytes: Buffer, mime: string | null): ProveedorMedia {
    // The tests inject their own provider: a suite that needs a Meta token is a suite
    // nobody runs.
    return { async descargar() { return { bytes, mime } } }
  }

  it('descarga, limpia y guarda una foto', async () => {
    const almacen = almacenamientoLocal(raiz)
    const original = await fotoConExif()

    const guardada = await procesarMedia('media-id-1', 'foto', {
      proveedor: proveedorDe(original, 'image/jpeg'),
      almacenamiento: almacen,
    })

    expect(guardada.exifRemovido).toBe(true)
    expect(guardada.storageKey).not.toMatch(/^https?:\/\//)
    expect(guardada.storageKey).toMatch(/^foto\//)

    const enDisco = await almacen.leer(guardada.storageKey)
    expect((await sharp(enDisco).metadata()).exif).toBeUndefined()
    // The hash describes what we stored, not what the provider sent.
    expect(guardada.bytes).toBe(enDisco.byteLength)
  })

  it('deja el audio como llegó y no dice haberle quitado EXIF', async () => {
    // `adjuntos_exif_check` only constrains photos, and claiming to have stripped an ogg
    // would be a lie recorded in the database.
    const guardada = await procesarMedia('media-id-2', 'audio', {
      proveedor: proveedorDe(Buffer.from('OggS-falso'), 'audio/ogg'),
      almacenamiento: almacenamientoLocal(raiz),
    })

    expect(guardada.exifRemovido).toBe(false)
    expect(guardada.mime).toBe('audio/ogg')
    expect(guardada.storageKey).toMatch(/^audio\/.*\.ogg$/)
  })

  it('propaga el fallo de descarga para que el job reintente', async () => {
    // 2.13: the message record is already committed, so a failed download costs the audio,
    // never the report.
    const proveedor: ProveedorMedia = {
      async descargar() {
        throw new Error('HTTP 404')
      },
    }
    await expect(
      procesarMedia('media-id-3', 'audio', {
        proveedor,
        almacenamiento: almacenamientoLocal(raiz),
      }),
    ).rejects.toThrow('HTTP 404')
  })
})
