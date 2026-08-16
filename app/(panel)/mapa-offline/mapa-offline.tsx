'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Crosshair, Download, Signal, SignalZero, WifiOff } from 'lucide-react'
import type { DatosMapa } from '@/lib/mapa/datos'
import { etiquetaTramo } from '@/lib/mapa/datos'
import { figurasDe, fuentesYCapas, limitesDe } from '@/lib/mapa/capas'
import { anilloCircular } from '@/lib/mapa/geometria'
import {
  URL_PMTILES,
  estiloDeMapa,
  hayPaqueteOffline,
  registrarProtocoloPmtiles,
  urlAbsolutaPmtiles,
} from '@/lib/mapa/pmtiles'

/**
 * The offline field map (PRD-13 / §26).
 *
 * The same honest geometry the panel map draws — circles for centroids, never pins — over a
 * basemap that works with NO connection: a PMTiles archive, downloaded while signal exists and
 * read locally by a service worker. On top of it a live GPS dot, because the phone's GPS needs
 * no connection; only the map ever did. The one thing this screen adds over `MapaCuenca` is
 * that it is built to survive going offline, so it owns the service-worker registration, the
 * «descargar para uso sin conexión» action, and the «buscando señal» state of the first fix.
 *
 * What it deliberately does NOT do yet (deferred, needs device work — see docs/mapas-offline.md
 * and PRD-13 §26): the run-scoped bundle (manifest + ordered stops + confirmation codes +
 * corridor tiles), encryption at rest, expiry on completion and remote wipe. Those are the
 * safety half of the transporter bundle and are a follow-up; this pass ships the basemap half.
 */

type EstadoGps = 'inactivo' | 'buscando' | 'fijo' | 'error'
type EstadoPaquete = 'inicial' | 'descargando' | 'listo' | 'error'

const CENTRO_CUENCA: [number, number] = [-76.72, 5.95]

export default function MapaOffline({ datos }: { datos: DatosMapa }) {
  const contenedor = useRef<HTMLDivElement>(null)
  const mapaRef = useRef<import('maplibre-gl').Map | null>(null)
  const gpsMarcador = useRef<import('maplibre-gl').Marker | null>(null)
  const watchId = useRef<number | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [listo, setListo] = useState(false)
  const [enLinea, setEnLinea] = useState(true)
  const [gps, setGps] = useState<EstadoGps>('inactivo')
  const [precisionGps, setPrecisionGps] = useState<number | null>(null)
  const [paquete, setPaquete] = useState<EstadoPaquete>('inicial')
  const [swActivo, setSwActivo] = useState(false)

  // ── Service worker: the thing that makes «offline» real. Production only — in dev it would
  //    fight HMR by caching hashed chunks. Registration is scoped to this route's needs. ─────
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => setSwActivo(true))
      .catch(() => setSwActivo(false))

    function onMensaje(e: MessageEvent) {
      const d = (e.data ?? {}) as { type?: string; ok?: boolean }
      if (d.type === 'PMTILES_CACHED') setPaquete(d.ok ? 'listo' : 'error')
    }
    navigator.serviceWorker.addEventListener('message', onMensaje)
    return () => navigator.serviceWorker.removeEventListener('message', onMensaje)
  }, [])

  // ── Online / offline banner ────────────────────────────────────────────────────────────
  useEffect(() => {
    const set = () => setEnLinea(navigator.onLine)
    set()
    window.addEventListener('online', set)
    window.addEventListener('offline', set)
    return () => {
      window.removeEventListener('online', set)
      window.removeEventListener('offline', set)
    }
  }, [])

  // ── Build the map. Same pure, tested geometry as the panel map; the basemap is composed on
  //    top of it, PMTiles when a bundle is configured, OSM raster otherwise. ────────────────
  useEffect(() => {
    let cancelado = false

    async function iniciar() {
      await registrarProtocoloPmtiles()
      const { Map: MapaGL, Marker, NavigationControl, ScaleControl, AttributionControl } =
        await import('maplibre-gl')
      if (cancelado || !contenedor.current) return

      const figuras = figurasDe(datos)
      const limites = limitesDe(figuras, datos.tramos)
      const estilo = estiloDeMapa(fuentesYCapas(figuras, datos.tramos))

      const m = new MapaGL({
        container: contenedor.current,
        style: estilo as unknown as import('maplibre-gl').StyleSpecification,
        center: CENTRO_CUENCA,
        zoom: 7.4,
        attributionControl: false,
      })
      mapaRef.current = m

      if (limites) m.fitBounds(limites, { padding: 48, animate: false })
      m.addControl(new NavigationControl({ showCompass: false }), 'top-right')
      m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')
      m.addControl(new AttributionControl({ compact: true }), 'bottom-right')

      m.on('error', (e) => setError(e.error?.message ?? 'No se pudo dibujar el mapa.'))

      m.on('load', () => {
        // Community names as DOM markers, not a symbol layer: we host no glyphs (the same
        // reason the offline basemap style carries no labels).
        for (const c of datos.comunidades) {
          if (c.lat === null || c.lon === null) continue
          const el = document.createElement('span')
          el.textContent = c.nombre
          el.className =
            'pointer-events-none rounded bg-white/95 px-1 text-[11px] font-medium text-barro-900 shadow-sm ring-1 ring-black/10'
          new Marker({ element: el, anchor: 'top', offset: [0, 7] })
            .setLngLat([c.lon, c.lat])
            .addTo(m)
        }

        // The GPS accuracy halo: a real-radius circle, honest like every other circle on this
        // map (2.2) — a wide halo when the fix is rough, a tight one when it is good. Empty
        // until the first fix arrives; the dot itself is a DOM marker added on top.
        if (!m.getSource('gps-precision')) {
          m.addSource('gps-precision', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          })
          m.addLayer({
            id: 'gps-precision-relleno',
            type: 'fill',
            source: 'gps-precision',
            paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.12 },
          })
          m.addLayer({
            id: 'gps-precision-borde',
            type: 'line',
            source: 'gps-precision',
            paint: { 'line-color': '#2563eb', 'line-width': 1.5 },
          })
        }

        if (!cancelado) setListo(true)
      })
    }

    iniciar().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : 'No se pudo cargar el mapa.'),
    )

    return () => {
      cancelado = true
      setListo(false)
      mapaRef.current?.remove()
      mapaRef.current = null
      gpsMarcador.current = null
    }
  }, [datos])

  // ── GPS dot. Geolocation needs no connection, so this works offline. First fix is slow, so
  //    the state is «buscando señal» until it lands, then a live dot + accuracy halo. ────────
  useEffect(() => {
    if (!listo) return
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGps('error')
      return
    }
    setGps('buscando')

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const m = mapaRef.current
        if (!m) return
        const { latitude, longitude, accuracy } = pos.coords
        setGps('fijo')
        setPrecisionGps(accuracy ?? null)

        import('maplibre-gl').then(({ Marker }) => {
          if (mapaRef.current !== m) return
          if (!gpsMarcador.current) {
            const el = document.createElement('div')
            el.className = 'relative flex size-4 items-center justify-center'
            el.innerHTML =
              '<span class="absolute inline-flex size-4 animate-ping rounded-full bg-blue-500/60"></span>' +
              '<span class="relative inline-flex size-3 rounded-full bg-blue-600 ring-2 ring-white"></span>'
            gpsMarcador.current = new Marker({ element: el }).setLngLat([longitude, latitude]).addTo(m)
          } else {
            gpsMarcador.current.setLngLat([longitude, latitude])
          }
        })

        const fuente = m.getSource('gps-precision') as
          | { setData?: (d: unknown) => void }
          | undefined
        // A floor on the drawn radius so a sub-metre accuracy is still a visible halo, not a
        // zero-area polygon.
        const radio = Math.max(accuracy ?? 0, 5)
        fuente?.setData?.({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'Polygon', coordinates: [anilloCircular(latitude, longitude, radio)] },
            },
          ],
        })
      },
      () => setGps('error'),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    )
    watchId.current = id

    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
      watchId.current = null
    }
  }, [listo])

  const centrarEnMi = useCallback(() => {
    const m = mapaRef.current
    if (!m || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => m.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 13 }),
      () => setGps('error'),
      { enableHighAccuracy: true, timeout: 30_000 },
    )
  }, [])

  const descargarPaquete = useCallback(() => {
    if (!hayPaqueteOffline()) return
    const sw = navigator.serviceWorker?.controller
    if (!sw) {
      setPaquete('error')
      return
    }
    setPaquete('descargando')
    sw.postMessage({ type: 'CACHE_PMTILES', url: urlAbsolutaPmtiles() })
    sw.postMessage({
      type: 'CACHE_SHELL',
      urls: ['/mapa-offline', '/manifest.webmanifest'],
    })
  }, [])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <EstadoConexion enLinea={enLinea} />
        <EstadoSenal gps={gps} precision={precisionGps} />
        {hayPaqueteOffline() ? (
          <button
            type="button"
            onClick={descargarPaquete}
            disabled={paquete === 'descargando' || paquete === 'listo' || !swActivo}
            className="ml-auto inline-flex items-center gap-1.5 rounded border border-barro-300 bg-white px-2.5 py-1.5 text-xs font-medium text-barro-800 hover:bg-barro-50 disabled:opacity-60"
          >
            <Download className="size-3.5" aria-hidden />
            {paquete === 'listo'
              ? 'Mapa guardado'
              : paquete === 'descargando'
                ? 'Descargando…'
                : 'Descargar para uso sin conexión'}
          </button>
        ) : (
          <span className="ml-auto text-xs text-barro-500">
            No hay paquete sin conexión configurado.
          </span>
        )}
        <button
          type="button"
          onClick={centrarEnMi}
          className="inline-flex items-center gap-1.5 rounded border border-barro-300 bg-white px-2.5 py-1.5 text-xs font-medium text-barro-800 hover:bg-barro-50"
        >
          <Crosshair className="size-3.5" aria-hidden />
          Mi ubicación
        </button>
      </div>

      <div
        ref={contenedor}
        className="mt-3 h-[32rem] w-full rounded-lg border border-barro-200 bg-barro-50"
      />

      {error && (
        <p className="mt-2 text-sm text-rose-900">
          {error} La lista de abajo tiene los mismos datos.
        </p>
      )}
      {paquete === 'error' && (
        <p className="mt-2 text-sm text-rose-900">
          No se pudo guardar el mapa. Vuelve a intentarlo con señal.
        </p>
      )}
      {!hayPaqueteOffline() && (
        <p className="mt-2 text-xs text-barro-500">
          Con un paquete PMTiles configurado ({URL_PMTILES || 'NEXT_PUBLIC_PMTILES_URL'}) el mapa
          base se dibuja sin conexión. Hoy usa las teselas en línea; el punto de GPS funciona sin
          señal de todos modos.
        </p>
      )}
    </div>
  )
}

function EstadoConexion({ enLinea }: { enLinea: boolean }) {
  return enLinea ? (
    <span className="inline-flex items-center gap-1.5 rounded bg-selva-50 px-2 py-1 text-xs font-medium text-selva-900 ring-1 ring-selva-200">
      <Signal className="size-3.5" aria-hidden />
      En línea
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded bg-barro-100 px-2 py-1 text-xs font-medium text-barro-800 ring-1 ring-barro-300">
      <WifiOff className="size-3.5" aria-hidden />
      Sin conexión
    </span>
  )
}

function EstadoSenal({ gps, precision }: { gps: EstadoGps; precision: number | null }) {
  if (gps === 'buscando') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-200">
        <SignalZero className="size-3.5 animate-pulse" aria-hidden />
        Buscando señal…
      </span>
    )
  }
  if (gps === 'fijo') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-900 ring-1 ring-blue-200">
        <Signal className="size-3.5" aria-hidden />
        Ubicación fija{precision != null ? ` · ±${Math.round(precision)} m` : ''}
      </span>
    )
  }
  if (gps === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded bg-rose-50 px-2 py-1 text-xs font-medium text-rose-900 ring-1 ring-rose-200">
        <SignalZero className="size-3.5" aria-hidden />
        Sin acceso al GPS
      </span>
    )
  }
  return null
}
