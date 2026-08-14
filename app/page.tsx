import { cargarMapaPublico } from '@/lib/publico'

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
 * The public page.
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

export default async function Inicio() {
  const filas = await cargarMapaPublico()

  const totalPendientes = filas.reduce((n, f) => n + f.pendientes, 0)
  const totalAtendidos = filas.reduce((n, f) => n + f.atendidos, 0)
  const zonas = [...new Set(filas.map((f) => f.municipio))]

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-stone-900">Convite</h1>
      <p className="mt-2 text-stone-700">
        Coordinación de ayuda humanitaria en la cuenca del Atrato, Chocó.
      </p>

      <section className="mt-8">
        <h2 className="font-semibold text-stone-900">Cómo va la respuesta</h2>
        <p className="mt-1 text-sm text-stone-700">
          {totalPendientes === 0 && totalAtendidos === 0
            ? 'Todavía no hay solicitudes registradas.'
            : `${totalPendientes} solicitud${totalPendientes === 1 ? '' : 'es'} en espera y ` +
              `${totalAtendidos} ya atendida${totalAtendidos === 1 ? '' : 's'} en ${zonas.length} ` +
              `zona${zonas.length === 1 ? '' : 's'}.`}
        </p>

        {filas.length > 0 && (
          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-300 text-stone-700">
                <th className="py-2 pr-3 font-medium">Zona</th>
                <th className="py-2 pr-3 font-medium">Tipo de ayuda</th>
                <th className="py-2 pr-3 font-medium">En espera</th>
                <th className="py-2 font-medium">Atendidas</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={`${f.municipio}-${f.familiaLabel}`} className="border-b border-stone-200">
                  <td className="py-2 pr-3 text-stone-900">{f.municipio}</td>
                  <td className="py-2 pr-3 text-stone-800">{f.familiaLabel}</td>
                  <td className="py-2 pr-3 text-stone-900">{f.pendientes}</td>
                  <td className="py-2 text-stone-900">{f.atendidos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-10 rounded-lg border border-barro-200 bg-white px-4 py-4">
        <h2 className="font-semibold text-stone-900">Por qué esta página no dice más</h2>
        <p className="mt-1 text-sm text-stone-700">
          No publicamos nombres de comunidades, ubicaciones ni teléfonos, y agrupamos las
          zonas para que ninguna fila hable de un solo pueblo. Saber qué vereda se quedó sin
          comida y no tiene cómo salir es información que puede usarse en contra de quien
          vive ahí. Los conteos alcanzan para ver el tamaño de la respuesta; lo demás se
          queda del otro lado de una sesión.
        </p>
      </section>

      <p className="mt-8 text-xs text-stone-500">
        ¿Trabaja en la respuesta?{' '}
        <a href="/entrar" className="underline">
          Entrar al panel
        </a>
        .
      </p>
    </main>
  )
}
