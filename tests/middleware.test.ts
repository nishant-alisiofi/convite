import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { esRutaPublica, middleware, PUBLICAS, SIEMPRE_PUBLICAS } from '@/middleware'

/**
 * What the middleware does when identity is not configured.
 *
 * Found by rehearsing a deploy rather than by reading the code: the auth client used to be
 * built unconditionally, so a server missing its identity configuration answered **500 to
 * every route** — the WhatsApp webhook and the health check included. Meta retries against
 * a 500, and the uptime monitor cannot even ask whether the queue is alive.
 *
 * The rule is that missing identity configuration degrades the private surface and leaves
 * the public one alone. It is not a bypass: with the variables present nothing changes, and
 * without them protected routes still refuse — they just say why instead of crashing.
 *
 * Since identity moved onto our own Postgres (0028) the two variables are
 * `BETTER_AUTH_SECRET` and `DATABASE_URL`, and there is no longer a second service to stand
 * up before the panel works. The degraded path stays because a deploy that forgets the
 * secret should name it.
 */

afterEach(() => {
  vi.unstubAllEnvs()
})

const pedir = (ruta: string) => new NextRequest(`https://convite.test${ruta}`)

function sinAutenticacionConfigurada() {
  vi.stubEnv('BETTER_AUTH_SECRET', '')
  vi.stubEnv('DATABASE_URL', '')
}

/** Configured, but nobody is signed in: no session cookie on the request. */
function conAutenticacionConfigurada() {
  vi.stubEnv('BETTER_AUTH_SECRET', 'x'.repeat(64))
  vi.stubEnv('DATABASE_URL', 'postgresql://convite:convite@localhost:5433/convite')
}

describe('la lista de rutas públicas', () => {
  it('incluye todo lo que responde sin cookie', () => {
    for (const ruta of ['/api/webhooks', '/api/jobs', '/api/salud', '/entrar', '/auth']) {
      expect(PUBLICAS, ruta).toContain(ruta)
    }
  })

  it('una ruta que solo EMPIEZA igual no es pública', () => {
    /*
     * `startsWith` on a bare prefix made all of these public without anybody adding them:
     * `/api/salud` covered `/api/salud-privada`, `/entrar` covered `/entrar-copia`,
     * `/api/jobs` covered `/api/jobs-interno`. Nobody would create those routes intending
     * them to be open — which is why it would never be spotted. The list would read
     * correctly and the door would be open anyway.
     */
    expect(esRutaPublica('/api/salud-privada')).toBe(false)
    expect(esRutaPublica('/api/jobs-interno')).toBe(false)
    expect(esRutaPublica('/entrar-copia')).toBe(false)
    expect(esRutaPublica('/api/webhooks-internos')).toBe(false)
    expect(esRutaPublica('/authorization')).toBe(false)

    // And the real ones still are, exactly and by segment.
    expect(esRutaPublica('/api/salud')).toBe(true)
    expect(esRutaPublica('/api/salud/detalle')).toBe(true)
    expect(esRutaPublica('/entrar')).toBe(true)
    expect(esRutaPublica('/entrar/nueva-clave')).toBe(true)
    expect(esRutaPublica('/auth/callback')).toBe(true)
  })

  it('incluye los propios endpoints de autenticación', () => {
    // How somebody with no session gets one. Gating these behind a session is a deadlock:
    // /entrar would render and its form would 307 to /entrar forever.
    expect(PUBLICAS).toContain('/api/auth')
    expect(esRutaPublica('/api/auth/sign-in/magic-link')).toBe(true)
    expect(esRutaPublica('/api/auth/magic-link/verify')).toBe(true)
    expect(esRutaPublica('/api/auth/sign-out')).toBe(true)
  })

  it('trata la raíz como pública y el panel como privado', () => {
    expect(esRutaPublica('/')).toBe(true)
    expect(esRutaPublica('/api/salud')).toBe(true)
    expect(esRutaPublica('/api/webhooks/whatsapp')).toBe(true)
    expect(esRutaPublica('/tablero')).toBe(false)
    expect(esRutaPublica('/verificacion')).toBe(false)
  })
})

describe('los archivos que la web pide sin permiso', () => {
  it('no pasan por la puerta de autenticación', async () => {
    // Found on live staging: /robots.txt answered 503 «Autenticación no configurada». That
    // is two lies in one status — «this exists but the server is unwell» when the truth is
    // «there is nothing here» — and a 503 tells the caller to come back and try again
    // forever. Passing them through lets Next answer 404, which ends it honestly.
    sinAutenticacionConfigurada()

    for (const ruta of ['/robots.txt', '/sitemap.xml', '/.well-known/acme-challenge/xyz']) {
      const respuesta = await middleware(pedir(ruta))
      expect(respuesta.status, ruta).not.toBe(503)
      expect(esRutaPublica(ruta), ruta).toBe(true)
    }
  })

  it('la lista es exactamente la convención, no una puerta trasera', () => {
    // It would be an easy place to quietly park a route that should need a session.
    expect(SIEMPRE_PUBLICAS).toEqual([
      '/robots.txt',
      '/sitemap.xml',
      '/favicon.ico',
      '/.well-known',
    ])
    // A path that merely starts with the same letters is not one of them.
    expect(esRutaPublica('/robots.txt.bak')).toBe(false)
    expect(esRutaPublica('/sitemap.xml/../tablero')).toBe(false)
  })
})

describe('no indexable cuando se le dice', () => {
  it('pone x-robots-tag solo si CONVITE_NOINDEX=1', async () => {
    // Explicit flag, never inferred from the hostname — the lesson the database connection
    // taught tonight, where guessing from the host worked until it silently did not.
    vi.stubEnv('CONVITE_NOINDEX', '1')
    sinAutenticacionConfigurada()
    const conBandera = await middleware(pedir('/'))
    expect(conBandera.headers.get('x-robots-tag')).toBe('noindex, nofollow')

    vi.stubEnv('CONVITE_NOINDEX', '')
    const sinBandera = await middleware(pedir('/'))
    expect(sinBandera.headers.get('x-robots-tag')).toBeNull()
  })

  it('también marca la página de «sin autenticación»', async () => {
    // The 503 page is served on every protected path; it should not be indexable either.
    vi.stubEnv('CONVITE_NOINDEX', '1')
    sinAutenticacionConfigurada()
    const respuesta = await middleware(pedir('/tablero'))
    expect(respuesta.status).toBe(503)
    expect(respuesta.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  })
})

describe('sin identidad configurada', () => {
  it('deja pasar el webhook, la cola y la salud', async () => {
    // The whole point. A deploy that is missing its auth secret still receives messages,
    // still drains its queue, and can still be monitored.
    sinAutenticacionConfigurada()

    for (const ruta of ['/api/webhooks/whatsapp', '/api/jobs/correr', '/api/salud', '/entrar', '/']) {
      const respuesta = await middleware(pedir(ruta))
      expect(respuesta.status, ruta).toBe(200)
      expect(respuesta.headers.get('location'), ruta).toBeNull()
    }
  })

  it('el panel falla cerrado, con una razón legible', async () => {
    sinAutenticacionConfigurada()
    const respuesta = await middleware(pedir('/tablero'))

    // 503, not 500: the server is fine, the configuration is not.
    expect(respuesta.status).toBe(503)
    const cuerpo = await respuesta.text()
    expect(cuerpo).toContain('Autenticación no configurada')
    // Names the actual variables — the ones the code reads, not the ones the example file
    // used to document.
    expect(cuerpo).toContain('BETTER_AUTH_SECRET')
    expect(cuerpo).toContain('DATABASE_URL')
  })

  it('no deja entrar a nadie por no estar configurado', async () => {
    // The failure mode this must never have: "auth is broken, so let everybody in."
    sinAutenticacionConfigurada()
    for (const ruta of ['/tablero', '/verificacion', '/envios', '/ajustes']) {
      const respuesta = await middleware(pedir(ruta))
      expect(respuesta.status, ruta).toBe(503)
      expect(respuesta.status, ruta).not.toBe(200)
    }
  })

  it('una sola variable no cuenta como configurado', async () => {
    // Half-configured is the shape a hurried deploy actually takes.
    vi.stubEnv('BETTER_AUTH_SECRET', 'x'.repeat(64))
    vi.stubEnv('DATABASE_URL', '')
    expect((await middleware(pedir('/tablero'))).status).toBe(503)

    vi.stubEnv('BETTER_AUTH_SECRET', '')
    vi.stubEnv('DATABASE_URL', 'postgresql://convite:convite@localhost:5433/convite')
    expect((await middleware(pedir('/tablero'))).status).toBe(503)
  })
})

/**
 * With identity configured, the middleware only asks whether a session cookie is present.
 * That is a pure function of the request — no database, no network — so unlike the Supabase
 * arrangement it replaced, it can actually be tested here.
 */
describe('con identidad configurada', () => {
  it('manda al panel a /entrar cuando no hay cookie, y dice de dónde venía', async () => {
    conAutenticacionConfigurada()
    const respuesta = await middleware(pedir('/tablero'))

    expect(respuesta.status).toBe(307)
    const destino = new URL(respuesta.headers.get('location')!)
    expect(destino.pathname).toBe('/entrar')
    expect(destino.searchParams.get('desde')).toBe('/tablero')
  })

  it('no molesta a lo público', async () => {
    conAutenticacionConfigurada()
    for (const ruta of ['/', '/entrar', '/respuesta', '/api/salud', '/api/auth/sign-in/magic-link']) {
      const respuesta = await middleware(pedir(ruta))
      expect(respuesta.status, ruta).toBe(200)
      expect(respuesta.headers.get('location'), ruta).toBeNull()
    }
  })

  it('deja pasar al panel cuando la petición trae la cookie de sesión', async () => {
    // Presence only — this is not the security boundary and does not pretend to be. A
    // forged cookie gets past this line and then gets nothing: `sesionActual()` finds no
    // Better Auth session, so there is no `usuarios` row and every policy in 0017 returns
    // empty. Asserted here so nobody "hardens" the middleware into a database call on
    // every request believing that is what makes the panel safe.
    conAutenticacionConfigurada()
    const peticion = new NextRequest('https://convite.test/tablero', {
      headers: { cookie: 'better-auth.session_token=lo-que-sea' },
    })
    const respuesta = await middleware(peticion)

    expect(respuesta.status).toBe(200)
    expect(respuesta.headers.get('location')).toBeNull()
  })

  it('nada detrás de la sesión se guarda en una caché compartida', async () => {
    conAutenticacionConfigurada()
    const peticion = new NextRequest('https://convite.test/tablero', {
      headers: { cookie: 'better-auth.session_token=lo-que-sea' },
    })
    expect((await middleware(peticion)).headers.get('Cache-Control')).toBe('private, no-store')
  })
})
