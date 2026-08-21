# PRD-14 — Self-hosted Whisper transcription (D8)

- **Type:** PRD
- **Tier:** 2 — Roadmap (from PRD v1.0)
- **Priority:** P1
- **Status:** ⛔ **Not started** — the only PRD with no implementation. `lib/canales/transcripcion.ts` is a deliberate no-op port (`transcripcionPendiente.transcribir()` returns `null`); the call site (`lib/canales/trabajos.ts:93`) and the audio inbox that catches untranscribed notes already exist. Blocked on **decision D8** (may household audio leave our infrastructure?), which is a protection question, not a procurement one. v4 adds a prerequisite: noise suppression ahead of Whisper (§6.2).
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

---

## PRD v3 update (2026-08-15) — §4.1.7 recording pipeline: two non-relaxable rules

PRD v3 **§4.1.7** places Whisper inside the voice recording pipeline and adds **two rules that must not
be relaxed** — add both to acceptance:
- **Delete from the provider once we hold it.** The Ley 1581 position is that audio lives in
  infrastructure the alliance controls; copies left on a vendor platform quietly make them a **second
  processor** holding health-adjacent recordings. Pipeline: recording event → `GET` the file
  (**bytestream, not a signed URL** — server-to-server, never a leakable link) → store in our storage +
  keep the key → **`DELETE` from the provider** → **self-hosted Whisper** → transcript + confidence →
  normalizer → `RECIBIDO` → human verification queue.
- **Provider-side transcription stays OFF wherever it is offered.** Whisper self-hosted is the whole
  privacy answer (§7); using the provider's transcription undoes it.

Also: **multichannel recording / speaker diarization is not needed** for a single reporter speaking
alone — it becomes relevant later for **radio nets** (PRD-11) or any call carrying a coordinator + a
reportante together. Cross-ref **PRD-15** (§4.1 Infobip recording pipeline that hands audio to this
engine).

---

## PRD v4 update (2026-08-19) — Supplement §6.2: noise suppression before Whisper

**New, not in v3.** Chocó riverboat engine noise and heavy rain degrade IVR recording quality enough to
cause **Whisper transcription hallucinations** — the model confidently produces text that was never
said, which is worse than a low-confidence correct guess because it doesn't visibly signal "unsure"
(BUG-20's threshold logic only helps if the confidence score itself is honest). Add a required
pre-processing step: run an automated **high-pass / noise-suppression audio filter** on the extracted
recording **before** it is fed to Whisper. This is a pipeline addition upstream of transcription, not a
change to the Whisper model itself.

**Add to scope:** the noise-suppression filter as a pipeline stage between audio extraction (PRD-15's
`DELETE`-from-provider step) and the Whisper call.

**Add to acceptance criteria:**
5. A recording captured with background engine/rain noise is run through the noise-suppression filter
   before Whisper; the pipeline stage is present and ordered correctly (extraction → noise filter →
   Whisper), not skippable.

Cross-ref **PRD-15** (§6.2 also sets the 60-second recording cap at capture time, upstream of this
filter).
