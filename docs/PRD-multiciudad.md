# PRD — Convite multi-ciudad

**Status:** proposal. Nothing here is built.
**Written:** 14 August 2026, after Buenaventura asked whether Convite could serve them too.

---

## 1. Why this document exists

§13 of the original spec put multi-city switching explicitly out of scope: *"the schema is
scoped by `organizacion_id`, but v1 ships one basin."* That was the right call for v1 and it
is now the thing being asked for. This document says what would actually have to change, what
it would cost, and which parts are decisions rather than engineering.

The good news is that the day-one decision to scope by `organizacion_id` means this is an
expansion rather than a rewrite. The bad news is that the hard part was never the foreign
key.

---

## 2. What Ayudas Pereira got right, and where it would fail us

Worth studying properly, because they shipped a working answer to the same question during an
actual emergency.

**Their architecture:** a single HTML file with the Supabase anon key pasted into it, all
reads and writes going straight from the browser to PostgREST. Tables `ciudades`, `centros`,
`inventario`, `necesidades`, `transportes`, `ofrecimientos`, `vehiculos`, `voluntarios`, every
one carrying `ciudad_id`. An `AdminDeCiudad` role. Passkeys instead of emailed links. A public
directory of collection centres with addresses, phone numbers and opening hours.

### What they got right, and we should copy

- **`ciudad_id` on every table, from the start.** Same instinct as our `organizacion_id`, and
  they were right to denormalise it onto every row rather than reaching it through joins.
- **Passkeys over magic links.** No inbox round trip, no link expiring while somebody is
  offline. During a fast response that is meaningfully better than what we built, and worth
  considering as a second sign-in method.
- **They took distribution seriously.** Their own source comment: the real channel is
  WhatsApp, and *"un enlace sin título ni imagen no lo abre nadie —con razón, porque en cada
  desastre circulan sitios falsos de donaciones."* A humanitarian tool spreads as a forwarded
  link, and looking legitimate is a safety feature. Convite has no og: tags and no public
  page yet.
- **Demo mode when unconfigured.** You can open the file and see the thing work before
  committing to anything. Our equivalent is `pnpm db:seed`, which requires a terminal.
- **`destino_texto` beside `destino_id`.** A free-text destination for places not in the
  registry. Pragmatic, and we should steal it.
- **Time to first useful screen: minutes.** This is their real advantage and our real
  weakness — see §7.

### Where their answer would fail us

- **The anon key ships to the browser and every read goes through PostgREST.** Whatever RLS
  they wrote is the entire boundary, and it is enforced on a client anybody can edit. We
  deliberately went the other way (PRD §3: no PostgREST, the server holds the connection).
  Their model is faster to build and has a much larger blast radius.
- **Addresses, phone numbers and responsable names are public.** For Pereira after an
  earthquake that is a defensible trade — the point is for donors to find the centre. **In
  Buenaventura the same page is a target list.** This is exactly what non-negotiables 2.4 and
  2.16 exist for, and it is the single most important thing not to copy.
- **`necesidades` has `prioridad` and `estado: pendiente`.** That is the "38 pending" board.
  It records that something is needed without saying what is missing, which is the entire
  problem Convite was built to solve.
- **No matcher.** `ofrecimientos` carries a `necesidad_id` a human set. That works at city
  scale on roads, where everything is reachable and coordination is the constraint. It does
  not work where reachability is the constraint.
- **No inventory freshness.** Nothing in their column list records when stock was last
  counted (2.3). At city scale you can phone the centre; up a river you cannot.
- **`transportes` is origin → destination with a `zona`.** No directed graph, no season, no
  reachability. Correct for Pereira. Wrong for the Atrato, and wrong for rural Buenaventura.

**The summary:** they built a very good *directory* for a city where everything is reachable.
We built a *matcher* for a basin where nothing is. Those are different products, and the
difference is not sophistication — it is which side is scarce.

---

## 3. The insight this has to be built around

**The shape of the territory changes what the product is.**

| | Atrato (Chocó) | Pereira | Buenaventura |
|---|---|---|---|
| How you reach people | Boat, almost entirely | Roads, everywhere | Both — dense urban core, rural communities up rivers and along the coast |
| Binding constraint | Transport capacity | Supply and coordination | Varies by neighbourhood |
| Route graph | Essential, seasonal, hand-entered | Nearly pointless | Essential for the rural half, pointless for the urban half |
| Right public disclosure | Municipality counts only | Addresses and phones | **Almost certainly closer to the Atrato** |
| Catalogue | Flood and river items | Earthquake items | Both, plus port-city specifics |

Three consequences:

1. **The route graph has to be optional.** A city where everything is reachable by road
   should never have to enter one. The matcher must treat an empty graph as "everything is
   reachable" rather than returning `SIN_RUTA` for every request — today it would do the
   latter, which would make Convite useless in Pereira on day one.
2. **The catalogue has to be per-tenant.** 2.8 already says the catalogue is data, but
   `catalogo_items` has no tenant column. An earthquake city needs tarps and tools; a flood
   basin needs water treatment; a port city needs both.
3. **The public disclosure policy has to be per-tenant, with a safe default, enforced in
   RLS.** Not a frontend config. This is the one place where copying Pereira would be
   actively dangerous.

---

## 4. What "an organizer adds their city" actually means

Scope of the ask, in rough order of difficulty:

**Easy — mostly already there.**
- A tenant record, a name, an admin. `organizaciones` and `invitaciones_staff` exist.
- Community registry, catalogue, nodes, contacts scoped to that tenant.

**Medium — real work, no new ideas needed.**
- `organizacion_id` denormalised onto every tenant-scoped table, and every RLS policy
  extended to filter on it. Today most tables reach the tenant through a join to
  `comunidades`, which is both slow and easy to get wrong in a policy.
- A tenant switcher for staff who work across more than one city.
- Per-tenant settings: season handling on or off, public disclosure level, check-in cadence.
- Onboarding that does not require a terminal. Today the first admin is created by
  `pnpm invitar`, which is fine for us and impossible for an organizer in Buenaventura.

**Hard — these are the ones to think about before building.**
- **Vetting.** See §6.
- **Channel identity per city.** See §5.
- **Blast radius.** One wrong policy exposes every city, not one. See §5.

---

## 5. Decisions to make

| # | Decision | Recommendation |
|---|---|---|
| M1 | **Isolation model:** shared tables with RLS, schema per tenant, or database per tenant? | Shared with RLS, denormalised `organizacion_id`, plus a test suite that asserts cross-tenant isolation the same way `rls.db.test.ts` asserts role isolation. Schema-per-tenant is tempting for blast radius but multiplies migration cost by the number of cities, and we already run 27 migrations. |
| M2 | **One WhatsApp number or one per city?** | One per city if the partner can get them. A shared number means a message from an unknown number cannot be attributed to a city, and it couples every tenant to one WABA's rate limits and one suspension. Note this multiplies D3 and D4 by the number of cities. |
| M3 | **Who may create a city?** | Not self-serve. See §6. |
| M4 | **Public disclosure default for a new city.** | Aggregated, municipality-level, like the Atrato. An organizer may loosen it deliberately with a written acknowledgement; they must never get Pereira's behaviour by accident. |
| M5 | **Does a new city inherit the base catalogue?** | Yes — clone the 26 items on creation, then let them edit. An empty catalogue on day one is a dead product. |
| M6 | **Route graph optional?** | Yes, and the matcher must degrade correctly: no routes configured means treat all communities as reachable and let `SIN_CAPACIDAD` and `SIN_EXISTENCIA` do the work. This is a genuine change to the resolver. |
| M7 | **Who pays for messages and storage per city?** | Unresolved and needs an owner. Meta charges per conversation; storage grows with voice notes. A city that never pays is a city we eventually turn off, which is worse than never starting. |
| M8 | **What happens when a response ends?** | An archive state, and a retention clock. A dormant city holding phone numbers of vulnerable people indefinitely is a liability, not an asset (PRD D9). |

---

## 6. Vetting is the hard problem, and it is not technical

If anyone can create a city and start collecting names, phone numbers and locations of
vulnerable households, then Convite becomes an easy way to build exactly the dataset 2.4
exists to prevent. An armed group does not need to breach us; they need to fill in a signup
form and wait for reports to arrive.

This is not hypothetical for Buenaventura.

**Recommendation:** city creation is by invitation from an existing partner organisation, not
self-serve. Concretely:

- A new city requires an existing organisation to vouch for the organizer, or a manual review
  by whoever runs Convite.
- The organizer's identity and affiliation are recorded, with a name attached, like every
  other consequential action in the system (2.1).
- A new city starts with the strictest public disclosure and cannot loosen it in its first
  weeks.
- There is a documented way to suspend a city and freeze its data.

If that sounds slow, note that it is the same shape as the WABA dependency: humanitarian
infrastructure moves at the speed of institutional trust, and pretending otherwise is how it
gets abused.

---

## 7. Time to first useful screen

Pereira's real advantage: open a file, paste two keys, deploy anywhere, see something working
in minutes. Convite needs Postgres, PostGIS, migrations, a seed, a job worker and an auth
provider. For a city that needs coordination *today*, that gap matters more than any feature
we have.

Worth considering, in increasing order of ambition:

1. **A hosted instance organizers join**, rather than software they deploy. Almost certainly
   the right answer, and it makes §6's vetting enforceable.
2. **A guided setup that replaces `pnpm invitar`** — first admin, communities, catalogue,
   from a browser.
3. **A read-only public directory that works before any of the matching does** — closest to
   what Pereira built, and genuinely useful on day one while the route graph is still empty.
   This is a plausible first deliverable for Buenaventura.

---

## 8. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| **Cross-tenant leak** | One policy mistake exposes every city, and the data is exactly what must not leak. | Isolation tests as a first-class suite, written before the second city exists. |
| **Copying Pereira's disclosure defaults** | The most dangerous single change anyone could make to this codebase. | Safe default, deliberate opt-out, RLS-enforced, reviewed. |
| **The matcher is wrong for road cities** | An empty route graph currently yields `SIN_RUTA` for everything. | M6 before any non-river city goes live. |
| **Per-city WhatsApp multiplies external dependencies** | D3 and D4 already block M5 for one city. | Consider launching a new city with the web and SMS drivers first, WhatsApp when the number clears. |
| **Spreading thin** | The Atrato pilot has not run yet. A second territory before the first has proven itself risks two half-working deployments. | Sequence deliberately: §9. |

---

## 9. Suggested sequencing

Nothing here is committed to; it is what I would propose.

1. **Finish the Atrato pilot.** Multi-city built on an unproven product multiplies unknowns.
   The one exception is anything Buenaventura needs that also improves the Atrato — M6's
   graceful empty graph is one.
2. **Denormalise the tenant key and write the isolation tests**, while there is still only
   one tenant and mistakes are cheap.
3. **Ship the public directory for Buenaventura** — Pereira's shape, our disclosure defaults.
   Useful immediately, small, and it does not depend on WhatsApp.
4. **Then the guided onboarding and the tenant switcher.**
5. **Then per-city channels**, as each partner's WABA clears.

---

## 10. Open questions

- Who is asking from Buenaventura, and on whose behalf? The answer changes §6 entirely.
- Is the need there urban, rural-riverine, or both? It determines whether M6 is a
  prerequisite or a nice-to-have.
- Is Convite something organisations *join* or something they *run*? Everything in §7
  depends on it, and it is a strategy question rather than an engineering one.
- Would Ayudas Pereira consider sharing a catalogue or a data model? They have run a real
  response and we have not. There is more to learn from them than from any spec.
