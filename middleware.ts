import { getSessionCookie } from 'better-auth/cookies'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Keeps the panel behind a sign-in.
 *
 * This is a convenience, not a security boundary: the boundary is RLS. A request that got
 * past here with no staff record still reads nothing (db/migrations/0017).
 *
 * It checks that a session cookie is *present*, not that it is valid — `getSessionCookie`
 * reads the cookie jar and nothing else. That is deliberate and is what Better Auth
 * recommends for middleware: verifying properly means a database round trip, middleware
 * runs on every request including the public map, and the answer would be thrown away
 * anyway because the panel re-reads the session for real in `sesionActual()`. A forged
 * cookie gets past this line and then gets nothing: no Better Auth session, no `usuarios`
 * row, no rows from any policy.
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
export const PUBLICAS = [
  '/entrar',
  // §1 of docs/tipos-de-usuario-y-accesos.md: «¿Qué quiere hacer?» — the entry that routes by
  // intention instead of putting one login wall in front of four different people. Public by
  // definition: it is the screen somebody meets before they are anybody, and every door behind
  // it carries its own gate.
  '/entrada',
  // §4: requesting to run a centre is a low-friction, unauthenticated path — the whole point is
  // that somebody who is not yet staff can ask. It creates a `pendiente` organisation and a
  // pending invitation; nothing operates until the platform approves, so opening the door here
  // opens nothing behind it.
  '/solicitar-centro',
  // §2.2: the self-service donor. Public by definition — «donar es fácil» is the whole design —
  // and safe: the one function behind it creates a `donante` contact and a single offer, grants
  // no session and no read, and 2.10 holds because a number on an offer opens no panel.
  '/donar',
  // FR-18 (§29.2–29.3b): a transporter self-registers to OFFER capacity — the frictionless supply
  // side. Public by necessity (somebody not yet staff proves possession here) and safe: it lands
  // the person as an aportante with an empty ceiling and a `lectura` role, so RLS gives them no
  // household address by any route. Covers /transportar and its /registro callback.
  '/transportar',
  '/auth',
  // Better Auth's own endpoints. They are how a person who has no session gets one, so
  // gating them behind a session is the deadlock it sounds like.
  '/api/auth',
  '/api/webhooks',
  '/api/jobs',
  '/api/salud',
  // §28.1 (PRD-34): the .ics Agenda feed. A calendar app subscribing to it holds no session
  // cookie, so gating it behind one would 307 the subscription to a login page it cannot use.
  // The per-membership token in the URL is the access control — the handler fails closed (404)
  // on a missing, tampered, expired or offboarded token — so opening the door here opens nothing
  // behind it. Classified `autenticada` in tests/superficie.test.ts: a stranger gets no data.
  '/api/agenda',
  // The aggregate response page. The landing at `/` is public via the `ruta === '/'` clause
  // below; this covers the page it links to.
  '/respuesta',
  // Public legal pages, required both by Ley 1581 (política de tratamiento) and by Meta's
  // WhatsApp Business app review, which needs publicly reachable Privacy Policy, Terms of
  // Service, and Data-Deletion-Instructions URLs. Meta's crawler holds no cookie, so gating
  // these behind a session would 307 the review to a login page it cannot use.
  '/privacidad',
  '/terminos',
  '/eliminar-datos',
]

/**
 * Files the web expects to fetch without asking anybody's permission.
 *
 * Separate from PUBLICAS because they are not our routes — they are conventions crawlers,
 * browsers and certificate authorities reach for unprompted. Gating them produced a 503 for
 * `/robots.txt` on staging, which lies twice: it says «this exists but the server is
 * unwell» when the truth is «there is nothing here», and a 503 invites the caller back
 * forever. A 404 ends the conversation honestly.
 */
export const SIEMPRE_PUBLICAS = ['/robots.txt', '/sitemap.xml', '/favicon.ico', '/.well-known']

/** The only one with children. The rest are single files and match exactly. */
const CON_HIJOS = ['/.well-known']

function esArchivoConvencional(ruta: string): boolean {
  // A list of always-public paths is an inviting place to smuggle something through, so it
  // matches exactly rather than by prefix: `/sitemap.xml/../tablero` starts with
  // `/sitemap.xml/` and is not a sitemap. Next normalises paths before middleware sees
  // them, but a public-route list should not be depending on that to stay closed.
  if (ruta.includes('..')) return false
  return SIEMPRE_PUBLICAS.some(
    (p) => ruta === p || (CON_HIJOS.includes(p) && ruta.startsWith(`${p}/`)),
  )
}

export function esRutaPublica(ruta: string): boolean {
  /*
   * Exact match, or a whole path segment below it. A bare `startsWith` is the trap: `/api/salud`
   * on the list also made `/api/salud-privada` public, `/entrar` made `/entrar-copia` public,
   * and `/api/jobs` made `/api/jobs-interno` public. Nobody would add those routes *intending*
   * them to be open, which is exactly why it would go unnoticed — the list would look correct
   * and the route would be reachable.
   *
   * `SIEMPRE_PUBLICAS` already matched this way (see `esArchivoConvencional`, and the note
   * there about `/robots.txt.bak`). This brings the main list up to the same rule.
   */
  const coincide = (p: string) => ruta === p || ruta.startsWith(`${p}/`)
  return esArchivoConvencional(ruta) || PUBLICAS.some(coincide) || ruta === '/'
}

/**
 * Keeps an environment out of search indexes when it is told to.
 *
 * Explicitly flagged, never inferred from the hostname — the same lesson the database
 * connection taught us tonight, where guessing from the host worked until it silently did
 * not. Staging sets CONVITE_NOINDEX=1; production simply does not.
 */
function marcarNoIndexable(respuesta: NextResponse): NextResponse {
  if (process.env.CONVITE_NOINDEX === '1') {
    respuesta.headers.set('x-robots-tag', 'noindex, nofollow')
  }
  return respuesta
}

/**
 * Whether identity is configured at all.
 *
 * Both halves are needed and neither has a safe default: without `BETTER_AUTH_SECRET` there
 * is nothing to sign a session with, and without `DATABASE_URL` there is nowhere to keep
 * one. Read straight from `process.env` rather than through `lib/env.ts`, because this runs
 * on the edge and during the build, where a missing value has to be a «no» and never a
 * thrown exception.
 *
 * This should now be true in every real deployment — identity lives in the same database as
 * everything else, so there is no second service to stand up. It stays because a deploy
 * that forgot the secret should say so rather than crash.
 */
function autenticacionConfigurada(): boolean {
  return Boolean(process.env.BETTER_AUTH_SECRET && process.env.DATABASE_URL)
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
     <p>Faltan <code>BETTER_AUTH_SECRET</code> y <code>DATABASE_URL</code>. El resto del
     sistema —el webhook, la cola y <code>/api/salud</code>— sigue funcionando.</p>
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

  // Only the DB-backed response page is metered — that is the one a stranger can reach that
  // touches Postgres. The landing at `/` is static (no query to hammer), the panel is behind a
  // session, the webhooks carry a signature and their own idempotency, and the job runner is
  // called by cron.
  if (ruta === '/respuesta') {
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
  // why. Now that identity lives in our own database this should not happen in a real
  // deployment — but a deploy that forgot the secret should say which one it forgot.
  if (!autenticacionConfigurada()) {
    return marcarNoIndexable(esPublica ? NextResponse.next({ request }) : sinAutenticacion())
  }

  const respuesta = NextResponse.next({ request })

  // Presence, not validity — see the note at the top of this file. Sending someone who has
  // no cookie at all to /entrar saves them a round trip through a screen that would only
  // redirect them anyway; anyone holding a cookie is checked properly further in.
  if (!esPublica && !getSessionCookie(request)) {
    const destino = request.nextUrl.clone()
    destino.pathname = '/entrar'
    destino.searchParams.set('desde', ruta)
    return marcarNoIndexable(NextResponse.redirect(destino))
  }

  // Nothing behind a session is ever cached: a shared cache holding a coordinator's screen is
  // a leak with a long tail. The two public pages are left alone — the landing at `/` is
  // static (Next sets its own caching) and the response at `/respuesta` gets its Cache-Control
  // from next.config, the only place a dynamic route's header survives.
  if (ruta !== '/' && ruta !== '/respuesta') {
    respuesta.headers.set('Cache-Control', 'private, no-store')
  }

  // Pre-launch / staging: keep the whole surface out of search indexes when
  // CONVITE_NOINDEX=1. This has to run on the NORMAL path too — not only the
  // auth-not-configured branch above — or a healthy deploy never sends the header
  // (BUG-41: the landing at `/` was indexable on production).
  return marcarNoIndexable(respuesta)
}

export const config = {
  /*
   * `.pmtiles` joins the static exclusions, and it has to be here rather than in PUBLICAS.
   *
   * The offline basemap is fetched by the service worker (public/sw.js), which slices it with
   * HTTP Range requests. Middleware answered those with a 307 to /entrar — a redirect the worker
   * cannot follow and would cache as the map — so the download button produced a login page in
   * 13 MB of pieces. PUBLICAS would not have helped: that list is consulted *by* the middleware,
   * and the problem is the middleware running on a static file at all.
   *
   * Safe to exclude: it is a basemap of public geography, identical for everybody, carrying no
   * community, household or operational data of any kind. Nothing about who is asking changes
   * what it should return.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|pmtiles)$).*)'],
}
