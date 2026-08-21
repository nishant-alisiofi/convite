# BUG-24 — Never-seen tier-1 escalated the same as never-seen tier-4 (D6)

- **Type:** BUG
- **Tier:** 1 — Defect on the live demo (PRD v3 Part III)
- **Priority:** P1 — correctness (a missed-signal error, not cosmetics)
- **Status:** ✅ Fixed — deployed (staging + prod), pending Codex validation · fixed in the D1–D9 batch
- **Source:** PRD v3 §Defects **D6**. Related canonical behaviour: PRD v3 §14 (Comunidades).

## What's wrong (PRD v3 · D6)

**Yuto** — tier 1, cabecera, 340 families — is shown with «nunca hemos sabido nada de ella», treated
the same as a never-seen tier-3/4 river vereda. But for a **well-connected cabecera** never-seen almost
always means **the contact is wrong**, not that the community is fine. The system currently reads both
as the same "alta, no alarma" state.

## Why it matters

Silence is the only signal that fires when nobody reports (PRD v3 §19). For tier 3–4 «nunca vista» is
honestly "no baseline yet — high, not alarm" (PRD v3 §14). For a tier-1 cabecera the same silence is a
**broken pipe**: 340 families with good connectivity and zero contact means our number/contact for
them is wrong. Collapsing the two hides a real failure behind a benign label.

## Fix / acceptance criteria

1. The **never-seen** classification distinguishes by tier:
   - **Tier 1–2 never-seen** → escalate as a **likely contact/onboarding problem** ("bien conectada y
     sin contacto — probablemente falta o está mal el número"), surfaced for action.
   - **Tier 3–4 never-seen** → keep the current honest framing «Nunca hemos sabido nada de ella — es
     alta, no alarma.» (PRD v3 §14).
2. The two cases carry **different copy and different escalation** paths (they must not share one
   badge/treatment).
3. The «en silencio» vs «nunca vista» distinction (PRD v3 §14) is preserved — this fix adds a
   tier dimension to «nunca vista», it does not merge the two existing states.

## Codex validation (run on staging.convite.ai)

> **Do not touch production.** Log in per `docs/validacion-codex-0a1.md`.

1. Log in as **coordinador** (`talos+convite-coordinador@downshiftit.com`), open **Comunidades**.
2. Find **Yuto** (tier 1, never seen): it is flagged as a **contact problem** to act on, with copy
   distinct from a tier-4 never-seen community.
3. Find a **tier-3/4** never-seen community: it keeps the «es alta, no alarma» framing.
4. Confirm the two are visibly and semantically different, not the same badge.

**Pass = a never-seen tier-1 cabecera reads as "probably a wrong contact — escalate", while a
never-seen tier-3/4 community keeps "high, not alarm".**
