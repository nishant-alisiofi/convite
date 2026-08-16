# PRD-9 — Funded local purchase (third supply mode)

- **Type:** PRD
- **Tier:** 2 — Roadmap (from PRD v1.0)
- **Priority:** P2
- **Status:** Backlog
- **Source:** PRD v1.0 (three supply modes: donated goods, in-kind offers, and **funded local
  purchase**).

## Problem / why

Today supply comes from donor offers of existing goods (in-kind). The vision adds a third mode:
**buy the needed items locally with funds** — often faster, fresher, and it supports the local
economy, and for river-cut communities it may be the only mode that arrives in time. This needs a
funding source, a local vendor, a purchase record, and reconciliation, all under the same
human-decided allocation model.

## Scope

**In:**
- A **funded-purchase** supply mode alongside donations/offers: a demand can be satisfied by a
  purchase order against a funding pool.
- **Local vendor** records (who, where, what they can supply) and a **purchase order** with
  quantity, cost, and a receipt/confirmation.
- Ties into the matcher as a supply source (a request in `SIN_EXISTENCIA` can be resolved by a
  funded purchase rather than a donation).
- **Auditability:** every purchase is logged with the deciding human, amount, and vendor;
  immutable once recorded (mirrors `decisiones_asignacion`).
- Budget guardrails (a funding pool with a ceiling and alerting, like the M10 voice-spend caps).

**Out (v1):** payments integration / disbursement rails; accounting export; multi-currency.

## Acceptance criteria

1. A demand can be marked satisfiable by **funded local purchase**; the matcher treats it as a
   valid supply source distinct from donations.
2. A purchase order captures vendor, items, quantity, cost, and a confirmation/receipt.
3. Every purchase is logged with the deciding human and is immutable after recording.
4. A funding pool enforces a ceiling with an alert threshold; exceeding it blocks new purchases
   until raised.

## Validation approach (future, on staging)

Seed a funding pool + a local vendor; as coordinador/despachador, resolve a `SIN_EXISTENCIA`
demand via a funded purchase, confirm the order + receipt, confirm the decision is logged and
immutable, and confirm the pool ceiling/alert behaves. Never validate on production.
