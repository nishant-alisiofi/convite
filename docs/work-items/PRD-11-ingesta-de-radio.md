# PRD-11 — Real radio ingestion (fourth channel)

- **Type:** PRD
- **Tier:** 2 — Roadmap (from PRD v1.0)
- **Priority:** P2
- **Status:** Backlog
- **Source:** PRD v1.0 (four channels: SMS / voice-callback / WhatsApp / **radio**); Jam B
  (data arriving "from all four channels ... radio").

## Problem / why

In the deepest-signal communities, community radio is how information moves. The vision includes
**radio** as a real inbound channel: reports read/relayed over community radio (or an operator
logging what came in by radio) enter the same normalizer → verification → matcher pipeline as any
other channel, tagged `canal = radio`. In Tier 1 (PRD-1/PRD-3) radio appears as **seeded** data
with a badge; this WI makes it a **real** ingestion path.

## Scope

**In:**
- A **radio intake** path: an operator (or a station partner) logs a report heard on radio —
  free-text or an audio clip — which flows through the M4 normalizer (and M7 verification) exactly
  like WhatsApp/SMS/IVR, tagged `canal = radio`.
- Audio clips get the same voice pipeline (transcription — self-hosted Whisper, PRD-14), EXIF/
  metadata handling, and immutable original.
- Optional: an **outbound** radio digest (what to announce back over the air), aligned with the M6
  reply-channel policy where the reply channel need not be the intake channel.

**Out (v1):** automated radio audio capture / speech-to-text off a live broadcast; station
hardware integration.

## Acceptance criteria

1. A radio-sourced report can be entered (text or audio) and flows through normalize → verify →
   matcher, tagged `canal = radio`.
2. Radio audio is transcribed (PRD-14), original preserved, and shown with a "transcrito"
   indicator (PRD-3).
3. Radio reports are indistinguishable downstream from other channels except by their source
   badge (same pipeline, same states).

## Validation approach (future, on staging)

As an operator, log a radio report (text and audio); confirm it appears in Verificación with a
`radio` badge, the audio is transcribed with the original preserved, and it promotes to a pedido
and lands on the Tablero like any other channel. Never validate on production.
