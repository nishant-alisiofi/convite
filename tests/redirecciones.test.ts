import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rutaInterna } from '@/lib/sesion'

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
   * Behind Railway's proxy `request.url` is the origin the *container* was reached on — the
   * internal bind address — while `request.nextUrl` is the one Next rebuilds from the
   * forwarded host. Build a redirect from the first and the browser is sent to
   * `https://localhost:8080/tablero`, which resolves to nothing.
   *
   * It shipped, and the only reason it was found is that somebody clicked a real link on
   * deployed staging: sign-in ended one step short of the panel, on an unreachable URL. On a
   * laptop the two values are identical, so a local walk passes and so does any unit test —
   * `NextRequest` does not apply `x-forwarded-host` in its constructor, so the divergence
   * cannot be reproduced in-process at all.
   *
   * Which leaves the source as the honest place to assert it. Structural rather than
   * behavioural, and deliberately across every route instead of just the one that broke.
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

  it('ninguna ruta arma una redirección a partir de request.url', () => {
    for (const ruta of RUTAS) {
      let fuente: string
      try {
        fuente = sinComentarios(readFileSync(join(process.cwd(), ruta), 'utf8'))
      } catch {
        // The route was renamed or removed. The list above is a floor, not an inventory.
        continue
      }

      // `new URL(<algo>, request.url)` — the shape that produced the bug. A single-argument
      // `new URL(request.url)` is fine: that only parses it to read searchParams, which
      // does not depend on the origin being right.
      expect(
        /new URL\([^)]*,\s*(request|req)\.url\s*\)/.test(fuente),
        `${ruta} arma una URL sobre request.url; detrás del proxy eso apunta al bind ` +
          `interno. Use request.nextUrl (así lo hace middleware.ts).`,
      ).toBe(false)
    }
  })

  it('la callback sí usa nextUrl, que es el que trae el origen público', () => {
    // The positive half: the assertion above passes trivially if the file stops redirecting
    // at all, so this pins that it still does, the right way.
    const fuente = readFileSync(join(process.cwd(), 'app/auth/callback/route.ts'), 'utf8')
    expect(fuente).toMatch(/request\.nextUrl\.clone\(\)/)
    expect(fuente).toMatch(/NextResponse\.redirect\(/)
  })
})
