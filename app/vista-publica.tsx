import {
  Droplets,
  HandHeart,
  Home,
  HeartPulse,
  Package,
  ShieldCheck,
  Utensils,
  Waves,
} from 'lucide-react'
import type { FilaPublica } from '@/lib/publico'

/**
 * The public page's markup, kept out of the route so it renders without a database.
 *
 * `page.tsx` reads `mapa_publico` as `anon` and hands the rows here; this file only lays them
 * out. Same split as `verificacion/tarjeta.tsx` — and here it earns a second thing: the one
 * surface every visitor sees, on the cheap Android it has to survive on, can be rendered and
 * looked at from mock rows without standing up Postgres. Two copies would drift, and the copy
 * that drifted would be the one nobody could open.
 *
 * No client JavaScript: everything here is static markup, so the page arrives whole on a weak
 * connection. Colour is load-bearing and rationed — `atrato` (ochre) for what is still
 * waiting, `selva` (green) for what has been attended, and nothing else takes a hue.
 */

/** A family of need → a quiet, monochrome glyph. Matched on keywords because the label is
 *  free text from the catalogue; the icon only aids scanning, so an unmatched one is fine. */
function iconoFamilia(label: string) {
  const l = label.toLowerCase()
  if (l.includes('agua') || l.includes('saneamiento') || l.includes('higiene')) return Droplets
  if (l.includes('aliment') || l.includes('comida') || l.includes('mercado')) return Utensils
  if (l.includes('salud') || l.includes('medic')) return HeartPulse
  if (l.includes('albergue') || l.includes('abrigo') || l.includes('techo')) return Home
  return Package
}

type Zona = {
  municipio: string
  items: FilaPublica[]
  pendientes: number
  atendidos: number
}

export default function VistaPublica({ filas }: { filas: FilaPublica[] }) {
  // A row with nothing in either column says nothing: there are pedidos in that municipality
  // and family, but none in a state the public view counts. Dropping them here makes the
  // headline and the breakdown agree by construction — both are derived from this one filtered
  // set, so the page can never print «no hay solicitudes» above a list of them.
  const conDatos = filas.filter((f) => f.pendientes > 0 || f.atendidos > 0)

  const totalPendientes = conDatos.reduce((n, f) => n + f.pendientes, 0)
  const totalAtendidos = conDatos.reduce((n, f) => n + f.atendidos, 0)

  const zonas: Zona[] = []
  for (const f of conDatos) {
    let z = zonas.find((z) => z.municipio === f.municipio)
    if (!z) {
      z = { municipio: f.municipio, items: [], pendientes: 0, atendidos: 0 }
      zonas.push(z)
    }
    z.items.push(f)
    z.pendientes += f.pendientes
    z.atendidos += f.atendidos
  }

  const hayDatos = conDatos.length > 0

  return (
    <main className="mx-auto max-w-4xl px-5 py-10 sm:px-6 sm:py-14">
      <header>
        <div className="flex items-center gap-2 text-barro-900">
          <Waves className="h-6 w-6 text-selva-700" aria-hidden />
          <span className="text-2xl font-semibold tracking-tight">Convite</span>
        </div>
        <p className="mt-2 max-w-prose text-barro-700">
          Coordinación de ayuda humanitaria en la cuenca del Atrato, Chocó.
        </p>
      </header>

      {hayDatos ? (
        <>
          {/* The scale of the response, plainly. These are counts, not decisions — who waits
              and who is attended is decided by a person, in the panel, with their name on it. */}
          <section className="mt-8" aria-labelledby="resumen">
            <h2 id="resumen" className="text-sm font-medium text-barro-600">
              Así va la respuesta
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-atrato-100 bg-atrato-50 px-5 py-4">
                <p className="text-4xl font-semibold tabular-nums tracking-tight text-atrato-800">
                  {totalPendientes}
                </p>
                <p className="mt-1 text-sm font-medium text-barro-800">
                  {totalPendientes === 1 ? 'solicitud en espera' : 'solicitudes en espera'}
                </p>
                <p className="mt-0.5 text-sm text-barro-600">
                  Verificadas por una persona y todavía sin atender.
                </p>
              </div>
              <div className="rounded-xl border border-selva-100 bg-selva-50 px-5 py-4">
                <p className="text-4xl font-semibold tabular-nums tracking-tight text-selva-700">
                  {totalAtendidos}
                </p>
                <p className="mt-1 text-sm font-medium text-barro-800">
                  {totalAtendidos === 1 ? 'ya atendida' : 'ya atendidas'}
                </p>
                <p className="mt-0.5 text-sm text-barro-600">
                  La ayuda salió y llegó a la comunidad.
                </p>
              </div>
            </div>
            <p className="mt-3 text-sm text-barro-600">
              En {zonas.length} {zonas.length === 1 ? 'zona' : 'zonas'} de la cuenca.
            </p>
          </section>

          <section className="mt-10" aria-labelledby="por-zona">
            <h2 id="por-zona" className="text-sm font-medium text-barro-600">
              Por zona y tipo de ayuda
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {zonas.map((z) => (
                <div
                  key={z.municipio}
                  className="rounded-xl border border-barro-200 bg-white px-5 py-4"
                >
                  <div className="flex items-baseline justify-between gap-3 border-b border-barro-100 pb-3">
                    <h3 className="font-semibold text-barro-900">{z.municipio}</h3>
                    <span className="shrink-0 text-sm text-barro-500">
                      {z.pendientes} en espera
                    </span>
                  </div>
                  <ul className="divide-y divide-barro-100">
                    {z.items.map((f) => {
                      const Icono = iconoFamilia(f.familiaLabel)
                      return (
                        <li key={f.familiaLabel} className="flex items-start gap-2.5 py-2.5">
                          <Icono
                            className="mt-0.5 size-4 shrink-0 text-barro-400"
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-barro-900">{f.familiaLabel}</p>
                            <p className="mt-0.5 text-sm">
                              <span
                                className={
                                  f.pendientes > 0
                                    ? 'font-medium text-atrato-800'
                                    : 'text-barro-400'
                                }
                              >
                                {f.pendientes} en espera
                              </span>
                              <span className="text-barro-300"> · </span>
                              <span
                                className={f.atendidos > 0 ? 'text-selva-700' : 'text-barro-400'}
                              >
                                {f.atendidos} {f.atendidos === 1 ? 'atendida' : 'atendidas'}
                              </span>
                            </p>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : (
        <section className="mt-8 rounded-xl border border-barro-200 bg-white px-5 py-8 text-center">
          <HandHeart className="mx-auto size-6 text-barro-400" aria-hidden />
          <p className="mt-2 font-medium text-barro-900">
            Todavía no hay solicitudes registradas.
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-barro-600">
            Cuando una comunidad reporte una necesidad y el equipo la verifique, el tamaño de
            la respuesta aparece acá.
          </p>
        </section>
      )}

      {/* The restraint is the point, so it is stated as a choice, not apologised for. */}
      <section className="mt-10 rounded-xl border border-barro-200 bg-white p-5 sm:p-6">
        <h2 className="flex items-center gap-2 font-semibold text-barro-900">
          <ShieldCheck className="size-5 shrink-0 text-selva-700" aria-hidden />
          Por qué esta página no dice más
        </h2>
        <p className="mt-2 text-barro-700">
          No publicamos nombres de comunidades, ubicaciones ni teléfonos, y agrupamos las zonas
          para que ninguna fila hable de un solo pueblo. Saber qué vereda se quedó sin comida y
          no tiene cómo salir es información que puede usarse en contra de quien vive ahí. Los
          conteos alcanzan para ver el tamaño de la respuesta; lo demás se queda del otro lado
          de una sesión.
        </p>
      </section>

      <footer className="mt-10 border-t border-barro-200 pt-6 text-sm text-barro-500">
        <p>Los conteos se actualizan solos, a medida que el equipo atiende cada solicitud.</p>
        <p className="mt-2">
          ¿Trabaja en la respuesta?{' '}
          <a
            href="/entrar"
            className="font-medium text-selva-700 underline underline-offset-2 hover:text-selva-900"
          >
            Entrar al panel
          </a>
          .
        </p>
      </footer>
    </main>
  )
}
