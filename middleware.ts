import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Refreshes the Supabase session cookie and keeps the panel behind a sign-in.
 *
 * This is a convenience, not a security boundary: the boundary is RLS. A request that got
 * past here with no staff record still reads nothing (db/migrations/0017).
 */
/**
 * Routes that answer without a session.
 *
 * Exported so a test can assert the list rather than trusting it. Anything reachable by
 * something that cannot hold a cookie belongs here: a provider posting a webhook, a cron
 * hitting the job runner, an uptime monitor reading the health check. Miss one and it does
 * not fail loudly — it 307s to the sign-in page, and the caller sees a redirect it has no
 * idea what to do with.
 */
export const PUBLICAS = ['/entrar', '/auth', '/api/webhooks', '/api/jobs', '/api/salud']

export async function middleware(request: NextRequest) {
  let respuesta = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          for (const { name, value } of cookies) request.cookies.set(name, value)
          respuesta = NextResponse.next({ request })
          for (const { name, value, options } of cookies) respuesta.cookies.set(name, value, options)
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const ruta = request.nextUrl.pathname
  const esPublica = PUBLICAS.some((p) => ruta.startsWith(p)) || ruta === '/'

  if (!user && !esPublica) {
    const destino = request.nextUrl.clone()
    destino.pathname = '/entrar'
    destino.searchParams.set('desde', ruta)
    return NextResponse.redirect(destino)
  }

  return respuesta
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
