-- §5.9 — Connection points (puntos de conexión).
--
-- Where a person from a low- or no-signal community goes to send a report or hear an answer:
-- a shop with a phone, a pier the boats pass, a health post, a community WiFi mast. The
-- community knows exactly where signal is, where a pin can be bought, and where it is safe to
-- *stay* for the length of a call — none of which is on an operator's coverage map.
--
-- Recorded SEPARATELY from supply nodes (`nodos`), on purpose and forever. §5.9: connectivity
-- commerce is acceptable, goods commerce is not, and whoever decides who receives donated
-- goods must not also sell connection to the same people. One person may run both a `nodo` and
-- a `punto_conexion`; they stay two rows in two tables so that convergence is always visible.
-- This migration adds `puntos_conexion` and its served-communities join. It creates nothing on
-- `nodos` and merges nothing into it.
--
-- A connection point is NOT judged by bandwidth. The six judged dimensions are columns:
-- safety, privacy (weighted most where the subject is health), whether one can stay,
-- accessibility, available power, and cost. Reaching a point can itself cost travel, money and
-- risk, so `notas` carries that honesty for the "where can I go" surface.

-- ── The point ─────────────────────────────────────────────────────────────────────────────

create table puntos_conexion (
  id                      uuid primary key default gen_random_uuid(),
  -- Direct owning organisation (like `usuarios`), not reached through a community: a point is
  -- often outside every community it serves — it is the place people travel to. RLS scopes to it.
  organizacion_id         uuid not null references organizaciones (id),
  nombre                  text not null,
  tipo                    text not null default 'otro',

  ubicacion               geometry(Point, 4326),
  ubicacion_fuente        text,
  ubicacion_precision_m   integer,

  -- Characteristics: what it is, not how good it is.
  tiene_senal             boolean not null default false,
  internet_disponible     boolean not null default false,
  vende_pines             boolean not null default false,
  atendido                boolean not null default false,

  -- The six judgements (§5.9). A point is judged by these, never by bandwidth.
  seguridad               text not null default 'desconocido',
  privacidad              text not null default 'desconocido',
  permanencia             text not null default 'desconocido',
  accesibilidad           text not null default 'desconocido',
  energia                 text not null default 'desconocido',
  costo                   text not null default 'desconocido',

  -- The honest note: what reaching it costs in travel, money and risk.
  notas                   text,

  activo                  boolean not null default true,
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),

  constraint puntos_conexion_tipo_check
    check (tipo in ('tienda', 'muelle', 'puesto_salud', 'punto_wifi', 'antena', 'vivienda', 'otro')),
  constraint puntos_conexion_seguridad_check
    check (seguridad in ('alto', 'medio', 'bajo', 'desconocido')),
  constraint puntos_conexion_privacidad_check
    check (privacidad in ('alto', 'medio', 'bajo', 'desconocido')),
  constraint puntos_conexion_permanencia_check
    check (permanencia in ('alto', 'medio', 'bajo', 'desconocido')),
  constraint puntos_conexion_accesibilidad_check
    check (accesibilidad in ('alto', 'medio', 'bajo', 'desconocido')),
  constraint puntos_conexion_energia_check
    check (energia in ('alto', 'medio', 'bajo', 'desconocido')),
  constraint puntos_conexion_costo_check
    check (costo in ('gratuito', 'bajo', 'medio', 'alto', 'desconocido')),
  -- Non-negotiable 2.2, same as `nodos`: a stored point declares its source and precision, and
  -- a row with no point declares neither. No silent precision upgrade.
  constraint puntos_conexion_ubicacion_declarada_check
    check (
      (ubicacion is null and ubicacion_fuente is null)
      or (ubicacion is not null and ubicacion_fuente is not null and ubicacion_precision_m is not null)
    ),
  constraint puntos_conexion_ubicacion_fuente_check
    check (ubicacion_fuente is null or ubicacion_fuente in ('gps', 'centroide', 'referida', 'manual'))
);

comment on table puntos_conexion is
  '§5.9 connection points — where a community reaches signal. Separate from `nodos` (supply) so connectivity commerce never converges silently with goods commerce.';
comment on column puntos_conexion.privacidad is
  'Whether a call can be made unheard. Weighted most heavily where the subject is health (§5.9).';
comment on column puntos_conexion.notas is
  'The honest note: reaching a point can cost travel, money and risk — an activity meant to avoid a journey can require one first.';

create unique index puntos_conexion_org_nombre_key on puntos_conexion (organizacion_id, nombre);
create index puntos_conexion_org_idx on puntos_conexion (organizacion_id);
create index puntos_conexion_ubicacion_gix on puntos_conexion using gist (ubicacion);

create trigger puntos_conexion_tocar before update on puntos_conexion
  for each row execute function tocar_actualizado_en();

-- ── The communities a point serves ──────────────────────────────────────────────────────────
-- Many-to-many: one pier serves several riverside settlements; a community may reach signal
-- through more than one point. This is the "where can I go" join.

create table puntos_conexion_comunidades (
  punto_id                uuid not null references puntos_conexion (id) on delete cascade,
  comunidad_id            uuid not null references comunidades (id) on delete cascade
);

create unique index puntos_conexion_comunidades_key
  on puntos_conexion_comunidades (punto_id, comunidad_id);
create index puntos_conexion_comunidades_comunidad_idx
  on puntos_conexion_comunidades (comunidad_id);

-- ── RLS floor first, exactly as 0007/0012/0020 do it, so a half-finished policy set fails ─────
-- towards "staff cannot read" rather than "anon can".

alter table puntos_conexion enable row level security;
revoke all on public.puntos_conexion from anon, authenticated;
grant select, insert, update, delete on public.puntos_conexion to authenticated;

alter table puntos_conexion_comunidades enable row level security;
revoke all on public.puntos_conexion_comunidades from anon, authenticated;
grant select, insert, update, delete on public.puntos_conexion_comunidades to authenticated;

-- Read: any signed-in staff role, and only within their own organisation. A direct
-- `organizacion_id = convite_organizacion()` — the point carries its org, so the scope is on
-- the row, not on a join that could be widened later.
create policy puntos_conexion_lectura on puntos_conexion
  for select to authenticated
  using (
    convite_es(array['verificador', 'despachador', 'coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
  );

-- Write: a coordinator's desk. Field connectivity is operational knowledge maintained day to
-- day — like inventory and routes, not like placing a centre — so coordinador and admin write,
-- and only inside their own organisation. Enforced with `with check` too, so a row can neither
-- be created for, nor moved to, another organisation.
create policy puntos_conexion_coordina on puntos_conexion
  for all to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
  )
  with check (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
  );

-- The join inherits the point's boundary: you may read a served-community link when you can
-- read its point, and write one when you may write its point. Scoped through the parent's org.
create policy puntos_conexion_comunidades_lectura on puntos_conexion_comunidades
  for select to authenticated
  using (
    convite_es(array['verificador', 'despachador', 'coordinador', 'admin'])
    and exists (
      select 1 from puntos_conexion p
       where p.id = puntos_conexion_comunidades.punto_id
         and p.organizacion_id = convite_organizacion()
    )
  );

create policy puntos_conexion_comunidades_coordina on puntos_conexion_comunidades
  for all to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1 from puntos_conexion p
       where p.id = puntos_conexion_comunidades.punto_id
         and p.organizacion_id = convite_organizacion()
    )
  )
  with check (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1 from puntos_conexion p
       where p.id = puntos_conexion_comunidades.punto_id
         and p.organizacion_id = convite_organizacion()
    )
  );
