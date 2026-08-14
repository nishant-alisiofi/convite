import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { esRutaPublica, middleware, PUBLICAS, SIEMPRE_PUBLICAS } from '@/middleware'

/**
 * What the middleware does when identity is not configured.
 *
 * Found by rehearsing a deploy rather than by reading the code: the client used to be built
 * unconditionally, so a server without `NEXT_PUBLIC_SUPABASE_URL` answered **500 to every
 * route** — the WhatsApp webhook and the health check included. Meta retries against a 500,
 * and the uptime monitor cannot even ask whether the queue is alive.
 *
 * The rule now is that a missing identity provider degrades the private surface and leaves
 * the public one alone. It is not a bypass: with the variables present nothing changes, and
 * without them protected routes still refuse — they just say why instead of crashing.
 */

afterEach(() => {
  vi.unstubAllEnvs()
})

const pedir = (ruta: string) => new NextRequest(`https://convite.test${ruta}`)

function sinAutenticacionConfigurada() {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
}

describe('la lista de rutas públicas', () => {
  it('incluye todo lo que responde sin cookie', () => {
    for (const ruta of ['/api/webhooks', '/api/jobs', '/api/salud', '/entrar', '/auth']) {
      expect(PUBLICAS, ruta).toContain(ruta)
    }
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

describe('sin Supabase configurado', () => {
  it('deja pasar el webhook, la cola y la salud', async () => {
    // The whole point. A staging deploy with a database and no auth project still receives
    // messages, still drains its queue, and can still be monitored.
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
    expect(cuerpo).toContain('NEXT_PUBLIC_SUPABASE_URL')
    expect(cuerpo).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY')
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
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ejemplo.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    expect((await middleware(pedir('/tablero'))).status).toBe(503)

    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'una-clave')
    expect((await middleware(pedir('/tablero'))).status).toBe(503)
  })
})

/**
 * The configured path is deliberately not re-tested here: with the variables present the
 * middleware builds a real Supabase client and calls out to it, so a unit test would be
 * asserting the network. It is covered where it actually runs — the rest of this suite, and
 * the local deploy rehearsal that walked every route with the variables set.
 */
