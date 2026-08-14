import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path'

/**
 * Where media lives, behind an interface.
 *
 * Non-negotiable 2.6: our own object storage key, never the provider URL. WhatsApp media
 * URLs expire in minutes, so a stored URL is a guaranteed future 404 — and
 * `adjuntos_no_url_proveedor_check` refuses anything URL-shaped at the database, which is
 * the backstop rather than the rule.
 *
 * The local-disk driver is the one that exists today. R2 is the obvious production
 * implementation and needs no change above this line, which is the point of the interface:
 * the deployment decision (D5) does not block the pipeline.
 *
 * Files live outside the repo under DATA_DIR. Operational data is not source.
 */

export interface Almacenamiento {
  guardar(clave: string, bytes: Buffer): Promise<void>
  leer(clave: string): Promise<Buffer>
  existe(clave: string): Promise<boolean>
  /** For tests and for the local driver's own bookkeeping; never persisted anywhere. */
  rutaDe(clave: string): string
}

const CLAVE_VALIDA = /^[a-z0-9][a-z0-9/_.-]*$/i

/**
 * Rejects both the URL the constraint would refuse and the `..` that would let a provider
 * id walk out of the storage root.
 */
export function validarClave(clave: string): void {
  if (/^https?:\/\//i.test(clave)) {
    throw new Error(`Una storage_key nunca es una URL del proveedor (2.6): ${clave}`)
  }
  if (isAbsolute(clave) || clave.includes('..') || !CLAVE_VALIDA.test(clave)) {
    throw new Error(`storage_key inválida: ${clave}`)
  }
}

/**
 * Builds the key for a piece of media.
 *
 * Content-addressed by sha256, so the same audio downloaded twice after a retry lands on
 * the same key instead of leaving an orphan copy behind.
 */
export function claveMedia(tipo: string, bytes: Buffer, extension: string): string {
  const hash = createHash('sha256').update(bytes).digest('hex')
  return `${tipo}/${hash.slice(0, 2)}/${hash}.${extension.replace(/[^a-z0-9]/gi, '')}`
}

export function raizDatos(): string {
  // `??` is wrong here and it cost us: `.env.example` ships `DATA_DIR=` empty, an empty
  // string is not nullish, and `resolve('')` is the current working directory — so a fresh
  // clone wrote every voice note and photo into the REPO ROOT. It surfaced as an untracked
  // `audio/` directory nobody put there.
  //
  // Empty means "not configured yet", exactly as lib/env.ts already treats placeholder
  // values, so the gitignored ./.data fallback actually engages.
  const configurado = process.env.DATA_DIR?.trim()
  return configurado ? configurado : resolve(process.cwd(), '.data')
}

export function almacenamientoLocal(raiz: string = raizDatos()): Almacenamiento {
  const base = resolve(raiz)

  function rutaDe(clave: string): string {
    validarClave(clave)
    const ruta = resolve(join(base, normalize(clave)))
    // Belt and braces: even with a valid-looking key, never write outside the root.
    if (ruta !== base && !ruta.startsWith(base + sep)) {
      throw new Error(`storage_key fuera de la raíz de datos: ${clave}`)
    }
    return ruta
  }

  return {
    rutaDe,
    async guardar(clave, bytes) {
      const ruta = rutaDe(clave)
      await mkdir(dirname(ruta), { recursive: true })
      await writeFile(ruta, bytes)
    },
    async leer(clave) {
      return readFile(rutaDe(clave))
    },
    async existe(clave) {
      try {
        await stat(rutaDe(clave))
        return true
      } catch {
        return false
      }
    },
  }
}
