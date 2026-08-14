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

export function esRutaPublica(ruta: string): boolean {
  return PUBLICAS.some((p) => ruta.startsWith(p)) || ruta === '/'
}

/**
 * Whether identity is configured at all.
 *
 * These are the names the client actually reads. `.env.example` and `lib/env.ts` also carry
 * `SUPABASE_URL`/`SUPABASE_ANON_KEY`, which nothing consumes — setting those and not these
 * looks identical to setting nothing.
 */
function autenticacionConfigurada(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}

/**
 * What a protected route says when identity is not configured.
 *
 * 503 rather than 500, and it says what is missing. The previous behaviour was to construct
 * the Supabase client unconditionally, which threw on every single request — so a deployment
 * without these variables answered 500 to the webhook and to the health check as well, and
 * the only clue was a stack trace in a log nobody was watching. Meta retrying against a 500
 * because our auth is unconfigured is indefensible.
 *
 * This is not a bypass. Public routes were always public; protected routes still refuse
 * without a session, and now they refuse for a legible reason instead of crashing.
 */
function sinAutenticacion(): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="es"><meta charset="utf-8">
     <title>Autenticación no configurada</title>
     <body style="font-family:system-ui;max-width:34rem;margin:4rem auto;line-height:1.5">
     <h1>Autenticación no configurada</h1>
     <p>Esta pantalla necesita un inicio de sesión y el servidor no tiene configurada la
     identidad, así que no hay forma de comprobar quién es usted.</p>
     <p>Faltan <code>NEXT_PUBLIC_SUPABASE_URL</code> y
     <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. El resto del sistema —el webhook, la cola y
     <code>/api/salud</code>— sigue funcionando.</p>
     </body></html>`,
    { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

/**
 * Per-IP rate limiting for the public page (M12).
 *
 * In-process and therefore per-instance: it resets on deploy and does not coordinate across
 * replicas, so on two containers it is a limit of 2N. Written down rather than assumed —
 * the real answer when that day comes is a shared counter. What it buys today is that the
 * one page a stranger can reach cannot be used to hammer Postgres from a single source.
 */
const VENTANA_MS = 60_000
const MAXIMO_POR_VENTANA = 60
const golpes = new Map<string, { desde: number; n: number }>()

function excedeLimite(ip: string, ahora: number): boolean {
  const previo = golpes.get(ip)
  if (!previo || ahora - previo.desde > VENTANA_MS) {
    golpes.set(ip, { desde: ahora, n: 1 })
    // Cheap sweep so a long-lived process does not keep an entry per address ever seen.
    if (golpes.size > 5_000) {
      for (const [clave, v] of golpes) if (ahora - v.desde > VENTANA_MS) golpes.delete(clave)
    }
    return false
  }
  previo.n += 1
  return previo.n > MAXIMO_POR_VENTANA
}

export async function middleware(request: NextRequest) {
  const ruta = request.nextUrl.pathname
  const esPublica = esRutaPublica(ruta)

  // Only the public page is metered. The panel is behind a session, the webhooks carry a
  // signature and their own idempotency, and the job runner is called by cron.
  if (ruta === '/') {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      'desconocida'

    if (excedeLimite(ip, Date.now())) {
      return new NextResponse('Demasiadas solicitudes. Intente en un minuto.', {
        status: 429,
        headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' },
      })
    }
  }

  // Identity missing: the public surface carries on, the private one fails closed and says
  // why. This is what makes a database-only staging deploy possible — intake, the queue and
  // the health check all work while sign-in waits for a Supabase project.
  if (!autenticacionConfigurada()) {
    return esPublica ? NextResponse.next({ request }) : sinAutenticacion()
  }

  // ── Configured: exactly as before ───────────────────────────────────────────────────────
  // The client is still built for every route, public ones included, because that is what
  // refreshes the session cookie.
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

  if (!user && !esPublica) {
    const destino = request.nextUrl.clone()
    destino.pathname = '/entrar'
    destino.searchParams.set('desde', ruta)
    return NextResponse.redirect(destino)
  }

  // Nothing behind a session is ever cached: a shared cache holding a coordinator's screen
  // is a leak with a long tail. The public page's cacheability is Next's to set from its own
  // `revalidate` — setting it here too would just fight the framework.
  if (ruta !== '/') respuesta.headers.set('Cache-Control', 'private, no-store')

  return respuesta
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
