import { NextResponse } from 'next/server'
import { eventosDeAgenda, membresiaActivaParaFeed } from '@/lib/agenda-ics/feed'
import { serializarCalendario } from '@/lib/agenda-ics/ics'
import { membresiaDeToken } from '@/lib/agenda-ics/token'

/**
 * The Agenda .ics feed — PRD-34 §28.1, the first, no-OAuth integration tier.
 *
 * A coordinator pastes `…/api/agenda/<token>.ics` into any calendar app and their jornadas and
 * shipments appear alongside everything else, staying current forever. The app polls this with no
 * session — it cannot hold a cookie — so the **token in the URL is the access control** (the route
 * is listed in the middleware's PUBLICAS for that reason), and the handler fails closed on
 * anything short of a valid token pointing at an `activa` membership: a bad, tampered, expired or
 * offboarded token gets a 404 with no detail, never a calendar and never a hint. That is why
 * `tests/superficie.test.ts` classifies it `autenticada` — a stranger gets no data.
 *
 * The response is `private, no-store`: a subscribe URL is a secret, and a shared cache holding one
 * membership's feed would be a leak with a long tail. §28.1's discretion and fixed-offset rules
 * live in `lib/agenda-ics/ics.ts`; the scoping lives in `lib/agenda-ics/feed.ts`.
 */

export const dynamic = 'force-dynamic'

function noEncontrado(): NextResponse {
  // One answer for every failure — malformed, unsigned, unknown, revoked — so the feed URL cannot
  // be probed to tell «wrong signature» from «offboarded» from «never existed».
  return new NextResponse('No encontrado', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' },
  })
}

export async function GET(
  _peticion: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params

  const membresiaId = membresiaDeToken(token)
  if (!membresiaId) return noEncontrado()

  try {
    const membresia = await membresiaActivaParaFeed(membresiaId)
    if (!membresia) return noEncontrado()

    const eventos = await eventosDeAgenda(membresia)
    const cuerpo = serializarCalendario(eventos, { nombre: 'Convite · Agenda' })

    return new NextResponse(cuerpo, {
      status: 200,
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'inline; filename="convite-agenda.ics"',
        'cache-control': 'private, no-store',
      },
    })
  } catch {
    // Fail closed: a database or serialisation error must not draw a calendar or spill a stack.
    return noEncontrado()
  }
}
