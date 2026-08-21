# PRD-4 — Panel page audit: every page populated & correct (per-page acceptance)

- **Type:** PRD (audit / verification)
- **Tier:** 1 — Demo (this pass)
- **Priority:** P0
- **Status:** ✅ Built + deployed (staging + prod) — pending Codex validation
- **Source:** Jam A (Nishant clicked through every panel page and all were empty; asked that
  every page "works exactly as it should" once data is populated).
- **Depends on:** PRD-1 (seed), PRD-2 (map), PRD-3 (card visualization). This is the roll-up
  acceptance gate for the demo.

## Problem / why

Jam A is a page-by-page tour that found every operational page empty. This WI is the grouped
audit that confirms *each* page reaches its correct **populated** state after the seed and UI
work land. Each page below has a checkable expected state — the demo is "done" only when all of
them pass live on staging.

## Scope

**In:** a page-by-page walk of the coordinator/admin panel on staging, confirming each page's
populated state. **Out:** building any page (owned by PRD-1/2/3 and the shipped M4–M12 work);
this WI only verifies.

## Per-page acceptance criteria

Each row is a checkable expected state. Nav labels are from Jam A; likely routes in parentheses.

| Page (nav) | Expected populated state |
|---|---|
| **Tablero** (`/tablero`) | Non-empty; matcher output grouped by what's missing — rows in `SIN_RUTA`, `SIN_EXISTENCIA`, `SIN_CAPACIDAD`, `LISTO`, `EN_CAMINO`, each colored by its state; rows carry channel badges (PRD-3). |
| **Verificación** (`/verificacion`) | Non-empty queue (no "Nada esperando"); sorted urgency→age; at least one voice-note item with a "transcrito" indicator; channel badges present; all four channels represented. |
| **Mapa** (`/mapa`) | Real basemap (PRD-2); precision-aware community markers (circles/pins); center pins; exact request points; schematic route legs labelled time+mode. |
| **Rutas** (`/rutas`) | Existing routes listed (not an empty form); the river-route editor opens and works with data. |
| **Recogidas** (`/recogidas`) | At least one pickup group/cluster; at least one center **with a location** (no blanket "Ningún centro tiene ubicación"); BUG-7 resolved. |
| **Comunidades** (`/comunidades`) | Seeded communities listed, including at least one **tier-4 silent** community. |
| **Equipo** (`/equipo`) | Shows invited members for the org (no "no ha invitado a nadie"); admin sees the invite affordance. (RBAC 0034 already shipped.) |
| **Centros** (`/centros`) | Org (Alisio) shown Aprobado with members; **platform admin** sees pending centers with approve/reject. |
| **Ajustes** (`/ajustes`) | Season (`temporada`) setting visible and selectable; change is auditable (M8). |

## Role coverage

- **Coordinador** — Tablero, Verificación (its org), Mapa, Rutas, Recogidas, Comunidades.
- **Verificador** (TAG/MER/BET) — Verificación shows **only its communities**, not all.
- **Admin de centro** — Equipo (invite/manage own org), Centros (own org).
- **Admin de plataforma** — Centros (approve pending, see cross-org).
- **Lectura** — restricted; sees the read-only surface, no actions.

## Codex validation (run on staging.convite.ai)

> **Do not touch production.** Log in per `docs/validacion-codex-0a1.md`. Fetch magic links from
> the `talos` inbox or Resend as described there.

1. Log in as **coordinador** (`talos+convite-coordinador@downshiftit.com`). Walk **Tablero →
   Verificación → Mapa → Rutas → Recogidas → Comunidades** and confirm each matches its row in
   the table above. None should be empty or show a "nothing here" message.
2. Log in as **verificador** (`talos+convite-verificador@downshiftit.com`). Open **Verificación**
   and confirm it shows **only TAG/MER/BET communities**, not others (RLS boundary).
3. Log in as **admin de centro** (`talos+convite-admin@downshiftit.com`). Open **Equipo** (shows
   members / invite affordance for its org) and **Centros** (shows its org). Confirm it **cannot**
   act on another org's people or grant platform tier.
4. Log in as **admin de plataforma** (`talos+convite-plataforma@downshiftit.com`). Open
   **Centros**; confirm pending centers appear with **approve/reject** and cross-org visibility.
5. Open **Ajustes** and confirm the **season (temporada)** setting is present and selectable.
6. Log in as **lectura** (`talos+convite-lectura@downshiftit.com`). Confirm the restricted
   read-only surface (no coordinator actions).

**Pass = every page in the table reaches its expected populated state for the right role, and the
RLS/role boundaries (verificador scoped, admin-de-centro cannot cross orgs) hold.**
