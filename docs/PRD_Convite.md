# Convite — Product Requirements

**Version 1.0 · August 2026**
Territory: Chocó, Valle del Cauca, Cauca — the Pacific littoral
First partner: ASOREDIPARCHOCÓ (1,600 parteras, 31 municipalities)

---

## 1. What Convite is

**A three-sided marketplace for humanitarian supply in territories where connectivity fails.**

| Side | Who | Contributes | Scarcity |
|---|---|---|---|
| Demand | Communities, and the community health workers who serve them | Verified requests | Never scarce |
| Supply | Warehouses, collection points, donors, local purchase | Stock | Sometimes scarce |
| Capacity | Boat and vehicle operators | Space on an open route | **Almost always the thin side** |

A matcher runs continuously and, for every open request, determines **which side is missing**:
`SIN_RUTA`, `SIN_EXISTENCIA`, `SIN_CAPACIDAD`, `LISTO`, `EN_CAMINO`.

**That classification is the product.** "38 pending" helps nobody. "12 await transport, 8 await
donation, 3 are cut off" turns each number into a specific phone call to a specific person.

The messaging channels are the I/O layer. They determine reach, and reach is the differentiator —
but they are not the architecture.

## 2. What Convite is not

Stated as limits, because each one is a liability if crossed.

- **Not a clinical record system.** No historia clínica, no diagnoses, no prescriptions. Health data
  is *dato sensible* under Ley 1581 with its own regulatory regime. We connect to a telemedicine
  platform; we do not become one.
- **Not emergency dispatch.** An obstetric emergency means calling **123**, not texting Convite.
- **Not a radio network operator.** We ingest from nets that already exist and are already accepted
  locally. We never transmit, never license, never distribute radios.
- **Not a replacement for institutional care or existing coordination.** We make what already
  operates legible; we don't ask anyone to start over.

---

## 3. Users

**No account required** — identified by phone number, since WhatsApp and SMS already prove control
of it:

- **Reporter** — asks for what a community or she herself needs
- **Damage reporter** — reports a blocked road, fallen bridge, damaged aqueduct
- **Donor** — offers goods
- **Volunteer** — offers time at a node

**Account required, vouched:**

- **Transporter (open)** — offers capacity; sees public collection points only
- **Transporter (vouched)** — sees exact addresses for their own active run, time-boxed
- **Contributing organisation** — manages inventory at a node it operates
- **Verifier** — confirms reports are real, for assigned communities
- **Dispatcher** — plans shipments and records allocation decisions
- **Coordinator** — both, plus routes and inventory
- **Org admin** — administers their own organisation's people, within a ceiling
- **Admin** — catalogue, community registry, organisation approval

**The community health worker is both reporter and beneficiary.** A partera reporting she's out of
her own medication is reporting for herself while remaining the trusted node reporting for everyone
around her. Both roles attach to one contact; her silence is both a coverage gap and a person who
may be unwell.

---

## 4. Principles

1. **Asking for help never costs money.** No channel may require balance, data or an app.
2. **Free-form in, structured out.** No forms, no menu trees. People send whatever they send;
   structure appears only in the confirmation.
3. **The normalizer returns null before it guesses.** A confidently wrong parse is worse than
   asking, because nobody checks it.
4. **No flow requires a live session.** Records are created on receipt, never on confirmation.
5. **Never invent a coordinate.** Every location carries its source and an accuracy radius.
6. **Inventory is never a promise.** Every stock figure shows when it was last counted.
7. **The matcher proposes; a person commits.** Under scarcity, matching decides who waits.
8. **Show less in public, on purpose.** Aggregate to municipality; never household.
9. **Battery is scarce.** Fewest round trips, smallest payloads, screen off where possible.
10. **Human accompaniment is part of the system, not a shortfall of it.**

---

## 5. Functional requirements

### 5.1 Intake

Four channels, one record. Every report carries `canal`.

| Channel | Context | Robustness under weak signal |
|---|---|---|
| SMS | 2G, low balance | **Highest** — store-and-forward at network level |
| Voice callback | Zero balance, no literacy | High — connects where data fails |
| WhatsApp | Data available | Moderate; voice notes and photos are the most fragile inputs |
| Radio and paper | No coverage | Human relay |

**Missed-call callback.** Person dials and hangs up; the call never connects, so it costs them
nothing. The system rejects, calls back, plays one prompt, records. Requires no gesture at all —
which matters, because press-and-hold is one of the hardest touchscreen gestures for first-time
users. Hard spend caps before first live call.

**Interaction constraints for first-time touchscreen users.** Voice notes are offered, never
required. Prefer quick-reply buttons over list rows. No dragging, long-press menus, swipe actions
or small targets. Handle a two-second mis-hold as an attempt, not an error.

**Discretion.** Default confirmation carries the folio and nothing else. Never the item, quantity or
community — that screen may be seen by someone else.

### 5.2 Normalization

Free text, voice and document images all resolve to `{codigo_item, cantidad, unidad, urgencia,
confianza}`. Below threshold, the record still lands and goes to a human clarification queue.

- **Self-hosted Whisper.** Audio never leaves our infrastructure. No third-party processor, no
  training-data question, no international transfer to justify.
- Domain lexicon for Colombian and Chocoano terms.
- `texto_original` is never overwritten.
- Audio auto-deletes after a defined retention window (default 90 days).

**Emergency escalation.** Anything the normalizer flags as an obstetric or medical emergency returns
an immediate instruction to call 123 and alerts a coordinator. It does not enter a supply queue.

### 5.3 Supply — three modes

This is where the partner's plan changed our model. Stock reaches a community three ways:

**Donated stock at a node.** Warehouse or collection point inventory, with `contado_en`.

**Individual offers.** Goods in private hands needing pickup. Observed from a live deployment: in
the first week of a response, offers in homes vastly outnumber node inventory, and node counts go
stale within days. **The matcher must check both.** Reporting "nobody has this" while eight people
are offering it is the single most consequential bug in this class of system.

**Funded local purchase.** ASOREDIPARCHOCÓ's third strategy inverts the default: rather than
centralising purchases in Quibdó and shipping out, allocate funds to a territorial responsible who
buys in or near the municipality. Less time, lower logistics cost, and local economies strengthened.

Local purchase requires its own record with full traceability — purchase authorisation, territorial
responsible, receipt, verification of materials received, distribution, documentary and photographic
evidence — because decentralising must not mean losing control.

**Perishables and cold chain.** Prepared food and short-dated medicine sort above everything else by
expiry. Insulin and injectables carry storage constraints — temperature, light protection — that
restrict which routes and which nodes can hold them. A route that takes six hours in an open boat is
not a valid path for insulin.

### 5.4 Matching

Resolves in fixed order — route, then stock (nodes *and* offers), then capacity — and never mutates
stock or commits capacity. Re-runs on every state change. `motivo` is a human-readable Spanish
sentence that appears directly in the UI.

**When supply is insufficient, the allocation decision is recorded**: which rule was applied, who
confirmed, which requests were deferred. A deferred community with nobody to argue with is how the
reporter network dies.

### 5.5 Transport — goods and people

Goods move to communities. **People also move out of them**, and that's a distinct flow the partner
made visible: parteras travelling to Quibdó, Medellín or Bogotá for surgery or specialist care,
requiring river transport, road, occasionally air, plus lodging, food, accompaniment, and
counter-referral follow-up.

Same matching logic — a person needing to reach care is demand, a boat going that way is capacity —
but the record carries a person, not a quantity, and it has a return leg.

### 5.6 Delivery and verification

Four-digit confirmation code generated at dispatch, printed on the manifest. The receiving person
sends it by WhatsApp, SMS, or dictates it by phone. Signed paper manifest is the offline fallback,
reconciled later.

Nothing enters the queue unverified. Nothing is dispatched without a named confirmation.

### 5.7 Maps and offline

**OpenStreetMap as the base**, not Google. OSM tags waterways, ferry routes, footpaths and informal
tracks — the connections that actually carry shipments in this territory. It's editable, so a
lanchero's knowledge of which channel is navigable in dry season goes back into the map permanently.
And it works offline.

- **Road routing:** self-hosted OSRM or Valhalla on an OSM extract. No per-request cost.
- **River routing: manual, always.** Not derivable from any source. Seasonal rows, entered by people
  who know the river. First-class admin feature, not an afterthought.
- **Google:** optional, urban only — Cali and Quibdó cabecera. One adapter behind an interface.
- **CEMS and Maxar:** advisory overlays. CEMS damage grading strengthens silence alerts and proposes
  route deactivations for human confirmation. Never a routing input, and useless under Chocó cloud
  cover much of the time.

**Offline map bundles for transporters and verifiers.** PMTiles archive plus MapLibre, downloaded
while signal exists, rendered offline with a GPS dot on top. GPS needs no connection — only the map
underneath does. First fix is slow without assisted GPS, so the UI says "buscando señal" rather than
looking broken.

Precompute the run before departure: manifest, ordered stops, confirmation codes, corridor tiles. No
on-device routing engine needed — a lanchero going upriver isn't choosing between routes.

**This does not violate "no app to install."** That rule protects reporters, who keep WhatsApp, SMS
and the phone. The offline map serves transporters and verifiers — a small, better-equipped group who
accept an assignment and travel.

**Bundle scope is a safety requirement.** Only the stops on that run. Encrypted at rest, expires on
completion, remote wipe supported. A device carrying every community, every household pin and a
delivery schedule is a liability in territory where devices already attract questions.

**Tier 4 communities have coordinates from the registry, not from reports.** They appear on the map,
accumulate requests and trigger silence alerts even having never sent a digital message — otherwise
the map renders exactly the communities that need it least.

### 5.8 Radio

**Convite never operates a radio network.** We ingest from nets that already exist, are already
licensed, and are already accepted locally — health posts, Defensa Civil, Cruz Roja, parish networks.
No new signal appears in the territory because of us.

- **Off by default, enabled per community** via `radio_permitido` with an attestation: who confirmed
  a licensed net exists and that using it is safe, and when. Never a regional setting — conditions
  vary river by river.
- **Attestation expires** (six months) and requires active re-confirmation. Defaults drift closed.
- **Ingestion only, never transmission.** Confirmations go back by SMS, callback, or through the
  operator personally — never over the air.
- **The log is unbranded.** A notebook or a plain form. Nothing identifies the network to someone
  reading over a shoulder.
- **Relayed reports have two people**: the person who spoke and the operator who typed. Both
  recorded; second-hand records always require verification.
- **No promised transcription accuracy on radio audio.** HF voice defeats speech models. The
  operator's typing is the record.
- Where radio isn't available, communities are **relay-only**, not excluded. Someone carries reports
  to a coverage point.

### 5.9 Connection points

Communities hold detailed knowledge of where signal exists, where it works best, where community or
private internet is available, where pines can be bought, and which places are suitable to *stay* for
the length of a call. None of this appears on operator coverage maps.

A connection point is not judged by bandwidth. Record **safety, privacy, whether one can stay,
accessibility, available power and cost** — privacy weighted more heavily where the subject is health.

Surface these alongside stock in the "where can I go" flow. **Reaching one may cost travel, money and
risk** — an activity designed to avoid a journey can require a journey first.

**Possible operator model, flagged for discussion not implementation.** The village-phone precedent
suggests giving connectivity nodes an independent economic reason to exist. The scarcity has moved
from handsets to connection — saldo, data, pines, power, somewhere safe to stand. A person who makes
connecting cheaper for their neighbours makes Convite work better for everyone.

**But: connectivity commerce is acceptable; goods commerce is not.** Whoever decides who receives
donated goods must not also be selling to the same people. Keep `nodos` and `puntos_conexion` as
separate records even when the same person runs both, so convergence is always visible.

### 5.10 Permissions and multi-tenancy

- **The approving body sets a capability ceiling** per organisation at approval time.
- **The organisation administers freely below it** — invites, roles, suspension, removal, with no
  Convite approval for individual staff.
- **Delegation cannot escalate.** Enforced in row-level security, not the UI.
- **Membership is a join table.** A person can be a lanchero for one organisation and a community
  council delegate for another, with different permissions in each.
- **Offboarding is first-class.** Termination cancels active run assignments. Address-level access
  auto-suspends after 45 days of inactivity — the default drifts closed.
- **Separation of duties.** Whoever confirms a need is real is not whoever decides it gets skipped.

### 5.11 Data protection

Under Ley 1581: the partner organisation is **responsable del tratamiento**; Convite is **encargado**,
processing only on their instruction. Written before launch.

- Export everything, any time, in open format
- On termination: handover and deletion, no residual retention
- No sharing with third parties, no secondary use
- SIC database registration where the entity's size requires it
- Prior, express and informed authorisation, with consent text at first contact
- Full audit trail: actor, action, entity, before and after, timestamp

**Public view is aggregated by design** — municipality-level totals only. Enforced in the database,
not the frontend.

---

## 6. Mapping to ASOREDIPARCHOCÓ's plan

Their twelve-month response plan, against what Convite provides:

| Their component | Convite | Notes |
|---|---|---|
| Telemedicine platform, clinical record | **No** | Separate platform, separate regime. We integrate. |
| Banco de medicamentos | **Yes** | Inventory, matching, distribution, delivery evidence |
| Insumos for diabetes (glucometers, strips, lancets) | **Yes** | Catalogue items with consumption-based reordering |
| Conectividad — mobile data for 120 coordinators | **Partly** | `puntos_conexion` maps where connection is possible; procurement is theirs |
| Satellite viability study, terminals, backup power | **Informs** | Results become connection-point records |
| 600 prenatal kits, 200 birth kits | **Yes** | Catalogue, distribution, delivery confirmation |
| Banco de insumos para vivienda (zinc, madera, clavos) | **Yes** | Same engine, different catalogue |
| "Apadrina una partera y su casa" | **Yes, with work** | Earmarked funding tied to one beneficiary end-to-end; needs a sponsorship record |
| Transporte y referencia (parteras to Medellín/Bogotá) | **Yes, new** | Transport of people, with lodging, food, accompaniment, return leg |
| Semáforo de riesgo (red/orange/green) | **No** | Clinical triage. Theirs. |
| Anticiparnos al parto — two-week horizon | **Adjacent** | Anticipatory logistics: pre-position supplies and transport for known upcoming needs |
| Descentralised territorial purchasing | **Yes** | The third supply mode; drove a design change |
| Seguimiento de las 1.600 | **Yes** | Silence alerts against per-community check-in intervals |
| Inventario, distribución, evidencia de entregas | **Yes** | Core |
| Reportes periódicos al financiador | **Yes** | Audit trail and aggregate reporting |
| Protección de datos | **Yes** | Section 5.11 |

**Two things their plan surfaced that we hadn't modelled:** transport of people, and funded local
purchase as a supply source. Both are now requirements.

**One thing they asked for that we should decline:** the telemedicine platform. Saying so plainly is
better positioning than agreeing and underdelivering.

---

## 7. Pilot

**Fifty parteras. Two or three municipalities. One supply category. One month.**

Not 1,600. Their own plan applies this discipline — excluding 6,000 gestantes from telemedicine for
want of staff. What breaks with fifty is cheap to fix; what breaks with 1,600 costs the network's
trust, and that doesn't come back.

**Prerequisites, in dependency order:**

1. Meta business portfolio verification status confirmed — **longest pole**; unverified caps at 250
   unique contacts per 24 hours
2. A **new SIM**, not an existing staff line
3. Utility templates submitted for approval
4. Partera directory with phone and municipality
5. Named verifier, with budgeted time

**Success measures:**

- Median time from `RECIBIDO` to `VERIFICADO` under 24 hours. If it drifts, the answer is another
  person, not more automation.
- Proportion of requests reaching `ENTREGADO`, and median days to get there
- Distribution of stuck-states — which side of the market is actually thin, measured rather than
  assumed
- Reports arriving by channel — does SMS and callback reach people WhatsApp doesn't
- Silence: communities exceeding their check-in interval
- **Whether parteras keep reporting in month two.** The only measure that matters.

---

## 8. Open questions

- **Meta portfolio verified?** Determines the whole calendar.
- **Which existing radio nets operate in target communities, and where is use safe?** Diócesis,
  health secretariat, Defensa Civil.
- **Marine VHF among lancheros** — an existing network we could ingest from rather than build.
- **Starlink terminals** — which communities, and who administers them. Changes what tier 3 means.
- **Who inside the partner holds `org_admin`**, realistically, given workload.
- **Cold chain** — what storage exists at nodes, and which routes can carry insulin.
- **Allocation policy** — the rule for who waits when supply falls short. Not designed yet, and the
  most politically loaded component in the system.
