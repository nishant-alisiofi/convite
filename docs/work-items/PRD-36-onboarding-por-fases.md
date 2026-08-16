# PRD-36 — Staged onboarding by phase (Configurar / Operar / Revisar)

- **Type:** PRD
- **Tier:** 2 — Roadmap (PRD v3 Part IV)
- **Priority:** P2
- **Status:** Backlog
- **Source:** PRD v3 **§29b** (onboarding, staged by phase, not one long form).

## Problem / why

Setup today is not staged. **A deployment responding to a fresh disaster needs communities and a phone
number, and nothing else** (PRD v3 §29b.2) — do not present twelve steps when four will do. And empty
screens shown to someone who has registered nothing are noise, not onboarding.

## Scope

**In:**
- **Three contexts, not one menu (§29b.1):** **Configurar** (a dependency-ordered checklist, not a
  menu; collapses to a link in Ajustes once complete, still reachable) · **Operar** (the seven
  sections, appearing once configuration is far enough along) · **Revisar** (Informes; different
  rhythm, usually a different person). Maps onto the §18 navigation (PRD-28).
- **Setup staged by phase (§29b.2), mirroring §3:**
  | Stage | Unlocks | Needs |
  |---|---|---|
  | **0 · Entrada manual** | Operate with no channel at all | Data agreement signed · communities attached from the shared registry · a coordinator typing in what they already receive (`canal = 'manual'`) |
  | **1 · Alcance** | Receive reports directly | One intake number, once Meta verification clears |
  | **2 · Emparejamiento** | The matcher proposes | Catalogue · centres **with locations** · routes (river ones by hand) · inventory |
  | **3 · Recuperación** | Assessments and rebuilding | Assessment templates · materials catalogue · sponsorship |
  | **4 · Ordinario** | Programas and citas | Connection-point availability windows · service providers · cadences |
  **Stage 1 is an hour's work and is genuinely useful alone** — a registered, reachable community
  accumulates requests and triggers silence alerts with no catalogue configured.
- **Every incomplete step says what it blocks (§29b.3)** — the *consequence*, not «Rutas: pendiente»:
  > «6 comunidades no tienen ningún tramo escrito. El emparejador no puede proponer nada para ellas —
  > aparecen como incomunicadas aunque no lo estén.»
  > «Acopio Yuto no tiene ubicación. Sin ella, Recogidas no tiene desde dónde medir la vuelta.»
  > «Falta el número de voz para la llamada perdida. Sin él, quien no tiene saldo no puede reportar.»
  The product already does this in place (§7); the checklist collects those warnings in one screen.
- **Role defaults by description, not by matrix (§29b.4):** present roles as sentences and ask for
  confirmation — «Un verificador ve la bandeja de sus comunidades y nada más. ¿Está bien?» A checkbox
  grid gets default-everything; three sentences get a real answer (and those defaults protect
  household addresses later).
- **Empty states teach (§29b.5):** each empty screen names what is missing and links to the step that
  fixes it — an empty Mapa says «no hay comunidades registradas — empiece aquí», not «sin datos».

**Out / what NOT to build (§29b.6):**
- **No guided tour with numbered overlay bubbles** — learning happens by doing/repeating/correcting.
- **Progressive disclosure for screen intros:** the top-of-screen explanatory paragraphs are good
  teaching *and* a permanent vertical-space tax — expanded for the first few visits, then collapsed to
  one line with an info icon.
- **Tooltips on vocabulary only** — `tier 3`, `centroide · ±1000 m`, `segunda mano`, `desactualizado`,
  `transcrito 58%`, `pide detalle` (one sentence each), plus the one real gap: **`Solo verificar` vs
  `Verificar y crear pedido`** — nothing currently explains when to choose the first.

## Acceptance criteria

1. **Configurar** is a dependency-ordered checklist (not a menu) that collapses to an Ajustes link when
   complete and stays reachable; **Operar** appears only once configuration is far enough along;
   **Revisar** is Informes.
2. Setup presents the **five phase stages**; a fresh deployment can reach useful operation at **stage 1
   (communities + one number)** without configuring later stages.
3. Every incomplete step states its **consequence** (blocked capability), not a bare "pendiente".
4. Roles are confirmed **as sentences**, and the confirmed answers set the defaults.
5. Every empty screen **names what is missing and links to the fixing step**.
6. There is **no numbered-overlay tour**; screen intros use **progressive disclosure**; **vocabulary
   tooltips** exist, including a `Solo verificar` vs `Verificar y crear pedido` explainer.

## Dependencies

- **Stage 0 (manual entry) + shared registry** come from **PRD-35** (§29.3b).
- **Roles / role sentences** come from **PRD-16** (§29.2–29.3). **Nav contexts** map to **PRD-28** (§18).
- Stage 2–4 checklist items reference Catálogo/Rutas/Centros (built), **PRD-29** (assessment templates),
  **FR-17** (service providers/citas), **PRD-15** (intake number).

## Validation approach (future, on staging)

Walk a fresh org through Configurar; confirm it can reach useful operation at stage 1 with only
communities + a number; leave a step incomplete and confirm the checklist states the consequence;
confirm role confirmation is sentence-based; confirm empty screens teach and that no numbered tour
exists. Never validate on production.
