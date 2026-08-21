import type { MetadataRoute } from 'next'

/**
 * robots.txt — generated, static, no database.
 *
 * The public surface (the landing page and the aggregate response page) is meant to be found:
 * partner organisations and funders arrive there. Everything behind a session is not — the
 * panel, the sign-in flow, the API — so it is disallowed from crawlers as basic hygiene, not
 * as a security control (the real boundary is the auth gate, not this file).
 *
 * Keeping staging out of indexes is a separate, runtime concern handled by the
 * `x-robots-tag: noindex` header the middleware sets when CONVITE_NOINDEX is on. A static
 * robots.txt can't tell staging from production; the header can.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/respuesta'],
      disallow: [
        '/entrar',
        '/auth',
        '/api',
        '/comenzar',
        '/bandeja',
        '/campo',
        '/tablero',
        '/verificacion',
        '/mapa',
        '/rutas',
        '/recogidas',
        '/envios',
        '/estado',
        '/ajustes',
      ],
    },
  }
}
