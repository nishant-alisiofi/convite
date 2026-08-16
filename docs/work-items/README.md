# Convite — Work Items

Tracked work items for Convite. This repo has no `.forge` tooling, so items live here as
self-contained markdown. Each file carries its own acceptance criteria and, for Tier 1, an
ordered **Codex validation** checklist that a validator runs on **`staging.convite.ai`**.

**Numbering:** one shared sequence, type-prefixed (`PRD-` feature/scoped, `BUG-` defect,
`FR-` open request). IDs are forever — never renumber.

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

**Validation surface (Tier 1):** `https://staging.convite.ai` only. **Never** validate on
`https://convite.ai` (production) — it is intentionally clean; do not sign up or submit forms
there. Test accounts and how to fetch magic links: `docs/validacion-codex-0a1.md`.

---

## Tier 1 — Demo (this pass) — validate now

| ID | Title | Type | Source | Priority | Demo/Roadmap | Status |
|----|-------|------|--------|----------|--------------|--------|
| [PRD-1](PRD-1-seed-multicanal.md) | Multi-channel AI-ingestion demo seed (staging) | PRD | Jam A + Jam B + eng-in-flight | P0 | Demo | In progress (eng) |
| [PRD-2](PRD-2-mapa-openstreetmap.md) | Real OpenStreetMap panel map + geolocation + pin-drop + center-location capture | PRD | Jam A + Jam B + eng-in-flight | P0 | Demo | In progress (eng) |
| [PRD-3](PRD-3-visualizacion-canal-transcripcion.md) | Panel UI pass: channel/source + transcription visualization on cards | PRD | Jam B + planned UI pass | P0 | Demo | Planned |
| [PRD-4](PRD-4-auditoria-paginas-panel.md) | Panel page audit: every page populated & correct (per-page acceptance) | PRD | Jam A | P0 | Demo | Planned |
| [BUG-5](BUG-5-paginas-vacias-org.md) | Panel pages empty for the logged-in org despite an approved center + members | BUG | Jam A | P0 | Demo | Open |
| [BUG-6](BUG-6-mapa-en-blanco.md) | Mapa renders blank / schematic with no basemap | BUG | Jam A | P0 | Demo | Open |
| [BUG-7](BUG-7-recogidas-sin-ubicacion.md) | Recogidas: centers have no location ("Ningún centro tiene ubicación") | BUG | Jam A | P1 | Demo | Open |

## Tier 2 — Roadmap (from PRD v1.0, not this pass)

| ID | Title | Type | Source | Priority | Demo/Roadmap | Status |
|----|-------|------|--------|----------|--------------|--------|
| [PRD-8](PRD-8-transporte-de-personas.md) | Transport of people (not just goods) | PRD | PRD v1.0 | P2 | Roadmap | Backlog |
| [PRD-9](PRD-9-compra-local-financiada.md) | Funded local purchase (third supply mode) | PRD | PRD v1.0 | P2 | Roadmap | Backlog |
| [PRD-10](PRD-10-puntos-de-conexion.md) | Connection points (puntos de conexión) | PRD | PRD v1.0 | P2 | Roadmap | Backlog |
| [PRD-11](PRD-11-ingesta-de-radio.md) | Real radio ingestion (fourth channel) | PRD | PRD v1.0 + Jam B | P2 | Roadmap | Backlog |
| [PRD-12](PRD-12-apadrina-una-partera.md) | Sponsorship: "apadrina una partera" | PRD | PRD v1.0 | P2 | Roadmap | Backlog |
| [PRD-13](PRD-13-mapas-offline-pmtiles.md) | Offline PMTiles map bundles | PRD | PRD v1.0 | P2 | Roadmap | Backlog |
| [PRD-14](PRD-14-whisper-autohospedado.md) | Self-hosted Whisper transcription (D8) | PRD | PRD v1.0 + PRD §D8 | P1 | Roadmap | Backlog |
| [PRD-15](PRD-15-gateways-sms-voz.md) | Live SMS + voice-callback gateways (D1/D2) | PRD | PRD v1.0 + PRD §D1/D2 | P1 | Roadmap | Backlog |
| [PRD-16](PRD-16-membresia-multi-org.md) | Multi-org membership (join-table) | PRD | PRD v1.0 | P2 | Roadmap | Backlog |
| [FR-17](FR-17-integracion-telesalud.md) | Telehealth-module integration | FR | PRD v1.0 | P3 | Roadmap | Backlog |
| [FR-18](FR-18-autoregistro-transportista.md) | Transporter self-signup flow (decision pending) | FR | Jam B | P3 | Roadmap | Decision pending |

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
