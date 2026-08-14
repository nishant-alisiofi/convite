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

export function firmar(cuerpoCrudo: string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(cuerpoCrudo, 'utf8').digest('hex')}`
}

/**
 * Fails closed everywhere: a missing header, a malformed header, a missing secret and a
 * wrong digest are all rejections. There is deliberately no "skip verification in
 * development" flag — that flag is how an unverified webhook reaches production.
 */
export function verificarFirma(
  cuerpoCrudo: string,
  cabecera: string | null,
  appSecret: string | undefined,
): ResultadoFirma {
  if (!appSecret) return { valida: false, motivo: 'WHATSAPP_APP_SECRET no está configurado.' }
  if (!cabecera) return { valida: false, motivo: `Falta la cabecera ${CABECERA_FIRMA}.` }
  if (!cabecera.startsWith('sha256=')) {
    return { valida: false, motivo: 'La firma no viene en el formato sha256=<hex>.' }
  }

  const esperada = Buffer.from(firmar(cuerpoCrudo, appSecret), 'utf8')
  const recibida = Buffer.from(cabecera, 'utf8')

  // timingSafeEqual throws on a length mismatch, which is itself a rejection.
  if (esperada.length !== recibida.length) return { valida: false, motivo: 'Firma inválida.' }
  if (!timingSafeEqual(esperada, recibida)) return { valida: false, motivo: 'Firma inválida.' }

  return { valida: true }
}
