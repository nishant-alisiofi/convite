'use client'

import { useEffect, useRef, useState } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { DatosMapa } from '@/lib/mapa/datos'
import { etiquetaTramo } from '@/lib/mapa/datos'
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
 * There is no basemap. We have no tiles for Chocó we can serve ourselves, and the honest
 * alternative to borrowed geography is empty space: OSM has 13 ferry terminals in the whole
 * basin, so a generic basemap would still not show the landing sites a transporter needs.
 * Everything drawn here is something the database actually knows.
 *
 * What to draw is decided in lib/mapa/capas.ts, which is pure and covered by tests — the
 * rule that a centroid is never a dot does not live inside an effect.
 */

type Props = { datos: DatosMapa }

export default function MapaCuenca({ datos }: Props) {
  const contenedor = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mapa: import('maplibre-gl').Map | null = null
    let cancelado = false

    async function iniciar() {
      const { Map: MapaGL, Marker, NavigationControl, ScaleControl } = await import('maplibre-gl')
      if (cancelado || !contenedor.current) return

      const figuras = figurasDe(datos)
      const limites = limitesDe(figuras, datos.tramos)
      const estilo = fuentesYCapas(figuras, datos.tramos)

      const m = new MapaGL({
        container: contenedor.current,
        // Sources and layers come from lib/mapa/capas.ts. There is no tile source anywhere:
        // the style is a background colour plus our own data.
        style: estilo as unknown as import('maplibre-gl').StyleSpecification,
        center: [-76.72, 5.95],
        zoom: 7.4,
        attributionControl: false,
      })
      mapa = m

      // Frame the data instead of a fixed viewport: at a hardcoded basin-wide zoom a
      // kilometre-wide accuracy circle is a single pixel, and the map quietly becomes the
      // dot map it exists not to be.
      if (limites) m.fitBounds(limites, { padding: 48, animate: false })

      m.addControl(new NavigationControl({ showCompass: false }), 'top-right')
      m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')

      m.on('error', (e) => setError(e.error?.message ?? 'No se pudo dibujar el mapa.'))

      m.on('load', () => {
        // Labels are DOM markers, not a symbol layer: a symbol layer needs a glyph server
        // and we have none. It also lets the names use the panel's own type.
        for (const c of datos.comunidades) {
          if (c.lat === null || c.lon === null) continue
          const el = document.createElement('span')
          el.textContent = c.nombre
          el.className =
            'pointer-events-none rounded bg-white/85 px-1 text-[11px] font-medium text-stone-800'
          // Hung below the point: centred, the label box is wider than a 1000 m circle at
          // basin zoom and hides the very thing the circle is there to show.
          new Marker({ element: el, anchor: 'top', offset: [0, 7] })
            .setLngLat([c.lon, c.lat])
            .addTo(m)
        }

        for (const t of datos.tramos) {
          const el = document.createElement('span')
          el.textContent = etiquetaTramo(t)
          el.className = 'pointer-events-none rounded bg-barro-50/80 px-1 text-[10px] text-stone-600'
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
