'use client'

import { useEffect, useRef, useState } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import { estiloConBasemap } from '@/lib/mapa/basemap'

/**
 * A reusable location picker on the real map.
 *
 * The coordinator sets a point three ways, all of them on OpenStreetMap so they are placing
 * it on ground they recognise, not on empty space: «use my location» (a GPS fix from the
 * device), a tap anywhere on the map, or dragging the pin. Whichever they use, the lat/long
 * is surfaced in plain text and carried in hidden inputs so a server action can store it.
 *
 * Honesty about precision travels with the point (non-negotiable 2.2). The stored source is
 * always `manual` — a person deliberately placed this — and they state the radius. A GPS fix
 * pre-fills that radius with the device's reported accuracy, because that is the truthful
 * number for how well the phone knows where it is; a hand-dropped pin starts at a
 * building-scale default the person can widen if they are less sure. The point is never a
 * bare pair with no stated margin, which is exactly how a rough location becomes a false one.
 *
 * Nothing here is on a public surface — it is the authenticated panel, and the only location
 * it captures is the centre's own. It never touches `mapa_publico` or the aggregated view.
 */

type Props = {
  /** The centre's current point, or null when it has never been located. */
  latInicial: number | null
  lonInicial: number | null
  precisionInicial: number | null
  /** Where the empty map opens — the basin, so «use my location» is not the only way in. */
  centro: [number, number]
  /** Field-name prefix so more than one picker can share a form without colliding. */
  nombre?: string
}

const PRECISION_MANUAL_POR_DEFECTO = 50

export default function SelectorUbicacion({
  latInicial,
  lonInicial,
  precisionInicial,
  centro,
  nombre = '',
}: Props) {
  const contenedor = useRef<HTMLDivElement>(null)
  const mapaRef = useRef<import('maplibre-gl').Map | null>(null)
  const marcadorRef = useRef<import('maplibre-gl').Marker | null>(null)
  const geolocRef = useRef<import('maplibre-gl').GeolocateControl | null>(null)
  const crearMarcador = useRef<(lon: number, lat: number) => void>(() => {})

  const tienePunto = latInicial !== null && lonInicial !== null
  const [lat, setLat] = useState<number | null>(tienePunto ? latInicial : null)
  const [lon, setLon] = useState<number | null>(tienePunto ? lonInicial : null)
  const [precision, setPrecision] = useState<number>(
    precisionInicial ?? PRECISION_MANUAL_POR_DEFECTO,
  )
  const [estado, setEstado] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const campo = (sufijo: string) => (nombre ? `${nombre}_${sufijo}` : sufijo)

  useEffect(() => {
    let cancelado = false

    async function iniciar() {
      const { Map: MapaGL, Marker, NavigationControl, GeolocateControl, AttributionControl } =
        await import('maplibre-gl')
      if (cancelado || !contenedor.current) return

      const m = new MapaGL({
        container: contenedor.current,
        style: estiloConBasemap({
          version: 8,
          sources: {},
          layers: [{ id: 'fondo', type: 'background', paint: { 'background-color': '#f2efe9' } }],
        }) as unknown as import('maplibre-gl').StyleSpecification,
        center: tienePunto ? [lonInicial, latInicial] : centro,
        zoom: tienePunto ? 15 : 11,
        attributionControl: false,
      })
      mapaRef.current = m

      m.addControl(new NavigationControl({ showCompass: false }), 'top-right')
      const geoloc = new GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        showAccuracyCircle: true,
        trackUserLocation: false,
      })
      geolocRef.current = geoloc
      m.addControl(geoloc, 'top-right')
      m.addControl(new AttributionControl({ compact: true }), 'bottom-right')

      // Places or moves the pin, keeps it draggable, and mirrors the position into React so
      // the readout and the hidden inputs stay in step with the marker.
      function colocar(lonNuevo: number, latNuevo: number) {
        if (!marcadorRef.current) {
          const marcador = new Marker({ color: '#2c7a5f', draggable: true })
            .setLngLat([lonNuevo, latNuevo])
            .addTo(m)
          marcador.on('dragend', () => {
            const p = marcador.getLngLat()
            setLon(p.lng)
            setLat(p.lat)
          })
          marcadorRef.current = marcador
        } else {
          marcadorRef.current.setLngLat([lonNuevo, latNuevo])
        }
        setLon(lonNuevo)
        setLat(latNuevo)
      }
      crearMarcador.current = colocar

      if (tienePunto) colocar(lonInicial, latInicial)

      // A tap anywhere drops (or moves) the pin — the plain way to set a point for a place
      // the phone's own GPS cannot reach.
      m.on('click', (e) => colocar(e.lngLat.lng, e.lngLat.lat))

      // The device fix: move the pin there and pre-fill the radius with the reported accuracy,
      // which is the honest margin for how well the phone knows the spot.
      geoloc.on('geolocate', (e) => {
        const { longitude, latitude, accuracy } = e.coords
        colocar(longitude, latitude)
        m.easeTo({ center: [longitude, latitude], zoom: Math.max(m.getZoom(), 16) })
        if (Number.isFinite(accuracy)) setPrecision(Math.max(1, Math.round(accuracy)))
        setEstado(null)
        setError(null)
      })
      geoloc.on('error', () => {
        setEstado(null)
        setError('No se pudo obtener la señal del dispositivo. Toque el mapa para poner el punto.')
      })

      m.on('error', (ev) => setError(ev.error?.message ?? 'No se pudo dibujar el mapa.'))
    }

    iniciar().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : 'No se pudo cargar el mapa.'),
    )

    return () => {
      cancelado = true
      mapaRef.current?.remove()
      mapaRef.current = null
      marcadorRef.current = null
    }
    // Built once. Initial props only seed the first render; live changes come through the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function usarMiUbicacion() {
    setError(null)
    setEstado('Buscando señal… la primera lectura del GPS puede tardar.')
    geolocRef.current?.trigger()
  }

  return (
    <div>
      <div
        ref={contenedor}
        className="h-96 w-full rounded-lg border border-barro-200 bg-barro-50"
      />

      <input type="hidden" name={campo('lat')} value={lat ?? ''} />
      <input type="hidden" name={campo('lon')} value={lon ?? ''} />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={usarMiUbicacion}
          className="rounded border border-barro-300 bg-white px-3 py-1.5 text-sm text-barro-800 hover:bg-barro-50"
        >
          Usar mi ubicación
        </button>

        <label className="flex items-center gap-2 text-sm text-barro-700">
          Radio de precisión (m)
          <input
            type="number"
            name={campo('precision_m')}
            min={1}
            step={1}
            value={precision}
            onChange={(e) => setPrecision(Math.max(1, Math.round(Number(e.target.value) || 1)))}
            className="w-24 rounded border border-barro-300 px-2 py-1"
          />
        </label>
      </div>

      <p className="mt-2 text-sm text-barro-600" aria-live="polite">
        {estado ? (
          estado
        ) : lat !== null && lon !== null ? (
          <>
            Punto elegido: <span className="tabular-nums text-barro-900">{lat.toFixed(5)}</span>,{' '}
            <span className="tabular-nums text-barro-900">{lon.toFixed(5)}</span> · ±{precision} m.
            Arrastre el pin o toque el mapa para ajustarlo.
          </>
        ) : (
          'Sin punto todavía. Use su ubicación o toque en el mapa donde está el centro.'
        )}
      </p>

      {error && <p className="mt-1 text-sm text-rose-900">{error}</p>}
    </div>
  )
}
