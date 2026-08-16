# PRD-14 — Self-hosted Whisper transcription (D8)

- **Type:** PRD
- **Tier:** 2 — Roadmap (from PRD v1.0)
- **Priority:** P1
- **Status:** Backlog
- **Source:** PRD v1.0; PRD.md D8 + `docs/decisiones-pendientes.md` ("Whisper auto-hospedado
  desde el día uno").

## Problem / why

Voice notes contain names, locations, and health details of vulnerable households in a
conflict-affected zone. Sending that audio to a third-party transcription provider means PII
leaves our infrastructure. The standing recommendation (D8) is **self-hosted Whisper** so audio
never leaves our control. The voice pipeline (M5/M7/M10) is built and tested against recorded
payloads; this WI wires the real transcription engine behind it.

## Scope

**In:**
- A **self-hosted Whisper** transcription service the voice pipeline calls (WhatsApp voice notes,
  IVR recordings, radio audio — PRD-11).
- Transcript written as **correctable but original-preserving** (`texto_original` never
  overwritten — M4/M7 invariant already enforced).
- Runs within our infrastructure (pilot volume runs on CPU per D8); no audio egress to third
  parties.
- Slots into the existing pipeline behind the same interface the recorded-payload tests use.

**Out (v1):** speaker diarization; translation; live streaming transcription.

## Acceptance criteria

1. A voice note / IVR recording / radio clip is transcribed by the self-hosted engine, with **no
   audio sent to any third party**.
2. The transcript is correctable and the original is preserved (existing invariant holds).
3. The transcribed report shows a "transcrito" indicator (PRD-3) and flows through verification →
   matcher normally.
4. Transcription latency/throughput at pilot volume is acceptable on the chosen hardware.

## Validation approach (future, on staging)

Submit a voice note through the pipeline; confirm it is transcribed with no outbound call to an
external transcription API (network egress check), the original is preserved, and it appears in
Verificación with the transcript. Confirm the data-processor list / privacy policy no longer names
an external transcription vendor. Never validate on production.
