import { CircleDashed, MapPin, Route, TriangleAlert } from 'lucide-react'
import { redirect } from 'next/navigation'
import { figurasDe } from '@/lib/mapa/capas'
import { cargarMapa, etiquetaTramo } from '@/lib/mapa/datos'
import { representacionDe } from '@/lib/mapa/precision'
import { conSesion, sesionActual } from '@/lib/sesion'
import { temporadaVigente } from '@/lib/temporada'
import MapaCuenca from './mapa-cuenca'

export const dynamic = 'force-dynamic'

/**
 * The coordinator map.
 *
 * Section 4.5 is emphatic that the queue, not the map, answers the daily question — so this
 * screen exists to answer the other one: where is this, and how sure are we? Every seeded
 * community is a `centroide`, which means the honest picture of the basin today has no pins
 * on it at all, only circles a kilometre across. That is the point. An information
 * management team checks precision rendering first, and a map that quietly promoted
 * centroids to dots would be the fastest way to lose their trust.
 *
 * The list below the map carries the same rows, so the screen still answers the question
 * when the map does not load.
 */

const ETIQUETA_ESTADO: Record<string, string> = {
  SIN_RUTA: 'incomunicada',
  SIN_EXISTENCIA: 'espera donación',
  SIN_CAPACIDAD: 'espera transporte',
  LISTO: 'listo para despachar',
  EN_CAMINO: 'en camino',
}

export default async function Mapa() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const datos = await conSesion(sesion, async (client) =>
    cargarMapa(client, await temporadaVigente(client)),
  )

  // Same helper the map draws from, so "not on the map" and "listed as unlocated" can never
  // disagree about which rows those are.
  const { sinUbicar } = figurasDe(datos)
  const conPin = datos.comunidades.filter((c) => representacionDe(c).forma === 'pin').length

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-barro-900">Mapa</h1>
        <p className="text-sm text-barro-600">
          Temporada {datos.temporada} · {datos.tramos.length} tramos dibujados
        </p>
      </div>

      <p className="mt-2 max-w-3xl text-sm text-barro-700">
        Los círculos son el margen de error de cada ubicación, no el tamaño de la comunidad.
        Hoy {conPin === 0 ? 'ninguna comunidad tiene punto exacto' : `${conPin} tienen punto exacto`}:
        el resto son centroides de gazetteer y se dibujan como tales.
      </p>

      <div className="mt-4">
        <MapaCuenca datos={datos} />
      </div>

      <section className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-barro-200 bg-white px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-barro-900">
            <MapPin className="size-4" aria-hidden />
            Punto exacto
          </h2>
          <p className="mt-1 text-sm text-barro-600">
            Pin de GPS. Alguien estuvo ahí con el teléfono.
          </p>
        </div>
        <div className="rounded-lg border border-barro-200 bg-white px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-barro-900">
            <CircleDashed className="size-4" aria-hidden />
            Centroide · ~1000 m
          </h2>
          <p className="mt-1 text-sm text-barro-600">
            Círculo de raya. El centro del poblado según el gazetteer, no un punto visitado.
          </p>
        </div>
        <div className="rounded-lg border border-barro-200 bg-white px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-barro-900">
            <CircleDashed className="size-4" aria-hidden />
            Referida · ~2000 m
          </h2>
          <p className="mt-1 text-sm text-barro-600">
            Círculo punteado. Nos la contaron por radio o por un tercero.
          </p>
        </div>
      </section>

      <p className="mt-3 flex items-start gap-2 rounded-lg border border-atrato-100 bg-atrato-50 px-4 py-3 text-sm text-barro-800">
        <Route className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Las líneas son esquemáticas: unen origen y destino con el modo y el tiempo, y no
          trazan el camino real. No hay cartografía del canal, así que una lancha dibujada
          recta cruzando tierra firme sería tan inventada como una coordenada.
        </span>
      </p>

      {sinUbicar.length > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-800">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Sin ubicar, y por eso fuera del mapa: {sinUbicar.join(', ')}. Aparecen acá para que
            se les pueda tomar el punto, no se les inventa uno.
          </span>
        </p>
      )}

      <section className="mt-8">
        <h2 className="font-semibold text-barro-900">Comunidades</h2>
        <ul className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
          {datos.comunidades.map((c) => {
            const figura = representacionDe(c)
            return (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 px-4 py-3 text-sm">
                <span className="font-medium text-barro-900">{c.nombre}</span>
                <span className="text-barro-500">{c.municipio}</span>
                <span className="text-barro-600">
                  {figura.forma === 'pin' && 'punto exacto'}
                  {figura.forma === 'circulo' && `±${figura.radioM} m (${c.fuente})`}
                  {figura.forma === 'ausente' && 'sin ubicar'}
                </span>
                {c.abiertos > 0 && (
                  <span className="ml-auto text-barro-700">
                    {c.abiertos} abierta{c.abiertos === 1 ? '' : 's'} ·{' '}
                    {ETIQUETA_ESTADO[c.estado ?? ''] ?? c.estado}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold text-barro-900">Tramos de esta temporada</h2>
        <ul className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
          {datos.tramos.map((t) => (
            <li key={t.clave} className="flex flex-wrap items-baseline gap-x-2 px-4 py-3 text-sm">
              <span className="font-medium text-barro-900">
                {t.origen} ↔ {t.destino}
              </span>
              <span className="text-barro-600">{etiquetaTramo(t)}</span>
              {!t.activa && (
                <span className="rounded bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-900">
                  desactivado
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
