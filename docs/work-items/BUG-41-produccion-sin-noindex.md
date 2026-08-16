# BUG-41 · Production missing the pre-launch noindex

- **Type:** BUG · **Priority:** P1 · **Tier:** 1
- **Source:** Codex validation pass 1 (2026-08-16), `.forge/artifacts/validate/2026-08-15.md`
- **Status:** ✅ Fixed (config) — `CONVITE_NOINDEX=1` set on production 2026-08-16
- **Related:** `middleware.ts` (sets `x-robots-tag: noindex, nofollow` when `CONVITE_NOINDEX=1`)

## Problem
`https://convite.ai` (production) did not return the pre-launch `noindex`. The middleware
emits `x-robots-tag: noindex, nofollow` when `CONVITE_NOINDEX=1`, but the variable was
not live on production, so the empty pre-launch site was indexable.

## Fix
Set `CONVITE_NOINDEX=1` on the production `convite-app` service (auto-redeploys; the
middleware then sends the header). Removed only at real launch.

## Codex validation (read-only, production)
1. `curl -I https://convite.ai/` → confirm `x-robots-tag: noindex, nofollow` is present.
   Config-only check; create nothing on production.
