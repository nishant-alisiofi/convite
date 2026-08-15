import { NextResponse } from 'next/server'
import { getPool } from '@/db/client'
import { LIMITE_CUERPO_BYTES, leerAcotado } from '@/lib/canales/whatsapp/cuerpo'
import { CABECERA_FIRMA, revisarFirmaPrevia, verificarFirma } from '@/lib/canales/whatsapp/firma'
import { encolar } from '@/lib/jobs/cola'

export const dynamic = 'force-dynamic'

/**
 * The WhatsApp Cloud API webhook.
 *
 * Three rules shape this file and none is negotiable.
 *
 * **Verify the signature over the raw bytes.** The URL is public and Meta sends no bearer
 * token, so the HMAC is the only authentication. The body is read exactly once and handed to
 * the verifier as the bytes that arrived — parsing and re-serialising first would reorder
 * keys and break the digest for reasons that are invisible in a log.
 *
 * **Refuse before reading.** Anyone can POST here. Buffering a whole body and *then*
 * noticing there was no signature means an unauthenticated stranger decides how much memory
 * we spend, and a chunked upload with no `content-length` can decide it is unbounded. So the
 * header conditions are checked off the headers alone, and the read itself is capped.
 *
 * **Answer 200 first, work later** (contract §3). Every provider retries on a slow or
 * non-200 response, so a webhook that does its work inline turns a bad database minute into
 * a duplicate-delivery storm. The payload is parked on the job queue and the worker does
 * intake. The one thing that is *not* deferred is authentication: an unsigned request never
 * reaches the queue.
 */

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const modo = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const desafio = url.searchParams.get('hub.challenge')

  const esperado = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
  if (!esperado) {
    return NextResponse.json({ error: 'verificación no configurada' }, { status: 503 })
  }
  if (modo !== 'subscribe' || token !== esperado || !desafio) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 403 })
  }

  // Meta expects the challenge echoed back as bare text, not JSON.
  return new Response(desafio, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  const cabecera = request.headers.get(CABECERA_FIRMA)
  const appSecret = process.env.WHATSAPP_APP_SECRET

  // Headers first, body second. A missing secret or a missing or malformed signature is
  // decided here, before a single byte of an unauthenticated body is held.
  const previa = revisarFirmaPrevia(cabecera, appSecret)
  if (!previa.valida) {
    // Logged, because a run of these is somebody probing the endpoint and that is worth
    // seeing. The body is deliberately not logged: it is unauthenticated and may be anything.
    console.warn(`[whatsapp] firma rechazada: ${previa.motivo}`)
    return NextResponse.json({ error: 'firma inválida' }, { status: 401 })
  }

  const lectura = await leerAcotado(request, LIMITE_CUERPO_BYTES)
  if (!lectura.ok) {
    console.warn(`[whatsapp] cuerpo rechazado: ${lectura.motivo}`)
    return NextResponse.json({ error: 'cuerpo demasiado grande' }, { status: 413 })
  }

  // Over the bytes exactly as they arrived: decoding and re-encoding first is the same
  // mistake as parsing and re-serialising.
  const firma = verificarFirma(lectura.cuerpo, cabecera, appSecret)
  if (!firma.valida) {
    console.warn(`[whatsapp] firma rechazada: ${firma.motivo}`)
    return NextResponse.json({ error: 'firma inválida' }, { status: 401 })
  }

  let webhook: unknown
  try {
    webhook = JSON.parse(lectura.cuerpo.toString('utf8'))
  } catch {
    // Signed but unreadable. Retrying will not fix it, so take the 200 and move on.
    console.warn('[whatsapp] payload firmado pero no es JSON válido')
    return NextResponse.json({ recibido: true, encolado: false })
  }

  await encolar(getPool(), 'procesar_webhook_whatsapp', { webhook })

  return NextResponse.json({ recibido: true, encolado: true })
}
