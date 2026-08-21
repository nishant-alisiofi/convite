# FR-42 — Búsqueda rápida de personas / beneficiarios

- **Type:** FR
- **Tier:** 2 — Roadmap
- **Priority:** P2
- **Status:** ✅ Built + deployed (staging + prod) — pending Codex validation
- **Source:** Field feedback from Chocó (Doña Marta, Red de Mujeres Chocanas), relayed by Nishant
  2026-08-17. "Optimize search functionality to make locating individuals in remote databases
  fast and straightforward."

## Problem / why

A coordinator in the field needs to find a specific person fast — by partial name, by phone, by
community — often on a weak connection and a small screen. Today there is no dedicated person
search; you navigate by community. In a distribution or a callback, "who is this number / where
is this family" has to be one box and one keystroke, not a drill-down.

## Scope

**In:**
- A person/beneficiary search over `contactos` (and their community), reachable from the panel
  (Comunidades, and ideally a global search box in the shell).
- Match on partial name, phone (E.164 or local), and community name; **accent- and
  case-insensitive** (`unaccent`/`ILIKE` or a normalized column) so "María" matches "maria".
- Results respect the caller's RLS scope (a coordinator only finds people their org can see) and
  the PII boundary (household address only to roles already permitted it — never widened here).
- Each result links to the person's reports / the community.

**Out:** fuzzy/ML ranking, cross-org search, exposing addresses to roles that cannot see them.

## Acceptance criteria

1. Searching a partial name returns matching people within the caller's org scope, accent- and
   case-insensitive.
2. Searching a phone (local or E.164) returns the matching contact.
3. A result links to the person's reports / community; no PII is shown that the caller's role
   could not already see elsewhere.
4. Search returns quickly on the seeded dataset (indexed lookup, not a full scan).

## Validation approach (staging)

On `staging.convite.ai`, as a coordinator, search a seeded partera by partial accented name and
by phone; confirm results are scoped, linked, and address-safe. Confirm a `lectura` role sees no
address it should not.
