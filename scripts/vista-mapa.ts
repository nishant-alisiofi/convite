import 'dotenv/config'
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { closeDb, getPool } from '@/db/client'
import { figurasDe, fuentesYCapas, limitesDe } from '@/lib/mapa/capas'
import { cargarMapa, etiquetaTramo } from '@/lib/mapa/datos'
import { temporadaVigente } from '@/lib/temporada'

/**
 * Renders the coordinator map to a standalone page so somebody can look at it.
 *
 * `/mapa` sits behind a session, and getting one means inviting an address and clicking a
 * link, so without this there is no quick way to check what the screen exists for — whether a
 * centroid draws as a kilometre-wide circle or quietly as a dot. It reads real rows through
 * the same `cargarMapa` query and takes its sources and layers from the same
 * `lib/mapa/capas`, so what appears here is what the panel draws.
 *
 * `pnpm vista:mapa`, then open the printed path. Output goes to .data/, which is ignored.
 */

const SALIDA = '.data/vista-mapa'

async function main() {
  const client = await getPool().connect()
  let datos
  try {
    datos = await cargarMapa(client, await temporadaVigente(client))
  } finally {
    client.release()
  }

  const figuras = figurasDe(datos)
  const estilo = fuentesYCapas(figuras, datos.tramos)
  const limites = limitesDe(figuras, datos.tramos)

  const etiquetas = [
    ...datos.comunidades
      .filter((c) => c.lat !== null && c.lon !== null)
      .map((c) => ({ texto: c.nombre, lon: c.lon, lat: c.lat, clase: 'comunidad' })),
    ...datos.tramos.map((t) => ({
      texto: etiquetaTramo(t),
      lon: (t.origenLon + t.destinoLon) / 2,
      lat: (t.origenLat + t.destinoLat) / 2,
      clase: 'tramo',
    })),
  ]

  mkdirSync(`${SALIDA}/maplibre`, { recursive: true })
  // The whole dist: maplibre-gl.mjs pulls in a shared chunk and spawns a worker module, and
  // a missing one fails as a blank canvas rather than as an error.
  for (const archivo of readdirSync('node_modules/maplibre-gl/dist')) {
    if (archivo.endsWith('.mjs') || archivo.endsWith('.css')) {
      copyFileSync(`node_modules/maplibre-gl/dist/${archivo}`, `${SALIDA}/maplibre/${archivo}`)
    }
  }

  writeFileSync(
    `${SALIDA}/index.html`,
    `<!doctype html>
<html lang="es-CO">
<head>
<meta charset="utf-8" />
<title>Convite · mapa de la cuenca</title>
<link rel="stylesheet" href="./maplibre/maplibre-gl.css" />
<style>
  body { margin: 0; background: #faf9f7; color: #2a2622;
         font: 15px/1.55 system-ui, sans-serif; }
  header { padding: 12px 16px; border-bottom: 1px solid #e7e3dd; background: #fff; }
  h1 { margin: 0; font-size: 16px; }
  p { margin: 4px 0 0; font-size: 13px; color: #6f675e; }
  #mapa { height: calc(100vh - 76px); }
  .comunidad { background: rgba(255,255,255,.85); border-radius: 3px; padding: 0 3px;
               font-size: 11px; font-weight: 500; color: #292524; pointer-events: none; }
  .tramo { background: rgba(250,249,247,.8); border-radius: 3px; padding: 0 3px;
           font-size: 10px; color: #57534e; pointer-events: none; }
</style>
</head>
<body>
<header>
  <h1>Convite · cuenca del Atrato · temporada ${datos.temporada}</h1>
  <p>${datos.comunidades.length} comunidades · ${datos.tramos.length} tramos · ${figuras.pines.length} con punto exacto · sin ubicar: ${figuras.sinUbicar.join(', ') || 'ninguno'}</p>
</header>
<div id="mapa"></div>
<script type="module">
import { Map as MapaGL, Marker, NavigationControl, ScaleControl } from './maplibre/maplibre-gl.mjs'

const mapa = new MapaGL({
  container: 'mapa',
  style: ${JSON.stringify(estilo)},
  center: [-76.72, 5.95],
  zoom: 7.4,
  attributionControl: false,
})
window.__mapa = mapa

const limites = ${JSON.stringify(limites)}
if (limites) mapa.fitBounds(limites, { padding: 48, animate: false })

mapa.addControl(new NavigationControl({ showCompass: false }), 'top-right')
mapa.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')

mapa.on('load', () => {
  for (const e of ${JSON.stringify(etiquetas)}) {
    const el = document.createElement('span')
    el.textContent = e.texto
    el.className = e.clase
    const opciones = e.clase === 'comunidad'
      ? { element: el, anchor: 'top', offset: [0, 7] }
      : { element: el }
    new Marker(opciones).setLngLat([e.lon, e.lat]).addTo(mapa)
  }
})
</script>
</body>
</html>
`,
  )

  console.log(`\n${SALIDA}/index.html`)
  console.log(
    `  ${datos.comunidades.length} comunidades · ${datos.tramos.length} tramos · ` +
      `círculos ${Object.values(figuras.circulos).flat().length} · ` +
      `pines ${figuras.pines.length} · sin ubicar ${figuras.sinUbicar.length}\n`,
  )
}

main()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error)
    await closeDb()
    process.exit(1)
  })
