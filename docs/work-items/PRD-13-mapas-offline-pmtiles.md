# PRD-13 — Offline PMTiles map bundles

- **Type:** PRD
- **Tier:** 2 — Roadmap (from PRD v1.0)
- **Priority:** P2
- **Status:** Backlog
- **Source:** PRD v1.0 (offline PMTiles bundles); PRD.md §3 (MapLibre + Protomaps extract "which
  also works offline").

## Problem / why

Field devices in Chocó / Pacífico operate with no/low signal. The panel map (PRD-2) needs to work
**offline** on a field device: a pre-built **PMTiles** bundle of the operating area, served
locally, so a coordinator or transporter can see geography without a live tile connection. This
is the offline half of the same MapLibre + Protomaps choice already made in PRD.md §3.

## Scope

**In:**
- A **PMTiles extract** of the operating basin (Chocó / Pacífico), buildable and versioned.
- The panel/field map loads from the local PMTiles bundle when offline, falling back to online
  tiles when available.
- A path to **update/download** a bundle when connectivity allows (bundle versioning + size
  budget suitable for field devices).
- Per-territory bundles (the architecture is territory-agnostic; each territory gets its own
  extract — cf. Buenaventura note in `docs/estado-nocturno.md`).

**Out (v1):** offline *data* sync (reports/pedidos offline) — that is a separate offline-first
effort (PRD.md non-goals reference Kobo/ODK for offline capture).

## Acceptance criteria

1. A PMTiles bundle for the operating area can be built and versioned.
2. With the network disabled, the map still renders the basemap from the local bundle.
3. When online, the app can fetch/update to a newer bundle version.
4. Bundle size is within a documented field-device budget.

## Validation approach (future, on staging / field build)

Build a bundle, load the map with the network disabled, and confirm the basemap renders; re-enable
network and confirm an update path works. Verify a second-territory bundle (e.g. Buenaventura)
renders independently. Never validate on production.

---

## PRD v3 update (2026-08-15) — §26 sharpens this into transporter run bundles

PRD v3 **§26** ("Offline") reframes this specifically as **transporter bundles** and adds hard rules:
- **PMTiles + MapLibre, downloaded while signal exists**, with a **GPS dot on top**. **GPS needs no
  connection — only the map does** (the phone's GPS works offline; we only need the tiles cached).
- **Precompute the run:** the bundle carries the **manifest, ordered stops, confirmation codes, and
  corridor tiles** — not the whole territory. **No on-device routing engine** — "a lanchero upriver is
  not choosing between routes."
- **Bundle scope is a safety requirement**, not just a size budget: **only the stops on that run,
  encrypted, expiring on completion.** This couples to offboarding — **termination cancels active run
  assignments** and the bundle expires (§29.6, PRD-16), and to the transporter tiers
  (`transportista_avalado` sees exact addresses only for their own active run, time-boxed — §29.3).
- **This does not violate "no app to install"** — that principle protects **reporters**; a transporter
  bundle is for a vetted transporter on an assigned run.

Add to scope: **run-scoped, encrypted, expiring bundles** (manifest + ordered stops + confirmation
codes + corridor tiles), distinct from the general per-territory basemap bundle already scoped above.
Cross-ref PRD-16 (§29.6 offboarding cancels the run), PRD-32 (the run/manifest comes from planning).

---

## Implementation — first version (2026-08-16)

Ships the **basemap half** (the per-territory offline basemap), honest about what is deferred.

**In this version**
- **PMTiles basemap MapLibre reads offline.** `lib/mapa/pmtiles.ts` registers the `pmtiles://`
  protocol and composes a **label-free vector** style (water/land/roads/boundaries — no symbol
  layers, so no glyph server, matching the existing constraint) UNDER the honest geometry, exactly
  like `basemap.ts` does with OSM. The pure, tested `lib/mapa/capas.ts` is untouched, so the "no
  tile source in the pure layer" invariant (`tests/mapa.test.ts`) still holds.
- **Offline-capable view.** `app/(panel)/mapa-offline/` + a service worker (`public/sw.js`) that
  caches the shell, static assets and the PMTiles archive — answering each `Range` request from
  the cached whole file so the basemap draws with no connection. Manifest at
  `public/manifest.webmanifest`.
- **GPS dot with «buscando señal».** `watchPosition` paints a live blue dot + a real-radius
  accuracy halo; the first-fix state reads «Buscando señal…». GPS needs no connection.
- **Build script + artifact location.** `scripts/construir-pmtiles.sh` builds a per-territory
  extract from the free Protomaps/OSM build into `$DATA_DIR/pmtiles/` (operational data, gitignored)
  and copies to `public/mapa/` (gitignored). No paid provider, no key. Config via
  `NEXT_PUBLIC_PMTILES_URL`. Full guide: `docs/mapas-offline.md`. **No migration** (no manifest
  table needed yet).
- Online panel map unchanged where no bundle is configured (default): `estiloDeMapa` falls back to
  OSM raster, so precision honesty and the online map are byte-for-byte as before.

**Deferred (noted, not faked) — needs device work + follow-up (§26):** run-scoped bundle
(manifest + ordered stops + confirmation codes + corridor tiles), encryption at rest, expiry on
completion, remote wipe. `/mapa-offline` states this on screen.

**Verification:** typecheck clean; `pnpm build` compiles; new `tests/mapa-offline.test.ts`
(basemap composition + honesty invariant + OSM fallback) and existing `tests/mapa.test.ts` green;
SW range-slice math verified. Full offline PMTiles render needs a built `.pmtiles` artifact (the
`pmtiles` CLI) + a device/DevTools-offline pass — steps in `docs/mapas-offline.md`.

---

## PRD v4 update (2026-08-19) — Supplement §2: confirms transporter-persona offline behaviour

**Confirms, not new.** v4's persona/access-tier table (§2) describes the Transporter/Delivery persona
identically to what's already scoped here (the v3 §26 update above) and in PRD-16 (§29.3 roles):
"Mobile Web Map + Encrypted Run Bundle" online, "Pre-downloaded PMTiles Map & GPS" offline, and — the
access boundary that matters — "View offline route stops and delivery manifests; access public
collection points only (**never household addresses**)." That last clause is `transportista_abierto`'s
exact scope in PRD-16 §29.3; `transportista_avalado`'s time-boxed exact-address access on their own
active run is the exception, not the default. No scope change here — this is corroborating language
from a second source document. Cross-ref PRD-16.
