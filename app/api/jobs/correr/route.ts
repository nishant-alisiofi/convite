import { NextResponse } from 'next/server'
import { getPool } from '@/db/client'
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

  const resultado = await correrJobs(getPool(), MANEJADORES)
  return NextResponse.json(resultado)
}
