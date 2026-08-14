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
 * Unauthenticated on purpose — a monitor cannot hold a session — which is why the body is
 * counts and nothing else. No coordinate, no community name, no phone number, no folio (2.4).
 * `tests/privacidad.test.ts` asserts that rather than trusting it.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const estado = await estadoSistema(getPool())
    return NextResponse.json(estado, { status: estado.ok ? 200 : 503 })
  } catch (error) {
    // A database we cannot reach is the one failure this endpoint must never hide.
    console.error('[salud] no se pudo consultar el estado', error)
    return NextResponse.json(
      {
        ok: false,
        base: { conectada: false, migraciones: 0 },
        alertas: ['no se pudo consultar la base de datos'],
      },
      { status: 503 },
    )
  }
}
