# Convite — Product Requirements

**Version 3.0 · August 2026 — final**
Written against the running product at `staging.convite.ai`, not ahead of it.

Territory: the Colombian Pacific littoral — Chocó, Valle del Cauca, Cauca
Partners in conversation: ASOREDIPARCHOCÓ (1,600 parteras, 31 municipalities), Fundación Herencia
de Timbiquí (Timbiquí, Guapi, López de Micay)

---

## 0. How to read this

Versions 1 and 2 were written before there was a product. Version 3 is written after seeing one, and
the difference matters: **several screens solve problems better than the specification described
them.** Where that is true, the built behaviour is now canonical and the spec has been rewritten to
match it — not the other way round.

The document has four jobs:

- **Part II** records what is built and correct, including copy that is load-bearing and must not be
  "tidied up" by a future contributor.
- **Part III** lists defects.
- **Part IV** lists genuine gaps, in priority order.
- **Part V** covers partners, pilot and sequence.

Parts of v2 that remain accurate — the phase model, the principles, the marketplace framing — are
kept in condensed form in Part I rather than repeated at length.

---

# Part I — The model

## 1. What Convite is

**A marketplace for humanitarian supply in territories where connectivity fails.** Three sides:
demand (communities), supply (nodes, offers, local purchase), and capacity (whoever is travelling).

The matcher determines, for each open request, **which side is missing.** That classification is the
product. "12 solicitudes abiertas" helps nobody; five buckets naming what is absent turns each number
into a phone call to a specific person.

## 2. What Convite is not

- Not a clinical record system. No historia clínica, no diagnoses, no prescriptions.
- Not emergency dispatch. An obstetric emergency means calling **123**.
- Not a radio network operator. We ingest from nets that already exist and are already accepted.
- Not a learning platform. Organising a class is ours; delivering curriculum is not.
- Not a group chat. WhatsApp groups keep doing what they do well; we plug in beside them.

## 3. Phases

| Phase | Dominant question | Marketplace? |
|---|---|---|
| **Impacto** (0–72h) | Who is cut off, what broke | **No.** Reach and the silence map. |
| **Emergencia** (days–weeks) | Who needs what, can anyone get there | **Peak.** |
| **Recuperación** (months) | What does rebuilding require | Yes — bigger units, systematic assessment. |
| **Ordinario** (ongoing) | Keeping people supplied and served | **Partly.** Scheduling, not scarcity matching. |

**Mode is per community, not global.** A river vereda can be in `impacto` while the cabecera has
moved to `recuperación`. Phase changes defaults; it never changes the navigation.

## 4. Principles

1. **Asking for help never costs money.** The missed-call callback is the load-bearing proof of
   this, not an optional extra.
2. **Free-form in, structured out.** No forms, no menu trees for reporters.
3. **The normalizer returns null before it guesses.**
4. **No flow requires a live session.** Records are created on receipt, never on confirmation.
5. **Never invent a coordinate.**
6. **Inventory is never a promise.**
7. **The matcher proposes; a person commits.**
8. **Show less in public, on purpose.**
9. **Battery is scarce.**
10. **Human accompaniment is part of the system, not a shortfall of it.**

### 4.1 The missed-call callback is non-negotiable

Without it, Convite is a WhatsApp bot — which is what everyone else has, and it reaches exactly the
people who already have alternatives. It is the only channel satisfying all four constraints at once:

| Constraint | Why voice callback is the only answer |
|---|---|
| Zero balance | The call never completes, so no charge is ever raised |
| No literacy | Nothing to read or type |
| No touchscreen skill | No gesture at all — dial, and the system does the rest |
| Weak signal, low battery | Voice connects where data fails; the screen stays off |

**It is in the pilot, not deferred.** A pilot without it validates the easy half of the problem.

#### 4.1.1 The system disconnects, not the caller

Respond to the inbound leg with `<Reject reason="busy"/>`, which signals busy **before answer
supervision** — the call never reaches answered state, so the caller is never billed. **The person
simply dials.** They do not hang up quickly, do not time anything, and do not need to know a trick.

Use `reason="busy"`, not `reason="rejected"`: busy signals unambiguously before answer, and the whole
guarantee rests on never completing.

**Copy must say «solo marque», never «marque y cuelgue».** The second asks them to act and implies a
race. Fix on the landing page, in templates, and on the printed card.

This is the ZipDial pattern, proven at national scale in India: the missed call is a free signal, and
the system responds to it.

#### 4.1.2 What comes back also adapts

The response need not be a voice callback, and voice is the most expensive thing in the system.
Follow the §20 link profile:

| Contact | Response |
|---|---|
| SMS history, reads | **SMS reply** — fractions of a cent |
| No literacy, or no reply to SMS | **Voice callback** — expensive, and the reason the channel exists |
| Unknown, first contact | SMS first; callback if no reply within a window |

This cuts the voice bill substantially while keeping the guarantee intact for the people who need
voice.

#### 4.1.3 On the callback itself

One short prompt, then record. **At most one menu level** — *pedir ayuda · confirmar entrega ·
reportar daño · hablar con una persona* — because the normalizer does the classification the old DTMF
tree existed for. Shipping with zero levels, straight to record, is acceptable.

Read the folio back digit by digit. **Record prompts with a local voice, not TTS**: clearer, faster,
and it allows Emberá and Wounaan versions later.

**A registration call cannot navigate an IVR** — never put the Convite number behind a phone menu.

#### 4.1.4 This is not voicemail

What is specified is **outbound-initiated recording**: we call, we prompt, we record. Voicemail means
they call us and leave a message, which requires the call to *connect* — so they pay, and with zero
balance they cannot. Inbound voicemail is a reasonable fallback for someone with balance who would
rather not wait. It is never the primary path.

#### 4.1.5 Spend caps before the first live call

Two callbacks per number per 30 minutes · five per day · global daily minute ceiling with automatic
shutoff · coordinator alert at 70%.

On Twilio, enforce the ceiling with **Usage Triggers** (`UsageCategory=calls-outbound`,
`TriggerBy=price`, `Recurring=daily`) as a platform-level backstop underneath our own per-number
caps, so a bug in our queue cannot run an unbounded bill.

#### 4.1.6 Provider: Infobip for voice, Cloud API direct for WhatsApp

**Voice and SMS → Infobip.** Two capabilities decide it:

- **Early media is supported**, enabled per account by their team, and they recommend it. That solves
  the confirmation problem at the telephony layer — an announcement audible during ringing, before
  answer supervision, so the caller hears «lo llamamos ya» and is never billed. Twilio's `<Reject>`
  cannot do this: it is terminal and nothing plays before it.
- **Missed-call handling is a named setting**, not something assembled from primitives.

Their Calls API is the right shape — API-only, your application implements the voice logic and
controls calls, conferences, dialogs, recordings and media streaming over PSTN, WebRTC or SIP. You
lease a Voice number from them; one is required for inbound calls and also for a dedicated caller ID
on outbound, which satisfies the same-DID-both-legs requirement (§4.1.1).

**Recordings, dialogs and media streaming must be activated by an account manager** — a relationship
rather than a self-serve toggle. Raise it in the same conversation as early media and Colombian
termination rates.

**WhatsApp → Meta Cloud API direct**, under the partner's own WABA, with us as Tech Provider.
Infobip is a Meta BSP and could host it, but that inserts a third party into the chain that the
data-protection story rests on: the partner is *responsable del tratamiento*, we are *encargado*
(§23). A BSP also adds a per-message margin over Meta's rates, which matters more once service
messages become billable on 1 October 2026.

**Numbers cannot be consolidated regardless.** A number registered to WhatsApp Business can no longer
be used in the WhatsApp app and is dedicated to that channel, so voice/SMS and WhatsApp are separate
numbers whether or not the vendor is the same.

*Open question for Infobip: will they provision WhatsApp against a WABA the partner owns, rather than
one of theirs? If so, single vendor with ownership intact becomes the obvious answer.*

#### 4.1.7 The recording pipeline

Infobip's Calls API is event-driven: actions trigger an event to your application confirming
completion or raising an error, and inbound calls produce an event carrying TO, FROM and the rest. A
finished recording fires an event — no polling.

```
CALL_RECEIVED            → reject before answer (§4.1.1)
callback → prompt → record
recording event fires    → GET /calls/1/recording/file/:file-id   (bytestream, not a URL)
                         → store in our own storage, keep the key
                         → DELETE from the provider
                         → self-hosted Whisper → transcript + confidence
                         → normalizer → reporte in RECIBIDO
                         → human verification queue
```

Recordings are searchable by `callId`, `conferenceId` or `dialogId`. The file arrives as a
**bytestream rather than a signed URL**, which is better for us — the audio moves server to server
and never becomes a link that can leak.

**Two rules that must not be relaxed:**

- **Delete from the provider once we hold it.** The Ley 1581 position is that audio lives in
  infrastructure the alliance controls. Copies left on a vendor platform quietly make them a second
  processor holding health-adjacent recordings.
- **Provider-side transcription stays off**, wherever it is offered. Whisper self-hosted is the whole
  privacy answer (§7); using the provider's transcription undoes it.

Multichannel recording — each participant isolated on a separate channel, for tools that lack speaker
diarization — is not needed for a single reporter speaking alone. It becomes relevant later for radio
nets or any call carrying a coordinator and a reportante together.

---

# Part II — What is built

This part is descriptive. It records current behaviour as the specification.

## 5. Tablero

Five buckets, each with a plain-language subtitle naming what is absent:

| Bucket | Subtitle |
|---|---|
| Listos para despachar | Hay ruta, hay con qué y hay quién lo lleve. Falta que alguien confirme. |
| Esperan transporte | Hay con qué y se puede llegar, pero nadie va para allá. |
| Esperan donación | No hay en bodega ni nadie lo está ofreciendo. |
| Incomunicadas | No hay cómo llegar en esta temporada. |
| En camino | Ya salieron. |

**The `motivo` strings are the product and must be preserved.** They name the node, the staleness and
the gap in one sentence a coordinator can act on:

> «Hay 40 bidones de agua en Acopio Tagachí (contado hace 19 días), pero nadie va para Winandó en los
> próximos 14 días.»

> «Se necesitan 40 kits de curación para Pizarro y solo hay 10 en Acopio Pizarro. Nadie más lo está
> ofreciendo: falta conseguir el resto.»

> «Docampadó está incomunicada: en temporada de lluvias no hay ninguna ruta abierta desde las
> bodegas. Mientras no se abra un paso, no hay cómo mandar nada.»

Note the third: it distinguishes *seasonally* impassable from currently blocked. That distinction was
not in the spec and should stay.

Each row carries community, item, families, channel tag and age.

## 6. Verificación

Filters: Todo · Necesidades · Daños · Sin clasificar. Standing text:

> «Todo lo que entra queda registrado apenas llega, sin que nadie lo apruebe. Nada se convierte en
> pedido hasta que una persona lo lee, lo cree y lo firma.»

Per item: folio, community, municipality, channel tag, age, the original message in quotes, proposed
classification, families, and reporter name. A `Por qué el clasificador lo lee así` disclosure.

Audio items show a player, duration, **confidence as a percentage**, the transcript, and a correction
field. Load-bearing copy:

> «Lo que oyó la máquina se conserva aparte; la corrección no lo borra.»

Actions: `Verificar y crear pedido` · `Solo verificar` · `Marcar duplicado`.

**`sin clasificar` items refuse to guess** — «Nadie pudo clasificarlo. ¿Qué es?» with a classify
action. This is correct and matches principle 3.

**Radio items are tagged `segunda mano`.**

### 6.1 Damage verification exceeds the specification

A damage report lists the route segments it *might* have closed, each with its own `Cerrar este
tramo` action, and — critically — shows the downstream consequence before the click:

> Tagachí → Beté · lancha · 35 min · *cerrarlo deja sin paso a Bellavista, Beté*

> «Un reporte no cierra un tramo. Lo cierra una persona, después de verificarlo, y queda su nombre —
> un solo reporte exagerado no puede incomunicar una cuenca.»

**This is a decision aid, not a confirmation dialog.** Preserve the pattern and extend it anywhere
else an action has non-obvious downstream effects.

### 6.2 Derivaciones

A separate block for findings that are verified but are not cargo:

> «Verificadas y atendidas por una visita, no por una caja. No entran a despacho: no son carga.»

This is the `via_de_respuesta` concept, already built. It should extend to a third value for findings
belonging to another organisation's mandate (see §17.4).

## 7. Mapa

OpenStreetMap base. Header shows season and segment count.

**Precision is rendered honestly**, with a legend:

| Class | Rendering | Copy |
|---|---|---|
| Punto exacto | Pin | Pin de GPS. Alguien estuvo ahí con el teléfono. |
| Centroide · ~1000 m | Dashed circle | El centro del poblado según el gazetteer, no un punto visitado. |
| Referida · ~2000 m | Dotted circle | Nos la contaron por radio o por un tercero. |

> «Los círculos son el margen de error de cada ubicación, no el tamaño de la comunidad.»

**Two pieces of copy that are better than anything in v2 and must not be edited:**

> «Las líneas son esquemáticas: unen origen y destino con el modo y el tiempo, y no trazan el camino
> real. No hay cartografía del canal, así que una lancha dibujada recta cruzando tierra firme sería
> tan inventada como una coordenada.»

> «Sin ubicar, y por eso fuera del mapa: Acopio Yuto. Aparecen acá para que se les pueda tomar el
> punto, no se les inventa uno.»

The second is the honest answer to missing data: name the absence, offer the fix, invent nothing.

**Center location picker** with `Usar mi ubicación`, a tap-to-place pin, and an explicit
`Radio de precisión (m)` field. Correctly notes: «Este centro no tiene ubicación todavía, así que
Recogidas no tiene desde dónde medir.»

## 8. Inventario

Two columns per catalogue item: **PIDEN** (families, communities, orders) beside **EXISTENCIAS**
(total, then per node with `contado hace N días`).

Counts older than 14 days are flagged `desactualizado` and the item carries a line:

> «Hay pedidos abiertos y el conteo más viejo de este artículo ya pasó los 14 días. Conviene contar
> antes de prometer.»

Header summarises: `8 artículos con pedidos abiertos · 4 con conteo desactualizado`.

## 9. Rutas

> «Los tramos fluviales los escribe quien conoce el río: no hay proveedor con datos del Atrato, y este
> grafo es el que el emparejador usa para decidir a dónde se puede llegar. Nada en esta pantalla
> consulta un servicio externo.»

Entry form: origen, destino, modo, temporada, minutos, distancia, costo, notas. Two field hints that
should be preserved:

> Minutos — «Vacío si nadie lo ha cronometrado.»
> Distancia — «Vacío en tramos de río: nadie ha medido el canal.»

Seasonal pairs are stored as separate rows with **different times and different costs**, and are
directional. `Bellavista → Beté` at 165 min in lluvias and 215 min in seca, with `Beté → Bellavista`
at 110 and 145 — downstream is faster. That asymmetry is correct and must not be collapsed.

## 10. Recogidas

First-mile pickup, clustered by barrio, ordered as one run.

> «Se agrupa lo que está a menos de 400 m, que es más o menos una cuadra larga de Quibdó. Lo
> perecedero va primero: marca la hora de salida de toda la vuelta.»

Per stop: sequence number, donor, item, quantity, address in local terms («Barrio Yesquita, casa de
portón azul»), the original message, distance, and an expiry badge for perishables. Node selector at
top; header reads `6 paradas en 3 barrios · una sola vuelta`.

## 11. Conexión

Connection points, judged on the right axes:

> «No se miden por velocidad, sino por si son seguros, privados, alcanzables, con energía, si uno se
> puede quedar el rato de una llamada, y cuánto cuestan — la privacidad pesa más cuando lo que se
> habla es de salud.»

Six ratings per point: Seguridad · Privacidad · Se puede quedar · Acceso · Energía · Costo. Tags for
`Hay señal`, `Internet`, `Venden pines`. Type label (ANTENA, MUELLE). Serves which communities. Free
notes carrying operational reality:

> «Solo entra señal parado en la punta del muelle y cuando sube la marea. Llegar son casi dos horas en
> lancha y no hay dónde cargar el teléfono.»

And the separation of concerns is stated:

> «Estos no son los centros de acopio — conectividad y suministro se llevan aparte a propósito.»

## 12. Envíos

**Capacity-first, which is correct and was a design argument in v2:**

> «El transporte es el lado flaco: existencias se consiguen y tramos se abren, pero que alguien vaya
> esa semana casi nunca. Por eso empieza por quién viaja.»

Registration acknowledges how capacity actually arrives:

> «Casi siempre llega por WhatsApp o por teléfono: alguien avisa que sube el jueves y que le caben
> cuarenta. Anótelo acá y aparece para planear.»

Fields: quién viaja, modo, carga desde, hasta, sale, cupo, notas. Then offered transports with
`Planear este viaje`, and dispatched shipments with a code, mode, stops and capacity used.

## 13. Apadrinar

> «Al padrino se le muestra una etiqueta, nunca el nombre, el teléfono ni la ubicación de la partera.
> Una partera con nombre solo aparece si ya dio su consentimiento.»

Three totals: comprometido · aplicado · disponible para compras. Registration takes a beneficiary
**label** («Partera del Atrato medio»), optional community, sponsor, sponsor type, recurrence,
purpose, amount, and a **consent checkbox that is mandatory when a named community is selected**.

Empty community = fondo común. This is the correct default.

## 14. Comunidades

> «El silencio es una señal, no una ausencia de necesidad — sobre todo en tier 3 y 4, donde casi
> siempre habla más de la señal que de la situación.»

Header: `19 en el registro · 1 en silencio · 6 nunca vistas`.

**The distinction between "en silencio" and "nunca vista" is sharper than the specification and is
now canonical.** A community that has never been heard from is not overdue; it has no baseline.
Copy: «Nunca hemos sabido nada de ella — es alta, no alarma.»

Per community: code, name, type, agrupador, tier badge, families, precision class with radius, check
interval, and last signal with its channel.

## 15. Catálogo

26 items in 7 families. Per item: two-digit code, label, tipo, unit («se cuenta como mercado /
mercados»), a plain description in the reporter's language («Para tensión, azúcar, epilepsia u otro
tratamiento fijo. Díganos cuál.»), and badges for `pide detalle` and `urgencia mín. 3`.

> «El catálogo es dato, no código: se edita acá, sin desplegar nada.»

## 16. Centros

Organisation approval queue. `En revisión` with Aprobar / Rechazar, then all organisations with
status and member count.

> «Los centros que piden operar aparecen aquí. Aprobarlos los deja entrar; rechazarlos los deja
> fuera. Todo queda registrado con su nombre.»

## 17. Public surfaces

Landing page and `/respuesta`. The aggregated view shows counts by zone and category, with an
explanation of what is withheld and why.

---

# Part III — Defects

Ordered by severity.

**D1 · State-dependent copy not updating.** Paimadó sits under *En camino · Ya salieron* while its
motivo still reads «Confirme para despachar». The string is generated for `LISTO` and not
regenerated on transition. Audit every state-dependent string.

**D2 · Correction field pre-filled at low confidence.** Every transcript shown is 55–62%, and
`¿Qué dice en realidad?` arrives pre-filled with the machine's guess. At that confidence a tired
verifier will click `Guardar corrección` without reading. **Below threshold, leave the field blank.**
Above threshold, pre-fill. This is the difference between a correction and a rubber stamp.

**D3 · Item classification appears uncorrectable.** The transcript can be corrected; the proposed
`codigo_item` cannot. These are separate errors — a perfect transcript can carry a wrong category.
The verifier needs both.

**D4 · Locale defects.** `mm/dd/yyyy` in the Envíos date field, in a Colombian product. `todo_el_ano`
renders as a raw enum value in the Temporada dropdown.

**D5 · False precision on perishables.** «vence sáb, 04:23 p. m.» is a computed timestamp leaking
into a human field. Nobody promised 4:23. Round to «sábado en la tarde».

**D6 · Never-seen tier 1 is not the same as never-seen tier 4.** Yuto: tier 1, cabecera, 340 families,
«nunca hemos sabido nada de ella». For a well-connected cabecera that usually means the contact is
wrong, not that they are fine. Escalate separately from tier 3–4 silence.

**D7 · Small-cell disclosure on `/respuesta`.** «Bajo Baudó · Salud · 1 en espera» in a sparsely
populated municipality approaches identifying a household. Suppress cells below a threshold (3–5) and
roll them into an "otras" row. Two zones is also thin enough that zone plus category narrows
considerably.

**D8 · Zero-rating claim on the landing page.** «En los planes prepago del país no consume saldo» is
too strong. The benefit covers text and low-resolution media, not WhatsApp calls, and Claro ties it
to an active package — so someone with a dead balance may not have it, which is exactly the person
the callback exists for. Replace with:

> «En la mayoría de los paquetes prepago del país, los mensajes de WhatsApp no consumen datos. Si no
> hay paquete activo, la llamada perdida siempre funciona.»

**D9 · Catalogue code reads as a quantity.** `12 Agua potable` in Inventario is ambiguous against the
counts beside it. Style the code distinctly or prefix it.

---

# Part IV — Gaps

## 18. Navigation and the two inboxes

**Fourteen flat top-level items**, and three of the newest — Conexión, Apadrinar, Recogidas — are
peers of Ajustes. It will not survive jornadas and evaluaciones.

**Tablero and Verificación are two inboxes.** A coordinator checks two places to know what needs
them, and jornada tasks and allocation decisions will make it four. One typed queue:

```
Bandeja                    ← everything awaiting a person
Mapa
  · Evaluaciones · Rutas · Puntos de conexión
Comunidades
  · Red · Silencio
Agenda
  · Programas · Jornadas · Citas · Envíos y recogidas · Capacidad ofrecida
Existencias
  · Centros de acopio · Inventario · Ofertas · Catálogo
Informes
  · Cobertura · Entregas y evidencia · Apadrinamientos · Exportes
Ajustes
  · Equipo · Organizaciones · Estado
```

**Vocabulary — three levels, and no fourth word.** Avoid «evento»: it is vague and overlaps jornada.
The partners' own word is *jornada*.

| Term | What it is | Scale |
|---|---|---|
| **Programa** | A funded intervention with objective, budget and cadence (§21b) | Months |
| **Jornada** | One occurrence, at a place, on a date (§22) | Many people |
| **Cita** | One person, one time slot (§27b.2) | One person |

A programa contains jornadas and citas, **but not everything belongs to a programa** — an emergency
shipment does not — so programa cannot be the container in the navigation. The section that holds all
three is **Agenda**: things scheduled to happen at a time.

Agenda holds across all four phases, which is the test. Empty in `impacto`, and honestly so —
nothing is scheduled yet. Envíos and recogidas in `emergencia`. Obras and assessment sweeps in
`recuperación`. Citas, talleres and their programas in `ordinario`.

Rutas and puntos de conexión nest under Mapa because you edit them by looking at them. Envíos and
recogidas nest under Agenda because they are the goods legs of a jornada. **Capacidad ofrecida sits
in Agenda, not Existencias** — a lanchero going Thursday is a scheduled thing, not stock, and Envíos
already gets this right by opening with «empieza por quién viaja».

`Centros` is renamed **Organizaciones** and moved to Ajustes; it is the organisation approval queue,
not collection centres. `Centros de acopio` under Existencias is the real thing.

**Phase changes what opens first**, never the structure:

| Phase | Bandeja leads with | Mapa opens on |
|---|---|---|
| Impacto | Silence, unreachable communities | Contact recency |
| Emergencia | Stuck states, matches to confirm | Routes and stock |
| Recuperación | Assessments to review, projects to cost | Assessment coverage |
| Ordinario | Anticipatory proposals, scheduling | Connection points and windows |

**By role:** verificador sees Bandeja and Comunidades. Despachador sees Bandeja, Mapa, Agenda,
Existencias. Coordinador sees all seven. Org admin adds Equipo for their organisation. Director sees
Informes and a read-only Mapa.

## 19. Silence is not on the Tablero

It exists in Comunidades and is well modelled, but a coordinator working the board never sees it. It
is the only signal that fires when **nobody reports**, and it belongs in the unified Bandeja as a
first-class item type.

## 20. Ingestion — verify what is real

Channel tags for `SMS`, `llamada perdida` and `radio` appear on seeded records. Before the pilot,
confirm which are actually wired end to end. **Steps 5–8 of the sequence are the ingestion core and
ship together**; the claim Convite makes is about reach, and a deployment with only WhatsApp reaches
tier 1 and stops.

Specifically outstanding:

- **Missed-call callback** on Infobip, with early media, AMD on the outbound leg, and the spend caps
  and recording pipeline of §4.1.5–4.1.7.
- **SMS long code** from an aggregator — the most robust channel under weak signal, and the adaptive
  layer depends on it.
- **Adaptive link quality**: per-contact profile from delivery callbacks, media success rate, receipt
  lag and hour-of-day. Two policy functions — what to invite, and how to reply. **The confirmation
  channel need not be the intake channel.**
- **Discretion in outbound**: default confirmation carries the folio and nothing else.

## 21. Assessments and recovery

The largest functional gap, and the thing Herencia de Timbiquí is asking for.

**Level 1** (the report) is built. **Levels 2–4 are not.**

**Level 2 — damage becomes a bill of materials.** A verified `93` at severity 2 proposes materials,
transport and labour days. Template-driven, adjusted by whoever does the *asistencia técnica*. This is
what turns damage reporting from information into part of the marketplace.

**Level 3 — the assessment sweep.** A surveyor records every item in scope, not only those that
reported. Census-shaped; provenance is a visitor with a date; expires. **The only mechanism that
finds need in communities with no channel.**

**Level 4 — the territorial picture.** Aggregate by vereda and municipality. The artifact a funder
reads and sponsorship prices against.

**Coverage is the metric**, not damage count: *assessed out of estimated total*, with its date. Forty
of a hundred houses surveyed is a different claim from forty damaged houses.

**Repair is a four-component match** — materiales + transporte + mano de obra local + asistencia
técnica. Stuck-states extend accordingly. *Mano de obra local* is a supply side, not a cost line.

**Assessments are multi-domain**, driven by templates: housing, education infrastructure, health
posts, water, environment, organisational capacity. Every finding carries `via_de_respuesta`:
`convite` (matchable), `derivacion` (another mandate), `sin_via` (recorded, never queued). The
Derivaciones block in Verificación is the seed of this and should extend to the third value.

**Apadrinar already exists but has nothing to price.** A sponsor cannot fund a house until someone has
costed it. Level 2 is the missing link in a chain that is otherwise built.

## 21b. Programas — the layer above jornadas

A jornada is one occurrence. **What an organisation plans and funds is a programa**: an objective, a
target population, a cadence, a budget, and the set of jornadas that realise it over months.

ASOREDIPARCHOCÓ's *plan de respuesta comunitaria a 12 meses* is a programa with three strategies.
Herencia's *Timbiquí Suena* is a programa. Neither is a shipment, and neither fits in a jornada.

### 21b.1 What a programa holds

| | |
|---|---|
| Objetivo | What change is intended, in one sentence |
| Población objetivo | Which communities, how many families, on what criteria |
| Cadencia | Monthly brigade · twelve weekly sessions · quarterly delivery · one-off |
| Duración | Start, end, and whether it renews |
| Presupuesto | Committed, applied, remaining — per programa |
| Financiador | Who funds it and what they need reported |
| Indicadores | Coverage, attendance, delivery, completion |
| Jornadas | The occurrences, planned and actual |

### 21b.2 Seasonal feasibility across a year — the differentiated capability

Rutas already stores travel time **and cost by season**. That makes Convite able to answer, at
planning time, a question no external tool can:

> **Which months is each community actually reachable, and what does the year cost?**

Plan twelve monthly deliveries to 31 municipalities and the system returns a calendar with
reachability per month, cost per month, and the gaps named:

> «Docampadó queda incomunicada de junio a octubre — la jornada de agosto no la alcanza.»
> «En seca, Bellavista → Beté pasa de 165 a 215 minutos y de $420.000 a $480.000. El costo del
> segundo semestre sube 14%.»

**That is found at planning time instead of discovered by a boat.** For a twelve-month plan written
against a funder, it is the difference between a schedule and a wish.

Rules: never fabricate future state beyond seasonality. A route closed by a verified damage report
stays closed in the plan and is flagged as such; we do not guess when it reopens.

### 21b.3 Classes have a roster; aid drops do not

A twelve-week *formación* is the same cohort across sessions, with attendance and completion. A
distribution has different recipients each time.

So `taller` and `formacion` carry **participants that persist across jornadas** — the first thing in
Convite that tracks the same people across events. Attendance is per session; completion is per
cohort.

The §22 rule still binds: **record that someone attended, never what for.** A roster is a list of
names and sessions, not a record of what anyone needed.

### 21b.4 Budget and sponsorship

Apadrinamientos currently point at a beneficiary. They must also be able to fund a **programa** —
which is how «apadrina una partera y su casa» scales into «financia el banco de medicamentos por
seis meses». Same consent rules: the sponsor sees a label and a programa, never a name.

Programa-level totals mirror the ones already built in Apadrinar: comprometido · aplicado ·
disponible.

### 21b.5 Planning flow

```
Seleccionar comunidades en el mapa (§23.5)
  → fijar cadencia y duración
  → el sistema devuelve el calendario: alcanzabilidad y costo por mes
  → nombra lo inviable antes de que alguien lo prometa
  → genera jornadas en borrador
  → cada una se confirma por separado, con nombre
```

Plans diverge from reality. A jornada that happens differently is edited, not deleted, and the
programa shows planned against actual — which is what a funder report needs anyway.

## 22. Jornadas

A health brigade, a distribution, a youth encounter, an assessment sweep: **people and things arrive
at a place, on a date, for a community that must be told in advance.**

| Type | Payload |
|---|---|
| `distribucion` | Goods |
| `brigada` | People with skills |
| `taller` / `formacion` | Facilitator and materials |
| `evaluacion` | Surveyor and a template |
| `obra` | Materials, labour, technical assistance |

The engine does not change; this is a container over the same matching.

**Why it matters beyond features: it keeps the network alive between disasters.** A disaster-only
platform goes dormant, reporters stop answering, and when the next earthquake comes nobody remembers
the number.

Constraints: jornadas must not dilute the stuck-state board — only unmet requirements flow there.
Attendance records **that** someone attended, never what for. Some gaps are **tasks, not matches** —
finding a dentist is a phone call, and the Bandeja must hold both.

## 23. Map as planning surface

The map renders the present; it does not yet plan. Planning an intervention is inherently spatial and
is the thing Herencia de Timbiquí is asking for.

### 23.1 No mode toggle — facts are solid, drafts are dashed

Do **not** build a "current state / planning" switch. Modes require the user to remember which one
they are in, and during an emergency that is a real cost.

Planning is **a draft laid over the facts**, not a different map. This reuses a visual rule the
product already has: a solid pin is a real GPS point, a dashed circle is an estimate. Extend it —

- **Solid** = fact. Open routes, counted stock, confirmed shipments, communities as registered.
- **Dashed** = draft. Proposed stops, the route being composed, coverage that would result.

Nobody needs to be told which is which.

### 23.2 Two entry points, one draft

**Supply-first** is already built: `Planear este viaje` on an offered transport in Envíos. Aníbal is
going to Tagachí on Thursday with cupo 40 — what can he cover on the way.

**Demand-first** is the gap: select an area on the map, see what it needs in aggregate, then ask who
could serve it.

Both produce the same object: **a draft jornada**. Drafts are saveable and there may be several — a
coordinator holds two or three possible runs while waiting on a lanchero. Nothing is committed until
a person confirms, per principle 7.

### 23.3 The draft carries a date, and the date picks the route

Rutas already stores seasonal rows with different times *and* costs — Bellavista → Beté at 165 min in
lluvias and 215 in seca. **A draft dated in October must cost what October costs.** Resolve the
seasonal row from the draft's date, not from today.

Never fabricate future state beyond this. A route closed by a verified damage report stays closed in
the draft and is flagged; we do not guess when it reopens.

### 23.4 Layers

Independently toggleable: pending requests, stock by node, route status, **assessment recency**,
connection points, connectivity tier, communities in silence, last contact.

**Assessment recency is the layer nobody else has.** Communities shade by time since last surveyed,
with never-assessed rendered distinctly. That grey is simultaneously the diagnostic team's next
destination and the honest answer to *how do you know you are reaching everyone*. It is the single
most valuable thing to build for a diagnostic partner.

### 23.5 The selection panel

Draw a polygon, or select by municipality, cuenca or agrupador. The panel returns:

- Communities and estimated families in the selection
- Pending requests by category, and by stuck-state
- **Assessment coverage and its age** — *assessed out of estimated total*, never a bare count
- Which routes serve the area, which are open, and under which season
- Which communities in the selection have never been heard from
- Connection points inside it, with their safety and power ratings

From there: `Armar una jornada` — pick stops, order them, and the route graph returns travel time and
cost for the draft's date. Required capacity is shown against offered capacity, with the shortfall
named. Output is a draft jornada with stops, requirements and a manifest.

### 23.6 Plotting, in two places

**Operational plotting is spatial and lives on the map** — coverage, silence, stock, route status.
This is the planning surface.

**Reporting plotting is what a funder reads and lives in Informes** — coverage over time, delivered by
category, spend against commitment, response-time distribution. Mostly tables and simple bars; nothing
sophisticated is required, and sophistication here would be a distraction.

## 24. Supply modes and cold chain

**Funded local purchase** is the third supply mode and is absent. ASOREDIPARCHOCÓ's third strategy
inverts the default: allocate funds to a territorial responsible who buys near the municipality. Less
time, lower cost, local economies strengthened — with its own traceability chain: authorisation,
responsible, receipt, verification, distribution, photographic evidence.

**Cold chain** constrains routing. Insulin and injectables carry temperature and light constraints
that make some open routes invalid. A six-hour open boat is not a path for insulin. Rutas has notes
but no structured constraint, and Catálogo has no storage requirement field.

**Anticipatory supply.** In `ordinario`, demand is largely predictable — a partera on losartán needs a
refill monthly. Propose the order before she asks. Different resolver from the reactive one, and what
makes a medicine bank work rather than lurch between stockouts.

## 25. Transport of people

Parteras travel out for surgery and specialist care, needing river, road, sometimes air, plus lodging,
food, accompaniment and a return leg. Same matching logic; the record carries a person, not a
quantity.

## 26. Offline

Transporter bundles: PMTiles plus MapLibre, downloaded while signal exists, GPS dot on top. **GPS needs
no connection** — only the map does. Precompute the run: manifest, ordered stops, confirmation codes,
corridor tiles. No on-device routing engine; a lanchero upriver is not choosing between routes.

**This does not violate "no app to install"** — that protects reporters. **Bundle scope is a safety
requirement**: only the stops on that run, encrypted, expiring on completion.

## 27. Services (v2 scope, schema now)

**Goods need transport; services need connectivity.** Both are the scarce middle. `puntos_conexion` is
already built and becomes the capacity table for the services side.

| Goods | Services |
|---|---|
| `SIN_RUTA` | `SIN_CONECTIVIDAD` |
| `SIN_EXISTENCIA` | `SIN_PROVEEDOR` |
| `SIN_CAPACIDAD` | `SIN_HORARIO` |

Two resolvers, one board — quantity depletes, availability renews.

**The differentiated capability:** a telemedicine platform will book 2pm Tuesday and she will not have
signal. Convite knows she is reachable Thursday mornings at the school, where there is power and she
can stay an hour. **Add availability windows to `puntos_conexion` and a capability type to the
catalogue now** — small today, painful retrofits later.

## 27b. Telemedicine — Convite is the fulfilment half

ASOREDIPARCHOCÓ's strategy 1 chain is:

```
PARTERA → REGISTRO → TELECONSULTA → SEGUIMIENTO MÉDICO → BANCO DE MEDICAMENTOS → ENTREGA EN EL TERRITORIO
```

**The last two steps are Convite.** A consultation that produces a prescription is useless in Puerto
Meluk unless something sources the losartán and puts it on a boat. This is a larger role than
"integration" suggests, and it should be said plainly to them.

### 27b.1 The boundary: an order, never a record

Their platform sends **a supply instruction**. Convite receives:

```
{ beneficiario_ref, codigo_item, cantidad, cadencia, vigencia_hasta }
```

Never a diagnosis, never a history, never a prescription document. `beneficiario_ref` is an opaque
identifier or a label — the same pattern already built in Apadrinar, where the sponsor sees «Partera
del Atrato medio» and never a name.

Convite returns delivery confirmation and nothing else.

**Convite can prove arrival; it cannot assess adherence.** We know the medicine reached her. Whether
she takes it is clinical, and blurring that line is how a logistics system drifts into being a health
record — the thing §2 forbids.

### 27b.2 Agendamiento — the flow they actually asked for

Their stated primary problem is **getting reports from the field and being able to contact people
back**. That is not fulfilment; it is scheduling, and it is the same shape as scheduling a class.

```
reporte entra por cualquier canal (ya construido)
  → verificado por una persona (ya construido)
  → se enruta a agenda en vez de a suministro
  → se busca una ventana donde ella sea alcanzable Y haya quien la atienda
  → se le propone por su canal
  → confirma, o no responde y se reintenta
  → se le manda el modo de conexión
  → asiste · no asiste · se reagenda
```

**A jornada is many people at a place; a cita is one person at a time.** Same container logic, same
notification rules, same attendance discipline.

#### Finding the window is the hard part

It is not the clinician's calendar. It is **the intersection of the clinician's availability with her
reachability**, and reachability comes from three things Convite already holds:

- `puntos_conexion` — where she can get signal, with power, privacy, and somewhere to stay an hour
- her learned activity window (§20) — the hours she is actually online, which tracks when there is
  power
- her link quality — whether a video call is even possible

A telemedicine platform will book 2pm Tuesday and she will not have signal. Convite knows she is
reachable Thursday mornings at the school.

#### The join method degrades with connectivity

| Her link | The cita happens by |
|---|---|
| Good data | Meet link |
| Weak data | WhatsApp voice call — far lower bandwidth than video |
| Signal, no data | Plain phone call at an agreed time |
| Nothing at home | Scheduled **at a connection point**, in a window when it works |
| Not resolvable remotely | Becomes a referral and a trip (§25) |

The connection-point notes already carry what this needs: «Solo entra señal parado en la punta del
muelle y cuando sube la marea.» A cita scheduled there is scheduled around the tide.

#### The proposal must survive her being offline

Per principle 4, no flow requires a live session. A proposed appointment may not be seen for two days,
so:

- **Proposals do not expire in hours.** Hold them, and re-propose on her next inbound if the window
  passed.
- **Confirmation is one word.** «Tiene una cita el jueves a las 9. Responda SI.»
- **Discretion applies (§6.3):** never «cita médica» or the condition on a screen someone else may
  see. The time, and nothing else.
- Reminders respect the activity window and the spend caps.
- A no-show is a reschedule, not a failure. Three missed windows escalates to a person, not to a
  fourth message.

#### Templates

`cita_propuesta` · `cita_confirmada` · `cita_recordatorio` · `cita_reagendada`. All utility category.
Submit alongside the five in §32.

#### The same engine schedules classes

`taller` and `formacion` differ only in that they carry a persistent roster (§21b.3) and repeat on a
cadence. Attendance, reminders, no-show handling and the degrading join method are identical. Build
once.

### 27b.2b Fulfilment, anticipation, referral

**Fulfilment from the medicine bank.** The prescription becomes a `pedido` against `existencias`,
matched and dispatched like any other item, with the four-digit confirmation code on arrival.

**Anticipation.** A chronic treatment has a refill cadence, set clinically. Convite proposes the next
order before it runs out (§24) rather than waiting for a stockout to be reported. This is what makes
a medicine bank work rather than lurch.

**Moving the person when remote is not enough.** When the consultation escalates, the partera travels
— river, road, sometimes air, plus lodging, food and accompaniment (§25). Triggered clinically,
fulfilled by Convite.

### 27b.3 What Convite does not do

Consultation, clinical records, diagnosis, the risk *semáforo*, prescribing, adherence assessment.
All theirs, all under a regulatory regime we should not enter.

### 27b.4 It works before the telemedicine platform exists

Their telemedicine component is a funded proposal, not a running system. **The medicine bank does not
depend on it.** A coordinator can enter a chronic-treatment requirement manually today and Convite
sources, routes, delivers and confirms. When a platform arrives, the manual entry is replaced by the
order interface in §27b.1 and nothing else changes.

Say this to them: it de-risks their strategy 1, because the supply half works whether or not the
clinical half lands on schedule.

## 28. Groups and integrations

**WhatsApp Cloud API cannot join groups.** Strictly 1:1. Do not attempt it.

Split by direction: the group is for announcement and belonging; the 1:1 line is for the record. Two
bridges needing no integration — a `wa.me` deep link pinned in the group, and **paste-ready summaries**
a coordinator copies in. With service messages billable from 1 October 2026, the second is also
cheaper.

### 28.1 Calendar is the integration, because Agenda is a calendar

Partners will not manage OAuth clients or service accounts. **They must never see a client ID.**

**An .ics subscribe URL is the whole first tier.** Paste one link into Google Calendar and jornadas,
citas and departures appear alongside everything else, staying current forever. No consent screen, no
tokens. Coordinators already live in Calendar; this puts Convite there without asking them to change
anything.

**Feeds are per-person and scoped, never one shared calendar:**

| Who | Sees |
|---|---|
| Coordinador | Jornadas, envíos and citas for their region |
| Verificador | Citas they must arrange |
| Proveedor de servicio | Only their own citas |
| Transportista | Only their own runs |

Each URL is a secret tied to a membership and **revoked on offboarding**, like any other access
(§29).

**The discretion rule binds harder here than anywhere.** A calendar feed syncs to a phone, shows on a
lock screen, and may be seen by a spouse or a colleague. Event titles carry the folio and the type,
never the person or the condition:

> ✓ «Cita 472 · Puerto Meluk · 9:00»
> ✗ «Teleconsulta medicina crónica — Rosalba Cuesta»

Colombia is UTC−5 with no daylight saving; emit fixed offsets rather than floating times.

### 28.2 Meet, and why it is only one join method

**Start manual.** A coordinator creates the meeting and pastes the link into the cita. Zero
integration, works today. Automatic generation through the Calendar API needs OAuth and can wait.

**Meet is never the default.** Per §27b.2 the join method follows link quality — good data gets a
Meet link, weak data gets a WhatsApp voice call, signal-without-data gets a plain phone call.
Generating a Meet link for Docampadó would be worse than useless. If a template carries the link,
note that Meta applies additional rules to templates containing URLs.

### 28.3 Import probably matters more than export

If assessments already run on **Google Forms** — and Herencia's volunteer signup already does —
reading the responses sheet is worth more than writing one. Same for a **partera directory**, which
ASOREDIPARCHOCÓ almost certainly holds in a Sheet. Ask what exists before designing anything.

### 28.4 Tiers, in build order

1. **.ics feeds** — highest value, zero setup
2. **Scheduled email** of a spreadsheet, plus CSV and XLSX download
3. **Manual Meet links** pasted into citas
4. **«Conectar con Google»** — one OAuth button, all token machinery on our side: read a Sheet, create
   Calendar events with Meet links, write evidence to Drive

**Drive for evidence carries a caution.** Delivery and damage photographs could write to a folder they
control, but Drive sharing defaults are a real risk with images of damaged houses. Require an explicit
sharing configuration before enabling it, and strip EXIF first (§13 applies).

Mention **Google for Nonprofits** to eligible partners.

## 29. Roles, organisations and permissions

Centros has an approval queue; nothing else in this section exists yet. It is a gap, and it grows
with every role added.

### 29.1 The governing principle

**Friction scales with what you can see and what you can move — never with what you contribute.**

Reporting a need, reporting damage, offering goods or offering time is always free and never requires
an account. Taking something out, seeing a person's address or phone number, or committing resources
on behalf of others requires identity.

### 29.2 Three tiers of participant

**No account.** The reportante. WhatsApp, SMS or a call. **The channel is the authentication** — a
message from `+57…` proves control of that number because Meta verified it at registration. Do not
build OTP, passwords or account creation for reporters, donors or volunteers.

**One-use link, one screen.** Transportista, donante, voluntario. **The screen is the assignment** —
no navigation, no other data, and the URL is the access control. It expires on completion, which is
also how the household-address time window is enforced.

**Login, magic link.** Everyone else. Supabase Auth over email; phone OTP only as a fallback for
field verifiers without reliable email.

### 29.3 The roles

| Role | Account | Sees |
|---|---|---|
| `reportante` | None | Their own folio status; stock at their reachable node |
| `donante` | Link | Their offer, its match, the pickup time |
| `voluntario` | Link | Where, when, what to bring, who to meet |
| `transportista_abierto` | Link | Public collection points only — **never household addresses** |
| `transportista_avalado` | Link | Exact addresses for stops on their own active run, time-boxed |
| `evaluador` | Login, light | Offline assessment form with sync queue and coverage counter |
| `proveedor_servicio` | Login, light | Their availability windows and upcoming citas |
| `verificador` | Login | Bandeja and Comunidades, for assigned communities |
| `despachador` | Login | Bandeja, Mapa, Agenda, Existencias — **may not verify** |
| `coordinador` | Login | All seven sections |
| `org_admin` | Login | Adds Equipo, for their organisation only |
| `director` | Login | Informes and a read-only Mapa |
| `admin` | Login | Catalogue, community registry, organisation approval |

Organisation tiers — ancla, avalada, aportante, observadora — are defined in §29.3b.

**Never expose a list of vulnerable households to an unvouched account.** In territory with
armed-actor presence, that list plus a delivery schedule is targeting information.

### 29.3b How an organisation gets in

**There is no self-serve signup for an organisation that collects community data.** Three reasons,
and the first is decisive.

**Ley 1581 does not do self-serve.** If an organisation collects reports from communities, someone is
the *responsable del tratamiento*. If it is them, they need their own SIC registration, consent texts
and treatment policy — which a signup form cannot establish. If it is us, we have made ourselves
liable for what a stranger does with data about vulnerable people, including health data. No checkbox
fixes that.

**They cannot self-provision a channel anyway.** A WABA under our Tech Provider arrangement requires
a contract, not a form (§32).

**Trust does not transfer.** Communities answer because the Diócesis vouches for Convite. If anyone
can join, one bad actor's behaviour attaches to the whole network — and the reportante network takes
years to build and a week to lose.

The answer is not to slow everything down. It is to **split by whether the organisation touches
community data.**

| Tier | Who | Speed | Why |
|---|---|---|---|
| **Ancla** | Operates a channel, collects reports | Weeks — contract, data agreement, WABA | They are the responsable del tratamiento |
| **Avalada** | Invited by an anchor, operates under its agreement | Minutes | Accountability inherited; voucher on record; ceiling never above the voucher's |
| **Aportante** | Offers goods, capacity or funding only | Near-immediate | **Touches no community data** — supply side only |
| **Observadora** | Reads the aggregate layer | Immediate | It is already public |

**Vouching chains are the fast path**, and they match how the sector already works — you get into the
ELC because members know you. The Diócesis vouches for NRC in a minute; NRC inherits a ceiling no
higher than the Diócesis holds; the vouch is recorded and accountability is shared. Revoking a vouch
suspends the vouched organisation.

**The supply-side tier is the genuinely open one**, and it is where earthquake-week volume actually
is. A trucking company, a donor foundation, a hardware store with twenty sheets of zinc — none of them
collect anything from a community. They are offering, and offering has always been the frictionless
side (§29.1).

So an NGO arriving three days after an earthquake gets in fast **if someone already inside vouches for
them.** If nobody will, that is information — and it is the same answer the humanitarian cluster would
give.

#### Manual entry is the zeroth channel

An anchor organisation cannot obtain a WABA in five minutes. So **stage 1 of setup (§29b.2) must work
with no channel at all.**

Once the data agreement is signed, a coordinator registers communities and types in reports they are
already receiving — in their own WhatsApp group, by phone, on paper. Useful on day one, requires no
Meta trámite, and every record carries `canal = 'manual'` with the person who entered it. Channels
attach as verification clears, and nothing already entered changes.

#### A shared community gazetteer

If two organisations each register «Bellavista», the coordination layer is worthless.

**Communities are a common registry.** Organisations **attach to** existing communities rather than
creating them, and propose new ones when the registry lacks them — proposals surface to an admin and
to anyone already operating nearby, matched by name and proximity before creation. Location, tier,
agrupador and check-in interval are shared; requests, inventory, contacts and assessments belong to
the organisation that holds them.

#### What every tier sees from the start

Read access to the **aggregate coordination layer** — municipality-level counts, which communities
already have someone working in them, which routes are reported closed. This is what `/respuesta`
already publishes, and it costs nothing to extend.

It prevents what coordination bodies actually fear: two organisations sending mercados to Bellavista
while nobody goes to Winandó. **Coordination value at zero privacy cost.**

Seeing another organisation's community-level detail is **negotiated bilaterally, never default** —
granted by them, recorded, revocable. Convite does not broker it.

### 29.4 Capability ceiling per organisation

The approving body sets a ceiling at approval time, stored on the organisation. What the Diócesis may
grant its staff is not what a donor registered last Tuesday may grant.

```
techo_permisos jsonb:
  comunidades_alcance   uuid[] | 'todas'
  direcciones_hogar     bool     may they hold household addresses at all
  inventario_nodo       bool     may they manage stock at a node
  despacho              bool     may they dispatch
  agendamiento          bool     may they schedule citas
  evaluacion            bool     may they run assessments
  puede_delegar         bool     may they grant org_admin
```

**The organisation administers freely below the ceiling.** An `org_admin` invites, assigns, suspends
and removes their own staff with no Convite approval for individual employees. Do not build an
approval queue for people; it will not scale and they know their staff better than we do.

**Delegation cannot escalate.** Enforced in row-level security, not the UI:

- may grant only capabilities within their organisation's ceiling
- may not grant across organisations
- may not grant `org_admin` unless `puede_delegar` is set
- any attempt beyond the ceiling fails at the database and is logged

**The line: the organisation vouches for identity; the approving body sets scope.**

### 29.5 Membership, not a single org field

A person can be a lanchero for the Diócesis and a delegate of their community council, with different
permissions in each. `usuarios.organizacion_id` must not exist.

```
membresias  id, usuario_id, organizacion_id, rol, comunidades_alcance uuid[],
            otorgado_por, otorgado_en, vence_en, estado, motivo_baja
            UNIQUE (usuario_id, organizacion_id, rol)
```

Effective permissions are the **union of active memberships, each clipped to its organisation's
ceiling**, computed per request and **never cached** — a cached permission set goes stale about
exactly the thing that matters.

### 29.6 Offboarding is first-class

Turnover is high, and a departed employee holding household addresses is precisely the failure the
transporter tiers exist to prevent.

- Suspension and termination revoke on the next request
- **Termination cancels active run assignments** and reassigns or unassigns their stops — never leave
  a shipment holding a dead reference
- **Calendar feed URLs are revoked** with the membership (§28.1)
- **Dormancy auto-suspend**: any membership with address-level access and no activity for 45 days
  suspends automatically. Reinstating is one click; the point is that the default drifts closed.
- Every grant, suspension and termination writes to `auditoria` with actor, target, capability and
  reason

### 29.7 Separation of duties

Whoever confirms a need is real must not also decide it gets skipped. `verificador` cannot dispatch;
`despachador` cannot verify. This is deliberate and must survive convenience arguments.

## 29b. Onboarding — staged by phase, not one long form

### 29b.1 Three contexts, not one menu

**Configurar** — a dependency-ordered checklist, not a menu. Collapses to a link in Ajustes once
complete, still reachable.

**Operar** — the seven sections. Appears once configuration is far enough along; an empty Bandeja
shown to someone who has registered nothing is noise.

**Revisar** — Informes. Different rhythm, usually a different person.

### 29b.2 Setup is staged by phase

This is the point, and it mirrors §3. **A deployment responding to a fresh disaster needs communities
and a phone number, and nothing else.** Do not present twelve steps when four will do.

| Stage | Unlocks | Needs |
|---|---|---|
| **0 · Entrada manual** | Operate with no channel at all | Data agreement signed · communities attached from the shared registry · a coordinator typing in what they already receive |
| **1 · Alcance** | Receive reports directly | One intake number, once Meta verification clears |
| **2 · Emparejamiento** | The matcher proposes | Catalogue · centres **with locations** · routes, river ones by hand · inventory |
| **3 · Recuperación** | Assessments and rebuilding | Assessment templates · materials catalogue · sponsorship |
| **4 · Ordinario** | Programas and citas | Connection-point availability windows · service providers · cadences |

**Stage 1 is an hour's work and is genuinely useful alone.** A community that is registered and
reachable exists in the system, accumulates requests and triggers silence alerts, with no catalogue
configured at all.

### 29b.3 Every incomplete step says what it blocks

Not «Rutas: pendiente». The checklist states the consequence, because these are failures a
coordinator cannot otherwise diagnose:

> «6 comunidades no tienen ningún tramo escrito. El emparejador no puede proponer nada para ellas —
> aparecen como incomunicadas aunque no lo estén.»

> «Acopio Yuto no tiene ubicación. Sin ella, Recogidas no tiene desde dónde medir la vuelta.»

> «Falta el número de voz para la llamada perdida. Sin él, quien no tiene saldo no puede reportar.»

The product already does this well in place (§7's «Este centro no tiene ubicación todavía…»); the
checklist collects those warnings in one screen.

### 29b.4 Role defaults are set by description, not by matrix

During setup, present roles as sentences and ask for confirmation:

> «Un verificador ve la bandeja de sus comunidades y nada más. ¿Está bien?»

A grid of permission checkboxes gets a shrug and default-everything. Three role descriptions get a
real answer — and those defaults are what protect household addresses later.

### 29b.5 Empty states teach

Each empty screen names what is missing and links to the step that fixes it. An empty Mapa says «no
hay comunidades registradas — empiece aquí», not «sin datos».

### 29b.6 What not to build

**No guided tour with numbered overlay bubbles.** Field evidence is that learning happens by doing,
repeating and correcting with a person alongside; a tour clicked through once and forgotten is the
opposite. The checklist teaches by having them do the thing.

**Progressive disclosure for the screen intros.** The explanatory paragraphs at the top of each screen
are good teaching and a permanent tax on vertical space. Expanded for the first few visits, then
collapsed to one line with an info icon.

**Tooltips on vocabulary only** — `tier 3`, `centroide · ±1000 m`, `segunda mano`, `desactualizado`,
`transcrito 58%`, `pide detalle`. One sentence each. And one disambiguation that is currently a real
gap: **`Solo verificar` versus `Verificar y crear pedido`** — nothing on that screen explains when to
choose the first.

---

# Part V — Partners, pilot, sequence

## 30. ASOREDIPARCHOCÓ

1,600 parteras, 31 municipalities. Mapped against their twelve-month plan:

| Their component | Convite | Status |
|---|---|---|
| Telemedicine platform, clinical record | **No** | Separate regime. Theirs. |
| Fulfilment half of the telemedicine chain | **Yes** | §27b — banco de medicamentos and entrega are ours |
| Scheduling teleconsults against connectivity | Yes | §27b.2 — the capability they lack |
| Seguimiento de adherencia | **Partly** | We prove arrival, never adherence (§27b.1) |
| Alertas de controles pendientes | **Yes** | §27b.2 — a pending control is a scheduling problem |
| Contactar a la partera para agendar | **Yes** | §27b.2 — the flow they named as their primary need |
| Banco de medicamentos | Yes | Built |
| Diabetes supplies | Yes | Catalogue; needs consumption-based reordering (§24) |
| Mobile data for 120 coordinators | Partly | Conexión built |
| 600 prenatal kits, 200 birth kits | Yes | Built |
| Banco de insumos para vivienda | Yes | Catalogue extension |
| Materiales + transporte + mano de obra + asistencia | **Gap** | §21 |
| Plan de respuesta a 12 meses como objeto planificable | **Gap** | §21b — cadencia, presupuesto, viabilidad por temporada |
| "Apadrina una partera y su casa" | Partly | Apadrinar built; needs §21 level 2 to price |
| Transporte y referencia | **Gap** | §25 |
| Semáforo de riesgo | **No** | Clinical triage. Theirs. |
| Anticiparnos al parto | **Gap** | §24 |
| Compras territoriales descentralizadas | **Gap** | §24 |
| Seguimiento de las 1.600 | Yes | Comunidades; needs surfacing on Bandeja (§19) |
| Evidencia de entregas | Yes | Built |
| Protección de datos | Yes | Apadrinar consent model is the pattern |

Their field research on digital adoption remains the best source on interaction constraints.

## 31. Fundación Herencia de Timbiquí

Timbiquí, Guapi, López de Micay. Moved 40+ tonnes across three boat-access river municipalities during
the pandemic reaching 2,000+ families; ran a multi-specialty health brigade for 400+ families. **They
have done the logistics Convite coordinates.** They already operate a volunteer intake pipeline across
five categories.

**Their ask is the diagnostic** — §21, levels 3 and 4 — and **programas** (§21b): brigades, classes
and encounters planned as recurring interventions with a budget and a calendar, not as one-off trips. Cultural and educational programming is in
scope as a **jornada**, not as a platform; content delivery is theirs. **The adjacent thing to ask for
instead is onboarding accompaniment**, which is what formation work actually is.

## 32. Pilot

**Fifty parteras. Two or three municipalities. One supply category. One month.**

Prerequisites in dependency order:

1. Meta business portfolio verification status — **longest pole**; unverified caps at 250 unique
   contacts per 24 hours
2. **A new SIM**, never an existing staff line — registration deletes the existing profile and its
   history, and there is no trial
3. Utility templates submitted
4. **A Colombian voice number with its regulatory bundle**, leased from Infobip, with recordings and
   early media activated by their account team — started in parallel with the Meta trámite
5. Partera directory with phone and municipality
6. Named verifier with budgeted time

**Success measures:**

- Median `RECIBIDO` → `VERIFICADO` under 24 hours. Drift means another person, not more automation.
- Proportion reaching `ENTREGADO`, and median days
- Distribution of stuck-states — which side is actually thin, measured not assumed
- **Reports by channel and by tier.** If everything arrives by WhatsApp, either the tier assignments
  are wrong or the other channels are not working. Find that out at fifty, not at 1,600.
- Communities exceeding their check-in interval
- **Whether parteras keep reporting in month two.** The only measure that matters.

## 33. Sequence from here

1. **Defects D1–D9** — a day's work, and D2 and D7 are correctness issues, not polish
2. **Ingestion core** — verify SMS, wire the missed-call callback with spend caps, adaptive link layer
3. **Unify Bandeja**, surface silence, restructure navigation (§18)
3b. **Assessment recency layer and area selection** (§23.4–23.5) — smallest useful step toward the
    diagnostic, and the most demo-able thing for a diagnostic partner
4. **Assessments and bill of materials** (§21) — unblocks both Apadrinar and Herencia
5. **Map as planning surface** (§23)
6. **Jornadas** (§22), then **programas** (§21b) — the calendar with seasonal feasibility is the
   piece both partners will recognise immediately
7. Local purchase, cold chain, anticipatory supply (§24)
8. Transport of people (§25)
9. Offline bundles (§26)
10. Telemedicine fulfilment interface (§27b) and services (§27)

## 34. Open questions

- **Meta portfolio verified?** Determines the calendar.
- **Infobip:** will they provision WhatsApp against a WABA the partner owns? Does one Colombian
  number carry both voice and SMS? Per-operator termination rates to Claro, Tigo and WOM? Is a
  rejected inbound leg billed?
- **Which radio nets operate where, and where is use safe?** Marine VHF among lancheros specifically —
  an existing network we could ingest from rather than build.
- **Starlink** — which communities, administered by whom. Changes what tier 3 means.
- **Who holds `org_admin`** inside each partner, realistically.
- **Cold chain** — what storage exists at nodes, which routes can carry insulin.
- **What already lives in their Google Workspace** — import may matter more than export.
- **The allocation policy.** The rule for who waits when supply falls short. Still not designed, and
  the most politically loaded component in the system. With 400 parteras on cardiometabolic treatment
  and a medicine bank that adjusts to real consumption, there will be months it does not stretch.
  Everything else in this document is engineering; this one is governance, and it needs a decision
  from the partners before it needs a screen.
