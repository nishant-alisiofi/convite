# BUG-26 — Overstated zero-rating claim on the landing page (D8)

- **Type:** BUG
- **Tier:** 1 — Defect on the live demo (PRD v3 Part III)
- **Priority:** P1 — visible public copy; the claim is load-bearing to the product's promise
- **Status:** ✅ Fixed — deployed (staging + prod), pending Codex validation · fixed in the D1–D9 batch
- **Source:** PRD v3 §Defects **D8**. Related: §4.1 (missed-call callback), §4.1.1 copy rule.

## What's wrong (PRD v3 · D8)

The landing page says **«En los planes prepago del país no consume saldo»**. This is too strong. The
zero-rating benefit covers **text and low-resolution media, not WhatsApp calls**, and Claro ties it to
**an active package** — so someone with a dead balance may not have it, which is **exactly the person
the missed-call callback exists for** (PRD v3 §4.1).

## Why it matters

The whole pitch is "asking for help never costs money" (principle 1). Overstating that WhatsApp is
always free misleads the zero-balance user into a channel that may charge them, and quietly undermines
the reason the callback is non-negotiable. Truthful copy here is part of the product's integrity.

## Fix / acceptance criteria

1. Replace the overstated claim with the exact PRD v3 §D8 copy:

   ```
   En la mayoría de los paquetes prepago del país, los mensajes de WhatsApp no consumen datos.
   Si no hay paquete activo, la llamada perdida siempre funciona.
   ```

2. While in this copy: apply the §4.1.1 rule anywhere the callback is described — **«solo marque»,
   never «marque y cuelgue»** (the second asks the person to act and implies a race). Fix on the
   landing page, in templates, and on the printed card.
3. No remaining copy asserts WhatsApp is unconditionally free of charge.

## Codex validation (run on staging.convite.ai — public, no login)

> **Do not touch production.** Use `https://staging.convite.ai`.

1. Open the landing page unauthenticated.
2. Confirm the zero-rating statement matches the new copy and no longer says «no consume saldo»
   absolutely.
3. Confirm any missed-call instruction reads **«solo marque»**, not «marque y cuelgue».

**Pass = the landing page carries the qualified zero-rating copy and the «solo marque» phrasing.**
