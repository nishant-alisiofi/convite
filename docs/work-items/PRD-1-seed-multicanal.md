# PRD-1 — Multi-channel AI-ingestion demo seed (staging)

- **Type:** PRD (feature / infra)
- **Tier:** 1 — Demo (this pass)
- **Priority:** P0
- **Status:** ✅ Built + deployed (staging + prod) — pending Codex validation
- **Source:** Jam A ("populate staging with data so every page works"), Jam B ("show data
  arriving from all four channels via AI ingestion — that has to come out in our demo"),
  engineering-in-flight item #1.
- **Resolves:** BUG-5 (empty pages for the logged-in org). Enables PRD-3, PRD-4.

## Problem / why

In Jam A, Nishant logged into the panel and clicked every page — Tablero, Verificación, Mapa,
Rutas, Recogidas, Comunidades, Equipo — and each was empty ("Nada esperando", "Ningún centro
tiene ubicación", "no ha invitado a nadie", blank map). Only Centros showed the org (Alisio ·
Aprobado · 3 miembros). The whole M4–M12 pipeline is built and green in tests, but staging has
no demo data scoped to the demo login org, so a walkthrough shows an empty system. Jam B makes
the demand explicit: the demo must *show the value of AI ingestion* — reports arriving across
all four channels, voice notes transcribed, and pedidos flowing through the matcher into a
classified Tablero.

## Scope

**In:**
- Seed staging (`staging.convite.ai`) with demo data **scoped to the demo login org** so the
  test accounts in `docs/validacion-codex-0a1.md` see it.
- **Reports across all four channels** — WhatsApp, SMS, missed-call (IVR), and radio — each
  report carrying its `canal`/source so the UI can render a channel badge (PRD-3).
- At least one **voice-note report with a transcription** (transcribed indicator, original
  `texto_original` preserved) so the "transcrito" state is demonstrable.
- **Pedidos across every matcher state**: `SIN_RUTA`, `SIN_EXISTENCIA`, `SIN_CAPACIDAD`,
  `LISTO`, `EN_CAMINO` — so the Tablero classified-by-what's-missing view has a row of each.
- **Nodes + offers** (donor offers, incl. at least one perishable with a departure check) and a
  **route graph** with schematic river/road legs (time + mode labelled).
- At least one **dispatch** (manifest with 4-digit code, allocation decision row) so Recogidas /
  dispatch surfaces render.
- **Tier-4 silent communities** so the silence-alert / check-in surface has something to show.
- Every seeded row a person can see is marked `[DATO DE PRUEBA]` (per project rule).
- The seed **runs a matcher pass** after inserting, so `mapa_publico` and Tablero reflect
  post-matcher states (this was the fix in `778c5fe` — the public page showed an empty basin
  because the seed never ran the matcher).

**Out:**
- Any seeding of **production** (`convite.ai`) — banned. Production stays clean.
- Live channel traffic (real WhatsApp/SMS/IVR/radio) — that is Tier 2 (PRD-11/PRD-15) and D3/D4.
- New pipeline logic — the pipeline exists; this is data only.

## Acceptance criteria

1. Logging into staging as the coordinador test account lands on a **non-empty** Tablero.
2. The Tablero contains **at least one pedido in each matcher state** (`SIN_RUTA`,
   `SIN_EXISTENCIA`, `SIN_CAPACIDAD`, `LISTO`, `EN_CAMINO`).
3. The verification queue contains reports from **all four channels** (WhatsApp, SMS,
   missed-call, radio) and **at least one voice-note report with a transcription**.
4. Comunidades lists the seeded communities including **at least one tier-4 silent** community.
5. Rutas shows a non-empty route graph; Recogidas shows at least one pickup group and at least
   one center **with a location**; at least one **dispatch** exists with a 4-digit code.
6. The public `/respuesta` page shows a non-empty aggregated response (matcher ran).
7. **Nothing is seeded on production** — `convite.ai` panel/public surfaces show no demo data.

## Codex validation (run on staging.convite.ai)

> **Do not touch production (`convite.ai`).** Log in per `docs/validacion-codex-0a1.md`: go to
> `/entrar`, enter the test email, request the link, and open it from the `talos` inbox
> (`/inbox` or `email.sh`) or Resend (`resend-api.sh convite query emails/<id>` — the `text`
> field has the plaintext link). WhatsApp codes appear in the server log
> (`railway-api.sh convite logs staging deploy`).

1. Log in as **coordinador** (`talos+convite-coordinador@downshiftit.com`). Expected: Tablero
   renders and is **not empty**.
2. On the Tablero, confirm rows exist for **each** of `SIN_RUTA`, `SIN_EXISTENCIA`,
   `SIN_CAPACIDAD`, `LISTO`, `EN_CAMINO` (each colored by its own state).
3. Open **Verificación**. Expected: a non-empty queue (no "Nada esperando"). Confirm reports
   labelled with **each** channel: WhatsApp, SMS, missed-call, radio.
4. Find a **voice-note** report in the queue. Expected: a "transcrito"/transcribed indicator and
   a readable transcript; the original is preserved (correcting the transcript does not overwrite
   `texto_original`).
5. Open **Comunidades**. Expected: seeded communities listed, including at least one tier-4
   (silent / long check-in interval) community.
6. Open **Rutas**. Expected: existing routes shown (dashed schematic legs, each labelled with
   time + mode).
7. Open **Recogidas**. Expected: at least one pickup group and at least one center that **has a
   location** (no "Ningún centro tiene ubicación" for all).
8. Confirm at least one **dispatch/manifest** exists (4-digit code visible).
9. Open the public **`/respuesta`** page (no login). Expected: a non-empty aggregated response,
   municipality-level only (no community names, no coordinates, no phone numbers).
10. **Negative check:** open `https://convite.ai/respuesta` (production, public, read-only — do
    NOT log in or submit anything). Expected: **no** demo data (`[DATO DE PRUEBA]` absent).

**Pass = steps 1–9 all show populated, correctly-scoped demo data; step 10 confirms production
is clean.**
