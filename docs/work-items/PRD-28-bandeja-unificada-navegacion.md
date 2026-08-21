# PRD-28 — Unified Bandeja + seven-section navigation (silence as a first-class item)

- **Type:** PRD
- **Tier:** 2 — Roadmap (PRD v3 Part IV)
- **Priority:** P1
- **Status:** 🟡 Partially built + deployed — the seven-section shell shipped (AC 1, 6, 7). **AC 2–5 are unmet**: the unified single queue, silence-as-item, tasks-as-items and phase-led ordering were all deferred, and the deferral was recorded only in a code comment (`app/(panel)/secciones.ts:24-27` and `:38-41`, «until the single queue exists» + «TODO (PRD-28 follow-up)»), never in this file. Phase is still not a stored concept anywhere in `db/schema`.
- **Source:** PRD v3 **§18** (navigation and the two inboxes) + **§19** (silence is not on the Tablero).
  Sequence: §33 step 3.

## Problem / why

The panel has **fourteen flat top-level items**, with Conexión, Apadrinar and Recogidas sitting as
peers of Ajustes. It will not survive jornadas and evaluaciones (PRD v3 §18). Worse, **Tablero and
Verificación are two inboxes** — a coordinator checks two places to know what needs them, and jornada
tasks plus allocation decisions will make it four. And **silence** — the only signal that fires when
*nobody* reports (§19) — lives in Comunidades where a coordinator working the board never sees it.

## Scope

**In:**
- Collapse fourteen flat items into the **seven sections** of PRD v3 §18, three levels deep, no fourth
  word:
  ```
  Bandeja                     ← everything awaiting a person (the one unified inbox)
  Mapa        · Evaluaciones · Rutas · Puntos de conexión
  Comunidades · Red · Silencio
  Agenda      · Programas · Jornadas · Citas · Envíos y recogidas · Capacidad ofrecida
  Existencias · Centros de acopio · Inventario · Ofertas · Catálogo
  Informes    · Cobertura · Entregas y evidencia · Apadrinamientos · Exportes
  Ajustes     · Equipo · Organizaciones · Estado
  ```
- **One unified Bandeja** that merges today's Tablero + Verificación queues into a single typed queue
  of everything awaiting a person: stuck-state rows, items to verify, jornada tasks, allocation
  decisions.
- **Silence as a first-class Bandeja item type (§19):** communities that have crossed their check-in
  interval, and never-seen communities, surface in the Bandeja — not only in Comunidades. Respect the
  §14 / BUG-24 distinctions (en silencio vs nunca vista; tier-1 vs tier-3/4).
- **Some Bandeja items are tasks, not matches** (PRD v3 §22) — "find a dentist" is a phone call; the
  Bandeja holds both matches and tasks.
- **Renames/moves:** `Centros` → **Organizaciones**, moved to Ajustes (it is the org approval queue,
  not collection centres); `Centros de acopio` under Existencias is the real thing. Rutas and Puntos
  de conexión nest under **Mapa** (you edit them by looking at them). Envíos y recogidas nest under
  **Agenda**. **Capacidad ofrecida sits in Agenda, not Existencias** (a lanchero going Thursday is a
  scheduled thing, not stock).
- **Phase changes what opens first, never the structure** (§18 table): Impacto → Bandeja leads with
  silence/unreachable, Mapa opens on contact recency; Emergencia → stuck states + matches, routes +
  stock; Recuperación → assessments/projects, assessment coverage; Ordinario → anticipatory proposals
  + scheduling, connection points + windows.
- **Role-scoped navigation** (§18 / §29.3): verificador sees Bandeja + Comunidades; despachador sees
  Bandeja, Mapa, Agenda, Existencias; coordinador sees all seven; org_admin adds Equipo; director sees
  Informes + read-only Mapa.

**Out:**
- The features the sections *point at* that don't exist yet (Evaluaciones §21 → PRD-29; Programas §21b
  → PRD-31; Jornadas §22 → PRD-30; Citas §27b.2 → FR-17). This WI builds the shell + the unified
  Bandeja + silence surfacing; empty sub-sections show a teaching empty state (§29b.5).
- Vocabulary tooltips and progressive-disclosure of screen intros — those are PRD-36 (§29b.6).

## Acceptance criteria

1. The top nav shows the **seven sections** of §18 with the specified nesting; the fourteen flat items
   are gone; `Centros` is renamed **Organizaciones** and lives under Ajustes.
2. A single **Bandeja** shows everything awaiting a person — verification items **and** stuck-state
   rows in one typed queue — so a coordinator no longer checks two inboxes.
3. **Silence appears in the Bandeja** as a first-class item type (interval-exceeded and never-seen),
   preserving the §14 / BUG-24 distinctions.
4. The Bandeja holds **tasks as well as matches** (a task item is representable and actionable).
5. **Phase** changes only what the Bandeja leads with and what the Mapa opens on — the seven-section
   structure is identical across all four phases.
6. Navigation is **role-scoped** per §18/§29.3; a verificador cannot see Agenda/Existencias, etc.
7. Load-bearing copy from Part II screens is carried through unchanged when a screen moves.

## Dependencies

- Interacts with **PRD-16** (roles/permissions drive role-scoped nav) — coordinate the role → section
  map.
- Feeds **PRD-36** (staged onboarding: Configurar/Operar/Revisar map onto this structure; empty states).
- The sub-sections are realised by **PRD-29** (Evaluaciones), **PRD-30** (Jornadas), **PRD-31**
  (Programas), **FR-17** (Citas).

## Validation approach (future, on staging)

As coordinador, confirm the seven-section nav and that Bandeja is one queue containing verification
items, stuck states, silence, and at least one task. Flip phase and confirm only the lead ordering
changes, not the structure. As verificador and despachador, confirm the nav is scoped to their
sections. Never validate on production.
