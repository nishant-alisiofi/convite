# PRD-49 — Sensitive-disclosure handling: redaction, escalation, and the `verificador_vulnerable` role

- **Type:** PRD
- **Tier:** 2 — Roadmap (PRD Supplement v4.0)
- **Priority:** P1 — safety-critical once any real reporting is live, but new build (not a live-demo
  defect)
- **Status:** 🟡 Built + deployed — migration 0063: RLS redaction, `verificador_vulnerable` role, escalation path. **Open (partner decisions, not engineering defaults):** the protection-lead contact per partner org, and the distress-term list that triggers the alert — both need Red de Mujeres Chocanas / ASOREDIPARCHOCÓ input.
- **Source:** PRD Supplement v4.0 **§3** (Privacy, Sensitive Data & RBAC) + **§6.3** (Urgent GBV /
  Distress Escalation Protocol). Genuinely new scope — v3 has no GBV/domestic-violence handling; this
  is not an enrichment of an existing WI.

## Problem / why

Convite already refuses to be a clinical record system (v3 §2) and already treats sensitive routing
carefully — the discretion rule on calendar feeds (v3 §28.1, PRD-34) and separation of duties (v3 §29.7,
PRD-16) both exist. But **no path exists today for a gender-based-violence or domestic-violence
disclosure** arriving through any channel (WhatsApp, SMS, IVR, radio). Today that content would land in
the standard Verificación queue exactly like a supply request: visible to any `verificador`/`despachador`
with community access, and subject to the same ~24h verification cadence PRD v3 §32 treats as the normal
success measure. Neither is acceptable for a live distress disclosure, and neither protects the reporter
if the content is later redacted for public/aggregate surfaces.

## Scope

**In:**
- **A sensitivity flag on normalized reports.** The normalizer/transcript is checked against a
  configured list of high-risk distress terms; a match sets a routing flag (e.g. `sensible_gbv`) on the
  report. **This is a routing decision, never a diagnosis or risk score** — no clinical triage, no
  *semáforo de riesgo* (that boundary is explicit in v3 §27b.3 and unchanged here).
- **Automated redaction/anonymization.** Anything populating a public surface (`/respuesta`, landing,
  v3 §17) or the general (non-vulnerable) coordinator/despachador view strips PII and the disclosure text
  itself for a flagged report — the report still exists and is still trackable by folio, just without the
  content that would identify or expose the person.
- **A new role, `verificador_vulnerable`** (added to PRD-16's §29.3 roles table): vouched, org-ceiling
  gated like every other login role (PRD-35's vouching model, PRD-37's ceiling schema), and **the only
  role that can see un-redacted audio, transcript, or address on a flagged report.**
- **Immediate-escalation path.** A flagged report **bypasses the standard verification queue's default
  cadence** and fires an urgent SMS/WhatsApp alert directly to the community/organisation's **designated
  protection lead(s)** (e.g. Red de Mujeres, an NGO lead) — it does not wait for the next dashboard
  check.
- **Discretionary notification, applied explicitly to this flow.** Any calendar entry, lock-screen alert,
  or automated message referencing a flagged report carries the **folio and nothing else** — this is
  PRD-34 §28.1's existing discretion rule, extended here so it's not accidentally skipped for this
  specific, highest-stakes case.
- **Separation of duties holds.** `verificador_vulnerable` still **cannot dispatch** (v3 §29.7,
  unchanged) — seeing a flagged report is not authority to act on it alone.

**Out:**
- Clinical risk assessment, triage, or a *semáforo de riesgo* — forbidden by v3 §2 / §27b.3, same
  boundary as the rest of the product.
- The general permission-engine mechanics (ceiling enforcement, membership, offboarding) — **PRD-16**;
  this WI only adds the role and its distinct default "sees" scope.
- The ceiling schema column that gates the role — **PRD-37** (schema only, per that WI's convention).
- **Designating who the protection leads are per partner organisation.** That is a partner/founder
  decision (see Open questions below), not a build task — this WI builds the alerting mechanism assuming
  a configured contact exists.
- **The distress-term list itself.** Choosing what triggers the flag is a partner/clinically-informed
  decision, not an engineering default (see Open questions below).

## Acceptance criteria

1. A report whose transcript/text matches a configured high-risk distress term is flagged and bypasses
   the standard verification-queue cadence.
2. On flag, an urgent SMS/WhatsApp alert fires directly to the organisation's configured protection
   lead(s) — not the standard dashboard cadence.
3. Un-redacted audio, transcript, and address for a flagged report are visible only to
   `verificador_vulnerable` accounts within the flagged community's ceiling; every other role — including
   standard `verificador` and `despachador` — sees a redacted view with PII and disclosure text stripped.
4. Public surfaces (`/respuesta`, landing) never render any content from a flagged report, redacted or
   not.
5. Any notification (calendar, lock-screen, SMS) referencing a flagged report carries folio + type only —
   never the disclosure content or a name.
6. `verificador_vulnerable` cannot dispatch (§29.7 unchanged).

## Dependencies

- **PRD-16** — the role definition, ceiling enforcement, membership and offboarding mechanics this role
  inherits.
- **PRD-37** — the `techo_permisos` ceiling flag that gates who may hold the role.
- **PRD-35** — the vouching model that admits/vouches the person into the role.
- **PRD-34** — the discretion rule this flow extends explicitly.
- **PRD-15 / PRD-14** — the ingestion + transcription pipeline this classifier sits downstream of; the
  flag is computed on the normalized report those WIs produce.

## Open questions (founder/partner decision, not resolved by this WI)

- **Who are the protection leads per partner org**, and how are they configured (echoes the existing v3
  §34 "who holds `org_admin`" open question)? The alert mechanism can be built without this, but cannot
  fire correctly until it's answered.
- **The distress-term list.** This should be built with partner input (Red de Mujeres / ASOREDIPARCHOCÓ),
  not invented internally — false negatives are dangerous, false positives desensitize the alert.

## Validation approach (future, on staging)

On `staging.convite.ai`, submit a test report (via a seeded/test channel, **never** a real submission)
containing a **configured test distress term** — not a real disclosure. Confirm it is flagged, the
standard verifier view shows a redacted version, the alert fires to a test protection-lead contact, and
only a `verificador_vulnerable` test account can see the un-redacted audio/transcript/address. Confirm
`/respuesta` never surfaces it. Never validate on production; never use real distress-disclosure content
as test data.
