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
