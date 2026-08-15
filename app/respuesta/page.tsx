import { cargarMapaPublico } from '@/lib/publico'
import VistaPublica from './vista'

/**
 * Rendered per request, never at build time.
 *
 * `revalidate` looked right — the counts move when the matcher sweeps, not when somebody
 * refreshes — but it makes Next statically prerender this page during `next build`, which
 * means opening a database connection in the build container. Railway hands DATABASE_URL to
 * the *runtime*; no build container will ever have it, so the build died on «Configuración
 * inválida: DATABASE_URL: Required» and staging never came up.
 *
 * Serving it dynamically is also the more honest shape. A prerendered shell built without a
 * database would say «todavía no hay solicitudes registradas» — not a stale number, an
 * actively false one — and ISR would serve that to the first visitors after every deploy.
 *
 * Cacheability comes from next.config's headers() instead, which is the only place a
 * dynamic route's Cache-Control survives.
 */
export const dynamic = 'force-dynamic'

/**
 * The public response page (`/respuesta`).
 *
 * Everything anybody can see without signing in, which is counts by municipality and family
 * of need. No coordinate, no community name, no phone number, no individual request —
 * non-negotiable 2.4, and the reason is not privacy in the abstract: this is a territory
 * with armed actor presence, and "this village has no food and no way out" is targeting
 * information.
 *
 * Municipalities holding fewer than three communities are folded into one basin-wide bucket
 * (migration 0027). Four of the five municipalities here are a single village, so without
 * that fold this page would name them while calling itself an aggregate.
 *
 * Served from our own route rather than PostgREST (Section 3), read as `anon` so the policy
 * is the boundary, and rendered on the server with no JavaScript.
 */

export default async function Respuesta() {
  const filas = await cargarMapaPublico()
  return <VistaPublica filas={filas} />
}
