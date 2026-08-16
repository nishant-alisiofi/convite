-- PRD-37 — Territory & registry schema (part 1: regiones + registry columns).
--
-- The bare schema the real territory seed (db/seed/territorio.sql, loaded by PRD-38) needs, so
-- the community registry can be planted on day one and the feature WIs build their logic on top.
-- Schema only: no enforcement, no UI. Enforcement lands in the WIs cited per column.
--
-- Two things this migration is careful NOT to do: it does not recreate comunidades or
-- organizaciones (it only ADDs columns to them), and it touches neither the item catalogue,
-- routes nor nodes — those already carry what the seed needs. Part 2 (jornadas) is 0043.

-- ── Regiones — the shared gazetteer's top level (§5.7) ───────────────────────────────────────
--
-- A region groups communities for the map and for jornada planning: Chocó, Pacífico caucano,
-- Valle del Cauca. Reference data, exactly like catalogo_items — every signed-in staff role
-- reads it, only an admin edits it. Not org-scoped: the gazetteer is shared (§29.3b).

create table regiones (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  departamento   text not null,
  -- 'rural' | 'urbana' | 'mixta'. text + check, so a new kind is a one-line ALTER (§5).
  tipo           text not null,
  activa         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  constraint regiones_tipo_check check (tipo in ('rural', 'urbana', 'mixta'))
);

create unique index regiones_nombre_key on regiones (nombre);

comment on table regiones is
  'PRD-37 territory registry (§5.7): groups communities by region for the map and jornada planning. Reference data — any signed-in staff reads it, only an admin edits it. Seeded by PRD-38.';

create trigger regiones_tocar before update on regiones
  for each row execute function tocar_actualizado_en();

-- ── comunidades — attach to a region, and carry a verification stamp ─────────────────────────
--
-- region_id: the region a community belongs to (the seed plants communities per region).
-- Nullable, because communities already registered before this migration have no region yet,
-- and a proposal to the shared registry (§29.3b) may arrive before a region is assigned. The FK
-- is declared here in SQL rather than in the Drizzle mirror to avoid a circular import between
-- core.ts and territorio.ts — the same reason pedidos.oferta_sugerida does it (0011).

alter table comunidades add column region_id uuid references regiones (id);
create index comunidades_region_idx on comunidades (region_id);

comment on column comunidades.region_id is
  'PRD-37 (§5.7): the region this community belongs to. Nullable — a community may exist before a region is assigned. Surfaced by PRD-28/PRD-31.';

-- verificado_en: §14 / §29.3b. Nothing seeded counts as verified until someone from the
-- territory confirms it, so this is NULL by default and stays NULL for every seeded row. The
-- «unverified» state it drives is surfaced by the registry/Comunidades UI (PRD-28/PRD-35); this
-- migration only adds the column.

alter table comunidades add column verificado_en timestamptz;

comment on column comunidades.verificado_en is
  'PRD-37 (§14/§29.3b): when someone from the territory confirmed this community. NULL = unverified. Nothing seeded is verified until the territory says so. Surfaced by PRD-28/PRD-35.';

-- ── organizaciones — type, capability ceiling and vouch note ─────────────────────────────────
--
-- tipo: what kind of organisation this is in the shared registry (§29.3b) — an anchor community
-- network, a foundation, an arriving NGO, a donor, a transporter, a shop. Nullable, because
-- organisations registered before this migration have no type recorded; `otro` keeps the
-- registry from ever having to reject a real organisation just to record it. Typing is PRD-35.

alter table organizaciones add column tipo text;
alter table organizaciones add constraint organizaciones_tipo_check
  check (tipo is null or tipo in (
    'red_comunitaria', 'fundacion', 'ong', 'diocesis', 'consejo_comunitario',
    'donante', 'transportista', 'comercio', 'gobierno', 'otro'
  ));

comment on column organizaciones.tipo is
  'PRD-37 (§29.3b): the kind of organisation in the shared registry. Nullable + `otro` so the registry never rejects a real org to record it. Registry typing/enforcement is PRD-35.';

-- techo_permisos: the capability ceiling the approving body sets at approval time (§29.4). The
-- organisation administers freely below it; delegation cannot escalate past it, enforced in RLS
-- by PRD-16. Modelled as jsonb per §29.4's shape (comunidades_alcance, direcciones_hogar,
-- inventario_nodo, despacho, agendamiento, evaluacion, puede_delegar). NOT NULL default '{}', so
-- an org with no ceiling set grants nothing — fail closed, the direction the RLS floor already
-- fails (0007). The seed sets a minimal ceiling; enforcement is PRD-16.

alter table organizaciones add column techo_permisos jsonb not null default '{}'::jsonb;

comment on column organizaciones.techo_permisos is
  'PRD-37 (§29.4): capability ceiling set by the approving body. jsonb per §29.4 (comunidades_alcance, direcciones_hogar, inventario_nodo, despacho, agendamiento, evaluacion, puede_delegar). Default {} grants nothing (fail closed). Enforced by PRD-16.';

-- aval_motivo: the vouch note behind an organisation's admission to the shared registry
-- (§29.3b) — «X vouches for Y», recorded so the shared accountability is auditable. The vouch
-- workflow (and revocation, which suspends the vouched org) is PRD-35; this only adds the column
-- so the seed can record «Semilla inicial. Techo pendiente de acuerdo.»

alter table organizaciones add column aval_motivo text;

comment on column organizaciones.aval_motivo is
  'PRD-37 (§29.3b): why this organisation was vouched into the shared registry. Vouching/revocation workflow is PRD-35.';

-- ── RLS floor for regiones ───────────────────────────────────────────────────────────────────
-- Same order as 0007/0017/0040: enable, revoke everything, grant back exactly what the policies
-- allow, so a half-finished policy set fails towards «staff cannot read» rather than «anon can».
-- Reference data, so it mirrors catalogo_items exactly: any signed-in staff role reads it, only
-- an admin edits it. `lectura` gets nothing (aggregate views only, §11). Not org-scoped.
--
-- comunidades and organizaciones already carry RLS (0007) and their policies (0017); adding
-- columns to them changes neither, so nothing is done to their policies here.

alter table regiones enable row level security;
revoke all on public.regiones from anon, authenticated;
grant select, insert, update, delete on public.regiones to authenticated;

create policy regiones_lectura on regiones
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));

create policy regiones_admin_escribe on regiones
  for all to authenticated
  using (convite_es(array['admin']))
  with check (convite_es(array['admin']));
