import { timingSafeEqual } from 'node:crypto'

/**
 * Verifying the voice webhook, the same fails-closed posture as
 * lib/canales/whatsapp/firma.ts — but a different mechanism, because Infobip's Calls webhooks
 * carry no HMAC the way Meta's `X-Hub-Signature-256` does. What Infobip gives instead is a
 * webhook URL we choose ourselves when we register the Calls Application, so the secret is
 * ours: embedded in that URL (as a header or a query parameter — Infobip lets an integrator
 * configure either), and checked here in constant time.
 *
 * Fails closed exactly like the WhatsApp check: a missing secret, a missing value and a
 * mismatched value are all rejections, and there is no "skip verification in development"
 * escape hatch — that flag is how an unverified webhook reaches production.
 */

export const CABECERA_SECRETO = 'x-convite-webhook-secret'
export const PARAM_SECRETO = 'secreto'

export type ResultadoSecreto = { valida: true } | { valida: false; motivo: string }

function compararConstante(recibido: string, esperado: string): boolean {
  const a = Buffer.from(recibido, 'utf8')
  const b = Buffer.from(esperado, 'utf8')
  // timingSafeEqual throws on a length mismatch, which is itself a rejection — same trick
  // firma.ts uses for the WhatsApp signature.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Checked off the request alone (header or query string), before the body is ever read — a
 * public, unauthenticated endpoint should not spend memory buffering a body for a caller who
 * never had the secret.
 */
export function verificarSecretoVoz(
  request: Request,
  secretoEsperado: string | undefined,
): ResultadoSecreto {
  if (!secretoEsperado) return { valida: false, motivo: 'INFOBIP_WEBHOOK_SECRET no está configurado.' }

  const url = new URL(request.url)
  const recibido = request.headers.get(CABECERA_SECRETO) ?? url.searchParams.get(PARAM_SECRETO)
  if (!recibido) {
    return {
      valida: false,
      motivo: `Falta la cabecera ${CABECERA_SECRETO} o el parámetro ?${PARAM_SECRETO}=.`,
    }
  }
  if (!compararConstante(recibido, secretoEsperado)) return { valida: false, motivo: 'Secreto inválido.' }
  return { valida: true }
}
