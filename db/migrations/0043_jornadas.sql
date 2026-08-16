-- PRD-37 — Territory & registry schema (part 2: jornadas + jornada_paradas).
--
-- §21b/§22: a jornada is one occurrence — people and things arrive at a place, on a date, for a
-- community that must be told in advance. This is the bare table only (schema, no logic): the
-- planning surface, drafting and matching are PRD-30. The tables live here, ahead of that
-- feature, because the seed (PRD-38) plants Herencia's historical jornadas so a partner opens
-- the map onto their own work rather than an empty screen (§31). Part 1 (regiones + columns) is
-- 0042 and must run first — jornadas references regiones.

-- ── jornadas ─────────────────────────────────────────────────────────────────────────────────
-- Org-scoped like every operational table (0017/0030/0040): RLS binds reads and writes to the
-- owning organisation. region_id is NOT NULL — a jornada is planned for a region (§22/§23) and
-- the seed always sets one; the stops (paradas) name the exact communities.

create table jornadas (
  id                 uuid primary key default gen_random_uuid(),
  codigo             text not null,
  tipo               text not null,
  organizacion_id    uuid not null references organizaciones (id),
  titulo             text not null,
  region_id          uuid not null references regiones (id),
  fecha_inicio       date,
  fecha_fin          date,
  estado             text not null default 'borrador',
  familias_atendidas integer,
  notas              text,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),

  constraint jornadas_tipo_check
    check (tipo in ('distribucion', 'brigada', 'taller', 'formacion', 'evaluacion', 'obra')),
  constraint jornadas_estado_check
    check (estado in ('borrador', 'planificada', 'en_curso', 'completada', 'cancelada', 'historico')),
  constraint jornadas_familias_check
    check (familias_atendidas is null or familias_atendidas >= 0),
  -- A jornada that ends before it begins is a data error, not a plan.
  constraint jornadas_fechas_check
    check (fecha_fin is null or fecha_inicio is null or fecha_fin >= fecha_inicio)
);

create unique index jornadas_codigo_key on jornadas (codigo);
create index jornadas_organizacion_idx on jornadas (organizacion_id);
create index jornadas_region_idx on jornadas (region_id);
create index jornadas_estado_idx on jornadas (estado);

comment on table jornadas is
  'PRD-37 (§21b/§22): one occurrence at a place on a date — distribution, brigade, workshop, assessment, works. Bare table only; the planning surface and matching are PRD-30. Historical jornadas seeded by PRD-38 (§31).';
comment on column jornadas.estado is
  'borrador (a draft over the map, §23) -> planificada -> en_curso -> completada|cancelada. historico is a past jornada seeded so a partner sees their own work, not an empty screen (§31).';

create trigger jornadas_tocar before update on jornadas
  for each row execute function tocar_actualizado_en();

-- ── jornada_paradas — the stops of a jornada, in order ───────────────────────────────────────
-- Which communities a jornada reaches, and in what order. Seeded (PRD-38) as «supposed» stops
-- for the historical jornadas, explicitly for the partner to correct. Cascades with its jornada;
-- comunidad_id is a plain reference so deleting a jornada never reaches into the shared registry.

create table jornada_paradas (
  id           uuid primary key default gen_random_uuid(),
  jornada_id   uuid not null references jornadas (id) on delete cascade,
  comunidad_id uuid not null references comunidades (id),
  orden        integer not null,
  notas        text,
  creado_en    timestamptz not null default now(),

  constraint jornada_paradas_orden_check check (orden >= 0)
);

-- One stop per position within a jornada; a community may be revisited at a different orden.
create unique index jornada_paradas_orden_key on jornada_paradas (jornada_id, orden);
create index jornada_paradas_jornada_idx on jornada_paradas (jornada_id);
create index jornada_paradas_comunidad_idx on jornada_paradas (comunidad_id);

comment on table jornada_paradas is
  'PRD-37: the ordered stops of a jornada (which communities it reaches). Seeded by PRD-38 as supposed stops for the partner to correct.';

-- ── RLS floor ────────────────────────────────────────────────────────────────────────────────
-- Same order as 0040: enable, revoke, grant back. Jornadas are operational planning maintained
-- day to day — like routes and connection points — so any signed-in staff role reads them within
-- their own organisation (a platform admin reaches across organisations for reads, 0034/0041),
-- and coordinador/admin write, only inside their own organisation. The planning flow itself is
-- PRD-30; this is the floor.

alter table jornadas enable row level security;
revoke all on public.jornadas from anon, authenticated;
grant select, insert, update, delete on public.jornadas to authenticated;

alter table jornada_paradas enable row level security;
revoke all on public.jornada_paradas from anon, authenticated;
grant select, insert, update, delete on public.jornada_paradas to authenticated;

create policy jornadas_lectura on jornadas
  for select to authenticated
  using (
    convite_es(array['verificador', 'despachador', 'coordinador', 'admin'])
    and (organizacion_id = convite_organizacion() or convite_es_plataforma())
  );

create policy jornadas_coordina on jornadas
  for all to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
  )
  with check (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
  );

-- The stops inherit the jornada's boundary: read a stop when you can read its jornada, write one
-- when you may write its jornada. Scoped through the parent's org.
create policy jornada_paradas_lectura on jornada_paradas
  for select to authenticated
  using (
    convite_es(array['verificador', 'despachador', 'coordinador', 'admin'])
    and exists (
      select 1 from jornadas j
       where j.id = jornada_paradas.jornada_id
         and (j.organizacion_id = convite_organizacion() or convite_es_plataforma())
    )
  );

create policy jornada_paradas_coordina on jornada_paradas
  for all to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1 from jornadas j
       where j.id = jornada_paradas.jornada_id
         and j.organizacion_id = convite_organizacion()
    )
  )
  with check (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1 from jornadas j
       where j.id = jornada_paradas.jornada_id
         and j.organizacion_id = convite_organizacion()
    )
  );
