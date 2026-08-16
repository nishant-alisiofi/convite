# FR-18 — Transporter self-signup flow (decision pending)

- **Type:** FR (open request — decision pending)
- **Tier:** 2 — Roadmap
- **Priority:** P3
- **Status:** Decision pending
- **Source:** Jam B — Nishant raised "a transporter self-signup question" and **explicitly flagged
  it as undecided**.

## Problem / why

Today a transporter is a **vetted** contact: a center invites/approves them, they authenticate
lightly (WhatsApp OTP + GPS), and they see delivery details **only during their time window**
(`convite_conduce_hacia`, built and tested — see `docs/tipos-de-usuario-y-accesos.md` §2.3). Jam B
asks whether transporters should be able to **self-sign-up** instead of being invited. This is a
genuine trade-off, not a build task, so it is filed as an FR with the decision surfaced — do not
build until the founder/partner decides.

## The decision

**Should transporters self-sign-up, or stay invite-only?**

- **Invite-only (current design).** A transporter handles real aid and sees where vulnerable
  families live during their window. In a zone with armed-actor presence, letting a stranger
  self-register into that role is a security risk. This is why the RBAC blueprint puts
  "entregar / operar un centro" on the **vetted** side.
- **Self-signup (the Jam B question).** Faster to scale supply of transporters; lowers friction
  for legitimate drivers in a thin market. Would need a **vetting gate before activation** (apply →
  center/platform approves → active), so it is really "self-*apply*, then approved," not open
  self-service.

**Recommendation (confidence: medium, grounded in the RBAC threat model in
`docs/tipos-de-usuario-y-accesos.md` §4 and the conflict-zone privacy posture):** keep transport
**approval-gated**. If friction is the concern, add a **self-apply** entry point that still routes
to center/platform approval before any window/PII access — never open self-service into the role.
The founder/partner decides.

## If approved (self-apply → approval), provisional scope

**In:** a public "puedo transportar" apply form (name, number, coverage area, vehicle/seats);
creates a **pending** transporter; a center/platform approves before any activation; no delivery
detail / PII visible until approved and inside a window. **Out:** open self-service with immediate
access (rejected by the threat model).

## Acceptance criteria (provisional, if built)

1. A public apply form creates a **pending** transporter with no data access.
2. A pending transporter **cannot** see any delivery detail, coordinate, or PII until approved.
3. Approval is a logged human decision by a center/platform admin.
4. Once approved, the existing time-window + GPS + RLS rules apply unchanged.

## Next step

Founder/partner decides invite-only vs self-apply. Record the decision, then either close this FR
(wont-fix / invite-only stands) or promote to a PRD.

---

## PRD v3 update (2026-08-15) — §29.2–29.3 + §29.3b largely resolve the decision

PRD v3's participant model answers the trade-off this FR raised, and it lands where the recommendation
above did — **not open self-service into any role that sees household addresses.**

**Participant tiers (§29.2–29.3):**
- **`transportista_abierto`** (one-use link): sees **public collection points only — never household
  addresses.** This is the low-friction, low-risk transporter.
- **`transportista_avalado`** (vetted, under an org's aval): sees **exact addresses for stops on their
  own active run, time-boxed** — the household-address time window this FR describes
  (`convite_conduce_hacia`).

**Organisation admission tiers (§29.3b, built in PRD-35):** the genuinely open, near-immediate tier is
**`aportante`** — a party that **offers goods, capacity or funding and touches no community data**
(§29.1: friction never scales with what you *contribute*). A trucking company offering seats self-
applies fast **as capacity**; it does **not** thereby get address-level access. Address access still
requires a vouch/aval.

**So the decision is:** a transporter **offering capacity** = near-immediate (aportante-shaped, no PII);
a transporter **seeing household addresses on a run** = **vetted/avalado**, under an org's aval and
ceiling (§29.4), time-boxed, and revoked on offboarding (§29.6). "Self-apply, then approved" maps
exactly to aportante-in / avalado-for-address-access. This is the same answer the humanitarian cluster
gives (§29.3b): you get in fast if someone inside vouches; if nobody will, that is information.

**Status:** the design decision is effectively made by v3; what remains open is the **partner/founder
confirmation** of who holds `org_admin` and issues avales inside each partner (§34 open question). Keep
this as an FR pending that confirmation; the build itself is covered by **PRD-35** (admission/aval) and
**PRD-16** (transporter roles + ceiling + offboarding) — do not file a separate self-signup PRD.
Cross-ref PRD-35, PRD-16.
