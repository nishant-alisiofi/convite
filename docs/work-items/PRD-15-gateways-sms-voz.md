# PRD-15 — Live SMS + voice-callback gateways (D1/D2)

- **Type:** PRD
- **Tier:** 2 — Roadmap (from PRD v1.0)
- **Priority:** P1
- **Status:** Backlog
- **Source:** PRD v1.0 (four channels, live); PRD.md D1/D2 + M6/M10 (SMS driver + IVR built
  against simulators; real aggregator pending D2).

## Problem / why

SMS and voice-callback (IVR) are built and tested against **simulator drivers** (M6, M10) — no
real message has ever been sent or received. SMS is the channel that reaches tier 3–4 communities;
voice is the most robust under weak signal. Going live needs a real Colombian aggregator (D2:
Hablame / Masivian / Infobip for SMS; voice decided at M10) and the entity/number decisions
(D3-adjacent). This WI wires the live gateways behind the existing channel port.

> Related: **WhatsApp live-number verification** (M5, deferred to D3/D4) rides the same "go live"
> effort — the WhatsApp driver is built and tested against recorded Meta payloads; it needs the
> partner WABA + phone-number id + System User token + the 5 approved utility templates
> (`docs/plantillas-whatsapp.md`). Track it here or split into its own WI when D3/D4 land.

## Scope

**In:**
- A **live SMS gateway** driver behind `lib/canales/` (real aggregator per D2), one-segment SMS
  fallback, delivery telemetry feeding the M6 adaptive-link policy.
- A **live voice-callback (IVR)** path (missed-call → callback → single-level menu → recording →
  normalizer), with the M10 spend caps (2/30min, 5/day, global budget with 70% alert + shutoff)
  enforced against the real provider.
- Idempotency + signature/verification for real inbound, matching the contract the simulator tests
  already assert.
- Spend guardrails live (voice is the dominant cost line — see plan-de-ejecucion).

**Out:** the WhatsApp WABA go-live (tracked as a related item above — D3/D4); provider selection
itself (that is decision D2, which this WI consumes).

## Acceptance criteria

1. A real SMS sent to the service is received, normalized, and appears in Verificación tagged
   `canal = sms`; a one-segment SMS reply can be sent.
2. A real missed call triggers a callback, a single-level menu, a recording, and a normalized
   report tagged `canal = ivr`/llamada perdida.
3. The same contract tests that pass against the simulator pass against the live provider
   (idempotency, signature/verification).
4. Voice spend caps enforce: rate limits, global budget, 70% alert, and shutoff — verified without
   real overspend.

## Validation approach (future, on staging)

With the live aggregator configured on staging, send a real SMS and place a real missed call from
a test handset; confirm each lands normalized with the right channel tag, replies work, and the
spend caps trip correctly. Never validate on production. (Live traffic requires the entity/number/
provider decisions D2/D3.)
