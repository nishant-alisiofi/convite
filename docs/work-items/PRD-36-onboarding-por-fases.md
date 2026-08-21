# PRD-36 — Staged onboarding by phase (Configurar / Operar / Revisar)

- **Type:** PRD
- **Tier:** 2 — Roadmap (PRD v3 Part IV)
- **Priority:** P2
- **Status:** ✅ Built + deployed — **two distinct pieces**: the derived setup checklist at `/configuracion-inicial` (original scope), and the pre-panel **declaration flow** at `/comenzar` (migration 0065, built 2026-08-21 — intent, tools, phase, rural reach; see the section at the end of this file). Phase is stored for the first time, which unblocks PRD-28's phase-led ordering. Nothing yet *routes* on the declaration.
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

## Onboarding declaration — built 2026-08-21 (migration 0065)

Founder feedback (Nishant, 2026-08-21): *"We need to make an onboarding flow before we reach our
home screen so that an organization can sign up and explain what they would like to do… We should
ask them what tools they use… This should match up with the phases that are important for a
disaster and also we should allow them to decide if they need to connect to rural areas or not."*

**What PRD-36 shipped was not this.** The built `/configuracion-inicial` is a *derived progress
checklist* — thirteen counts read from existing tables, two acknowledgement rows in
`configuracion`, reachable only as the fourth sub-item under Ajustes, blocking nothing, asking
nothing. Post-login has always landed on `/tablero` (`app/auth/callback/route.ts:86`). So the
declarative pre-panel flow is new *behaviour*, filed here rather than under a new ID because
PRD-36 already owns §29b onboarding and its five setup stages already mirror the four phases.

**Built:**
- `app/comenzar/page.tsx` — four questions, one screen, one submit. Outside `app/(panel)/` on
  purpose: the panel layout is what redirects here, so living inside it would loop, and the
  seven-section shell is precisely what this screen postpones. Server-rendered, zero client JS,
  matching `/entrar` and `/solicitar-centro`.
- `db/migrations/0065_declaracion_de_onboarding.sql` — `intenciones`, `herramientas`, `fase`,
  `alcance_rural`, `onboarding_completado_en` on `organizaciones`, with vocabulary check
  constraints and `convite_declarar_organizacion()` (admin-only, own org, audited).
- `lib/declaracion.ts` — `debeDeclarar` / `faltaDeclaracionAjena`, pure and tested
  (`tests/declaracion.test.ts`) because getting the rule wrong strands somebody outside the panel.
- Gate in `app/(panel)/layout.tsx`, ordered **after** `panelBloqueado`.

**Four exemptions, each of which would otherwise strand somebody:** platform admins (they
approve organisations; gating them locks the approval queue behind the thing it approves);
unapproved organisations (already sent to the awaiting-approval screen — and two gates racing
for one redirect is how loops start); `aportante` organisations (a self-registered transporter
has a one-person org and is in no "phase of the response"); and non-admins (the SQL function
refuses them, so gating them traps them in a form that rejects them — they get a note instead).

**Phase is now stored.** `organizaciones.fase` is §18's phase's first home in the database. It
existed only as a TypeScript union and a `?fase=` parameter nothing emitted — which is exactly
why PRD-28's phase-led Bandeja ordering was never buildable. `lib/mapa/planificacion.ts`'s `Fase`
now derives from `FASES_RESPUESTA` so the column and the type cannot drift. **Per organisation,
not global:** two organisations on the same river are routinely in different phases, and one
global value would force one of them to lie.

**Not built, deliberately:** nothing yet *reads* `intenciones` or `herramientas` to change the
panel. The declaration is recorded and audited; routing on it is the follow-up, and it belongs
with PRD-28's queue work (what the Bandeja leads with) and PRD-34's integration discovery.
