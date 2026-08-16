# PRD-35 — Organisation admission tiers, vouching, shared community gazetteer, manual-entry channel

- **Type:** PRD
- **Tier:** 2 — Roadmap (PRD v3 Part IV)
- **Priority:** P1 — gates onboarding stage 0 and the day-one manual-entry channel
- **Status:** Backlog
- **Source:** PRD v3 **§29.3b** (how an organisation gets in; shared gazetteer; manual-entry zeroth
  channel; aggregate read layer). Related: §29.1 (governing principle), §23 Ley 1581.

## Problem / why

`Centros` has an approval queue; **nothing else in §29.3b exists yet.** There is **no self-serve
signup for an organisation that collects community data** — for three reasons, the first decisive:
**Ley 1581 does not do self-serve** (someone must be the *responsable del tratamiento*); a WABA
**cannot be self-provisioned** (contract, not a form); and **trust does not transfer** (communities
answer because the Diócesis vouches for Convite — one bad actor's behaviour attaches to the whole
network). The answer is not to slow everything down; it is to **split admission by whether the
organisation touches community data** (§29.3b).

## Scope

**In:**
- **Four organisation tiers (§29.3b):**
  | Tier | Who | Speed |
  |---|---|---|
  | **Ancla** | Operates a channel, collects reports | Weeks — contract, data agreement, WABA (responsable del tratamiento) |
  | **Avalada** | Invited by an anchor, operates under its agreement | Minutes — accountability inherited; ceiling never above the voucher's |
  | **Aportante** | Offers goods/capacity/funding only, **touches no community data** | Near-immediate |
  | **Observadora** | Reads the aggregate layer | Immediate (already public) |
- **Vouching chains are the fast path (§29.3b).** An anchor vouches for an org; the vouched org
  **inherits a ceiling no higher** than the voucher's; the vouch is **recorded**; **revoking a vouch
  suspends the vouched organisation**. (`organizaciones.aval_motivo` records the vouch — schema from
  PRD-37.)
- **Manual entry is the zeroth channel (§29.3b).** Stage-0 setup (PRD-36) must work **with no channel
  at all**: once the data agreement is signed, a coordinator registers communities and types in reports
  they already receive. Every such record carries **`canal = 'manual'`** with the person who entered
  it; channels attach later as verification clears, and nothing already entered changes.
- **A shared community gazetteer (§29.3b).** Communities are a **common registry**: organisations
  **attach to** existing communities and **propose** new ones, matched by **name + proximity** before
  creation; proposals surface to an admin and to anyone operating nearby. **Location, tier, agrupador,
  check-in interval are shared**; requests, inventory, contacts and assessments belong to the org that
  holds them.
- **Aggregate coordination read layer for every tier from the start (§29.3b).** Municipality-level
  counts, which communities already have someone working in them, which routes are reported closed —
  the same data `/respuesta` publishes, extended. **Coordination value at zero privacy cost**; it
  prevents two orgs both sending mercados to Bellavista while nobody goes to Winandó. Community-level
  detail from another org is **negotiated bilaterally, never default** — granted, recorded, revocable;
  Convite does not broker it.

**Out:**
- The **per-user permission engine** (roles, capability ceiling enforcement, membership, offboarding,
  separation of duties) — **PRD-16** (§29.4–29.7). This WI sets the ceiling *at approval/vouch time*;
  PRD-16 enforces it.
- The staged setup checklist UI — **PRD-36** (§29b).
- Live channel provisioning (WABA/SMS/voice) — **PRD-15** (§4.1/§20); this WI only records tier + aval.

## Acceptance criteria

1. An organisation is admitted under one of the four tiers with the stated speed; **aportante** and
   **observadora** are near-immediate/immediate and **hold no community data**.
2. A **vouch** from an anchor admits an avalada org in minutes, records `aval_motivo`, **caps its
   ceiling ≤ the voucher's**, and **suspends the vouched org when the vouch is revoked**.
3. Records can be created with **`canal = 'manual'`** by an identified coordinator before any channel
   exists; later channel attachment leaves existing records unchanged.
4. Communities are a **shared registry**: an org **attaches** to an existing community; a proposed new
   community is **matched by name + proximity** and surfaced to an admin/nearby orgs before creation;
   shared fields (location, tier, agrupador, interval) are common while requests/inventory/contacts/
   assessments stay org-scoped.
5. Every tier reads the **aggregate coordination layer**; another org's community-level detail is
   never visible by default and only via a recorded, revocable bilateral grant.

## Dependencies

- **Schema:** `organizaciones.aval_motivo` (+ `techo_permisos`) and the shared-registry columns come
  from **PRD-37**. **The territory seed (PRD-38)** sets `aval_motivo` on the two partner orgs.
- **Pairs with PRD-16** (ceiling enforcement) and **PRD-36** (stage-0 onboarding uses manual entry).
- **Extends** `/respuesta` (§17) for the aggregate layer. **Resolves** FR-18 (aportante is the open
  supply-side tier).
- Open question §34: **who holds `org_admin`** inside each partner, realistically.

## Validation approach (future, on staging)

Admit an aportante org and confirm it can offer supply but sees no community data; vouch for an
avalada org and confirm its ceiling ≤ the anchor's, then revoke and confirm suspension; enter a
`canal = 'manual'` report before any channel; propose a duplicate community and confirm name/proximity
matching flags it; confirm the aggregate layer is visible to all tiers and bilateral detail is not.
Never validate on production.
