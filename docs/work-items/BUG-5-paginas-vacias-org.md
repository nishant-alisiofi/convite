# BUG-5 — Panel pages empty for the logged-in org despite an approved center + members

- **Type:** BUG
- **Tier:** 1 — Demo (this pass)
- **Priority:** P0
- **Status:** Open
- **Source:** Jam A.
- **Fixed by:** PRD-1 (multi-channel demo seed scoped to the demo org).

## Reproduction (from Jam A)

Logged into the panel on staging as a member of the Alisio org, Nishant clicked through the
panel. **Centros** correctly showed `Alisio · Aprobado · 3 miembros` — so the org exists, is
approved, and has members. But every operational page was empty:

- **Tablero** — empty.
- **Verificación** — "Nada esperando".
- **Mapa** — blank (see BUG-6).
- **Rutas** — empty form.
- **Recogidas** — "Ningún centro tiene ubicación" (see BUG-7).
- **Comunidades** — empty.
- **Equipo** — "no ha invitado a nadie".

An approved org with 3 members and zero operational data anywhere is the symptom.

## Why it matters

The whole point of the demo (Jam A + Jam B) is to show the system working for a real
organisation. An org that is approved but shows an empty system everywhere reads as "the product
does nothing." This is the #1 blocker for showing organisations the value of Convite.

## Root cause (hypothesis)

Staging has no operational demo data **scoped to the demo login org**. The M4–M12 pipeline is
built and there is seed data in the repo, but it is not associated with the org the test accounts
belong to (or the seed did not run the matcher, so post-matcher surfaces read empty — cf. the
`778c5fe` public-page fix). PRD-1 addresses this by seeding multi-channel demo data scoped to the
demo org and running a matcher pass.

## Scope

**In:** confirm that, once PRD-1's seed lands, the logged-in org's operational pages are
populated. **Out:** the seed build itself (PRD-1); the map (BUG-6/PRD-2); center location
(BUG-7).

## Acceptance criteria

1. Logged in as a member of the demo org, **Tablero, Verificación, Rutas, Comunidades, Equipo**
   are all non-empty and scoped to that org.
2. The data shown belongs to the **logged-in org** (RLS boundary intact — another org's data is
   not visible).
3. No page that should have data shows an empty-state message once the seed is loaded.

## Codex validation (run on staging.convite.ai)

> **Do not touch production.** Log in per `docs/validacion-codex-0a1.md`.

1. Log in as **coordinador** (`talos+convite-coordinador@downshiftit.com`).
2. Open **Centros** — confirm the org shows Aprobado with members (baseline unchanged).
3. Open, in turn, **Tablero, Verificación, Rutas, Comunidades, Equipo**. Expected: **each is
   non-empty** (no "Nada esperando", no "no ha invitado a nadie", no empty form).
4. Log in as **verificador** (`talos+convite-verificador@downshiftit.com`). Confirm the data is
   scoped — Verificación shows only TAG/MER/BET communities, proving the populated data respects
   the org/community RLS boundary.
5. **Before/after evidence:** capture the empty state (repro, if a pre-seed environment is
   available) and the populated state after PRD-1.

**Pass = every operational page for the logged-in org is populated and correctly scoped.**
(Mapa and Recogidas-location are covered by BUG-6 and BUG-7 respectively.)
