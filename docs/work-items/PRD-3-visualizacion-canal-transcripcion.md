# PRD-3 — Panel UI pass: channel/source + transcription visualization on cards

- **Type:** PRD (feature / front-end)
- **Tier:** 1 — Demo (this pass)
- **Priority:** P0
- **Status:** ✅ Built + deployed (staging + prod) — pending Codex validation
- **Source:** Jam B ("each report showing its source and, for voice notes, a 'transcribed'
  indicator"; "raw-messages → triage → categorized Tablero"; recurring theme: "show
  organisations the value that comes in through this AI ingestion"), planned panel-UI pass.
- **Depends on:** PRD-1 (seed provides multi-channel + voice data to render).

## Problem / why

Jam B's core demo goal is to *make AI ingestion visible*: an organisation should see that a
report came in by WhatsApp vs SMS vs missed-call vs radio, and that a voice note was
transcribed. Today the pipeline records `canal`/source and transcription state, but the panel
cards do not surface them, so the demo cannot tell the "value comes in through ingestion" story.
This is a presentational-layer pass over report / verification / Tablero cards.

## Scope

**In:**
- A **channel/source badge** on every report card (Verificación queue, Tablero rows, report
  detail): WhatsApp · SMS · llamada perdida (IVR) · radio.
- A **"transcrito"** (transcribed) indicator on voice-note reports, with access to the transcript
  and a visible marker that the original is preserved.
- Surface the **raw-message → triage → categorized** flow so a viewer can see a message enter as
  raw text/voice, get normalized (codigo_item + cantidad + confidence), and land classified on
  the Tablero. (A "sin_clasificar / en clarificación" state is visible when confidence is low.)
- Consistent iconography (Lucide, always with a text label, per PRD.md §5 design system).

**Out:**
- Any change to the normalizer, matcher, or channel drivers (logic is built; this is UI only).
- New pages — this decorates existing cards.
- Live channel wiring (Tier 2).

## Acceptance criteria

1. Every report card (Verificación, Tablero, detail) shows a **channel/source badge** naming one
   of: WhatsApp, SMS, llamada perdida, radio.
2. Voice-note reports show a **"transcrito"** indicator and expose the transcript; the UI makes
   clear the original text/audio is preserved.
3. The Tablero visibly reflects the **raw → triage → categorized** flow: a low-confidence item is
   visible as `sin_clasificar` / in clarification; a classified item shows its normalized
   category + quantity.
4. Badges/indicators are labelled (icon + text), consistent with the Chocó design system.
5. Mobile 360 px: cards render channel/transcription info without overflow.

## Codex validation (run on staging.convite.ai)

> **Do not touch production.** Log in per `docs/validacion-codex-0a1.md`.

1. Log in as **coordinador** (`talos+convite-coordinador@downshiftit.com`) and open **Tablero**.
   Expected: report/pedido rows carry a **channel badge** (WhatsApp / SMS / llamada perdida /
   radio).
2. Open **Verificación**. Confirm the queue shows a **channel badge** on each item and that all
   four channels are represented (from PRD-1 seed).
3. Find a **voice-note** item. Expected: a **"transcrito"** indicator + a viewable transcript;
   the original is marked as preserved.
4. Confirm the **raw → triage → categorized** story is visible: at least one item in a
   `sin_clasificar` / clarification state, and classified items showing normalized category +
   quantity.
5. Log in as **verificador** (`talos+convite-verificador@downshiftit.com`, communities TAG/MER/
   BET). Confirm the same badges/indicators render on the reports they can see (and only those).
6. Shrink the viewport to **360 px**. Expected: cards render channel/transcription info with no
   horizontal overflow.

**Pass = a viewer can tell, at a glance, which channel each report arrived by and that voice
notes were transcribed — the "value of AI ingestion" is visible on the cards.**
