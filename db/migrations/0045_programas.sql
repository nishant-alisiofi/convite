-- PRD-31 — Programas: the funded layer above jornadas (§21b).
--
-- A jornada (§22, tables from 0043) is one occurrence. A programa is what an organisation plans
-- and funds: an objective, a target population, a cadence, a budget and a financiador, realised by
-- a set of jornadas over months. This migration adds the programa layer on top of the existing
-- jornada tables — it never changes the matching engine (§22) and never touches PRD-12's
-- apadrinamientos (programa sponsorship gets its own table). Additive throughout: the one change to
-- an existing table is a nullable jornadas.programa_id, because «not everything belongs to a
-- programa» (an emergency shipment does not). 0043 (jornadas) must run first.

-- ── programas ──────────────────────────────────────────────────────────────────────────────────
-- Org-scoped like every operational table (0017 / 0030 / 0041): RLS binds reads and writes to the
-- owning organisation. Indicadores (coverage, attendance, delivery, completion) are computed from
-- the jornadas, the roster and the ledger, never stored, so they can never drift from the facts.

create table programas (
  id                           uuid primary key default gen_random_uuid(),
  codigo                       text not null,
  organizacion_id              uuid not null references organizaciones (id),
  titulo                       text not null,
  objetivo                     text not null,
  poblacion_objetivo           text,
  familias_objetivo            integer,
  cadencia                     text not null,
  fecha_inicio                 date,
  fecha_fin                    date,
  renueva                      boolean not null default false,
  estado                       text not null default 'borrador',
  presupuesto_comprometido_cop bigint not null default 0,
  financiador                  text,
  financiador_reporte          text,
  notas                        text,
  creado_por                   uuid references usuarios (id),
  creado_en                    timestamptz not null default now(),
  actualizado_en               timestamptz not null default now(),

  constraint programas_cadencia_check
    check (cadencia in ('mensual', 'semanal', 'trimestral', 'unico')),
  constraint programas_estado_check
    check (estado in ('borrador', 'activo', 'pausado', 'completado', 'cancelado')),
  constraint programas_familias_check
    check (familias_objetivo is null or familias_objetivo >= 0),
  constraint programas_presupuesto_check
    check (presupuesto_comprometido_cop >= 0),
  constraint programas_fechas_check
    check (fecha_fin is null or fecha_inicio is null or fecha_fin >= fecha_inicio)
);

create unique index programas_codigo_key on programas (codigo);
create index programas_organizacion_idx on programas (organizacion_id);
create index programas_estado_idx on programas (estado);

comment on table programas is
  'PRD-31 (§21b): the funded layer above jornadas — objective, target population, cadence, duration, budget and financiador, realised by a set of jornadas. Not the navigation container (an emergency shipment belongs to no programa); lives inside Agenda (§18).';
comment on column programas.presupuesto_comprometido_cop is
  '§21b.1 Presupuesto: committed COP for the programa. Applied is summed off programa_aplicaciones; remaining is committed minus applied (AC2).';

-- ── jornadas.programa_id ─────────────────────────────────────────────────────────────────────
-- The link back to the containing programa (§21b), added additively. Nullable because not every
-- jornada belongs to a programa. The Drizzle mirror declares this as a plain uuid; the FK lives
-- here, the same one-way-import trick comunidades.region_id uses (0042).

alter table jornadas add column programa_id uuid references programas (id);
create index jornadas_programa_idx on jornadas (programa_id);

comment on column jornadas.programa_id is
  'PRD-31: the programa this jornada realises, or null — «not everything belongs to a programa» (§21b). The programa shows its jornadas planned vs actual (AC6).';

-- ── programa_comunidades — target population + feasibility input ──────────────────────────────
-- Which communities the programa targets. The seasonal-feasibility calendar (§21b.2) reads this
-- set. Cascades with its programa; comunidad_id is a plain reference so removing a programa never
-- reaches into the shared registry.

create table programa_comunidades (
  id                 uuid primary key default gen_random_uuid(),
  programa_id        uuid not null references programas (id) on delete cascade,
  comunidad_id       uuid not null references comunidades (id),
  familias_estimadas integer,
  creado_en          timestamptz not null default now(),

  constraint programa_comunidades_familias_check
    check (familias_estimadas is null or familias_estimadas >= 0)
);

create unique index programa_comunidades_par_key on programa_comunidades (programa_id, comunidad_id);
create index programa_comunidades_programa_idx on programa_comunidades (programa_id);
create index programa_comunidades_comunidad_idx on programa_comunidades (comunidad_id);

comment on table programa_comunidades is
  'PRD-31 (§21b.1/§21b.2): the communities a programa targets and the families estimated in each — the input to the seasonal-feasibility calendar.';

-- ── programa_participantes — the persistent roster (§21b.3) ───────────────────────────────────
-- A taller/formacion carries the same participants across sessions. `completado` is completion per
-- cohort. §22 binds hard: record that someone attended, never what for — there is deliberately no
-- necesidad/motivo/diagnostico column here.

create table programa_participantes (
  id             uuid primary key default gen_random_uuid(),
  programa_id    uuid not null references programas (id) on delete cascade,
  nombre         text not null,
  contacto       text,
  completado     boolean not null default false,
  completado_en  timestamptz,
  notas          text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  constraint programa_participantes_completado_check
    check (completado = false or completado_en is not null)
);

create index programa_participantes_programa_idx on programa_participantes (programa_id);

comment on table programa_participantes is
  'PRD-31 (§21b.3): the persistent roster of a taller/formacion — the same people across sessions. A list of names and completion, never a record of what anyone needed (§22).';

-- ── programa_asistencias — attendance per session (§21b.3) ────────────────────────────────────
-- A session is a jornada. Attendance records only THAT a participant attended (§22), never what
-- for. One row per participante per jornada.

create table programa_asistencias (
  id              uuid primary key default gen_random_uuid(),
  participante_id uuid not null references programa_participantes (id) on delete cascade,
  jornada_id      uuid not null references jornadas (id) on delete cascade,
  asistio         boolean not null default true,
  creado_en       timestamptz not null default now()
);

create unique index programa_asistencias_par_key on programa_asistencias (participante_id, jornada_id);
create index programa_asistencias_participante_idx on programa_asistencias (participante_id);
create index programa_asistencias_jornada_idx on programa_asistencias (jornada_id);

comment on table programa_asistencias is
  'PRD-31 (§21b.3/§22): attendance per session — that a participant attended a jornada, never what for.';

-- ── programa_apadrinamientos — programa-level sponsorship (§21b.4) ─────────────────────────────
-- An apadrinamiento can fund a programa — «financia el banco de medicamentos por seis meses». Its
-- own table so PRD-12's apadrinamientos is untouched. Same consent posture: the sponsor sees a
-- label (etiqueta) and the programa, never a name (Ley 1581). Retired by state, never deleted.

create table programa_apadrinamientos (
  id                uuid primary key default gen_random_uuid(),
  programa_id       uuid not null references programas (id) on delete cascade,
  etiqueta          text not null,
  padrino_nombre    text not null,
  padrino_contacto  text,
  padrino_tipo      text not null default 'individuo',
  monto_cop         bigint not null,
  recurrencia       text not null default 'unico',
  estado            text not null default 'activo',
  consentimiento    boolean not null default false,
  consentimiento_en timestamptz,
  creado_por        uuid references usuarios (id),
  notas             text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  constraint programa_apadrinamientos_monto_check check (monto_cop > 0),
  constraint programa_apadrinamientos_tipo_check
    check (padrino_tipo in ('individuo', 'organizacion')),
  constraint programa_apadrinamientos_recurrencia_check
    check (recurrencia in ('unico', 'mensual')),
  constraint programa_apadrinamientos_estado_check
    check (estado in ('activo', 'pausado', 'completado', 'cancelado')),
  constraint programa_apadrinamientos_consent_check
    check (consentimiento = false or consentimiento_en is not null)
);

create index programa_apadrinamientos_programa_idx on programa_apadrinamientos (programa_id);
create index programa_apadrinamientos_estado_idx on programa_apadrinamientos (estado);

comment on table programa_apadrinamientos is
  'PRD-31 (§21b.4): a sponsorship that funds a programa. The sponsor sees a label and the programa, never a name (Ley 1581). Programa totals mirror Apadrinar: comprometido / aplicado / disponible.';

-- ── programa_aplicaciones — the spend ledger (§21b.1/§21b.4) ───────────────────────────────────
-- How much of a programa's budget has been applied, and to what. `aplicado` (AC2) is the sum over
-- this table; an application may name the sponsorship whose money it draws (AC5) and/or the jornada
-- it paid for. Append-only and immutable, mirroring apadrinamiento_asignaciones.

create table programa_aplicaciones (
  id                 uuid primary key default gen_random_uuid(),
  programa_id        uuid not null references programas (id) on delete cascade,
  apadrinamiento_id  uuid references programa_apadrinamientos (id),
  jornada_id         uuid references jornadas (id),
  monto_aplicado_cop bigint not null,
  concepto           text,
  aplicado_por       uuid references usuarios (id),
  creado_en          timestamptz not null default now(),

  constraint programa_aplicaciones_monto_check check (monto_aplicado_cop > 0)
);

create index programa_aplicaciones_programa_idx on programa_aplicaciones (programa_id);
create index programa_aplicaciones_apadrinamiento_idx on programa_aplicaciones (apadrinamiento_id);
create index programa_aplicaciones_jornada_idx on programa_aplicaciones (jornada_id);

comment on table programa_aplicaciones is
  'PRD-31 (§21b.1/§21b.4): the immutable spend ledger for a programa. aplicado = sum over this table; restante = committed budget minus it (AC2). May name the sponsorship it draws (AC5) and the jornada it paid for.';

-- ── The audit row ────────────────────────────────────────────────────────────────────────────
-- A trigger rather than an application write, so a change from a script, a psql session or a
-- future screen is recorded the same way. SECURITY DEFINER so it can write `auditoria` regardless
-- of the caller's grants — the same shape as auditar_apadrinamiento (0041). auditoria has no
-- UPDATE/DELETE policy (0017), so what lands here cannot be edited afterwards.

create or replace function auditar_programa() returns trigger
language plpgsql security definer set search_path = public
as $auditar$
begin
  -- A write that changes nothing is not a decision worth a row.
  if tg_op = 'UPDATE' and to_jsonb(old) is not distinct from to_jsonb(new) then
    return new;
  end if;

  insert into auditoria (actor_id, accion, entidad, entidad_id, antes, despues)
  values (
    auth.uid(),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(new.id, old.id),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end
$auditar$;

comment on function auditar_programa() is
  'Non-negotiable 2.1 for programas: who created/changed a programa, its sponsorships or applied its funds, from what to what, and when. Writes an immutable auditoria row on every insert/update.';

create trigger programas_auditar
  after insert or update on programas
  for each row execute function auditar_programa();
create trigger programas_tocar before update on programas
  for each row execute function tocar_actualizado_en();

create trigger programa_apadrinamientos_auditar
  after insert or update on programa_apadrinamientos
  for each row execute function auditar_programa();
create trigger programa_apadrinamientos_tocar before update on programa_apadrinamientos
  for each row execute function tocar_actualizado_en();

create trigger programa_aplicaciones_auditar
  after insert on programa_aplicaciones
  for each row execute function auditar_programa();

create trigger programa_participantes_tocar before update on programa_participantes
  for each row execute function tocar_actualizado_en();

-- ── RLS floor ────────────────────────────────────────────────────────────────────────────────
-- Same order as 0041: enable, revoke everything, grant back exactly what the policies allow, so a
-- half-finished policy set fails towards «staff cannot read» rather than «anon can». Programas are
-- planning and funding — coordination work — so they are coordinador + admin, within their own
-- organisation; a platform admin reaches across organisations for reads only (0034/0041), never for
-- writes. The child tables inherit the programa's boundary through an EXISTS on programas.

alter table programas enable row level security;
revoke all on public.programas from anon, authenticated;
grant select, insert, update on public.programas to authenticated;

create policy programas_lectura on programas
  for select to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and (organizacion_id = convite_organizacion() or convite_es_plataforma())
  );

create policy programas_agrega on programas
  for insert to authenticated
  with check (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
    and creado_por = auth.uid()
  );

create policy programas_actualiza on programas
  for update to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
  )
  with check (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
  );

-- A small helper predicate, inlined per table: you may touch a child row when you may read/write
-- its programa. Reads allow the platform's cross-org reach; writes stay inside the caller's org.
alter table programa_comunidades enable row level security;
revoke all on public.programa_comunidades from anon, authenticated;
grant select, insert, update, delete on public.programa_comunidades to authenticated;

create policy programa_comunidades_lectura on programa_comunidades
  for select to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1 from programas p
       where p.id = programa_comunidades.programa_id
         and (p.organizacion_id = convite_organizacion() or convite_es_plataforma())
    )
  );

create policy programa_comunidades_coordina on programa_comunidades
  for all to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1 from programas p
       where p.id = programa_comunidades.programa_id
         and p.organizacion_id = convite_organizacion()
    )
  )
  with check (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1 from programas p
       where p.id = programa_comunidades.programa_id
         and p.organizacion_id = convite_organizacion()
    )
  );

alter table programa_participantes enable row level security;
revoke all on public.programa_participantes from anon, authenticated;
grant select, insert, update, delete on public.programa_participantes to authenticated;

create policy programa_participantes_lectura on programa_participantes
  for select to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1 from programas p
       where p.id = programa_participantes.programa_id
         and (p.organizacion_id = convite_organizacion() or convite_es_plataforma())
    )
  );

create policy programa_participantes_coordina on programa_participantes
  for all to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1 from programas p
       where p.id = programa_participantes.programa_id
         and p.organizacion_id = convite_organizacion()
    )
  )
  with check (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1 from programas p
       where p.id = programa_participantes.programa_id
         and p.organizacion_id = convite_organizacion()
    )
  );

alter table programa_asistencias enable row level security;
revoke all on public.programa_asistencias from anon, authenticated;
grant select, insert, update, delete on public.programa_asistencias to authenticated;

create policy programa_asistencias_lectura on programa_asistencias
  for select to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1 from programa_participantes pp
         join programas p on p.id = pp.programa_id
       where pp.id = programa_asistencias.participante_id
         and (p.organizacion_id = convite_organizacion() or convite_es_plataforma())
    )
  );

create policy programa_asistencias_coordina on programa_asistencias
  for all to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1 from programa_participantes pp
         join programas p on p.id = pp.programa_id
       where pp.id = programa_asistencias.participante_id
         and p.organizacion_id = convite_organizacion()
    )
  )
  with check (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1 from programa_participantes pp
         join programas p on p.id = pp.programa_id
       where pp.id = programa_asistencias.participante_id
         and p.organizacion_id = convite_organizacion()
    )
  );

alter table programa_apadrinamientos enable row level security;
revoke all on public.programa_apadrinamientos from anon, authenticated;
grant select, insert, update on public.programa_apadrinamientos to authenticated;

create policy programa_apadrinamientos_lectura on programa_apadrinamientos
  for select to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1 from programas p
       where p.id = programa_apadrinamientos.programa_id
         and (p.organizacion_id = convite_organizacion() or convite_es_plataforma())
    )
  );

create policy programa_apadrinamientos_agrega on programa_apadrinamientos
  for insert to authenticated
  with check (
    convite_es(array['coordinador', 'admin'])
    and creado_por = auth.uid()
    and exists (
      select 1 from programas p
       where p.id = programa_apadrinamientos.programa_id
         and p.organizacion_id = convite_organizacion()
    )
  );

create policy programa_apadrinamientos_actualiza on programa_apadrinamientos
  for update to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1 from programas p
       where p.id = programa_apadrinamientos.programa_id
         and p.organizacion_id = convite_organizacion()
    )
  )
  with check (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1 from programas p
       where p.id = programa_apadrinamientos.programa_id
         and p.organizacion_id = convite_organizacion()
    )
  );

alter table programa_aplicaciones enable row level security;
revoke all on public.programa_aplicaciones from anon, authenticated;
-- No UPDATE or DELETE: an application is immutable once recorded.
grant select, insert on public.programa_aplicaciones to authenticated;

create policy programa_aplicaciones_lectura on programa_aplicaciones
  for select to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1 from programas p
       where p.id = programa_aplicaciones.programa_id
         and (p.organizacion_id = convite_organizacion() or convite_es_plataforma())
    )
  );

create policy programa_aplicaciones_agrega on programa_aplicaciones
  for insert to authenticated
  with check (
    convite_es(array['coordinador', 'admin'])
    and aplicado_por = auth.uid()
    and exists (
      select 1 from programas p
       where p.id = programa_aplicaciones.programa_id
         and p.organizacion_id = convite_organizacion()
    )
  );
