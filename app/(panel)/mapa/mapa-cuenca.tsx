'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { DatosMapa } from '@/lib/mapa/datos'
import { etiquetaTramo } from '@/lib/mapa/datos'
import { estiloDeMapa, registrarProtocoloPmtiles } from '@/lib/mapa/pmtiles'
import { figurasDe, fuentesYCapas, limitesDe } from '@/lib/mapa/capas'
import {
  agregarSeleccion,
  capaInicialPorFase,
  costearBorrador,
  puntoEnPoligono,
  rutasQueSirven,
  type Borrador,
  type CapaId,
  type ComunidadSeleccionable,
  type Fase,
  type NecesidadComunidad,
  type Vertice,
} from '@/lib/mapa/planificacion'
import {
  COLOR_BORRADOR,
  GUION_BORRADOR,
  coleccionCirculos,
  coleccionConexion,
  coleccionParadasBorrador,
  coleccionPoligono,
  coleccionRecencia,
  coleccionRutaBorrador,
  colorTier,
  enSilencio,
  RECENCIA_COLOR,
  type CirculoColoreado,
} from '@/lib/mapa/planificacion-capas'
import type { ComunidadPlan, DatosPlanificacion, PuntoConexionPlan } from '@/lib/mapa/planificacion-datos'
import { recenciaEvaluacion as recenciaContacto } from '@/lib/mapa/planificacion'
import ControlesMapa, { type TipoSeleccion } from './controles-mapa'
import PanelPlan from './panel-plan'

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
 *
 * PRD-32: when `planificacion` is present the same map becomes a planning surface — layers,
 * area selection and a draft laid over the facts. There is no mode toggle (§23.1): the facts
 * stay exactly as they were drawn, and the draft is drawn dashed on top. The honesty of the
 * base rendering is untouched; everything the planner adds is composed above it.
 */

type Props = {
  datos: DatosMapa
  planificacion?: DatosPlanificacion
  /** The operational phase decides which layer opens first (§18). */
  fase?: Fase
  /** A draft handed in by the supply-first entry point (§23.2), if any. */
  borradorInicial?: Borrador
}

const CLAVE_BORRADORES = 'convite:mapa:borradores'
const CENTRO_CUENCA: [number, number] = [-76.72, 5.95]

/** Overlay layer ids, in one place so the toggles and the setup cannot drift. */
const CAPAS_BASE_PEDIDOS = [
  'circulos-solido-relleno',
  'circulos-discontinuo-relleno',
  'circulos-punteado-relleno',
  'pines-punto',
] as const
const CAPAS_BASE_RUTAS = ['tramos-casing', 'tramos-linea'] as const

export default function MapaCuenca({ datos, planificacion, fase = 'emergencia', borradorInicial }: Props) {
  const contenedor = useRef<HTMLDivElement>(null)
  const mapaRef = useRef<import('maplibre-gl').Map | null>(null)
  const marcadoresStock = useRef<import('maplibre-gl').Marker[]>([])
  const [error, setError] = useState<string | null>(null)
  const [listo, setListo] = useState(false)

  // ── Planning state (only meaningful when `planificacion` is present) ────────────────────
  const capaInicial = capaInicialPorFase(fase)
  const [activas, setActivas] = useState<CapaId[]>(() => [
    ...new Set<CapaId>(['pedidos', 'rutas', capaInicial]),
  ])
  const [modoPoligono, setModoPoligono] = useState(false)
  const [poligono, setPoligono] = useState<Vertice[]>([])
  const [seleccionPor, setSeleccionPor] = useState<{ tipo: TipoSeleccion; valor: string } | null>(null)
  const [borradores, setBorradores] = useState<Borrador[]>([])
  const [borradorActivoId, setBorradorActivoId] = useState<string | null>(null)

  const modoPoligonoRef = useRef(modoPoligono)
  useEffect(() => {
    modoPoligonoRef.current = modoPoligono
  }, [modoPoligono])

  // Drafts are client state: saveable, several at once, committed by a person later (§23.2).
  useEffect(() => {
    if (!planificacion) return
    try {
      const crudo = localStorage.getItem(CLAVE_BORRADORES)
      const guardados: Borrador[] = crudo ? JSON.parse(crudo) : []
      const conInicial =
        borradorInicial && !guardados.some((b) => b.id === borradorInicial.id)
          ? [borradorInicial, ...guardados]
          : guardados
      setBorradores(conInicial)
      if (borradorInicial) setBorradorActivoId(borradorInicial.id)
    } catch {
      setBorradores(borradorInicial ? [borradorInicial] : [])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persistir = useCallback((lista: Borrador[]) => {
    setBorradores(lista)
    try {
      localStorage.setItem(CLAVE_BORRADORES, JSON.stringify(lista))
    } catch {
      // A browser with storage disabled still plans for the session; it just does not persist.
    }
  }, [])

  // ── Derived planning data ────────────────────────────────────────────────────────────────
  const comunidadesById = useMemo(() => {
    const m = new Map<string, ComunidadPlan>()
    for (const c of planificacion?.comunidades ?? []) m.set(c.id, c)
    return m
  }, [planificacion])

  const necesidades = useMemo(() => {
    const m = new Map<string, NecesidadComunidad>()
    for (const c of planificacion?.comunidades ?? []) {
      m.set(c.id, { id: c.id, nombre: c.nombre, familiasPendientes: c.familiasPendientes })
    }
    return m
  }, [planificacion])

  /** Which communities the current selection contains (polygon or by-field). */
  const idsSeleccionados = useMemo(() => {
    const ids = new Set<string>()
    if (!planificacion) return ids
    if (poligono.length >= 3) {
      for (const c of planificacion.comunidades) {
        if (c.lat !== null && c.lon !== null && puntoEnPoligono(c.lon, c.lat, poligono)) ids.add(c.id)
      }
    } else if (seleccionPor) {
      for (const c of planificacion.comunidades) {
        const coincide =
          seleccionPor.tipo === 'municipio'
            ? c.municipio === seleccionPor.valor
            : seleccionPor.tipo === 'cuenca'
              ? c.regionId === seleccionPor.valor
              : c.agrupador === seleccionPor.valor
        if (coincide) ids.add(c.id)
      }
    }
    return ids
  }, [planificacion, poligono, seleccionPor])

  const seleccionVista = useMemo(() => {
    if (!planificacion || idsSeleccionados.size === 0) return null
    const comunidades = planificacion.comunidades.filter((c) => idsSeleccionados.has(c.id))
    const seleccionables: ComunidadSeleccionable[] = comunidades
    const resumen = agregarSeleccion(seleccionables, planificacion.ahora)
    const rutas = rutasQueSirven(planificacion.aristas, idsSeleccionados)
    const nombres = new Set(comunidades.map((c) => c.nombre))
    const puntos: PuntoConexionPlan[] = planificacion.puntos.filter((p) => {
      if (poligono.length >= 3 && p.lat !== null && p.lon !== null) {
        return puntoEnPoligono(p.lon, p.lat, poligono)
      }
      return p.comunidades.some((n) => nombres.has(n))
    })
    return { resumen, rutas, puntos, comunidades }
  }, [planificacion, idsSeleccionados, poligono])

  const borradorActivo = useMemo(
    () => borradores.find((b) => b.id === borradorActivoId) ?? null,
    [borradores, borradorActivoId],
  )

  const costeo = useMemo(() => {
    if (!planificacion || !borradorActivo) return null
    return costearBorrador(borradorActivo, planificacion.aristas, necesidades)
  }, [planificacion, borradorActivo, necesidades])

  // ── Static overlay collections (recompute only when planning data changes) ───────────────
  const overlaysEstaticos = useMemo(() => {
    if (!planificacion) return null
    const ahora = planificacion.ahora
    const recencia = coleccionRecencia(
      planificacion.comunidades.map((c) => ({
        lat: c.lat,
        lon: c.lon,
        fuente: c.fuente,
        precisionM: c.precisionM,
        nombre: c.nombre,
        verificadoEn: c.verificadoEn,
      })),
      ahora,
    )
    const conCirculo = (color: (c: ComunidadPlan) => string): CirculoColoreado[] =>
      planificacion.comunidades.map((c) => ({
        lat: c.lat,
        lon: c.lon,
        fuente: c.fuente,
        precisionM: c.precisionM,
        nombre: c.nombre,
        color: color(c),
      }))
    const conectividad = coleccionCirculos(conCirculo((c) => colorTier(c.tierConectividad)))
    const contacto = coleccionCirculos(
      conCirculo((c) => RECENCIA_COLOR[recenciaContacto(c.ultimoContacto, ahora)]),
    )
    const silencioItems = planificacion.comunidades
      .filter((c) => enSilencio(c.ultimoContacto, c.intervaloChequeoDias, ahora))
      .map((c) => ({
        lat: c.lat,
        lon: c.lon,
        fuente: c.fuente,
        precisionM: c.precisionM,
        nombre: c.nombre,
        color: '#e11d48',
      }))
    const silencio = coleccionCirculos(silencioItems)
    const conexion = coleccionConexion(
      planificacion.puntos.map((p) => ({
        lat: p.lat,
        lon: p.lon,
        fuente: p.fuente,
        precisionM: p.precisionM,
        id: p.id,
        nombre: p.nombre,
        tipo: p.tipo,
        seguridad: p.seguridad,
        energia: p.energia,
      })),
    )
    return { recencia, conectividad, contacto, silencio, conexion }
  }, [planificacion])

  // ── Build the map (base rendering unchanged; overlays added on load) ─────────────────────
  useEffect(() => {
    let cancelado = false

    async function iniciar() {
      // Registers the pmtiles:// protocol only when an offline bundle is configured; a no-op
      // otherwise, so the online OSM path is unchanged where no bundle exists (PRD-13).
      await registrarProtocoloPmtiles()
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
      // Data sources and layers come from lib/mapa/capas.ts (pure, tile-free). The basemap is
      // composed on top of that here, slipped UNDER the circles and connectors: the offline
      // PMTiles bundle when one is configured, the online OSM raster otherwise (PRD-13).
      const estilo = estiloDeMapa(fuentesYCapas(figuras, datos.tramos))

      const m = new MapaGL({
        container: contenedor.current,
        style: estilo as unknown as import('maplibre-gl').StyleSpecification,
        center: [-76.72, 5.95],
        zoom: 7.4,
        // We add our own AttributionControl below so the OSM credit sits where we want it.
        attributionControl: false,
      })
      mapaRef.current = m

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

        // Planning overlays, drawn ON TOP of the facts (§23.1). Empty sources to begin with;
        // the sync effects below feed them. Guarded so the plain map (no planificacion) is
        // byte-for-byte what it was.
        if (planificacion) {
          agregarCapasPlan(m)
          // Click to add a polygon vertex, double-click to close (§23.5). Handlers read the
          // mode from a ref so they never capture stale React state.
          m.on('click', (e) => {
            if (!modoPoligonoRef.current) return
            setPoligono((prev) => [...prev, [e.lngLat.lng, e.lngLat.lat] as Vertice])
          })
          m.on('dblclick', (e) => {
            if (!modoPoligonoRef.current) return
            e.preventDefault()
            setModoPoligono(false)
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
      marcadoresStock.current.forEach((mk) => mk.remove())
      marcadoresStock.current = []
      mapaRef.current?.remove()
      mapaRef.current = null
    }
  }, [datos, planificacion])

  // ── Sync static overlays + visibility when they change ───────────────────────────────────
  useEffect(() => {
    const m = mapaRef.current
    if (!m || !listo || !planificacion || !overlaysEstaticos) return
    setData(m, 'plan-recencia', overlaysEstaticos.recencia)
    setData(m, 'plan-conectividad', overlaysEstaticos.conectividad)
    setData(m, 'plan-contacto', overlaysEstaticos.contacto)
    setData(m, 'plan-silencio', overlaysEstaticos.silencio)
    setData(m, 'plan-conexion', overlaysEstaticos.conexion)
  }, [listo, planificacion, overlaysEstaticos])

  // Layer visibility follows the toggles; base fact layers are toggled too (§23.4).
  useEffect(() => {
    const m = mapaRef.current
    if (!m || !listo || !planificacion) return
    const ver = (id: string, on: boolean) => {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    }
    for (const id of CAPAS_BASE_PEDIDOS) ver(id, activas.includes('pedidos'))
    for (const id of CAPAS_BASE_RUTAS) ver(id, activas.includes('rutas'))
    for (const [capa, ids] of Object.entries(CAPAS_OVERLAY)) {
      for (const id of ids) ver(id, activas.includes(capa as CapaId))
    }

    // Stock labels are DOM markers (no glyph server), added/removed on toggle.
    marcadoresStock.current.forEach((mk) => mk.remove())
    marcadoresStock.current = []
    if (activas.includes('existencias')) {
      import('maplibre-gl').then(({ Marker }) => {
        if (mapaRef.current !== m) return
        for (const n of planificacion.nodos) {
          if (n.lat === null || n.lon === null || n.items.length === 0) continue
          const total = n.items.reduce((s, it) => s + it.cantidad, 0)
          const el = document.createElement('span')
          el.textContent = `${n.nombre}: ${total}`
          el.className =
            'pointer-events-none rounded bg-selva-50/95 px-1 text-[10px] font-medium text-selva-900 shadow-sm ring-1 ring-selva-200'
          const mk = new Marker({ element: el, anchor: 'bottom', offset: [0, -8] })
            .setLngLat([n.lon, n.lat])
            .addTo(m)
          marcadoresStock.current.push(mk)
        }
      })
    }
  }, [listo, planificacion, activas])

  // Draft overlay + selection polygon follow their state (§23.1, §23.5).
  useEffect(() => {
    const m = mapaRef.current
    if (!m || !listo || !planificacion) return
    const paradas = (borradorActivo?.paradas ?? []).map((id) => {
      const c = comunidadesById.get(id)
      return { id, nombre: c?.nombre ?? id, lat: c?.lat ?? null, lon: c?.lon ?? null }
    })
    setData(m, 'plan-borrador-ruta', coleccionRutaBorrador(paradas, costeo?.piernas))
    setData(m, 'plan-borrador-paradas', coleccionParadasBorrador(paradas))
    setData(m, 'plan-seleccion', coleccionPoligono(poligono))
  }, [listo, planificacion, borradorActivo, costeo, comunidadesById, poligono])

  // ── Handlers ─────────────────────────────────────────────────────────────────────────────
  const alternarCapa = useCallback((id: CapaId) => {
    setActivas((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))
  }, [])

  const seleccionarPor = useCallback((tipo: TipoSeleccion, valor: string) => {
    setPoligono([])
    setModoPoligono(false)
    setSeleccionPor({ tipo, valor })
  }, [])

  const limpiarSeleccion = useCallback(() => {
    setPoligono([])
    setSeleccionPor(null)
    setModoPoligono(false)
  }, [])

  const cambiarModoPoligono = useCallback((activo: boolean) => {
    setSeleccionPor(null)
    if (activo) setPoligono([])
    setModoPoligono(activo)
  }, [])

  const nuevoBorrador = useCallback(
    (paradas: string[] = []) => {
      const hoy = new Date()
      hoy.setDate(hoy.getDate() + 7)
      const nuevo: Borrador = {
        id: `bor-${Date.now().toString(36)}`,
        nombre: `Borrador ${borradores.length + 1}`,
        fecha: hoy.toISOString().slice(0, 10),
        paradas,
        cupoOfrecido: null,
      }
      persistir([...borradores, nuevo])
      setBorradorActivoId(nuevo.id)
    },
    [borradores, persistir],
  )

  const armarJornada = useCallback(() => {
    if (!seleccionVista) return
    nuevoBorrador(seleccionVista.comunidades.map((c) => c.id))
  }, [seleccionVista, nuevoBorrador])

  const cambiarBorrador = useCallback(
    (patch: Partial<Borrador>) => {
      if (!borradorActivo) return
      persistir(borradores.map((b) => (b.id === borradorActivo.id ? { ...b, ...patch } : b)))
    },
    [borradorActivo, borradores, persistir],
  )

  const moverParada = useCallback(
    (index: number, dir: -1 | 1) => {
      if (!borradorActivo) return
      const paradas = [...borradorActivo.paradas]
      const destino = index + dir
      if (destino < 0 || destino >= paradas.length) return
      ;[paradas[index], paradas[destino]] = [paradas[destino]!, paradas[index]!]
      cambiarBorrador({ paradas })
    },
    [borradorActivo, cambiarBorrador],
  )

  const quitarParada = useCallback(
    (id: string) => {
      if (!borradorActivo) return
      cambiarBorrador({ paradas: borradorActivo.paradas.filter((p) => p !== id) })
    },
    [borradorActivo, cambiarBorrador],
  )

  const agregarParada = useCallback(
    (id: string) => {
      if (!borradorActivo || borradorActivo.paradas.includes(id)) return
      cambiarBorrador({ paradas: [...borradorActivo.paradas, id] })
    },
    [borradorActivo, cambiarBorrador],
  )

  const eliminarBorrador = useCallback(
    (id: string) => {
      persistir(borradores.filter((b) => b.id !== id))
      if (borradorActivoId === id) setBorradorActivoId(null)
    },
    [borradores, borradorActivoId, persistir],
  )

  const guardarBorrador = useCallback(() => {
    if (borradorActivo) persistir(borradores)
  }, [borradorActivo, borradores, persistir])

  const mapaEl = (
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

  if (!planificacion) return mapaEl

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div>
        {mapaEl}
        <p className="mt-2 text-xs text-barro-500">
          Lo sólido son los hechos; lo punteado es el borrador que se propone encima. Nadie tiene
          que preguntar cuál es cuál (§23.1).
        </p>
      </div>
      <aside className="space-y-4">
        <ControlesMapa
          activas={activas}
          onToggle={alternarCapa}
          modoPoligono={modoPoligono}
          onModoPoligono={cambiarModoPoligono}
          municipios={planificacion.municipios}
          regiones={planificacion.regiones}
          agrupadores={planificacion.agrupadores}
          seleccionActual={seleccionPor}
          onSeleccionarPor={seleccionarPor}
          haySeleccion={idsSeleccionados.size > 0}
          onLimpiar={limpiarSeleccion}
        />
        <PanelPlan
          seleccion={seleccionVista}
          onArmarJornada={armarJornada}
          borradores={borradores}
          borradorActivo={borradorActivo}
          costeo={costeo}
          comunidadesById={comunidadesById}
          comunidadesTodas={planificacion.comunidades}
          onNuevoBorrador={() => nuevoBorrador()}
          onSeleccionarBorrador={setBorradorActivoId}
          onCambiarBorrador={cambiarBorrador}
          onMoverParada={moverParada}
          onQuitarParada={quitarParada}
          onAgregarParada={agregarParada}
          onGuardarBorrador={guardarBorrador}
          onEliminarBorrador={eliminarBorrador}
        />
      </aside>
    </div>
  )
}

// ── MapLibre overlay wiring (imperative; the geometry it draws is pure, in lib/mapa) ───────

type MapaGL = import('maplibre-gl').Map

/** Overlay layer ids by the toggle they belong to — the single source both effects read. */
const CAPAS_OVERLAY: Record<string, string[]> = {
  recencia: ['plan-recencia-relleno', 'plan-recencia-borde'],
  conectividad: ['plan-conectividad-relleno', 'plan-conectividad-borde'],
  contacto: ['plan-contacto-relleno', 'plan-contacto-borde'],
  silencio: ['plan-silencio-borde'],
  conexion: ['plan-conexion-punto'],
}

const VACIA = { type: 'FeatureCollection' as const, features: [] }

function setData(m: MapaGL, id: string, data: unknown) {
  const fuente = m.getSource(id) as { setData?: (d: unknown) => void } | undefined
  fuente?.setData?.(data)
}

/** A translucent coloured fill + dashed border shading, honouring the confidence dash by feature. */
function capasSombreado(id: string): Record<string, unknown>[] {
  return [
    {
      id: `${id}-relleno`,
      type: 'fill',
      source: id,
      filter: ['==', ['geometry-type'], 'Polygon'],
      layout: { visibility: 'none' },
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.28 },
    },
    {
      id: `${id}-borde`,
      type: 'line',
      source: id,
      filter: ['==', ['geometry-type'], 'Polygon'],
      layout: { visibility: 'none' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 2 },
    },
  ]
}

/**
 * Adds every planning overlay source and layer, all hidden to begin with (the visibility
 * effect lights the active ones). Every source is GeoJSON — never a tile source — so the
 * planner cannot smuggle a basemap or a key onto a screen that draws honest uncertainty.
 */
function agregarCapasPlan(m: MapaGL) {
  const fuentes = [
    'plan-recencia',
    'plan-conectividad',
    'plan-contacto',
    'plan-silencio',
    'plan-conexion',
    'plan-seleccion',
    'plan-borrador-ruta',
    'plan-borrador-paradas',
  ]
  for (const id of fuentes) {
    if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: VACIA })
  }

  const capas: Record<string, unknown>[] = [
    ...capasSombreado('plan-recencia'),
    ...capasSombreado('plan-conectividad'),
    ...capasSombreado('plan-contacto'),
    // Silence is an outline, not a fill: it marks which places have gone quiet without
    // repainting the whole circle, so it can sit over another shading and still read.
    {
      id: 'plan-silencio-borde',
      type: 'line',
      source: 'plan-silencio',
      filter: ['==', ['geometry-type'], 'Polygon'],
      layout: { visibility: 'none' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [1, 1] },
    },
    // Connection points: a distinct marker (not a state hue), always allowed to be a dot —
    // it is a place a person walks to, located like any other point (2.2).
    {
      id: 'plan-conexion-punto',
      type: 'circle',
      source: 'plan-conexion',
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': 5,
        'circle-color': '#0e7490',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    },
    // The selection area: a faint fill and a firm dashed outline while it is being drawn.
    {
      id: 'plan-seleccion-relleno',
      type: 'fill',
      source: 'plan-seleccion',
      paint: { 'fill-color': '#4338ca', 'fill-opacity': 0.08 },
    },
    {
      id: 'plan-seleccion-borde',
      type: 'line',
      source: 'plan-seleccion',
      paint: { 'line-color': '#4338ca', 'line-width': 2, 'line-dasharray': [2, 1.5] },
    },
    // The draft route: dashed, and drawn by leg state so a closed or missing leg is never
    // drawn as an open plan (§23.1, §23.3). One layer per state with a static dash pattern —
    // `line-dasharray` is not a data-driven property across MapLibre versions, so a `match`
    // on it would fail silently; a filter per state is the portable, honest way.
    {
      id: 'plan-borrador-ruta-ok',
      type: 'line',
      source: 'plan-borrador-ruta',
      filter: ['==', ['get', 'estado'], 'ok'],
      paint: { 'line-color': COLOR_BORRADOR.ok, 'line-width': 3, 'line-dasharray': GUION_BORRADOR.ok },
    },
    {
      id: 'plan-borrador-ruta-cerrada',
      type: 'line',
      source: 'plan-borrador-ruta',
      filter: ['==', ['get', 'estado'], 'cerrada'],
      paint: {
        'line-color': COLOR_BORRADOR.cerrada,
        'line-width': 3,
        'line-dasharray': GUION_BORRADOR.cerrada,
      },
    },
    {
      id: 'plan-borrador-ruta-sin_ruta',
      type: 'line',
      source: 'plan-borrador-ruta',
      filter: ['==', ['get', 'estado'], 'sin_ruta'],
      paint: {
        'line-color': COLOR_BORRADOR.sin_ruta,
        'line-width': 3,
        'line-dasharray': GUION_BORRADOR.sin_ruta,
      },
    },
    // The draft stops: an indigo dot — the plan's own hue, distinct from every fact colour.
    {
      id: 'plan-borrador-paradas',
      type: 'circle',
      source: 'plan-borrador-paradas',
      paint: {
        'circle-radius': 6,
        'circle-color': COLOR_BORRADOR.ok,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    },
  ]

  for (const capa of capas) {
    if (!m.getLayer(capa.id as string)) m.addLayer(capa as never)
  }
}
