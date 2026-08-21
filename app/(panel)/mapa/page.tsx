import { CircleDashed, Crosshair, MapPin, Route, TriangleAlert } from 'lucide-react'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { figurasDe } from '@/lib/mapa/capas'
import { cargarMapa, etiquetaTramo } from '@/lib/mapa/datos'
import type { Borrador, Fase } from '@/lib/mapa/planificacion'
import { cargarPlanificacion } from '@/lib/mapa/planificacion-datos'
import { representacionDe } from '@/lib/mapa/precision'
import { EstadoVacio } from '@/components/estado-vacio'
import { IntroColapsable } from '@/components/intro-colapsable'
import { conSesion, sesionActual } from '@/lib/sesion'
import { temporadaVigente } from '@/lib/temporada'
import MapaCuenca from './mapa-cuenca'
import SelectorUbicacion from './selector-ubicacion'

export const dynamic = 'force-dynamic'

/** The basin, for opening the picker when a centre has no point of its own yet. */
const CENTRO_CUENCA: [number, number] = [-76.72, 5.95]

type UbicacionCentro = {
  lat: number | null
  lon: number | null
  fuente: string | null
  precisionM: number | null
}

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

type Params = Promise<{
  ok?: string
  error?: string
  /** §18: the operational phase decides which layer the map opens on. */
  fase?: string
  /** Supply-first seed (§23.2): a draft handed over from «Planear este viaje». */
  viaje?: string
  cupo?: string
  fecha?: string
}>

const FASES: Fase[] = ['impacto', 'emergencia', 'recuperacion', 'ordinario']

export default async function Mapa({ searchParams }: { searchParams: Params }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { ok, error, fase: faseParam, viaje, cupo, fecha } = await searchParams
  const esAdmin = sesion.rolStaff === 'admin'
  const fase: Fase = FASES.includes(faseParam as Fase) ? (faseParam as Fase) : 'emergencia'

  const { datos, planificacion, ubicacionCentro } = await conSesion(sesion, async (client) => {
    const datos = await cargarMapa(client, await temporadaVigente(client))
    const planificacion = await cargarPlanificacion(client)
    const { rows } = await client.query<UbicacionCentro>(
      `select st_y(ubicacion) as lat, st_x(ubicacion) as lon,
              ubicacion_fuente as fuente, ubicacion_precision_m as "precisionM"
         from organizaciones
        where id = convite_organizacion()`,
    )
    return { datos, planificacion, ubicacionCentro: rows[0] ?? null }
  })

  // Supply-first entry point (§23.2): a link from «Planear este viaje» lands here with a draft
  // already carrying its destination, date and offered cupo — the same Borrador the map's own
  // demand-first path produces. The two entry points, one draft.
  const paradaViaje = viaje && planificacion.comunidades.some((c) => c.id === viaje) ? viaje : null
  const borradorInicial: Borrador | undefined = paradaViaje
    ? {
        id: `viaje-${paradaViaje}`,
        nombre: 'Viaje ofrecido',
        fecha: fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : new Date().toISOString().slice(0, 10),
        paradas: [paradaViaje],
        cupoOfrecido: cupo && Number.isFinite(Number(cupo)) ? Math.max(0, Number(cupo)) : null,
      }
    : undefined

  // Same helper the map draws from, so "not on the map" and "listed as unlocated" can never
  // disagree about which rows those are.
  const { sinUbicar } = figurasDe(datos)
  const conPin = datos.comunidades.filter((c) => representacionDe(c).forma === 'pin').length

  /**
   * Set the centre's own point.
   *
   * Placing infrastructure is an admin decision (§11), so the form is admin-only and the
   * write goes through `convite_fijar_ubicacion_organizacion`, a SECURITY DEFINER function
   * that re-checks the role, touches only the three location columns — never `estado_aprobacion`
   * or the WABA fields — and leaves an `auditoria` row. The stored source is always `manual`:
   * a person deliberately placed this, and stated its radius.
   */
  async function guardarUbicacion(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion) redirect('/entrar')
    if (sesion.rolStaff !== 'admin') {
      redirect('/mapa?error=Solo+un+admin+fija+la+ubicación+del+centro')
    }

    const bruto = { lat: formData.get('lat'), lon: formData.get('lon') }
    if (bruto.lat === null || bruto.lat === '' || bruto.lon === null || bruto.lon === '') {
      redirect('/mapa?error=Falta+el+punto:+toque+el+mapa+o+use+su+ubicación')
    }

    const lat = Number(bruto.lat)
    const lon = Number(bruto.lon)
    const precision = Math.round(Number(formData.get('precision_m')))

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) redirect('/mapa?error=Latitud+inválida')
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) redirect('/mapa?error=Longitud+inválida')
    if (!Number.isFinite(precision) || precision < 1) redirect('/mapa?error=Precisión+inválida')

    const { rows } = await conSesion(
      sesion,
      (client) =>
        client.query<{ r: string }>(
          'select convite_fijar_ubicacion_organizacion($1, $2, $3) as r',
          [lat, lon, precision],
        ),
      { escribe: true },
    )

    const r = rows[0]?.r
    revalidatePath('/mapa')
    redirect(r === 'ok' ? '/mapa?ok=ubicacion' : `/mapa?error=${r ?? 'no_se_guardó'}`)
  }

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-barro-900">Mapa</h1>
        <p className="text-sm text-barro-600">
          Temporada {datos.temporada} · {datos.tramos.length} tramos dibujados
        </p>
      </div>

      {ok === 'ubicacion' && (
        <p className="mt-4 rounded-lg border border-selva-300 bg-selva-50 px-4 py-3 text-sm text-barro-900">
          Ubicación del centro guardada.
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </p>
      )}

      <IntroColapsable
        id="mapa"
        unaLinea="Los círculos son el margen de error, no el tamaño de la comunidad."
      >
        Los círculos son el margen de error de cada ubicación, no el tamaño de la comunidad.
        Hoy {conPin === 0 ? 'ninguna comunidad tiene punto exacto' : `${conPin} tienen punto exacto`}:
        el resto son centroides de gazetteer y se dibujan como tales.
      </IntroColapsable>

      {datos.comunidades.length === 0 && (
        <div className="mt-4">
          <EstadoVacio
            titulo="No hay comunidades registradas todavía"
            href="/comunidades"
            accion="Registrar la primera comunidad"
          >
            El mapa dibuja las comunidades y los tramos entre ellas. Sin ninguna registrada no hay
            nada que ubicar — empiece por registrarlas.
          </EstadoVacio>
        </div>
      )}

      <div className="mt-4">
        <MapaCuenca
          datos={datos}
          planificacion={planificacion}
          fase={fase}
          borradorInicial={borradorInicial}
          ubicacionCentro={
            ubicacionCentro?.lat != null && ubicacionCentro.lon != null
              ? {
                  lat: ubicacionCentro.lat,
                  lon: ubicacionCentro.lon,
                  precisionM: ubicacionCentro.precisionM ?? null,
                }
              : null
          }
        />
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

      <section className="mt-8 rounded-lg border border-barro-200 bg-white px-4 py-4">
        <h2 className="flex items-center gap-2 font-semibold text-barro-900">
          <Crosshair className="size-4" aria-hidden />
          Ubicación de tu centro
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-barro-700">
          Es el punto desde donde se mide la vuelta de recogidas. Ponlo sobre el mapa real: usa
          tu ubicación si estás en el centro, o toca dónde queda y ajusta el pin.
        </p>

        {ubicacionCentro?.lat != null && ubicacionCentro.lon != null ? (
          <p className="mt-3 text-sm text-barro-800">
            Guardada en{' '}
            <span className="tabular-nums">{ubicacionCentro.lat.toFixed(5)}</span>,{' '}
            <span className="tabular-nums">{ubicacionCentro.lon.toFixed(5)}</span>
            {ubicacionCentro.precisionM != null && ` · ±${ubicacionCentro.precisionM} m`}.
          </p>
        ) : (
          <p className="mt-3 flex items-start gap-2 text-sm text-barro-600">
            <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
            Este centro no tiene ubicación todavía, así que Recogidas no tiene desde dónde medir.
          </p>
        )}

        {esAdmin ? (
          <form action={guardarUbicacion} className="mt-4">
            <SelectorUbicacion
              latInicial={ubicacionCentro?.lat ?? null}
              lonInicial={ubicacionCentro?.lon ?? null}
              precisionInicial={ubicacionCentro?.precisionM ?? null}
              centro={CENTRO_CUENCA}
            />
            <button
              type="submit"
              className="mt-3 rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
            >
              Guardar ubicación
            </button>
          </form>
        ) : (
          <p className="mt-3 text-sm text-barro-600">
            Solo un admin fija la ubicación del centro. Si hay que ponerla o corregirla, pídelo.
          </p>
        )}
      </section>

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
