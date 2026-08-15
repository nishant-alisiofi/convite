import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { rutaInterna } from '@/lib/sesion'

/**
 * Set before the route is imported: `lib/env.ts` memoises on first read, and the point of
 * this file is that the redirect origin comes from configuration rather than the request.
 * Empty secret so the handler takes its first branch and returns before it needs a database
 * or a request context — that branch redirects, which is all we are measuring.
 */
const ORIGEN = 'https://origen-configurado.ejemplo'
process.env.APP_BASE_URL = ORIGEN
process.env.BETTER_AUTH_SECRET = ''

const { GET } = await import('@/app/auth/callback/route')

/**
 * Where we send people, and the two ways that goes wrong.
 *
 * Both of these were live defects, and neither was caught by a test — one because nothing
 * covered the function, the other because it is invisible on a laptop.
 */

describe('rutaInterna: a dónde aceptamos mandar a alguien tras entrar', () => {
  /*
   * `desde` survives a sign-in: the middleware puts the page you were trying to reach into
   * the redirect, and the form hands it back. That makes it attacker-controlled, which is
   * how «volver a donde estabas» turns into an open redirect — and a phishing link that
   * genuinely begins on our domain is a good one.
   */
  it('acepta una ruta de este sitio', () => {
    expect(rutaInterna('/tablero')).toBe('/tablero')
    expect(rutaInterna('/envios/123/manifiesto')).toBe('/envios/123/manifiesto')
    expect(rutaInterna('/verificacion?estado=RECIBIDO')).toBe('/verificacion?estado=RECIBIDO')
  })

  it('rechaza lo que sale del sitio', () => {
    // The one the original `startsWith('/')` guard let through: `//evil.example` is a
    // protocol-relative URL, so `new URL('//evil.example', 'https://convite…')` resolves to
    // `https://evil.example`. It reads like a path and is not one.
    expect(rutaInterna('//evil.example')).toBeNull()
    expect(rutaInterna('//evil.example/tablero')).toBeNull()
    expect(rutaInterna('/\\evil.example')).toBeNull()
    expect(rutaInterna('https://evil.example')).toBeNull()
    expect(rutaInterna('http://evil.example')).toBeNull()
    expect(rutaInterna('javascript:alert(1)')).toBeNull()
    expect(rutaInterna('')).toBeNull()
    expect(rutaInterna('tablero')).toBeNull()
  })
})

describe('las redirecciones se construyen sobre el origen público', () => {
  /*
   * Behind Railway's proxy, nothing on the incoming request knows the public origin.
   * `request.url` is the address the container was reached on, so a redirect built from it
   * sends the browser to `https://localhost:8080/tablero`, which resolves to nothing.
   *
   * `request.nextUrl` is NOT the fix, and this test exists partly to say so: it was the
   * second attempt, it shipped, and it failed identically. Next rebuilds `nextUrl` from the
   * forwarded host in **middleware** — which is why the middleware's redirect was correct
   * all along — but a Node route handler gets neither. Reading `x-forwarded-host` by hand
   * would work at the cost of trusting a client-settable header.
   *
   * So redirects are built from `APP_BASE_URL` via `urlBase()`: configuration we already
   * have, correct on every environment, and beyond the caller's influence. Better Auth uses
   * the same value for its own `baseURL`, and its half of the chain was right the whole time.
   *
   * Asserted structurally because it cannot be asserted behaviourally: `NextRequest` never
   * diverges in-process, so no unit test can tell a correct implementation from either of
   * the two broken ones. Applied across every route, not just the one that broke twice.
   */
  const RUTAS = [
    'app/auth/callback/route.ts',
    'app/api/auth/[...all]/route.ts',
    'app/api/salud/route.ts',
    'app/api/webhooks/whatsapp/route.ts',
    'app/api/jobs/correr/route.ts',
  ]

  /** Comments describe the trap on purpose; only real code should trip the check. */
  const sinComentarios = (fuente: string) =>
    fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it('ninguna ruta arma una redirección desde la petición', () => {
    for (const ruta of RUTAS) {
      let fuente: string
      try {
        fuente = sinComentarios(readFileSync(join(process.cwd(), ruta), 'utf8'))
      } catch {
        // The route was renamed or removed. The list above is a floor, not an inventory.
        continue
      }

      // Both shapes that shipped broken. A single-argument `new URL(request.url)` stays
      // allowed: that only parses it to read searchParams, which does not depend on the
      // origin being right.
      expect(
        /new URL\([^)]*,\s*(request|req)\.url\s*\)/.test(fuente),
        `${ruta} arma una URL sobre request.url; detrás del proxy eso apunta al bind ` +
          `interno del contenedor. Use urlBase().`,
      ).toBe(false)

      expect(
        /NextResponse\.redirect\([^)]*nextUrl/.test(fuente) ||
          /new URL\([^)]*,\s*(request|req)\.nextUrl/.test(fuente),
        `${ruta} arma una redirección sobre request.nextUrl. Eso funciona en middleware.ts, ` +
          `donde Next lo reconstruye desde el host reenviado, pero NO en un route handler: ` +
          `ya se desplegó así una vez y falló igual. Use urlBase().`,
      ).toBe(false)
    }
  })

  it('redirige al origen configurado aunque la petición llegue a otro', async () => {
    /*
     * The behavioural half, and the one that would have caught both broken attempts.
     *
     * It works only because the fix stopped depending on the request: the handler is asked
     * from `http://localhost:8080` — the exact internal address Railway's container answers
     * on — and has to answer with the configured public origin anyway. Against either
     * earlier version it returns `http://localhost:8080/entrar…` and fails here, in the
     * suite, instead of on a coordinator's screen.
     */
    const respuesta = await GET(new NextRequest('http://localhost:8080/auth/callback'))
    const destino = new URL(respuesta.headers.get('location')!)

    expect(destino.origin).toBe(ORIGEN)
    expect(destino.origin).not.toContain('localhost')
    expect(destino.pathname).toBe('/entrar')
  })

  it('la callback redirige sobre el origen configurado', () => {
    // The positive half: the assertions above pass trivially if the file stops redirecting
    // at all, so this pins that it still does, the right way.
    const fuente = sinComentarios(
      readFileSync(join(process.cwd(), 'app/auth/callback/route.ts'), 'utf8'),
    )
    expect(fuente).toMatch(/urlBase\(\)/)
    expect(fuente).toMatch(/NextResponse\.redirect\(/)
  })
})
