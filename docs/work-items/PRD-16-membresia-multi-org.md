# PRD-16 — Multi-org membership (join-table)

- **Type:** PRD
- **Tier:** 2 — Roadmap (from PRD v1.0)
- **Priority:** P2
- **Status:** Backlog
- **Source:** PRD v1.0 (multi-org membership via a join table — a user can belong to more than one
  organisation).

## Problem / why

Today the schema scopes by a single `organizacion_id` and a user belongs to one org (RLS derives
from a single-org design, migration 0017). The vision needs a user to belong to **multiple**
organisations — e.g. an Alisio staffer who also operates a center, or a coordinator serving two
partner orgs. That requires a **membership join table** (`user × organizacion × role`) and RLS/
policy that resolves the caller's org context per request. `docs/validacion-codex-0a1.md` already
flags that inherited cross-org *reads* from the single-org design are a known gap — this WI is the
structural fix.

## Scope

**In:**
- A **membership join table**: (user, organizacion, role[, scope]) — replacing the implicit
  single-org attachment.
- RLS + `conSesion` updated to resolve the **active org context** per request (the user picks/holds
  an active org; policies scope to it).
- An **org switcher** in the panel for multi-org users.
- Migration that preserves existing single-org users (each becomes one membership row).
- Preserves the RBAC 0034 hierarchy (platform admin cross-org; center admin within org;
  anti-escalation guard).

**Out (v1):** cross-org data *sharing* (a request visible to two orgs at once) — membership is
about a person in many orgs, not data in many orgs.

## Acceptance criteria

1. A user can hold membership (with a role) in **two+ organisations**; each membership is a row.
2. The panel offers an **org switcher**; the active org scopes all data/actions via RLS.
3. Switching org changes the visible data set correctly, and no membership leaks another org's
   data outside the active context.
4. Existing single-org users are migrated to exactly one membership row with no access change.
5. The RBAC 0034 invariants still hold (no privilege escalation; center admin bounded to own org).

## Validation approach (future, on staging)

Give a test user membership in two orgs; confirm the org switcher appears, that data/actions scope
to the active org, and that switching flips the data set without leakage. Confirm a single-org user
is unaffected. Re-run the RLS harness. Never validate on production.

---

## PRD v3 update (2026-08-15) — §29 makes this the whole permission engine

PRD v3 **§29** expands this WI well past a multi-org join table: it is now **the roles + capability
ceiling + membership + offboarding + separation-of-duties engine.** (Org *admission*/vouching/gazetteer
is a separate WI, **PRD-35** §29.3b; the `techo_permisos`/`membresias` **schema** is delivered by
**PRD-37**; this WI builds the enforcement logic.)

**§29.1 governing principle:** *friction scales with what you can see and what you can move, never with
what you contribute.* Reporting/offering is always free and account-less; taking something out, seeing
an address/phone, or committing resources for others requires identity.

**§29.2 three participant tiers:** **no account** (reportante — the channel is the authentication; do
**not** build OTP/passwords for reporters/donors/volunteers) · **one-use link, one screen**
(transportista/donante/voluntario — the screen is the assignment, the URL is the access control,
expires on completion) · **login via magic link** (everyone else; phone OTP only as a field fallback).

**§29.3 the roles** (13): reportante, donante, voluntario, `transportista_abierto` (**public
collection points only — never household addresses**), `transportista_avalado` (exact addresses for
stops on their **own active run, time-boxed**), evaluador, proveedor_servicio, verificador, despachador,
coordinador, org_admin, director, admin. Each with the "sees" scope in §29.3.

**§29.4 capability ceiling per organisation** (`techo_permisos` jsonb, set by the approving body at
approval time — column from PRD-37, vouch/tier from PRD-35): `comunidades_alcance` (uuid[] | 'todas'),
`direcciones_hogar`, `inventario_nodo`, `despacho`, `agendamiento`, `evaluacion`, `puede_delegar`. **The
org administers freely below the ceiling** — an `org_admin` invites/assigns/suspends/removes their own
staff with **no Convite approval for individual employees** (do not build a people-approval queue).
**Delegation cannot escalate — enforced in row-level security, not the UI:** may grant only within the
org's ceiling; never across orgs; never `org_admin` unless `puede_delegar`; any attempt beyond the
ceiling **fails at the database and is logged**. The line: *the organisation vouches for identity; the
approving body sets scope.*

**§29.5 membership, not a single org field:** `membresias(id, usuario_id, organizacion_id, rol,
comunidades_alcance uuid[], otorgado_por, otorgado_en, vence_en, estado, motivo_baja)`, `UNIQUE
(usuario_id, organizacion_id, rol)`. **`usuarios.organizacion_id` must NOT exist.** Effective
permissions = **union of active memberships, each clipped to its org's ceiling, computed per request and
NEVER cached** (a cached permission set goes stale about exactly the thing that matters). This
supersedes this WI's original "active org context" framing — it is a **union**, clipped per org, not a
single switchable context (an org switcher may still scope the *view*, but permissions are the union).

**§29.6 offboarding is first-class:** suspension/termination **revoke on the next request**;
**termination cancels active run assignments** and reassigns/unassigns their stops (never leave a
shipment holding a dead reference — couples to PRD-13 offline bundles); **calendar-feed URLs revoked**
with the membership (PRD-34 §28.1); **dormancy auto-suspend** — any membership with address-level access
and no activity for **45 days** auto-suspends (one-click reinstate; the default drifts closed); every
grant/suspension/termination writes to **`auditoria`** (actor, target, capability, reason).

**§29.7 separation of duties:** `verificador` cannot dispatch; `despachador` cannot verify. Deliberate;
must survive convenience arguments.

**Updated acceptance (add to the five above):**
6. Effective permissions are the **union of active memberships clipped to each org's ceiling**, computed
   per request and never cached; `usuarios.organizacion_id` does not exist.
7. Capability ceiling is enforced **in RLS**: no grant exceeds the org's `techo_permisos`, crosses orgs,
   or grants `org_admin` without `puede_delegar`; violations fail at the DB and are logged to `auditoria`.
8. **Offboarding** works: suspension/termination revoke next request, termination cancels active runs +
   revokes calendar feeds, 45-day dormancy auto-suspends address-level memberships, all logged.
9. **Separation of duties** holds: verificador cannot dispatch, despachador cannot verify.

Cross-ref **PRD-37** (schema), **PRD-35** (tier/vouch sets the ceiling), **PRD-34** (feed revocation),
**PRD-13** (run cancellation), **PRD-28** (role-scoped nav).

---

## PRD v4 update (2026-08-19) — Supplement §3: new role `verificador_vulnerable`

**New role, added to the §29.3 roles table.** v4 §3 requires a role-gated inbox for GBV/sensitive-
disclosure reports, distinct from the standard `verificador`: only explicitly **vouched**
`verificador_vulnerable` accounts, within their organisation's ceiling, may see un-redacted audio,
transcript, or address on a report flagged sensitive. Every other role — including standard
`verificador` and `despachador` — sees the redacted view (PII and disclosure text stripped).

**Add to the §29.3 roles table:**

| Role | Account | Sees |
|---|---|---|
| `verificador_vulnerable` | Login, vouched | Un-redacted audio/transcript/address for reports flagged sensitive, within their org's ceiling — nothing else beyond standard `verificador` scope |

**Separation of duties still applies (§29.7, unchanged):** `verificador_vulnerable` cannot dispatch.

The full redaction pipeline, the escalation trigger, and this role's behavioural spec are **PRD-49**
(new). This WI's addition is scoped narrowly: **the role itself belongs in the roles table and inherits
the standard ceiling/membership/offboarding mechanics already built here** — no new permission
*mechanism*, just a new *role value* with a narrower default "sees" scope than `verificador`. Schema:
the ceiling flag that gates it is added by **PRD-37**.
