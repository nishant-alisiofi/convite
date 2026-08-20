import { NextResponse } from 'next/server'
import { csvDeFilas, filasExporteAgenda } from '@/lib/exportes'
import { conSesion, sesionActual } from '@/lib/sesion'

/**
 * The Agenda CSV export — PRD-34 §28's Informes-exports item.
 *
 * Session-gated like every panel screen, unlike the token-gated .ics feed at
 * `app/api/agenda/[token]`: this is a signed-in download, not something a calendar app polls
 * with no cookie, so there is no reason to invent a second auth mechanism for it. No session
 * means no file — the same 401 any other authenticated API route in this app would give.
 *
 * RLS decides what the file actually contains (`filasExporteAgenda` reads through
 * `lib/jornadas.ts`, which every read in the panel already goes through), so a role that cannot
 * see jornadas gets a header-only file, never an error that hints at what exists.
 */
export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const sesion = await sesionActual()
  if (!sesion) {
    return new NextResponse('No autenticado', {
      status: 401,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' },
    })
  }

  const filas = await conSesion(sesion, (client) => filasExporteAgenda(client))
  const csv = csvDeFilas(filas)

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="convite-agenda.csv"',
      'cache-control': 'private, no-store',
    },
  })
}
