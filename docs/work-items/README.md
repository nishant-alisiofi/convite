# Convite — Work Items

Tracked work items for Convite. This repo has no `.forge` tooling, so items live here as
self-contained markdown. Each file carries its own acceptance criteria and, for Tier 1, an
ordered **Codex validation** checklist that a validator runs on **`staging.convite.ai`**.

**Numbering:** one shared sequence, type-prefixed (`PRD-` feature/scoped, `BUG-` defect,
`FR-` open request). IDs are forever — never renumber. Highest allocated ID: **FR-48**.

> **Governing spec:** `docs/PRD_Convite_v3.md` (v3.0, Aug 2026) **supersedes the earlier PRDs**
> (`docs/PRD.md` and the v1.0/v2 vision) as the canonical product specification. v3 is written
> against the running product: its **Part II** is descriptive (built behaviour is canonical, and its
> load-bearing copy must not be "tidied"), **Part III** lists defects (→ `BUG-19..27`), **Part IV**
> lists gaps (→ `PRD-28..38` + enrichments of the existing Tier-2 items), **Part V** covers partners
> and the pilot. Where v3 expands an existing WI, that WI was **enriched with a "PRD v3 update"
> section** rather than duplicated.

**Sources:**
- **Jam A** — "Convite - Populate data" (Nishant): clicked through every panel page; all empty.
  Asked to populate staging so every page works, and to replace the schematic map with a real
  map (pins + "use my location").
- **Jam B** — "Convite Setup - AI Ingestion" (Nishant, narrated): show data arriving from all
  four channels (WhatsApp/SMS/missed-call/radio) via AI ingestion, each report showing its
  source and, for voice, a "transcribed" indicator; raw-messages → triage → categorized
  Tablero; Tablero classified by what's missing; a real map; inventory as demand-vs-stock;
  routes + planning; pickup groups; per-org permissions. Recurring theme: "show organisations
  the value that comes in through this AI ingestion — that has to come out in our demo."
- **PRD §** — `docs/PRD.md` (M1–M12 remaining-work PRD; M4–M12 shipped) and the governing
  product vision v1.0 (three-sided marketplace; four channels; three supply modes incl. funded
  local purchase; transport of people; connection points; radio ingestion; sponsorship; offline
  PMTiles; multi-org membership; Ley 1581; pilot = 50 parteras / ASOREDIPARCHOCÓ).
- **PRD v3** — `docs/PRD_Convite_v3.md` (the governing spec, see the note above). Part III defects →
  `BUG-19..27`; Part IV gaps → `PRD-28..38` and enrichments of `PRD-8/9/12/13/14/15/16` + `FR-17/18`.
- **Territory seed** — `db/seed/territorio.sql` (real registry data: 3 regions, ~65 communities,
  catalogue, nodes, seasonal routes, Herencia's historical jornadas) → wired by `PRD-38`, on the
  schema from `PRD-37`.

**Validation surface (Tier 1):** `https://staging.convite.ai` only. **Never** validate on
`https://convite.ai` (production) — it is intentionally clean; do not sign up or submit forms
there. Test accounts and how to fetch magic links: `docs/validacion-codex-0a1.md`.

---

## Tier 1 — Demo (this pass) — validate now

| ID | Title | Type | Source | Priority | Demo/Roadmap | Status |
|----|-------|------|--------|----------|--------------|--------|
| [PRD-1](PRD-1-seed-multicanal.md) | Multi-channel AI-ingestion demo seed (staging) | PRD | Jam A + Jam B | P0 | Demo | ✅ Done — on staging (pending Codex) |
| [PRD-2](PRD-2-mapa-openstreetmap.md) | Real OpenStreetMap panel map + geolocation + pin-drop + center-location capture | PRD | Jam A + Jam B | P0 | Demo | ✅ Done — on staging (pending Codex) |
| [PRD-3](PRD-3-visualizacion-canal-transcripcion.md) | Panel UI pass: channel/source + transcription visualization on cards | PRD | Jam B | P0 | Demo | ✅ Done — on staging (pending Codex) |
| [PRD-4](PRD-4-auditoria-paginas-panel.md) | Panel page audit + build Inventario/Comunidades/Catálogo | PRD | Jam A | P0 | Demo | ✅ Done — on staging (pending Codex) |
| [BUG-5](BUG-5-paginas-vacias-org.md) | Panel pages empty for the logged-in org despite an approved center + members | BUG | Jam A | P0 | Demo | ✅ Fixed (seed org now `aprobada`) |
| [BUG-6](BUG-6-mapa-en-blanco.md) | Mapa renders blank / schematic with no basemap | BUG | Jam A | P0 | Demo | ✅ Fixed (real OSM base) |
| [BUG-7](BUG-7-recogidas-sin-ubicacion.md) | Recogidas: centers have no location ("Ningún centro tiene ubicación") | BUG | Jam A | P1 | Demo | ✅ Fixed (offer + center locations) |

## Tier 1 — Defects on the live demo (PRD v3 Part III) — fix now

The §33 "day's work" defect batch (D1–D9). D2 and D7 are correctness/safety issues, not polish.
Validate on `staging.convite.ai` (D7/D8 are on the public surface, no login).

| ID | Title | Type | Source | Priority | Status |
|----|-------|------|--------|----------|--------|
| [BUG-19](BUG-19-copia-de-estado-no-se-regenera.md) | State-dependent copy not regenerated on transition (Paimadó) | BUG | v3 §D1 | P0 | Open |
| [BUG-20](BUG-20-correccion-prellenada-baja-confianza.md) | Correction field pre-filled below the confidence threshold | BUG | v3 §D2 | P1 | Open |
| [BUG-21](BUG-21-clasificacion-item-no-corregible.md) | Proposed item classification (`codigo_item`) not correctable | BUG | v3 §D3 | P1 | Open |
| [BUG-22](BUG-22-defectos-de-locale.md) | Locale defects (mm/dd/yyyy date; raw `todo_el_ano` enum) | BUG | v3 §D4 | P2 | Open |
| [BUG-23](BUG-23-falsa-precision-perecederos.md) | False precision on perishable expiry timestamps | BUG | v3 §D5 | P2 | Open |
| [BUG-24](BUG-24-silencio-tier1-vs-tier4.md) | Never-seen tier-1 escalated the same as tier-3/4 silence | BUG | v3 §D6 | P1 | Open |
| [BUG-25](BUG-25-divulgacion-celda-pequena-respuesta.md) | Small-cell disclosure on `/respuesta` (k-anonymity) | BUG | v3 §D7 | P0 | Open |
| [BUG-26](BUG-26-claim-zero-rating-landing.md) | Overstated zero-rating claim on the landing page | BUG | v3 §D8 | P1 | Open |
| [BUG-27](BUG-27-codigo-catalogo-como-cantidad.md) | Catalogue code reads as a quantity in Inventario | BUG | v3 §D9 | P1 | Open |

## Tier 1 — Defects found by Codex validation pass 1 (2026-08-16)

| ID | Title | Type | Source | Priority | Status |
|----|-------|------|--------|----------|--------|
| [BUG-39](BUG-39-mapa-sin-capas-de-datos.md) | Map data overlays don't render over the OSM basemap | BUG | Codex pass 1 | P1 | ✅ Fixed (white casings) |
| [BUG-40](BUG-40-emparejador-no-corre-al-promover.md) | Matcher not run when a report is promoted to a pedido | BUG | Codex pass 1 | P1 | ✅ Fixed (emparejarPedido on promotion) |
| [BUG-41](BUG-41-produccion-sin-noindex.md) | Production missing the pre-launch noindex | BUG | Codex pass 1 | P1 | ✅ Fixed (config) |
| [PRD-39](PRD-39-unificar-comunidades-demo-registro.md) | Unify demo activity onto the real registry (dedup staging communities) | PRD | PRD-38 gap | P1 | ✅ Done (82→68, no dupes) |

## Tier 2 — Roadmap (from PRD v1.0, not this pass)

| ID | Title | Type | Source | Priority | Demo/Roadmap | Status |
|----|-------|------|--------|----------|--------------|--------|
| [PRD-8](PRD-8-transporte-de-personas.md) | Transport of people (not just goods) | PRD | PRD v1.0 | P2 | Roadmap | Backlog |
| [PRD-9](PRD-9-compra-local-financiada.md) | Funded local purchase (third supply mode) | PRD | PRD v1.0 | P2 | Roadmap | Backlog |
| [PRD-10](PRD-10-puntos-de-conexion.md) | Connection points (puntos de conexión) | PRD | PRD v1.0 | P2 | Built early | ✅ Done — on staging (pending Codex) |
| [PRD-11](PRD-11-ingesta-de-radio.md) | Real radio ingestion (fourth channel) | PRD | PRD v1.0 + Jam B | P2 | Roadmap | Backlog |
| [PRD-12](PRD-12-apadrina-una-partera.md) | Sponsorship: "apadrina una partera" | PRD | PRD v1.0 | P2 | Built early | ✅ Done — on staging (pending Codex) |
| [PRD-13](PRD-13-mapas-offline-pmtiles.md) | Offline PMTiles map bundles | PRD | PRD v1.0 | P2 | Roadmap | Backlog |
| [PRD-14](PRD-14-whisper-autohospedado.md) | Self-hosted Whisper transcription (D8) | PRD | PRD v1.0 + PRD §D8 | P1 | Roadmap | Backlog |
| [PRD-15](PRD-15-gateways-sms-voz.md) | Live SMS + voice-callback gateways (D1/D2) | PRD | PRD v1.0 + PRD §D1/D2 | P1 | Roadmap | Backlog |
| [PRD-16](PRD-16-membresia-multi-org.md) | Multi-org membership (join-table) | PRD | PRD v1.0 | P2 | Roadmap | Backlog |
| [FR-17](FR-17-integracion-telesalud.md) | Telehealth-module integration | FR | PRD v1.0 | P3 | Roadmap | Backlog |
| [FR-18](FR-18-autoregistro-transportista.md) | Transporter self-signup flow (decision pending) | FR | Jam B | P3 | Roadmap | Decision pending |

**Enriched by PRD v3 (not duplicated):** `PRD-8` (§25 transport of people), `PRD-9` (§24 funded
local purchase), `PRD-12` (§13 Apadrinar built + §21b.4 programa funding + §21 house-pricing),
`PRD-13` (§26 offline run bundles), `PRD-14` (§4.1.7 recording-pipeline privacy rules), `PRD-15`
(§4.1/§20 Infobip missed-call callback, adaptive link, spend caps, channel-reality gate), `PRD-16`
(§29.4–29.7 ceiling + membership + offboarding + separation of duties), `FR-17` (§27/§27b
telemedicine fulfilment + services), `FR-18` (§29.2–29.3b tier model resolves the decision). Each
carries a "PRD v3 update (2026-08-15)" section citing the new sections.

## Tier 2 — Roadmap (PRD v3 Part IV gaps) — new

Continues the ID sequence after FR-18. Build order follows PRD v3 §33.

| ID | Title | Type | Source | Priority | Status |
|----|-------|------|--------|----------|--------|
| [PRD-28](PRD-28-bandeja-unificada-navegacion.md) | Unified Bandeja + 7-section navigation (silence as first-class item) | PRD | v3 §18–19 | P1 | Backlog |
| [PRD-29](PRD-29-evaluaciones-y-recuperacion.md) | Assessments & recovery (levels 2–4, coverage, bill of materials) | PRD | v3 §21 | P1 | Backlog |
| [PRD-30](PRD-30-jornadas.md) | Jornadas — the scheduling container over the same matching | PRD | v3 §22 | P2 | Backlog |
| [PRD-31](PRD-31-programas.md) | Programas — funded layer above jornadas, seasonal feasibility | PRD | v3 §21b | P2 | Backlog |
| [PRD-32](PRD-32-mapa-como-superficie-de-planificacion.md) | Map as planning surface (draft-over-facts, area selection, assessment-recency) | PRD | v3 §23 | P1 | Backlog |
| [PRD-33](PRD-33-cadena-de-frio-y-suministro-anticipado.md) | Cold chain constraints + anticipatory supply | PRD | v3 §24 | P2 | Backlog |
| [PRD-34](PRD-34-grupos-e-integraciones.md) | Groups & integrations (.ics feeds, Meet, Google import/export, group bridges) | PRD | v3 §28 | P2 | Backlog |
| [PRD-35](PRD-35-admision-de-organizaciones-y-registro-comun.md) | Org admission tiers, vouching, shared community gazetteer, manual-entry channel | PRD | v3 §29.3b | P1 | Backlog |
| [PRD-36](PRD-36-onboarding-por-fases.md) | Staged onboarding by phase (Configurar / Operar / Revisar) | PRD | v3 §29b | P2 | Backlog |
| [PRD-37](PRD-37-esquema-territorio-y-registro.md) | Territory & registry schema (regiones, verificado_en, org ceiling/aval, jornadas tables) | PRD | v3 §14/§29/§22 + seed | P1 | Backlog |
| [PRD-38](PRD-38-sembrar-territorio-real.md) | Wire the real territory seed (`db/seed/territorio.sql`) | PRD | territory seed | P1 | Backlog |

**Dependency chain for the territory seed:** `PRD-37` (schema: regiones + `comunidades.region_id`/
`verificado_en` + `organizaciones.techo_permisos`/`aval_motivo` + `jornadas`/`jornada_paradas`
tables) → **then** `PRD-38` (run the seed). The seed needs only the *schema* from PRD-37, so it is
unblockable ahead of the feature logic in `PRD-16` (ceiling), `PRD-30` (jornadas) and `PRD-35`
(vouching). The `territorio.sql` registry data is valid for **both staging and production** (it is
the community registry, not demo test data) — unlike the staging-only demo `db:seed` reports/pedidos.

---

## Nishant field-feedback wrap-up (Chocó / Doña Marta, Aug 2026) — building now

Source: Nishant's relay of Red de Mujeres Chocanas / Doña Marta field feedback (2026-08-17).
**"Missed call with a recorded call back is the feature they need the most."** Provider path:
Infobip (`infobip.com/docs`), which matches PRD-15's already-specified missed-call design.

**Flagship — implements PRD-15 (voice + SMS via Infobip):** missed call → early-media
«lo llamamos ya» (audible during ringing, caller **never billed**) → callback IVR → record →
intake → verification, plus the Infobip **SMS** driver. Copy is **«solo marque»** (BUG-26 — the
system disconnects, not the caller). Live test is blocked on Nishant provisioning the Infobip
account + Colombian voice number + account-manager activation of recordings/early media.

| ID | Title | Type | Priority | Status |
|----|-------|------|----------|--------|
| [PRD-15](PRD-15-gateways-sms-voz.md) | Infobip voice missed-call + SMS gateway (build) | PRD | P1 | 🟡 Core built + deployed (reject→callback→spend-caps + SMS send + signed webhook); IVR capture + inbound-SMS route + live test pending Infobip account |
| [FR-42](FR-42-busqueda-rapida-personas.md) | Fast person/beneficiary search | FR | P2 | ✅ Built + deployed (staging+prod, pending Codex) |
| [FR-43](FR-43-caducidad-perecederos-alertas.md) | Perishable expiry tracking + alerts | FR | P2 | ✅ Built + deployed (staging+prod, pending Codex) |
| [FR-44](FR-44-inventario-farmacias-locales.md) | Local pharmacy inventory | FR | P3 | ✅ Built + deployed (staging+prod, pending Codex) |
| [FR-45](FR-45-categorias-bienes-ayuda.md) | Relief-goods categories (food/medical/construction) | FR | P2 | ✅ Built + deployed (staging+prod, pending Codex) |
| [FR-46](FR-46-lanchas-costo-y-pago.md) | Paid boat (lancha) logistics: cost + operator pay | FR | P2 | ✅ Built + deployed (staging+prod, pending Codex) |
| [PRD-47](PRD-47-red-de-lancheros-datos.md) | Lanchero relay network for data collection | PRD | P3 | ✅ Built + deployed (assumptions — partner review; pending Codex) |
| [FR-48](FR-48-servicios-de-ingenieria.md) | Engineering / technical evaluation services | FR | P3 | ✅ Built + deployed (staging+prod, pending Codex) |

**Also in this wrap-up (not a new WI):** WhatsApp live-number verification — number registered
(+57 300 510 1284), production webhook green, env vars set on app + worker; blocked only on a real
inbound test (needs a phone + confirming the `messages` field is subscribed + the app is published).

---

## Notes on scope

- **Bugs are distinct from features by design.** BUG-5/6/7 record what Nishant observed in Jam A
  from the customer's POV; the feature WIs (PRD-1/PRD-2) record the build that resolves them.
  They cross-reference and validate differently.
- **RBAC / per-org permissions is already shipped** (migration 0034, verified live on staging per
  `docs/estado-nocturno.md`). Jam B's "per-organisation permissions" is therefore not a new build
  — it is covered by PRD-4's Equipo/Centros per-page criteria (make it render with data) and by
  the existing walkthrough in `docs/validacion-codex-0a1.md`.
- **The whole M4–M12 pipeline is built** (see `docs/PRD.md` and `docs/estado-nocturno.md`). Tier 1
  is about making that pipeline *visible with data on staging*, not building new pipeline logic.
- **PRD v3 Part II is canonical and copy is load-bearing.** Several built screens (Tablero motivos,
  the map precision legend, Verificación "lo que oyó la máquina se conserva aparte", Comunidades
  "en silencio" vs "nunca vista") solve the problem better than v1/v2 described — that behaviour and
  its exact Spanish copy must not be "tidied" by a future contributor. Defect fixes (`BUG-19..27`)
  preserve it while correcting the specific defect.
- **Enrich, don't duplicate.** Where PRD v3 expands an existing WI, the WI was updated in place with
  a dated "PRD v3 update" section, not re-filed under a new ID. New IDs (`PRD-28..38`, `BUG-19..27`)
  are only for genuinely new gaps/defects. IDs are forever.
