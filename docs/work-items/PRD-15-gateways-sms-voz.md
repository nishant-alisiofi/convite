# PRD-15 — Live SMS + voice-callback gateways (D1/D2)

- **Type:** PRD
- **Tier:** 2 — Roadmap (from PRD v1.0)
- **Priority:** P1
- **Status:** In progress — Infobip adapter build (2026-08-18); live test pending the Infobip
  account + Colombian voice number (Nishant provisioning)
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

---

## PRD v3 update (2026-08-15) — §4.1 + §20: provider decision, missed-call callback, adaptive layer

PRD v3 makes the provider and callback decisions this WI left open, and elevates the missed-call
callback to **non-negotiable, in-pilot, not deferred** (§4.1: "without it, Convite is a WhatsApp
bot"). Fold the following into scope/acceptance.

**Provider (§4.1.6):** **Voice + SMS → Infobip**, **WhatsApp → Meta Cloud API direct** under the
partner's own WABA with us as Tech Provider.
- Infobip because **early media is supported** (an announcement audible *during ringing, before answer
  supervision*, so the caller hears «lo llamamos ya» and is **never billed** — Twilio's `<Reject>`
  cannot do this) and **missed-call handling is a named setting**. Recordings/dialogs/media streaming
  must be **activated by an account manager** (raise with early media + Colombian termination rates).
- WhatsApp direct because the data-protection story rests on the partner being **responsable del
  tratamiento** and us **encargado** (§23); a BSP inserts a third party and a per-message margin
  (matters once service messages bill from **1 Oct 2026**). **Numbers cannot be consolidated** — a
  WhatsApp-registered number can't be used for voice/SMS, so they are separate numbers regardless.

**Missed-call callback (§4.1.1–4.1.4):** respond to the inbound leg with **busy before answer
supervision** → the call never completes → the caller is never charged. **Copy: «solo marque», never
«marque y cuelgue»** (see BUG-26). This is the ZipDial pattern; **the system disconnects, not the
caller.** It is **outbound-initiated recording**, not voicemail. Callback = **one short prompt then
record**, **at most one menu level** (zero is acceptable), **prompts recorded in a local voice, not
TTS**, folio read back **digit by digit**; the registration number is **never behind an IVR**.

**Spend caps *before* the first live call (§4.1.5):** **2 callbacks/number/30 min · 5/day · a global
daily minute ceiling with automatic shutoff · coordinator alert at 70%.** Enforce the ceiling as a
**platform backstop** underneath our own per-number caps (on Infobip's equivalent of Twilio Usage
Triggers) so a bug in our queue cannot run an unbounded bill.

**Recording pipeline (§4.1.7):** `CALL_RECEIVED → reject before answer` → callback → prompt → record →
recording event → `GET` bytestream (not a URL) → store + key → **`DELETE` from provider** → **self-
hosted Whisper (PRD-14)** → normalizer → `RECIBIDO` → verification queue. Provider-side transcription
**off**. (See PRD-14 for the two non-relaxable rules.)

**Adaptive link quality (§20 + §4.1.2):** a **per-contact profile** from delivery callbacks, media
success rate, receipt lag and hour-of-day, driving **two policy functions — what to invite, and how to
reply**. **The confirmation channel need not be the intake channel.** Reply routing: SMS-history/reads
→ **SMS reply** (fractions of a cent); no literacy or no SMS reply → **voice callback** (expensive, the
reason the channel exists); unknown/first contact → **SMS first, callback if no reply within a window**.
This cuts the voice bill while keeping the guarantee for those who need voice.

**Discretion in outbound (§20):** the **default confirmation carries the folio and nothing else** — no
condition, no cita type on a screen someone else may see.

**"Verify what is real" (§20) — a pre-pilot acceptance gate:** channel tags (`SMS`, `llamada perdida`,
`radio`) appear on **seeded** records; before the pilot, **confirm which are actually wired end to
end.** Steps 5–8 of the sequence (§32) are the ingestion core and **ship together** — a deployment
with only WhatsApp reaches tier 1 and stops. Add an explicit **channel-reality checklist** as a gate:
each claimed channel is either genuinely wired or clearly marked seed-only.

**Also add:** **SMS long code** from an aggregator (most robust under weak signal; the adaptive layer
depends on it) and **AMD on the outbound leg**.

**Pilot prerequisites (§32), dependency-ordered:** Meta business-portfolio verification (**longest
pole**; unverified caps at 250 unique contacts/24h) · **a new SIM, never an existing staff line**
(registration deletes the existing profile; no trial) · utility templates submitted · **a Colombian
voice number + regulatory bundle from Infobip** with recordings + early media activated by their
account team (started in parallel with the Meta trámite).

Cross-ref **PRD-14** (Whisper in the pipeline), **PRD-11** (radio audio through the same pipeline),
**PRD-10** (connection-point origin informs reply routing), **FR-17** (§27b.2 reachability window
reuses the learned activity profile).
