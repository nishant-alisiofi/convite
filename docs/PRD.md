# Convite — PRD for the remaining work

**Status:** M1–M3 shipped and verified against a live database. M4–M12 remain.
**Last updated:** 13 August 2026.

This document covers what is left. It is not a restatement of the build prompt — it records
what changed once the thing was actually built, which decisions are blocking, and what each
remaining milestone has to prove before it counts as done.

---

## 1. Where things stand

| | |
|---|---|
| Database | Supabase `convite`, us-east-1, ref `kjwkvulmsjffzhuchwpy` |
| Migrations | 18, all applied |
| Tests | 116 passing against the live database |
| Seed | 13 communities around Quibdó, 36-edge directed route graph, 26 catalogue items, 4 offers, 1 boat |
| Deployed | Nowhere yet |

**Built:** the schema and its constraints; the matching engine and job queue; magic-link auth
with an admin-managed staff allowlist; RLS for all five roles; the Tablero.

**Verified working end to end:** magic-link sign-in → allowlist check → Tablero rendering
live data through RLS.

**Not built:** every inbound channel. Nothing has ever received a real message. The entire
I/O layer — normalizer, WhatsApp, IVR, the adaptive link policy — is ahead of us, and so is
everything downstream of dispatch.

### What the build changed about the plan

Four things we learned by building that the spec did not anticipate:

1. **`SIN_RUTA` needed a second meaning.** A community cut off from the main warehouse but
   holding its own half-empty acopio was classifying as `SIN_EXISTENCIA`, which sends a
   coordinator hunting donations when 180 mercados are sitting one closed river leg away.
   The engine now distinguishes "nothing exists" from "it exists and cannot get here", with
   a different sentence for each, because they are different phone calls.
2. **Perishables need a departure check, not just an expiry check.** The first live run
   proposed shipping Saturday's cooked lunches on Sunday's boat. Filtering offers already
   expired *now* is not enough; they have to survive until the transport leaves.
3. **Supabase grants everything to `anon` by default.** Our own tables escaped it, but
   PostGIS's metadata did not, and we cannot revoke it — those objects belong to
   `supabase_admin`. Resolved by not exposing PostgREST at all (see §3).
4. **The public boundary has to be tested against the database.** Three of the four issues
   above were invisible until the migrations ran somewhere real. Any milestone whose
   acceptance is a security property gets a database test, not a UI check.
5. **Magic links do not arrive as `?code=`.** Supabase delivers the token in the URL
   *fragment*, which a browser never sends to the server, so a callback that reads only
   `?code=` bounces every real sign-in back to the login page. Fixed by handling
   `token_hash` + `verifyOtp` — the server-side flow, and the only one that works without
   JavaScript. Found by actually clicking the link rather than by reading the code.

---

## 2. Decisions that block work

These need answers from the team. Each one gates a milestone.

| # | Decision | Blocks | Recommendation |
|---|---|---|---|
| D1 | **Is SMS in v1?** §13 says WhatsApp only; 2.14 requires a one-segment SMS fallback and 2.13 ranks SMS as the *least* fragile channel; M10 is an IVR milestone. These cannot all be true. | M6, M10 | Yes. SMS is the channel that reaches tier 3–4 communities. Amend §13. |
| D2 | **Which SMS/voice provider?** | M6, M10 | Not Twilio. Colombian long-code A2P delivery through international routes is unreliable; use a local aggregator (Hablame, Masivian, InfoBip) or a carrier short code arranged by the partner. Humanitarian short codes are sometimes free. |
| D3 | **Which partner's WABA**, and do we have a phone number id and a System User token? | M5 | Unblocked for building — the channel sits behind a port with a simulator driver — but M5 cannot be *verified* without it. |
| D4 | **Have the five utility templates been submitted?** | M5, M6 | Start now regardless of code progress. Approval takes days and nothing outbound works outside the 24-hour window until they clear. |
| D5 | **Where does the app server run?** Manuel is unlikely to choose Vercel. | Deployment, M6 | Railway or Render, us-east to sit beside the database. Fly.io is the one option with a Bogotá region if latency to Colombian coordinators matters more than co-location. |
| D6 | **Does `mapa_publico` keep `agrupador`?** 2.4 says municipality-level counts only; the view in §5 also groups by a sub-municipal field. | M12 | Drop it. One-line change, and 2.4 is explicit about the threat model. |
| D7 | **What can `lectura` see?** Currently `mapa_publico` and nothing else, which is the literal reading of §11. | M12 | Confirm. If a donor or partner login needs more, specify what and we add an internal aggregate view. |
| D8 | **Transcription provider**, and is it acceptable that voice notes containing names, locations and health details leave our infrastructure? | M4, M5 | Needs a decision before the first real voice note. Self-hosted Whisper is viable if not. |
| D9 | **Data retention.** Nothing currently expires. | Cross-cutting | For household data in a conflict zone, deletion is a protection measure. Set a policy before launch. |
| D10 | **WhatsApp or a mobile web app for community intake?** Under active debate. | M5 vs a web driver | Both, but not equally. WhatsApp for rural demand-side intake — it is zero-rated on Colombian prepaid plans, store-and-forwards on bad signal, and needs no install. A mobile web form is a good *donor* channel in Quibdó city and costs little, since the normalizer and pipeline are shared behind the channel port. See §9. |

### Spec conflicts to resolve

Beyond the blocking decisions, three places where the document contradicts itself. All
follow from 2.11 ("free-form in, structured out") having been added after the surrounding
sections were written:

- **§15's error example** «No entendí. Escriba así: 22 12 3» is exactly the coded syntax 2.11
  bans. Replace with a targeted question: «¿Me cuenta qué necesita? Escríbalo con sus
  palabras o mándeme una nota de voz.»
- **§9.3 (daño)** is still a menu tree — list of codes, then severity. Should be the same
  receive → normalize → confirm as everything else.
- **§6.2** still calls `interactive.list_reply` "the primary structured path"; §6.4 forbids
  it. §6.4 wins.

---

## 3. Architecture decisions already taken

Recorded here so they are not relitigated silently.

**No PostgREST.** The app talks to Postgres directly; `conSesion()` assumes the
`authenticated` role and sets the caller's JWT claims, so RLS applies exactly as in the
tests. Supabase is used for identity only. This also closes the PostGIS metadata exposure,
because `anon` has no network path. **Consequence for M12:** the public page serves
`mapa_publico` from our own route, which is better anyway — we control caching and rate
limiting.

**No Google Maps, pending D5.** Of 36 route edges, 22 are river, which Google has no data
for. That leaves six road pairs — not worth a billing account and an IP-restricted key.
Measured OSM coverage of the basin: 115 named places, 1,240 waterways, but only **13 ferry
terminals or piers across the entire basin**, so the landing sites a transporter actually
needs are unmapped in every provider. Recommendation stands: MapLibre with a Protomaps
extract of Chocó, which also works offline. The `rutas.fuente` column already accommodates
Google if that changes.

**Migrations are hand-authored SQL.** drizzle-kit does not generate PostGIS columns, GiST
indexes, partial unique indexes, views, triggers or RLS. `db/migrations/*.sql` is the source
of truth; `db/schema/*.ts` is the typed mirror; `pnpm db:check` surfaces drift.

**The channel is a port.** `lib/canales/` will hold a normalised inbound envelope and two
drivers — WhatsApp and a simulator that needs no credential. The 24-hour window rule lives
*above* the driver, so the simulator cannot let through what production would reject.

---

## 4. Remaining milestones

Sizes are relative (S/M/L), not dates. Dependencies are hard unless noted.

### M4 — Normalizer · L · blocks M5, M10

Free-text and voice into `codigo_item` + `cantidad` + `unidad` + confidence, plus the
clarification queue.

This is the highest-risk milestone in the project. Everything downstream assumes it works,
and 2.12 makes its failure mode explicit: **returning null must be cheaper than guessing.**

- Domain lexicon of Colombian and Chocoano terms — *colada de plátano, panela, pañitos,
  toldillo, chontaduro,* and *mercado* meaning a food parcel rather than a marketplace. A
  generic classifier will mishandle every one of these.
- `texto_original` is never overwritten. Transcripts get corrected; the original does not.
- Confidence threshold below which nothing is assigned and the record goes to clarification.

**Acceptance.** A corpus of real messages classifies or routes to clarification. Named
failing cases that must behave exactly as specified: «🍲 90» yields **no quantity**;
«Muchas cosas!! De todo!!!» yields **no category**; «comidas preparadas para mañana» sets
`perecedero` and `vence_en`. Never guesses, never drops, always keeps the original.

**Risk.** The corpus does not exist yet. Without real messages this milestone is guesswork —
see §6.

### M5 — WhatsApp intake · L · depends on M4; D3/D4 to verify

Webhook with signature verification and idempotency, the two-exchange flow, GPS pin capture,
voice-note pipeline, folio reply.

- Record is created **on receipt, never on confirmation** (2.13). The confirmation is a
  courtesy and a correction opportunity, never a gate.
- Media: download immediately, strip EXIF, store our own key. Retry a failed provider
  download with backoff for 24 hours; keep the message record either way.
- `conversaciones.expira_en` is 7 days, already enforced by a check constraint.

**Acceptance.** A free-text message and a voice note produce the same `reporte` shape; a
low-confidence input triggers exactly one targeted question, not a menu; the same webhook
payload twice creates one row.

**Note on verification.** Built and tested against recorded Meta payloads with locally
computed signatures — no account needed. The live-number check becomes a deferred item that
runs the same contract test once D3 lands.

### M6 — Adaptive link layer · M · depends on M5, D1, D2

Link-quality telemetry, the two policy functions, the piggyback outbound queue. Columns and
`salidas_pendientes` already exist.

- `queSolicitar(contacto)` — good link offers voice notes; weak link asks for a few words;
  no sustained data session means SMS or a callback, not WhatsApp.
- `comoConfirmar(contacto, mensaje)` — **the reply channel need not be the intake channel.**
  Someone who walked to a coverage point, sent a voice note and walked home is unreachable on
  WhatsApp by the time we answer.
- No code path sends unconditionally.

**Acceptance.** A contact whose messages never reach `delivered` stops being offered voice
notes and gets a one-segment SMS instead; five queued messages deliver as one digest when
they reappear.

### M7 — Verification and the audio inbox · M · depends on M5

Queue sorted by urgency then age, inline playback, transcript correction, duplicate marking,
promotion to `pedido`.

RLS already enforces that only a verificador (in their communities), coordinador or admin can
do this. **Acceptance:** nothing reaches `pedidos` without a human action.

### M8 — Maps, routes, first-mile pickup · L · depends on D5

Coordinator map with precision-aware markers, the manual river-route editor, pickup
clustering.

- **Precision rendering is the thing an information-management team checks first.** `gps` is
  a pin; `centroide` a dashed ~1000 m circle; `referida` a visually distinct ~2000 m circle.
  Every seeded community is `centroide` today, so the map must draw circles from day one.
- Route lines are **schematic dashed connectors labelled with time and mode**, never a line
  pretending to trace the real path. Drawing a `lancha` leg straight across land is its own
  version of inventing a coordinate.
- The river-route editor is a first-class screen, not an afterthought.
- Pickup clustering is the one place road routing genuinely helps. The current pickup range
  is a provisional 15 km straight line, to be replaced here.

**Acceptance.** A `lancha` route can be created and edited with no external call; non-GPS
reports render as circles; six offers in three neighbourhoods produce one ordered run.

### M9 — Capacity to dispatch · L · depends on M8

Capacity registration, planner, manifest PDF with map, 4-digit codes, allocation logging.

**Acceptance.** Dispatching with insufficient supply is blocked until a
`decisiones_asignacion` row exists. The table and its policies are in place: a despachador
can only write one in their own name, and no role can edit or delete one afterwards.

Also unblocks the transporter time-window policy (`convite_conduce_hacia`), which is written
but untested because nothing has been dispatched yet.

### M10 — IVR intake · M · depends on M4, D1, D2

Missed-call detection, automatic callback, single-level menu, recording, transcription into
the same normalizer. At most one level: «1 pedir ayuda, 2 confirmar entrega, 3 reportar un
daño, 0 hablar con una persona», then record.

**Acceptance.** A caller with zero balance and one bar of signal completes a report end to
end with no data session.

Deliberately ahead of the public view: voice is the most robust channel under weak signal,
and communities that cannot sustain a WhatsApp upload can still complete a call.

### M11 — Delivery confirmation and silence alerts · S · depends on M9

Code confirmation across channels, the daily silence job, damage → route deactivation with
human confirmation.

Silence is a signal, not an absence of need. The seed already sets shorter check-in intervals
for tier 3–4 communities.

### M12 — Public view · S · depends on D6, D7

Aggregated-only page. **Acceptance:** an unauthenticated request cannot obtain any
coordinate, community name or phone number *by any route, including direct API calls.* Since
we do not expose PostgREST, this is served from our own route and the test asserts the whole
surface, not just the page.

---

## 5. Design system

Established while building the sign-in screen, so later screens do not each invent their own.

- **Icons: Lucide** (`lucide-react`). One family, stroke icons, always paired with a text
  label — an icon-only control is unusable for someone meeting the system once a month.
- **Palette: Chocó.** `selva` (rainforest green) as the primary, `atrato` (the river's
  sediment ochre) for waiting states, `barro` warm neutrals instead of clinical grey.
  Defined as Tailwind theme tokens in `app/globals.css`.
- **Colour carries meaning and nothing else.** Each board state owns one hue; everything
  outside them stays quiet. A dashboard shouting in ten colours is one where nobody notices
  the urgent row.
- **No client JavaScript unless a screen genuinely needs it.** Sign-in and Tablero ship none.
  Section 10: it has to work on a laptop over a weak connection.

---

## 6. Cross-cutting work, in no milestone

Easy to lose because the build prompt does not list it.

- **Deployment.** Nothing is deployed. Needs D5, plus a worker process for the job queue —
  the matcher must react when a boat is offered, not once a day.
- **Privacy policy and legal basis.** We hold phone numbers of people who never logged in and
  never saw a policy screen. Colombia's Ley 1581 de 2012 governs this; it needs a lawyer, not
  an engineer. The draft policy reviewed on 13 August cannot be used as written — it says
  inventories and needs are public, which is the opposite of 2.4.
- **Third-party disclosure.** Message content goes to Meta and voice notes to a transcription
  provider. "We don't sell your data" is true and insufficient; the policy must name the
  processors.
- **No analytics on authenticated routes.** A URL like `/reportes/472` leaks an identifier to
  the analytics vendor, and RLS cannot stop it.
- **Backups and restore drill.** Supabase takes backups; nobody has tried restoring one.
- **`CONVITE_TEMPORADA` is still an env var.** Getting the season wrong silently changes which
  communities the engine believes are reachable. It should be an admin-controlled setting with
  an audit row — natural fit for M8 alongside the route editor.
- **Observability.** No error tracking, no alerting on a stuck job queue. A silently failing
  matcher looks exactly like a quiet week.
- **Node 22.** `@supabase/supabase-js` 2.112 needs a native WebSocket that Node 20 lacks.
  Next.js polyfills it so the app runs, but plain scripts using the SDK crash. Move the
  engine to 22 rather than leaving that trap for the next person.
- **Supabase Auth URL config** is environment-specific: site URL and redirect allow-list must
  include each deployment origin, and the magic-link email template must point at
  `/auth/callback?token_hash={{ .TokenHash }}&type=magiclink`. Set for localhost; **not yet
  set for any deployed environment**, and sign-in will silently fail without it.
- **The offer aggregation gap.** An offer must currently cover a whole request on its own.
  Eight people offering two mercados each will not satisfy a request for twelve, even though
  together they would. Splitting across offers is allocation, and §13 says humans decide — so
  this is a UI affordance in M9, not matcher logic.

---

## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **No real message corpus for M4** | The normalizer is the highest-risk component and cannot be validated on invented examples. Colombian and Chocoano vocabulary is exactly where a generic classifier fails. | Collect real messages before M4 starts — from the partner's existing WhatsApp line, a pilot group, or a Kobo/RapidPro deployment if one exists in Chocó (§14 Q5, still unanswered). |
| **Partner WABA and template approval have external lead times** | Gates M5 verification and all outbound. | Start D3 and D4 now, in parallel with M4. |
| **Seed coordinates and travel times are approximate** | A route plan built on invented river times sends someone on a trip that does not work. | Replace with field data before anyone plans a real trip. Every community is marked `centroide`, so the honesty is at least visible. |
| **Landing sites are unmapped everywhere** | The one geographic feature transporters need is absent from every provider. | Field team contributes to OSM; it propagates into our basemap and helps everyone else working there. |
| **Inventory staleness** | §14 Q4 is still unanswered — we do not know who counts stock or how often, so we cannot calibrate how loudly to warn. The seed deliberately includes a 19-day-old count. | Answer Q4 before M8's inventory screen. |
| **Season handling is manual** | Wrong season silently changes reachability across the basin. | Make it an admin setting with an audit trail. |

---

## 8. Non-goals for v1

Unchanged from §13, minus the SMS/IVR contradiction that D1 resolves:

- Multi-city switching. The schema is scoped by `organizacion_id`, but v1 ships one basin.
- Offline mobile app. Kobo and ODK already solve this; integrate later via API.
- Automated allocation rules. Humans decide who waits, and the decision is logged.
- Multi-language UI beyond Spanish.
- Push notifications, native apps, real-time websockets.
- Any ML beyond speech-to-text and the normalizer's classification.

---

## 9. What to do next

0. Answer **D10** — it decides whether M5 is the next build or a web intake driver is.
1. Answer **D1** and **D2** — they gate two milestones and have procurement lead times.
2. Start **D3** and **D4** with the partner in parallel with everything else.
3. **Collect a real message corpus.** M4 should not start without one.
4. Then build M4.
