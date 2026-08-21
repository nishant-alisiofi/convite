# PRD-10 — Connection points (puntos de conexión)

- **Type:** PRD
- **Tier:** 2 — Roadmap (from PRD v1.0)
- **Priority:** P2
- **Status:** ✅ Built + deployed (staging + prod) — pending Codex validation
- **Source:** PRD v1.0 (connection points — physical places where a person from a low/no-signal
  community goes to send a report or receive help).

## Problem / why

Tier 3–4 communities have no sustained data. People walk to a place with signal (a shop, a pier,
a health post) to send a voice note or make a missed call. The vision names these **connection
points** as first-class: a coordinator should see where they are, which communities they serve,
and use them for reply-channel decisions ("someone who walked to a point and walked home is
unreachable on WhatsApp by the time we answer" — PRD.md M6). They also anchor the reply-channel
policy and pickup logistics.

## Scope

**In:**
- A **connection-point** entity: name, location, the communities it serves, and its
  characteristics (has signal / is a pier / is a shop / staffed).
- Rendered on the Mapa (PRD-2) as a distinct marker.
- Feeds the M6 adaptive-link reply policy (`comoConfirmar`): a report originating via a point may
  need an out-of-band reply (SMS/callback/message left at the point), not WhatsApp.
- Optionally serves as a **pickup/dropoff node** in route planning.

**Out (v1):** point-operator accounts/logins; inventory held at a point.

## Acceptance criteria

1. Connection points can be created with location + served communities + characteristics.
2. They render as distinct markers on the Mapa.
3. The reply-channel policy can use "arrived via connection point" to choose an appropriate reply
   channel.
4. A point can be selected as a node in route/pickup planning.

## Validation approach (future, on staging)

Seed a connection point serving a tier-4 community; confirm it renders on the Mapa, that a report
routed through it triggers an out-of-band reply suggestion, and that it is selectable in planning.
Never validate on production.
