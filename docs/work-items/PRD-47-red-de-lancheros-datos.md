# PRD-47 — Red de lancheros para recolección y relevo de datos

- **Type:** PRD
- **Tier:** 2 — Roadmap
- **Priority:** P3
- **Status:** ✅ Built + deployed (staging + prod) — built on stated assumptions; **pending partner review** as well as Codex validation
- **Source:** Field feedback from Chocó (Doña Marta), relayed by Nishant 2026-08-17. "Boat
  operators act as a vital local communication network; they can be leveraged to collect field
  data and sync updates between disconnected river communities."

## Problem / why

Upriver communities may have **no channel at all** — no WhatsApp, no SMS, no signal for a
missed call. But a lanchero passes through them and later reaches a town with connectivity. The
lanchero is a **human sneakernet**: they can carry a report out of a dark community and submit it
when they surface. This extends Convite's "works offline" posture (PRD-10 connection points,
PRD-13 offline maps) to communities with zero live channel.

> **Assumptions (flag for Nishant/partner):** a lanchero is a trusted, registered relay — not an
> anonymous self-signup — because they submit on behalf of vulnerable communities. Attribution
> records both the **origin community** and the **relaying lanchero**. This mirrors the vetted
> stance of FR-18/transport. Confirm before pilot.

## Scope

**In:**
- A **lanchero relay** capability: a registered lanchero (contact + role) can submit/relay a
  report **attributed to an origin community** they serve, entering the same intake pipeline
  (`reportes`, `canal = 'relevo'` or similar) and verification queue as any other channel.
- The report records who relayed it and which community it is for, so a verifier sees the chain.
- Reuse connection-point / coverage concepts so a lanchero's route maps to the communities they
  can relay for.

**Out:** a dedicated lanchero mobile app, hardware, offline-first client sync (uses the existing
panel/channels); anonymous relay (relay is vetted).

## Acceptance criteria

1. A lanchero can be registered as a vetted relay tied to the communities on their route.
2. A lanchero can relay a report attributed to an origin community; it enters intake with a
   distinct channel tag and the relay + origin recorded.
3. A verifier sees the relay chain (who relayed, for which community); RLS + PII boundaries hold.

## Validation approach (staging)

On `staging.convite.ai`, register a lanchero relay, relay a report for an upriver community, and
confirm it appears in verification tagged as a relay with origin + relayer attribution.
