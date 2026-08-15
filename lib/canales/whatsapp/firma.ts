import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * `X-Hub-Signature-256`, the only thing standing between our intake and the open internet.
 *
 * The webhook URL is public and unauthenticated by design — Meta will not send a bearer
 * token — so the HMAC is the authentication. Without it anyone who learns the URL can post
 * a flood of fabricated needs into a humanitarian response, which is a worse failure than
 * the system being down.
 *
 * Two details that are easy to get wrong and impossible to notice afterwards:
 *
 *   1. The HMAC is over the **raw request body bytes**, not over a re-serialised object.
 *      `JSON.parse` then `JSON.stringify` reorders keys and drops whitespace, and the
 *      signature stops matching for reasons nobody can see. The route reads `req.text()`
 *      once and passes that exact string here.
 *   2. The comparison is constant-time. A plain `===` leaks how many leading bytes were
 *      right, which is enough to forge a signature given patience.
 */

export const CABECERA_FIRMA = 'x-hub-signature-256'

export type ResultadoFirma =
  | { valida: true }
  | { valida: false; motivo: string }

export function firmar(cuerpoCrudo: string | Buffer, appSecret: string): string {
  // A string is hashed as UTF-8 (Node's default) and a Buffer as the bytes it holds, so the
  // route can verify the bytes it received without decoding them first.
  return `sha256=${createHmac('sha256', appSecret).update(cuerpoCrudo).digest('hex')}`
}

export type RevisionPrevia =
  | { valida: true; appSecret: string; cabecera: string }
  | { valida: false; motivo: string }

/**
 * Everything that can be refused before the body is read.
 *
 * Split out because the body is the expensive part. This endpoint is public and takes
 * unauthenticated POSTs, so buffering megabytes and *then* noticing there was no signature
 * is a way to spend our memory on somebody who never had the secret. The route runs this
 * first, off the headers alone.
 *
 * Fails closed everywhere: a missing secret, a missing header and a malformed header are all
 * rejections. There is deliberately no "skip verification in development" flag — that flag
 * is how an unverified webhook reaches production.
 */
export function revisarFirmaPrevia(
  cabecera: string | null,
  appSecret: string | undefined,
): RevisionPrevia {
  if (!appSecret) return { valida: false, motivo: 'WHATSAPP_APP_SECRET no está configurado.' }
  if (!cabecera) return { valida: false, motivo: `Falta la cabecera ${CABECERA_FIRMA}.` }
  if (!cabecera.startsWith('sha256=')) {
    return { valida: false, motivo: 'La firma no viene en el formato sha256=<hex>.' }
  }
  return { valida: true, appSecret, cabecera }
}

/**
 * The full check: the header conditions above, and then the digest over the body.
 *
 * One definition of «fails closed», shared with `revisarFirmaPrevia`, so the cheap early
 * rejection and the real verification cannot drift apart.
 */
export function verificarFirma(
  cuerpoCrudo: string | Buffer,
  cabecera: string | null,
  appSecret: string | undefined,
): ResultadoFirma {
  const previa = revisarFirmaPrevia(cabecera, appSecret)
  if (!previa.valida) return previa

  const esperada = Buffer.from(firmar(cuerpoCrudo, previa.appSecret), 'utf8')
  const recibida = Buffer.from(previa.cabecera, 'utf8')

  // timingSafeEqual throws on a length mismatch, which is itself a rejection.
  if (esperada.length !== recibida.length) return { valida: false, motivo: 'Firma inválida.' }
  if (!timingSafeEqual(esperada, recibida)) return { valida: false, motivo: 'Firma inválida.' }

  return { valida: true }
}
