import { NextResponse } from 'next/server'
import { getPool } from '@/db/client'
import { estadoSistema } from '@/lib/observabilidad/salud'

export const dynamic = 'force-dynamic'

/**
 * The health check, answering the honest question.
 *
 * Returns 503 when something is actually wrong, so an uptime monitor alerts on a dead job
 * queue rather than only on a dead process. PRD §6: a silently failing matcher looks exactly
 * like a quiet week, and a check that returns 200 because the server is up reports "fine"
 * during precisely that outage.
 *
 * Two levels, because they answer to different readers:
 *
 *   GET /api/salud
 *     Public liveness. Is the database reachable, are the migrations there, is anything
 *     wrong at all. No numbers about the response — a stranger learning that 40 reports are
 *     waiting and nobody has verified one in three days is learning something about the
 *     basin's situation, and the whole point of 2.4 is that the outside sees aggregates or
 *     nothing.
 *
 *   GET /api/salud?detalle=1   (Authorization: Bearer $CRON_SECRET)
 *     The full picture, including the queue depths and PRD §6's median time from RECIBIDO to
 *     VERIFICADO. Same auth as the job runner, because it has the same reader: our own
 *     machinery. The coordinator surface does not come through here at all — the panel calls
 *     `estadoSistema()` directly, with a session behind it.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const quiereDetalle = new URL(request.url).searchParams.get('detalle') === '1'

  // Checked before any query: an unauthorised caller should not be able to make us do work,
  // and the auth answer does not depend on the system's state.
  if (quiereDetalle) {
    const secreto = process.env.CRON_SECRET
    if (!secreto) {
      // Fails closed rather than serving detail to anyone who guessed the query string.
      return NextResponse.json({ error: 'CRON_SECRET no configurado' }, { status: 503 })
    }
    if (request.headers.get('authorization') !== `Bearer ${secreto}`) {
      return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
    }
  }

  try {
    const estado = await estadoSistema(getPool())
    const codigo = estado.ok ? 200 : 503

    if (!quiereDetalle) {
      return NextResponse.json(
        {
          ok: estado.ok,
          base: estado.base,
          // A count of problems, never what they are: «3 alertas» tells a monitor to page
          // somebody without telling the internet how the response is going.
          alertas: estado.alertas.length,
        },
        { status: codigo },
      )
    }

    return NextResponse.json(estado, { status: codigo })
  } catch (error) {
    // A database we cannot reach is the one failure this endpoint must never hide.
    console.error('[salud] no se pudo consultar el estado', error)
    return NextResponse.json(
      { ok: false, base: { conectada: false, migraciones: 0 }, alertas: 1 },
      { status: 503 },
    )
  }
}
