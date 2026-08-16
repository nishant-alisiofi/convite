# PRD-16 — Multi-org membership (join-table)

- **Type:** PRD
- **Tier:** 2 — Roadmap (from PRD v1.0)
- **Priority:** P2
- **Status:** Backlog
- **Source:** PRD v1.0 (multi-org membership via a join table — a user can belong to more than one
  organisation).

## Problem / why

Today the schema scopes by a single `organizacion_id` and a user belongs to one org (RLS derives
from a single-org design, migration 0017). The vision needs a user to belong to **multiple**
organisations — e.g. an Alisio staffer who also operates a center, or a coordinator serving two
partner orgs. That requires a **membership join table** (`user × organizacion × role`) and RLS/
policy that resolves the caller's org context per request. `docs/validacion-codex-0a1.md` already
flags that inherited cross-org *reads* from the single-org design are a known gap — this WI is the
structural fix.

## Scope

**In:**
- A **membership join table**: (user, organizacion, role[, scope]) — replacing the implicit
  single-org attachment.
- RLS + `conSesion` updated to resolve the **active org context** per request (the user picks/holds
  an active org; policies scope to it).
- An **org switcher** in the panel for multi-org users.
- Migration that preserves existing single-org users (each becomes one membership row).
- Preserves the RBAC 0034 hierarchy (platform admin cross-org; center admin within org;
  anti-escalation guard).

**Out (v1):** cross-org data *sharing* (a request visible to two orgs at once) — membership is
about a person in many orgs, not data in many orgs.

## Acceptance criteria

1. A user can hold membership (with a role) in **two+ organisations**; each membership is a row.
2. The panel offers an **org switcher**; the active org scopes all data/actions via RLS.
3. Switching org changes the visible data set correctly, and no membership leaks another org's
   data outside the active context.
4. Existing single-org users are migrated to exactly one membership row with no access change.
5. The RBAC 0034 invariants still hold (no privilege escalation; center admin bounded to own org).

## Validation approach (future, on staging)

Give a test user membership in two orgs; confirm the org switcher appears, that data/actions scope
to the active org, and that switching flips the data set without leakage. Confirm a single-org user
is unaffected. Re-run the RLS harness. Never validate on production.
