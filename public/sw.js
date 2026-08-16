/*
 * Convite offline service worker (PRD-13 / §26).
 *
 * Its whole job is to let ONE surface — the offline map at /mapa-offline — render with no
 * connection: the app shell, the static assets and, above all, the PMTiles basemap archive.
 * It is deliberately narrow. It never touches /api/*, sign-in, or any other page: those are
 * passed straight to the network so nothing dynamic or authenticated is ever served stale by
 * accident. The only things it caches are immutable static assets, the offline-map document,
 * and the basemap archive the page explicitly asks it to keep.
 *
 * The hard part is the archive. `pmtiles` reads its file with HTTP Range requests, so caching
 * it is not "store the response for this URL" — it is "keep the whole file, then answer each
 * range out of it". So the page downloads the archive in full while signal exists (a message
 * below), and this worker slices that cached copy to satisfy every `bytes=…` request offline.
 */

const VERSION = 'v1'
const SHELL = `convite-shell-${VERSION}`
const ASSETS = `convite-assets-${VERSION}`
const TILES = `convite-pmtiles-${VERSION}`
const CACHES = [SHELL, ASSETS, TILES]

const RUTA_OFFLINE = '/mapa-offline'

self.addEventListener('install', () => {
  // Nothing to precache by name (Next asset URLs are content-hashed per build); the fetch
  // handler fills the caches at runtime. Take over as soon as we are ready.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const nombres = await caches.keys()
      await Promise.all(nombres.filter((n) => !CACHES.includes(n)).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  const msg = event.data || {}
  if (msg.type === 'CACHE_PMTILES' && typeof msg.url === 'string') {
    event.waitUntil(precacheArchivo(msg.url, event.source))
  } else if (msg.type === 'CACHE_SHELL' && Array.isArray(msg.urls)) {
    event.waitUntil(precacheShell(msg.urls))
  }
})

/** Downloads the whole archive (no Range) and stores it so ranges can be served offline. */
async function precacheArchivo(url, cliente) {
  try {
    const cache = await caches.open(TILES)
    const resp = await fetch(url, { cache: 'reload' })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    await cache.put(url, resp.clone())
    if (cliente) cliente.postMessage({ type: 'PMTILES_CACHED', url, ok: true })
  } catch (err) {
    if (cliente) cliente.postMessage({ type: 'PMTILES_CACHED', url, ok: false, error: String(err) })
  }
}

/** Caches the offline-map document + the assets the page hands us, for an offline reload. */
async function precacheShell(urls) {
  const cache = await caches.open(SHELL)
  await Promise.all(
    urls.map(async (u) => {
      try {
        const resp = await fetch(u, { cache: 'reload' })
        if (resp.ok || resp.type === 'opaqueredirect') await cache.put(u, resp.clone())
      } catch {
        /* one asset failing to precache is not fatal; the map still has what it got */
      }
    }),
  )
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // 1) The basemap archive: answer Range requests out of the cached whole file when offline.
  if (url.pathname.endsWith('.pmtiles')) {
    event.respondWith(servirArchivo(req, url))
    return
  }

  // 2) The offline-map document: network-first (fresh when online), cached shell when offline.
  if (req.mode === 'navigate' && url.pathname.startsWith(RUTA_OFFLINE)) {
    event.respondWith(documentoOffline(req))
    return
  }

  // 3) Immutable static assets: serve fast from cache, refresh in the background.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/mapa-offline/')) {
    event.respondWith(assetConRevalidacion(req))
    return
  }

  // Everything else (API, auth, other pages, tiles from OSM) is never intercepted.
})

/** Range-aware read of the cached archive; falls through to the network when not cached. */
async function servirArchivo(req, url) {
  const cache = await caches.open(TILES)
  const guardado = await cache.match(url.href)
  const rango = req.headers.get('range')

  if (guardado) {
    const buf = await guardado.arrayBuffer()
    if (!rango) {
      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(buf.byteLength),
          'Accept-Ranges': 'bytes',
        },
      })
    }
    const m = /bytes=(\d+)-(\d*)/.exec(rango)
    if (m) {
      const inicio = Number(m[1])
      const fin = m[2] ? Math.min(Number(m[2]), buf.byteLength - 1) : buf.byteLength - 1
      const trozo = buf.slice(inicio, fin + 1)
      return new Response(trozo, {
        status: 206,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Range': `bytes ${inicio}-${fin}/${buf.byteLength}`,
          'Content-Length': String(trozo.byteLength),
          'Accept-Ranges': 'bytes',
        },
      })
    }
  }

  // Not cached (or an unparseable range): go to the network. Offline + uncached = the map
  // shows its own error and the page's list still carries the data.
  return fetch(req)
}

async function documentoOffline(req) {
  const cache = await caches.open(SHELL)
  try {
    const fresco = await fetch(req)
    if (fresco.ok) cache.put(req, fresco.clone())
    return fresco
  } catch {
    const guardado = (await cache.match(req)) || (await cache.match(RUTA_OFFLINE))
    if (guardado) return guardado
    throw new Error('offline y sin copia del mapa')
  }
}

async function assetConRevalidacion(req) {
  const cache = await caches.open(ASSETS)
  const guardado = await cache.match(req)
  const red = fetch(req)
    .then((resp) => {
      if (resp.ok) cache.put(req, resp.clone())
      return resp
    })
    .catch(() => guardado)
  return guardado || red
}
