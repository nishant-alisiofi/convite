import { NextResponse } from 'next/server'
import { getPool } from '@/db/client'
import { MANEJADORES_CANALES } from '@/lib/canales/trabajos'
import { correrJobs } from '@/lib/jobs/cola'
import { MANEJADORES } from '@/lib/jobs/manejadores'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * The worker, invoked by cron (Section 3). Vercel Cron sends `Authorization: Bearer
 * $CRON_SECRET`; without the secret configured the route only answers to localhost, so a
 * misconfigured deploy fails closed rather than exposing a job runner.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secreto = process.env.CRON_SECRET
  const autorizacion = request.headers.get('authorization')

  if (secreto) {
    if (autorizacion !== `Bearer ${secreto}`) {
      return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'CRON_SECRET no configurado' }, { status: 503 })
  }

  // The channel layer registers its own handlers rather than the job module importing the
  // whole intake stack; the worker is where the two maps meet.
  const resultado = await correrJobs(getPool(), { ...MANEJADORES, ...MANEJADORES_CANALES })
  return NextResponse.json(resultado)
}
