import { toNextJsHandler } from 'better-auth/next-js'
import { NextResponse } from 'next/server'
import { autenticacionConfigurada, getAuth } from '@/lib/auth'

/**
 * Where Better Auth answers: `/api/auth/*`.
 *
 * Same origin as the panel, which is not an accident. When the auth server lives somewhere
 * else — its own API host — the sign-in cookie is a third-party cookie, the magic link's
 * redirect resolves against the wrong origin, and both problems get solved with a pile of
 * CORS and callback-rewriting configuration. Here there is one server, so there is nothing
 * to configure and nothing to get wrong.
 *
 * `force-dynamic` because this reads cookies and the database on every call; without it
 * Next would try to work out something static at build time, where neither exists.
 */

export const dynamic = 'force-dynamic'

/**
 * Built per request, not at module load.
 *
 * `next build` collects this route with no DATABASE_URL and no secret. Constructing the
 * auth instance here — inside the handler — is what keeps the build from opening a
 * connection it cannot have (tests/construccion.test.ts guards the same rule for pages).
 */
function manejar(metodo: 'GET' | 'POST'): (peticion: Request) => Promise<Response> {
  return async (peticion) => {
    if (!autenticacionConfigurada()) {
      // Matches what the middleware tells a browser, in the shape a fetch can read.
      return NextResponse.json(
        { error: 'autenticacion_no_configurada' },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      )
    }
    return toNextJsHandler(getAuth())[metodo](peticion)
  }
}

export const GET = manejar('GET')
export const POST = manejar('POST')
