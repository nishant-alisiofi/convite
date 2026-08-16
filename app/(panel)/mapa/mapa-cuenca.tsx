'use client'

import { useEffect, useRef, useState } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { DatosMapa } from '@/lib/mapa/datos'
import { etiquetaTramo } from '@/lib/mapa/datos'
import { estiloConBasemap } from '@/lib/mapa/basemap'
import { figurasDe, fuentesYCapas, limitesDe } from '@/lib/mapa/capas'

/**
 * The basin map.
 *
 * The one screen in the panel that genuinely needs JavaScript (Section 10 otherwise says
 * not to ship any): drawing a 1000 m accuracy circle that stays 1000 m on the ground as the
 * coordinator zooms is not something a server-rendered image does, and a fixed pixel radius
 * would shrink the uncertainty exactly when someone leans in to read it. MapLibre is
 * imported inside the effect rather than at the top of the module, so every other screen —
 * and the first paint of this one — never pays for it.
 *
 * The base is OpenStreetMap (§5.7 / §3): standard raster tiles, no key, no billing account.
 * Google has no data for the 22 river edges, and the landing sites a transporter needs are
 * unmapped everywhere — but the coastline, the rivers and the roads OSM does hold are worth
 * drawing under our own geography, so a coordinator sees the territory and not empty space.
 * The basemap is added by `estiloConBasemap`, which slips a raster layer UNDER the data
 * layers; the accuracy circles and schematic connectors still draw on top.
 *
 * What to draw is still decided in lib/mapa/capas.ts, which stays pure, tile-free and covered
 * by tests — the rule that a centroid is never a dot does not live inside an effect, and the
 * basemap does not live inside that pure layer either.
 */

type Props = { datos: DatosMapa }

export default function MapaCuenca({ datos }: Props) {
  const contenedor = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mapa: import('maplibre-gl').Map | null = null
    let cancelado = false

    async function iniciar() {
      const {
        Map: MapaGL,
        Marker,
        NavigationControl,
        ScaleControl,
        AttributionControl,
        GeolocateControl,
      } = await import('maplibre-gl')
      if (cancelado || !contenedor.current) return

      const figuras = figurasDe(datos)
      const limites = limitesDe(figuras, datos.tramos)
      // Data sources and layers come from lib/mapa/capas.ts (pure, tile-free). The OSM
      // basemap is composed on top of that here, slipped UNDER the circles and connectors.
      const estilo = estiloConBasemap(fuentesYCapas(figuras, datos.tramos))

      const m = new MapaGL({
        container: contenedor.current,
        style: estilo as unknown as import('maplibre-gl').StyleSpecification,
        center: [-76.72, 5.95],
        zoom: 7.4,
        // We add our own AttributionControl below so the OSM credit sits where we want it.
        attributionControl: false,
      })
      mapa = m

      // Frame the data instead of a fixed viewport: at a hardcoded basin-wide zoom a
      // kilometre-wide accuracy circle is a single pixel, and the map quietly becomes the
      // dot map it exists not to be.
      if (limites) m.fitBounds(limites, { padding: 48, animate: false })

      m.addControl(new NavigationControl({ showCompass: false }), 'top-right')
      // "Use my location": centres on the coordinator's device position. The first GPS fix is
      // slow, so the built-in control shows its own acquiring state rather than looking dead.
      m.addControl(
        new GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          showAccuracyCircle: true,
          trackUserLocation: false,
        }),
        'top-right',
      )
      m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')
      // Fed by the raster source's `attribution`; the OSM tile policy requires this credit.
      m.addControl(new AttributionControl({ compact: true }), 'bottom-right')

      m.on('error', (e) => setError(e.error?.message ?? 'No se pudo dibujar el mapa.'))

      m.on('load', () => {
        // Labels are DOM markers, not a symbol layer: a symbol layer needs a glyph server
        // and we have none. It also lets the names use the panel's own type.
        for (const c of datos.comunidades) {
          if (c.lat === null || c.lon === null) continue
          const el = document.createElement('span')
          el.textContent = c.nombre
          // Opaque enough, and lifted with a hairline ring + shadow, so the name reads on top
          // of the OSM basemap instead of washing into it. The tile detail below is why the
          // old bg-white/85 label needed strengthening once a real basemap sat under it.
          el.className =
            'pointer-events-none rounded bg-white/95 px-1 text-[11px] font-medium text-barro-900 shadow-sm ring-1 ring-black/10'
          // Hung below the point: centred, the label box is wider than a 1000 m circle at
          // basin zoom and hides the very thing the circle is there to show.
          new Marker({ element: el, anchor: 'top', offset: [0, 7] })
            .setLngLat([c.lon, c.lat])
            .addTo(m)
        }

        for (const t of datos.tramos) {
          const el = document.createElement('span')
          el.textContent = etiquetaTramo(t)
          // Same treatment as the community labels, kept barro-tinted so a connector's time
          // still reads as a different kind of label from a community's name.
          el.className =
            'pointer-events-none rounded bg-barro-50/95 px-1 text-[10px] text-barro-700 shadow-sm ring-1 ring-black/10'
          new Marker({ element: el })
            .setLngLat([(t.origenLon + t.destinoLon) / 2, (t.origenLat + t.destinoLat) / 2])
            .addTo(m)
        }
      })
    }

    iniciar().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : 'No se pudo cargar el mapa.'),
    )

    return () => {
      cancelado = true
      mapa?.remove()
    }
  }, [datos])

  return (
    <div>
      <div
        ref={contenedor}
        className="h-[32rem] w-full rounded-lg border border-barro-200 bg-barro-50"
      />
      {error && (
        <p className="mt-2 text-sm text-rose-900">
          {error} La lista de abajo tiene los mismos datos.
        </p>
      )}
    </div>
  )
}
