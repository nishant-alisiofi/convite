import { NextResponse } from 'next/server'
import { getPool } from '@/db/client'
import { leerAcotado, LIMITE_CUERPO_BYTES } from '@/lib/canales/whatsapp/cuerpo'
import { verificarSecretoVoz } from '@/lib/canales/voz/firma'
import { encolar } from '@/lib/jobs/cola'

export const dynamic = 'force-dynamic'

/**
 * The Infobip Calls webhook (PRD-15 / PRD v3 §4.1).
 *
 * Same three rules as app/api/webhooks/whatsapp/route.ts, because they are not specific to
 * Meta — they are what any public, unauthenticated intake endpoint has to do:
 *
 * **Verify before reading.** The secret is checked off the request (header or query string)
 * before the body is buffered — see lib/canales/voz/firma.ts for why Infobip's Calls
 * webhooks need a different mechanism than WhatsApp's HMAC.
 *
 * **Cap the read.** `leerAcotado` is channel-agnostic despite living under whatsapp/ — it
 * refuses an oversized `content-length` outright and cancels a chunked body the moment it
 * exceeds the cap, so an unauthenticated stranger cannot decide how much memory this costs.
 *
 * **Answer 200 first, work later.** Every provider retries a slow or non-200 response, and
 * this is doubly true for a channel where the "work" is placing a phone call: a webhook that
 * dials inline turns one bad database second into a duplicate-callback storm. The payload is
 * parked on the job queue (lib/canales/voz/trabajos.ts); idempotency holds if Infobip retries
 * the same CALL_RECEIVED, exactly like `registrarEntrante` does for WhatsApp (2.7).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secreto = verificarSecretoVoz(request, process.env.INFOBIP_WEBHOOK_SECRET)
  if (!secreto.valida) {
    console.warn(`[voz] secreto rechazado: ${secreto.motivo}`)
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  }

  const lectura = await leerAcotado(request, LIMITE_CUERPO_BYTES)
  if (!lectura.ok) {
    console.warn(`[voz] cuerpo rechazado: ${lectura.motivo}`)
    return NextResponse.json({ error: 'cuerpo demasiado grande' }, { status: 413 })
  }

  let webhook: unknown
  try {
    webhook = JSON.parse(lectura.cuerpo.toString('utf8'))
  } catch {
    // Authenticated but unreadable. Retrying will not fix malformed JSON, so take the 200.
    console.warn('[voz] payload autenticado pero no es JSON válido')
    return NextResponse.json({ recibido: true, encolado: false })
  }

  await encolar(getPool(), 'procesar_webhook_voz', { webhook })

  return NextResponse.json({ recibido: true, encolado: true })
}
