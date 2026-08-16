-- PRD-9 — Funded local purchase, the third supply mode (PRD v3 §24 / §30).
--
-- The first two supply modes move existing goods (counted stock, in-kind offers). This inverts
-- the default: instead of shipping a thing in, allocate funds to a territorial responsible who
-- buys in or near the municipality — less time, lower cost, local economies strengthened, and for
-- a river-cut community sometimes the only mode that arrives in time. A SIN_EXISTENCIA demand the
-- matcher cannot resolve from stock or offers becomes a candidate for a purchase.
--
-- It is a traceability chain, not a payments integration. §24/§30's six steps are made into state
-- a database enforces: autorización → responsable → recibo → verificación → distribución →
-- evidencia. The state machine cannot skip a step; the authorisation core cannot be edited after
-- recording (the immutability trigger); a pool refuses a purchase past its ceiling (the guardrail,
-- mirroring the M10 voice-spend caps). Audit rows are written by trigger, the shape 0041 uses.

-- ── The budget guardrail: a pool with a ceiling and an alert threshold ───────────────────────

create table fondos_compra (
  id                  uuid primary key default gen_random_uuid(),
  organizacion_id     uuid not null references organizaciones (id),
  nombre              text not null,
  -- Hard ceiling in COP. New purchases are blocked once committed spend would exceed it.
  techo_cop           bigint not null,
  -- Optional soft line a screen alerts at. <= the ceiling.
  umbral_alerta_cop   bigint,
  activo              boolean not null default true,
  creado_por          uuid references usuarios (id),
  notas               text,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),

  constraint fondos_compra_techo_check check (techo_cop > 0),
  constraint fondos_compra_umbral_check
    check (umbral_alerta_cop is null or (umbral_alerta_cop > 0 and umbral_alerta_cop <= techo_cop))
);

create index fondos_compra_organizacion_idx on fondos_compra (organizacion_id);

comment on table fondos_compra is
  'PRD-9 budget guardrail (AC #4): a funding pool with a hard ceiling (techo_cop) the guardrail trigger enforces, and an optional soft alert threshold. Exceeding the ceiling blocks new purchases until it is raised.';

-- ── Local vendors: who, where, what they can supply ─────────────────────────────────────────

create table proveedores_locales (
  id                  uuid primary key default gen_random_uuid(),
  organizacion_id     uuid not null references organizaciones (id),
  nombre              text not null,
  comunidad_id        uuid references comunidades (id),
  municipio           text,
  -- Free text of what they can supply — the catalogue coupling is out of v1 scope.
  suministra          text,
  contacto            text,
  activo              boolean not null default true,
  creado_por          uuid references usuarios (id),
  notas               text,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now()
);

create index proveedores_locales_organizacion_idx on proveedores_locales (organizacion_id);

comment on table proveedores_locales is
  'PRD-9 local vendor records (§24): who, where, and what they can supply near the municipality.';

-- ── The purchase + its traceability chain ───────────────────────────────────────────────────

create table compras_locales (
  id                    uuid primary key default gen_random_uuid(),
  organizacion_id       uuid not null references organizaciones (id),
  -- The pool this draws on. The guardrail trigger sums against its ceiling.
  fondo_id              uuid not null references fondos_compra (id),
  -- The demand it resolves — a SIN_EXISTENCIA pedido a purchase satisfies (AC #1).
  pedido_id             uuid references pedidos (id),
  proveedor_id          uuid references proveedores_locales (id),
  -- Step 2: the territorial responsible who buys near the municipality (§30).
  responsable_id        uuid not null references contactos (id),
  comunidad_id          uuid references comunidades (id),
  concepto              text not null,
  -- Step 1: the amount authorised, in COP. Immutable. The guardrail sums this against the pool.
  monto_autorizado_cop  bigint not null,
  -- Step 3: the amount actually spent, recorded with the receipt.
  monto_real_cop        bigint,
  estado                text not null default 'AUTORIZADA',

  -- Step 1: the deciding human (2.1). Immutable. Signed against auth.uid() by the insert policy.
  autorizado_por        uuid references usuarios (id),
  autorizado_en         timestamptz not null default now(),
  -- Step 3: the receipt reference (a filed document id/number).
  recibo_ref            text,
  comprado_por          uuid references usuarios (id),
  comprado_en           timestamptz,
  -- Step 4: verification the materials were received.
  verificado_por        uuid references usuarios (id),
  verificado_en         timestamptz,
  -- Step 5: distribution in/near the municipality.
  distribuido_por       uuid references usuarios (id),
  distribuido_en        timestamptz,
  -- Step 6: closed once the documentary/photographic evidence is on record.
  cerrado_por           uuid references usuarios (id),
  cerrado_en            timestamptz,

  notas                 text,
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now(),

  constraint compras_locales_estado_check
    check (estado in ('AUTORIZADA', 'COMPRADA', 'VERIFICADA', 'DISTRIBUIDA', 'CERRADA', 'CANCELADA')),
  constraint compras_locales_monto_check check (monto_autorizado_cop > 0),
  constraint compras_locales_monto_real_check check (monto_real_cop is null or monto_real_cop >= 0),
  -- Each step's who-and-when is both-or-neither (2.1 shape).
  constraint compras_locales_comprado_check check ((comprado_por is null) = (comprado_en is null)),
  constraint compras_locales_verificado_check check ((verificado_por is null) = (verificado_en is null)),
  constraint compras_locales_distribuido_check check ((distribuido_por is null) = (distribuido_en is null)),
  constraint compras_locales_cerrado_check check ((cerrado_por is null) = (cerrado_en is null)),
  -- The chain cannot skip a step: a later state requires every earlier step's evidence.
  constraint compras_locales_comprada_check
    check (estado not in ('COMPRADA', 'VERIFICADA', 'DISTRIBUIDA', 'CERRADA')
           or (recibo_ref is not null and comprado_por is not null)),
  constraint compras_locales_verificada_check
    check (estado not in ('VERIFICADA', 'DISTRIBUIDA', 'CERRADA') or verificado_por is not null),
  constraint compras_locales_distribuida_check
    check (estado not in ('DISTRIBUIDA', 'CERRADA') or distribuido_por is not null),
  constraint compras_locales_cerrada_check
    check (estado <> 'CERRADA' or cerrado_por is not null)
);

create index compras_locales_organizacion_idx on compras_locales (organizacion_id);
create index compras_locales_fondo_idx on compras_locales (fondo_id);
create index compras_locales_estado_idx on compras_locales (estado);
create index compras_locales_pedido_idx on compras_locales (pedido_id);

comment on table compras_locales is
  'PRD-9 funded purchase walked through the six-step chain (§24/§30): autorización → responsable → recibo → verificación → distribución → evidencia. The authorisation core is immutable after recording (compra_local_inmutable trigger); the state machine cannot skip a step (checks); a pool ceiling blocks over-spend (compra_local_guardrail trigger).';

create table compra_local_items (
  id            uuid primary key default gen_random_uuid(),
  compra_id     uuid not null references compras_locales (id) on delete cascade,
  codigo_item   char(2) not null references catalogo_items (codigo),
  cantidad      integer not null,
  costo_cop     bigint,
  creado_en     timestamptz not null default now(),

  constraint compra_local_items_cantidad_check check (cantidad > 0),
  constraint compra_local_items_costo_check check (costo_cop is null or costo_cop >= 0)
);

create index compra_local_items_compra_idx on compra_local_items (compra_id);

comment on table compra_local_items is
  'PRD-9 line items (AC #2): what a purchase bought, how much, at what cost.';

create table compra_local_evidencias (
  id            uuid primary key default gen_random_uuid(),
  compra_id     uuid not null references compras_locales (id) on delete cascade,
  tipo          text not null,
  -- Where the evidence lives — a stored file path/url or a filed reference.
  referencia    text not null,
  descripcion   text,
  subido_por    uuid references usuarios (id),
  creado_en     timestamptz not null default now(),

  constraint compra_local_evidencias_tipo_check
    check (tipo in ('recibo', 'foto', 'documento', 'acta'))
);

create index compra_local_evidencias_compra_idx on compra_local_evidencias (compra_id);

comment on table compra_local_evidencias is
  'PRD-9 documentary/photographic trail (§24, steps 3 and 6): the receipt, photos of materials received, the distribution act. Append-only and immutable — no update/delete grant below.';

-- ── The ceiling guardrail ───────────────────────────────────────────────────────────────────
-- BEFORE INSERT: sum the pool's committed (non-cancelled) purchases plus this one, and refuse it
-- if that would breach the ceiling (AC #4). SECURITY DEFINER so the sum sees every purchase in the
-- pool regardless of the caller's row visibility, and monto_autorizado_cop is immutable so there
-- is nothing to re-check on UPDATE.

create or replace function compra_local_guardrail() returns trigger
language plpgsql security definer set search_path = public
as $guard$
declare
  techo         bigint;
  comprometido  bigint;
begin
  select techo_cop into techo from fondos_compra where id = new.fondo_id;
  if techo is null then
    raise exception 'El fondo % no existe.', new.fondo_id;
  end if;

  select coalesce(sum(monto_autorizado_cop), 0) into comprometido
    from compras_locales
   where fondo_id = new.fondo_id and estado <> 'CANCELADA';

  if comprometido + new.monto_autorizado_cop > techo then
    raise exception
      'La compra supera el techo del fondo: comprometido % + % autorizado > techo %. Suba el techo antes de autorizar.',
      comprometido, new.monto_autorizado_cop, techo;
  end if;

  return new;
end
$guard$;

comment on function compra_local_guardrail() is
  'PRD-9 AC #4: refuses a purchase whose authorised amount would push a pool past its ceiling. The block lifts when the ceiling is raised.';

create trigger compras_locales_guardrail
  before insert on compras_locales
  for each row execute function compra_local_guardrail();

-- ── Authorisation immutability ──────────────────────────────────────────────────────────────
-- AC #3: a purchase is immutable after recording. Later columns advance the chain; the
-- authorisation core does not change. This refuses any UPDATE that alters it.

create or replace function compra_local_inmutable() returns trigger
language plpgsql set search_path = public
as $inmutable$
begin
  if new.id is distinct from old.id
     or new.organizacion_id is distinct from old.organizacion_id
     or new.fondo_id is distinct from old.fondo_id
     or new.pedido_id is distinct from old.pedido_id
     or new.proveedor_id is distinct from old.proveedor_id
     or new.responsable_id is distinct from old.responsable_id
     or new.comunidad_id is distinct from old.comunidad_id
     or new.concepto is distinct from old.concepto
     or new.monto_autorizado_cop is distinct from old.monto_autorizado_cop
     or new.autorizado_por is distinct from old.autorizado_por
     or new.autorizado_en is distinct from old.autorizado_en
     or new.creado_en is distinct from old.creado_en then
    raise exception 'La autorización de una compra local es inmutable; solo avanza su estado y su evidencia.';
  end if;
  return new;
end
$inmutable$;

comment on function compra_local_inmutable() is
  'PRD-9 AC #3: the authorisation core (who authorised, how much, from which pool, for whom) cannot be edited after recording. Only the chain state and its evidence advance.';

create trigger compras_locales_inmutable before update on compras_locales
  for each row execute function compra_local_inmutable();

-- ── Audit + touch triggers ──────────────────────────────────────────────────────────────────

create or replace function auditar_compra_local() returns trigger
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

comment on function auditar_compra_local() is
  'Non-negotiable 2.1 for funded purchases: who authorised/advanced a purchase and its evidence, from what to what, and when. Writes an immutable auditoria row on every insert/update.';

create trigger compras_locales_auditar
  after insert or update on compras_locales
  for each row execute function auditar_compra_local();

create trigger compra_local_items_auditar
  after insert on compra_local_items
  for each row execute function auditar_compra_local();

create trigger compra_local_evidencias_auditar
  after insert on compra_local_evidencias
  for each row execute function auditar_compra_local();

create trigger fondos_compra_tocar before update on fondos_compra
  for each row execute function tocar_actualizado_en();
create trigger proveedores_locales_tocar before update on proveedores_locales
  for each row execute function tocar_actualizado_en();
create trigger compras_locales_tocar before update on compras_locales
  for each row execute function tocar_actualizado_en();

-- ── RLS floor ─────────────────────────────────────────────────────────────────────────────
-- Same order as 0041. Pools and vendors are coordination (coordinador/admin); purchases are the
-- work of coordination and dispatch alike (coordinador/admin/despachador), matching the PRD's
-- «as coordinador/despachador, resolve a SIN_EXISTENCIA demand». Reads are org-scoped; a platform
-- admin reaches across organisations for reads only (0034). Line items and evidence are
-- append-only — no UPDATE/DELETE grant.

alter table fondos_compra enable row level security;
revoke all on public.fondos_compra from anon, authenticated;
grant select, insert, update on public.fondos_compra to authenticated;

create policy fondos_compra_lectura on fondos_compra
  for select to authenticated
  using (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and (organizacion_id = convite_organizacion() or convite_es_plataforma())
  );

create policy fondos_compra_agrega on fondos_compra
  for insert to authenticated
  with check (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
    and creado_por = auth.uid()
  );

create policy fondos_compra_actualiza on fondos_compra
  for update to authenticated
  using (convite_es(array['coordinador', 'admin']) and organizacion_id = convite_organizacion())
  with check (convite_es(array['coordinador', 'admin']) and organizacion_id = convite_organizacion());

alter table proveedores_locales enable row level security;
revoke all on public.proveedores_locales from anon, authenticated;
grant select, insert, update on public.proveedores_locales to authenticated;

create policy proveedores_locales_lectura on proveedores_locales
  for select to authenticated
  using (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and (organizacion_id = convite_organizacion() or convite_es_plataforma())
  );

create policy proveedores_locales_agrega on proveedores_locales
  for insert to authenticated
  with check (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
    and creado_por = auth.uid()
  );

create policy proveedores_locales_actualiza on proveedores_locales
  for update to authenticated
  using (convite_es(array['coordinador', 'admin']) and organizacion_id = convite_organizacion())
  with check (convite_es(array['coordinador', 'admin']) and organizacion_id = convite_organizacion());

alter table compras_locales enable row level security;
revoke all on public.compras_locales from anon, authenticated;
grant select, insert, update on public.compras_locales to authenticated;

create policy compras_locales_lectura on compras_locales
  for select to authenticated
  using (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and (organizacion_id = convite_organizacion() or convite_es_plataforma())
  );

create policy compras_locales_agrega on compras_locales
  for insert to authenticated
  with check (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and organizacion_id = convite_organizacion()
    and autorizado_por = auth.uid()
    and exists (
      select 1 from fondos_compra f
       where f.id = fondo_id and f.organizacion_id = convite_organizacion()
    )
  );

create policy compras_locales_actualiza on compras_locales
  for update to authenticated
  using (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and organizacion_id = convite_organizacion()
  )
  with check (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and organizacion_id = convite_organizacion()
  );

alter table compra_local_items enable row level security;
revoke all on public.compra_local_items from anon, authenticated;
-- No UPDATE or DELETE: line items are recorded once with the purchase.
grant select, insert on public.compra_local_items to authenticated;

create policy compra_local_items_lectura on compra_local_items
  for select to authenticated
  using (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and exists (
      select 1 from compras_locales c
       where c.id = compra_id
         and (c.organizacion_id = convite_organizacion() or convite_es_plataforma())
    )
  );

create policy compra_local_items_agrega on compra_local_items
  for insert to authenticated
  with check (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and exists (
      select 1 from compras_locales c
       where c.id = compra_id and c.organizacion_id = convite_organizacion()
    )
  );

alter table compra_local_evidencias enable row level security;
revoke all on public.compra_local_evidencias from anon, authenticated;
-- Append-only: evidence, once filed, is not edited or deleted.
grant select, insert on public.compra_local_evidencias to authenticated;

create policy compra_local_evidencias_lectura on compra_local_evidencias
  for select to authenticated
  using (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and exists (
      select 1 from compras_locales c
       where c.id = compra_id
         and (c.organizacion_id = convite_organizacion() or convite_es_plataforma())
    )
  );

create policy compra_local_evidencias_agrega on compra_local_evidencias
  for insert to authenticated
  with check (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and subido_por = auth.uid()
    and exists (
      select 1 from compras_locales c
       where c.id = compra_id and c.organizacion_id = convite_organizacion()
    )
  );
