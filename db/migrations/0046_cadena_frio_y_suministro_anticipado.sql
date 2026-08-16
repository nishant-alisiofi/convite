-- PRD-33 (§24) — cold chain constraints + anticipatory supply.
--
-- The two of §24's three supply capabilities that are not funded local purchase (PRD-9):
--
--   1. Cold chain constrains routing. An item declares a storage requirement, a route declares
--      whether it can carry cold chain, a node declares whether it can hold it. The matcher
--      (lib/matching) excludes routes that cannot preserve a cold-chain item and surfaces a
--      distinct stuck-state rather than proposing a six-hour open boat for insulin.
--
--   2. Anticipatory supply. A subscription carries a refill cadence; a resolver distinct from the
--      reactive matcher proposes the next order ahead of stockout, and a person confirms it
--      before it becomes a pedido (2.1, principle 7).
--
-- All of it is additive: the constraints live in their own tables keyed to catalogo_items,
-- rutas and nodos, so Catálogo/Rutas/Nodos are untouched and every match that ran before this
-- migration runs identically. Real cold-storage hardware/telemetry at nodes is an open question
-- (§34) and out of scope — `apta_cadena_frio` is a declared capability, not a sensor reading.

-- ── Cold chain: item requirement ────────────────────────────────────────────────────────────

create table catalogo_requisitos_almacenamiento (
  codigo_item          char(2) primary key references catalogo_items (codigo),
  cadena_frio          boolean not null default false,
  sensible_luz         boolean not null default false,
  max_minutos_transito integer,
  notas                text,
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now(),

  constraint catalogo_requisitos_max_minutos_check
    check (max_minutos_transito is null or max_minutos_transito > 0)
);

comment on table catalogo_requisitos_almacenamiento is
  'PRD-33 §24: storage constraint for a catalogue item (cold chain / light-sensitive / open-transit window). Absence of a row = an ordinary item with no constraint.';
comment on column catalogo_requisitos_almacenamiento.max_minutos_transito is
  'Longest the item tolerates in open transit before it spoils, in minutes. Null = no time bound. For insulin this is the window that rules out the long river legs.';

create trigger catalogo_requisitos_almacenamiento_tocar before update on catalogo_requisitos_almacenamiento
  for each row execute function tocar_actualizado_en();

-- ── Cold chain: route restriction ───────────────────────────────────────────────────────────

create table rutas_restriccion_cadena_frio (
  ruta_id          uuid primary key references rutas (id) on delete cascade,
  apta_cadena_frio boolean not null default false,
  notas            text,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now()
);

comment on table rutas_restriccion_cadena_frio is
  'PRD-33 §24: whether a route (leg) can carry a cold-chain item. Absence of a row = not assessed = not apt (fail-closed): an unassessed open boat never carries insulin.';

create trigger rutas_restriccion_cadena_frio_tocar before update on rutas_restriccion_cadena_frio
  for each row execute function tocar_actualizado_en();

-- ── Cold chain: node capability ─────────────────────────────────────────────────────────────

create table nodos_almacenamiento_frio (
  nodo_id          uuid primary key references nodos (id) on delete cascade,
  apta_cadena_frio boolean not null default false,
  notas            text,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now()
);

comment on table nodos_almacenamiento_frio is
  'PRD-33 §24: whether a node can hold a cold-chain item (has cold storage). Absence of a row = cannot (fail-closed). §34 open question — a declared capability, not telemetry.';

create trigger nodos_almacenamiento_frio_tocar before update on nodos_almacenamiento_frio
  for each row execute function tocar_actualizado_en();

-- ── Anticipatory supply: the subscription ───────────────────────────────────────────────────

create table suministros_anticipados (
  id                  uuid primary key default gen_random_uuid(),
  -- Org-scoped like every operational table (0017 / 0030). RLS binds reads and writes to it.
  organizacion_id     uuid not null references organizaciones (id),
  comunidad_id        uuid not null references comunidades (id),
  -- Opaque beneficiary label (§27b.1) — «Partera del Atrato medio», never a name or a record.
  beneficiario_ref    text,
  codigo_item         char(2) not null references catalogo_items (codigo),
  familias            integer not null,
  -- Refill interval in days. Null = no cadence: the anticipatory resolver never fires (AC4).
  cadencia_dias       integer,
  dias_anticipacion   integer not null default 7,
  ultimo_suministro_en timestamptz,
  -- Validity from the telemedicine order (§27b.1). Null = open-ended.
  vigencia_hasta      timestamptz,
  -- Who set it (2.1). Signed against auth.uid() by the insert policy.
  creado_por          uuid references usuarios (id),
  activo              boolean not null default true,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),

  constraint suministros_anticipados_familias_check check (familias > 0),
  constraint suministros_anticipados_cadencia_check check (cadencia_dias is null or cadencia_dias > 0),
  constraint suministros_anticipados_anticipacion_check check (dias_anticipacion >= 0)
);

create index suministros_anticipados_organizacion_idx on suministros_anticipados (organizacion_id);
create index suministros_anticipados_comunidad_idx on suministros_anticipados (comunidad_id);
create index suministros_anticipados_item_idx on suministros_anticipados (codigo_item);

comment on table suministros_anticipados is
  'PRD-33 §24/§30: a predictable recurring need (chronic treatment, diabetes supplies, prenatal cadence). A refill cadence drives an anticipatory proposal ahead of stockout. Convite consumes a cadence, it does not prescribe one (§27b.1, §2).';
comment on column suministros_anticipados.beneficiario_ref is
  'Opaque beneficiary label from the telemedicine order (§27b.1). Never a real name, number, health detail or coordinate (Ley 1581 / 2.16).';
comment on column suministros_anticipados.cadencia_dias is
  'Refill interval in days. Null = no cadence: the anticipatory resolver never fires for this row (AC4).';

create trigger suministros_anticipados_tocar before update on suministros_anticipados
  for each row execute function tocar_actualizado_en();

-- ── Anticipatory supply: the proposal ───────────────────────────────────────────────────────

create table propuestas_anticipadas (
  id                uuid primary key default gen_random_uuid(),
  suministro_id     uuid not null references suministros_anticipados (id) on delete cascade,
  -- The refill due date this proposal is for. Idempotent per due date (unique index below).
  propuesto_para_en timestamptz not null,
  -- The confirming person (2.1, principle 7). Null while it is only a proposal.
  confirmado_por    uuid references usuarios (id),
  confirmado_en     timestamptz,
  -- The pedido this became on confirmation. Null until confirmed.
  pedido_id         uuid references pedidos (id),
  creado_en         timestamptz not null default now(),

  -- Same shape as emparejamientos: a confirmation is a person and a timestamp, or neither.
  constraint propuestas_anticipadas_confirmacion_check
    check ((confirmado_por is null and confirmado_en is null)
        or (confirmado_por is not null and confirmado_en is not null)),
  -- A proposal only becomes a pedido once a person has confirmed it.
  constraint propuestas_anticipadas_pedido_check
    check (pedido_id is null or confirmado_por is not null)
);

create unique index propuestas_anticipadas_suministro_fecha_key
  on propuestas_anticipadas (suministro_id, propuesto_para_en);
create index propuestas_anticipadas_suministro_idx on propuestas_anticipadas (suministro_id);

comment on table propuestas_anticipadas is
  'PRD-33 §24: an anticipatory order proposal for one refill due date. Idempotent per due date; nothing until a person confirms it (2.1) — only then does it carry a confirmado_por and the pedido_id it became.';

-- ── Audit: coordination decisions land an immutable row (2.1) ────────────────────────────────
--
-- Same shape and reasoning as auditar_apadrinamiento (0041): a write from a script, a psql
-- session or a future screen is recorded the same way, and auditoria has no UPDATE/DELETE policy
-- (0017), so what lands here cannot be edited afterwards.

create or replace function auditar_suministro_anticipado() returns trigger
language plpgsql security definer set search_path = public
as $auditar$
begin
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

comment on function auditar_suministro_anticipado() is
  'PRD-33 2.1: who created/changed an anticipatory subscription or confirmed a proposal, from what to what, and when. Writes an immutable auditoria row on every insert/update.';

create trigger suministros_anticipados_auditar
  after insert or update on suministros_anticipados
  for each row execute function auditar_suministro_anticipado();

create trigger propuestas_anticipadas_auditar
  after insert or update on propuestas_anticipadas
  for each row execute function auditar_suministro_anticipado();

-- ── RLS floor ───────────────────────────────────────────────────────────────────────────────
--
-- Same order as 0007/0017/0041: enable, revoke everything, grant back exactly what the policies
-- allow, so a half-finished policy set fails towards «staff cannot read», never «anon can».
-- service_role bypasses RLS entirely and is what the matcher and job worker use; these policies
-- govern human sessions.

-- Cold-chain constraints mirror the reference tables they hang off (0017): everyone with a role
-- reads them, and the same role that edits the parent edits the constraint.

alter table catalogo_requisitos_almacenamiento enable row level security;
revoke all on public.catalogo_requisitos_almacenamiento from anon, authenticated;
grant select, insert, update, delete on public.catalogo_requisitos_almacenamiento to authenticated;

-- Catálogo is shared reference data edited by admin (catalogo_admin_escribe).
create policy catalogo_requisitos_lectura on catalogo_requisitos_almacenamiento
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));

create policy catalogo_requisitos_admin_escribe on catalogo_requisitos_almacenamiento
  for all to authenticated
  using (convite_es(array['admin'])) with check (convite_es(array['admin']));

alter table rutas_restriccion_cadena_frio enable row level security;
revoke all on public.rutas_restriccion_cadena_frio from anon, authenticated;
grant select, insert, update, delete on public.rutas_restriccion_cadena_frio to authenticated;

-- Marking a route's cold-chain aptitude is a routing decision — coordinador + admin, like rutas
-- itself (rutas_coordina).
create policy rutas_restriccion_lectura on rutas_restriccion_cadena_frio
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));

create policy rutas_restriccion_coordina on rutas_restriccion_cadena_frio
  for all to authenticated
  using (convite_es(array['coordinador', 'admin']))
  with check (convite_es(array['coordinador', 'admin']));

alter table nodos_almacenamiento_frio enable row level security;
revoke all on public.nodos_almacenamiento_frio from anon, authenticated;
grant select, insert, update, delete on public.nodos_almacenamiento_frio to authenticated;

-- A node's cold storage is an infrastructure decision — admin, org-scoped through the node's
-- community, exactly as nodos_admin_escribe scopes the node itself.
create policy nodos_almacenamiento_lectura on nodos_almacenamiento_frio
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));

create policy nodos_almacenamiento_admin_escribe on nodos_almacenamiento_frio
  for all to authenticated
  using (
    convite_es(array['admin'])
    and exists (
      select 1 from nodos n
        join comunidades c on c.id = n.comunidad_id
       where n.id = nodos_almacenamiento_frio.nodo_id
         and c.organizacion_id = convite_organizacion()
    )
  )
  with check (
    convite_es(array['admin'])
    and exists (
      select 1 from nodos n
        join comunidades c on c.id = n.comunidad_id
       where n.id = nodos_almacenamiento_frio.nodo_id
         and c.organizacion_id = convite_organizacion()
    )
  );

-- Anticipatory supply is coordination work, scoped to the organisation, mirroring apadrinamientos
-- (0041): coordinador + admin, own organisation for writes, cross-org reads for a platform admin.

alter table suministros_anticipados enable row level security;
revoke all on public.suministros_anticipados from anon, authenticated;
grant select, insert, update on public.suministros_anticipados to authenticated;

create policy suministros_anticipados_lectura on suministros_anticipados
  for select to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and (organizacion_id = convite_organizacion() or convite_es_plataforma())
  );

create policy suministros_anticipados_agrega on suministros_anticipados
  for insert to authenticated
  with check (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
    and creado_por = auth.uid()
  );

create policy suministros_anticipados_actualiza on suministros_anticipados
  for update to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
  )
  with check (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
  );

alter table propuestas_anticipadas enable row level security;
revoke all on public.propuestas_anticipadas from anon, authenticated;
grant select, insert, update on public.propuestas_anticipadas to authenticated;

create policy propuestas_anticipadas_lectura on propuestas_anticipadas
  for select to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1
        from suministros_anticipados s
       where s.id = suministro_id
         and (s.organizacion_id = convite_organizacion() or convite_es_plataforma())
    )
  );

create policy propuestas_anticipadas_agrega on propuestas_anticipadas
  for insert to authenticated
  with check (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1
        from suministros_anticipados s
       where s.id = suministro_id
         and s.organizacion_id = convite_organizacion()
    )
  );

-- Confirming a proposal (2.1): coordinador/admin in the owning organisation, and you may only
-- sign your own confirmation — confirmado_por is auth.uid() or still null.
create policy propuestas_anticipadas_confirma on propuestas_anticipadas
  for update to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1
        from suministros_anticipados s
       where s.id = suministro_id
         and s.organizacion_id = convite_organizacion()
    )
  )
  with check (
    convite_es(array['coordinador', 'admin'])
    and (confirmado_por is null or confirmado_por = auth.uid())
    and exists (
      select 1
        from suministros_anticipados s
       where s.id = suministro_id
         and s.organizacion_id = convite_organizacion()
    )
  );
