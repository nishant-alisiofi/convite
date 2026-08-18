-- FR-46 (lancha: costo y pago al lanchero) + PRD-47 (red de lancheros para relevo de datos) —
-- two correlated river-logistics features, field feedback from Chocó (Doña Marta, relayed by
-- Nishant 2026-08-17), sharing the same primitive: a lanchero is a contact with a role.
--
-- FR-46: the river is the road and the lancha is the truck. Boat is already a transport mode
-- (`lancha` in MODOS since 0004/0048) — what a leg by boat does not carry today is a financial
-- record: what it cost, and what is owed to the lanchero who ran it. `pagos_lanchero` is that
-- record, attached to exactly one leg (an `envio` or a `traslado_persona`). Record-keeping only —
-- no disbursement — the same posture PRD-9's `compras_locales` (0049) already established for
-- funding without moving money.
--
-- PRD-47: upriver communities may have no channel at all, but a lanchero passing through can carry
-- a report out and relay it once they reach connectivity — a human sneakernet. Built on stated
-- assumptions (flagged in the WI for partner review): a lanchero is a REGISTERED, VETTED relay,
-- never an anonymous self-signup, mirroring the vetted stance FR-18 drew for transport. Two pieces
-- make that real: `lancheros_comunidades` records which communities a lanchero's route covers (the
-- same many-to-many "coverage" shape `puntos_conexion_comunidades` already uses, 0040), and
-- `registrar_reporte_relevo` is the one gated door a report enters through — mirroring
-- `registrar_reporte_manual` (0052) exactly, plus the vetting check that the lanchero is actually
-- registered for the origin community they are relaying for.
--
-- What this migration deliberately does NOT do: no anonymous lanchero self-registration (registering
-- one is coordinador/admin desk work, same as any other contact), no dedicated lanchero mobile
-- client or offline sync (the existing panel is the only surface), no automated payment rails.

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  Part 0 — the shared primitive: a lanchero is a contact with a role
-- ════════════════════════════════════════════════════════════════════════════════════════════

alter table contactos drop constraint contactos_rol_check;
alter table contactos add constraint contactos_rol_check
  check (rol in ('reportante', 'verificador', 'transportista', 'coordinador', 'donante', 'lanchero'));

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  Part 1 — FR-46: boat-leg cost + lanchero payment (record-keeping only)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Attached to exactly one leg, goods or people — `envios` (marketplace shipments) or
-- `traslados_persona` (0048). Two amounts, because the WI names two nouns: what the leg cost
-- overall, and what is owed to the lanchero specifically; they are not always the same figure
-- (fuel and other costs may be paid separately from the lanchero's own fee).

create table pagos_lanchero (
  id                    uuid primary key default gen_random_uuid(),
  organizacion_id       uuid not null references organizaciones (id),
  envio_id              uuid references envios (id),
  traslado_persona_id   uuid references traslados_persona (id),
  -- The lanchero to be paid. Any contact may be named here — FR-46 is record-keeping, not the
  -- PRD-47 vetting boundary — though in practice this is usually the rol='lanchero' contact.
  lanchero_contacto_id  uuid not null references contactos (id),
  -- What the leg cost overall (fuel, tolls, whatever the coordinator was told). Optional: a
  -- cost may be recorded before it is fully known, with only the lanchero's fee set.
  costo_total_cop       bigint,
  -- What is owed to the lanchero specifically. This is the amount the pendiente/pagado status
  -- below tracks.
  monto_lanchero_cop    bigint not null,
  estado_pago           text not null default 'pendiente',
  pagado_por            uuid references usuarios (id),
  pagado_en             timestamptz,
  notas                 text,
  creado_por            uuid references usuarios (id),
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now(),

  -- Exactly one leg — same shape as adjuntos_dueno_check (0002).
  constraint pagos_lanchero_leg_check check (num_nonnulls(envio_id, traslado_persona_id) = 1),
  constraint pagos_lanchero_costo_check check (costo_total_cop is null or costo_total_cop >= 0),
  constraint pagos_lanchero_monto_check check (monto_lanchero_cop > 0),
  constraint pagos_lanchero_estado_check check (estado_pago in ('pendiente', 'pagado')),
  -- Same 2.1 shape as every despacho check in this codebase: a payment marked pagado carries a
  -- name and a timestamp, or it did not happen; pendiente carries neither yet.
  constraint pagos_lanchero_pago_check
    check ((estado_pago = 'pagado') = (pagado_por is not null and pagado_en is not null))
);

create index pagos_lanchero_organizacion_idx on pagos_lanchero (organizacion_id);
create index pagos_lanchero_envio_idx on pagos_lanchero (envio_id) where envio_id is not null;
create index pagos_lanchero_traslado_idx
  on pagos_lanchero (traslado_persona_id) where traslado_persona_id is not null;
create index pagos_lanchero_estado_idx on pagos_lanchero (estado_pago);

comment on table pagos_lanchero is
  'FR-46: cost + lanchero payment for one logistics leg (an envío or a traslado_persona). Record-keeping only — no disbursement, the same posture compras_locales (0049) uses for funding without moving money. estado_pago pendiente/pagado; moving to pagado requires a name and a timestamp.';

create or replace function auditar_pago_lanchero() returns trigger
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

comment on function auditar_pago_lanchero() is
  'A payment record is money leaving the record of who owes whom (FR-46) — every write is audited the same shape 0041/0048 use.';

create trigger pagos_lanchero_auditar
  after insert or update on pagos_lanchero
  for each row execute function auditar_pago_lanchero();

create trigger pagos_lanchero_tocar before update on pagos_lanchero
  for each row execute function tocar_actualizado_en();

-- ── RLS floor ─────────────────────────────────────────────────────────────────────────────────
-- Same tier as traslados_persona/capacidades: dispatch-desk operational data. Not PII, but it is
-- money, so lectura and verificador stay out — same as capacidades_lectura/despacha (0017).

alter table pagos_lanchero enable row level security;
revoke all on public.pagos_lanchero from anon, authenticated;
grant select, insert, update on public.pagos_lanchero to authenticated;

create policy pagos_lanchero_lectura on pagos_lanchero
  for select to authenticated
  using (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and (organizacion_id = convite_organizacion() or convite_es_plataforma())
  );

create policy pagos_lanchero_agrega on pagos_lanchero
  for insert to authenticated
  with check (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and organizacion_id = convite_organizacion()
    and creado_por = auth.uid()
  );

create policy pagos_lanchero_actualiza on pagos_lanchero
  for update to authenticated
  using (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and organizacion_id = convite_organizacion()
  )
  with check (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and organizacion_id = convite_organizacion()
  );

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  Part 2 — PRD-47: the vetted lanchero relay network
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- ── Part 2a — coverage: which communities a lanchero's route serves ────────────────────────────
-- The exact many-to-many shape puntos_conexion_comunidades (0040) already uses for "where can I
-- go" — no separate id, no timestamps, a composite key. This is the vetting boundary
-- registrar_reporte_relevo checks below: a lanchero relays only for a community on their own route.

create table lancheros_comunidades (
  lanchero_contacto_id uuid not null references contactos (id) on delete cascade,
  comunidad_id         uuid not null references comunidades (id) on delete cascade
);

create unique index lancheros_comunidades_key
  on lancheros_comunidades (lanchero_contacto_id, comunidad_id);
create index lancheros_comunidades_comunidad_idx
  on lancheros_comunidades (comunidad_id);

comment on table lancheros_comunidades is
  'PRD-47: which communities a registered lanchero (contactos.rol = ''lanchero'') routes through and may relay a report for — the vetting boundary registrar_reporte_relevo enforces. Same coverage-join shape as puntos_conexion_comunidades (0040).';

-- RLS: lancheros_comunidades carries no organizacion_id of its own — scoped through the linked
-- community's org, exactly the way puntos_conexion_comunidades is scoped through its point's org.

alter table lancheros_comunidades enable row level security;
revoke all on public.lancheros_comunidades from anon, authenticated;
grant select, insert, update, delete on public.lancheros_comunidades to authenticated;

create policy lancheros_comunidades_lectura on lancheros_comunidades
  for select to authenticated
  using (
    convite_es(array['verificador', 'despachador', 'coordinador', 'admin'])
    and exists (
      select 1 from comunidades c
       where c.id = lancheros_comunidades.comunidad_id
         and (c.organizacion_id = convite_organizacion() or convite_es_plataforma())
    )
  );

create policy lancheros_comunidades_coordina on lancheros_comunidades
  for all to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1 from comunidades c
       where c.id = lancheros_comunidades.comunidad_id
         and c.organizacion_id = convite_organizacion()
    )
  )
  with check (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1 from comunidades c
       where c.id = lancheros_comunidades.comunidad_id
         and c.organizacion_id = convite_organizacion()
    )
  );

-- ── Part 2b — the relay channel: widen CANALES, attribute the relay on `reportes` ──────────────
-- Same treatment 0052 Part 1 gave `manual`: every check constraint that reads the CANALES
-- vocabulary is re-made to include `relevo` (the TS mirror in db/schema/vocabulario.ts gains it
-- too, so `pnpm db:check` stays clean).

alter table reportes drop constraint reportes_canal_check;
alter table reportes add constraint reportes_canal_check
  check (canal in ('whatsapp', 'sms', 'ivr', 'radio', 'papel', 'web', 'manual', 'relevo'));

alter table mensajes drop constraint mensajes_canal_check;
alter table mensajes add constraint mensajes_canal_check
  check (canal in ('whatsapp', 'sms', 'ivr', 'radio', 'papel', 'web', 'manual', 'relevo'));

alter table entregas drop constraint entregas_canal_check;
alter table entregas add constraint entregas_canal_check
  check (confirmado_canal is null
    or confirmado_canal in ('whatsapp', 'sms', 'ivr', 'radio', 'papel', 'web', 'manual', 'relevo'));

alter table salidas_pendientes drop constraint salidas_canal_check;
alter table salidas_pendientes add constraint salidas_canal_check
  check (canal_sugerido is null
    or canal_sugerido in ('whatsapp', 'sms', 'ivr', 'radio', 'papel', 'web', 'manual', 'relevo'));

-- The relay chain (AC #3): who relayed it, alongside the existing comunidad_id, which carries the
-- origin community. NULL for every other channel.
alter table reportes add column relevo_lanchero_id uuid references contactos (id);

alter table reportes add constraint reportes_relevo_lanchero_check
  check ((canal = 'relevo') = (relevo_lanchero_id is not null));

-- Attribution to an origin community is the point of a relay (AC #2) — it cannot be left blank.
alter table reportes add constraint reportes_relevo_comunidad_check
  check (canal <> 'relevo' or comunidad_id is not null);

comment on column reportes.relevo_lanchero_id is
  'PRD-47: the registered lanchero who relayed this report, set only when canal = ''relevo''. comunidad_id carries the origin community they relayed it for — together a verifier sees the full chain.';

-- ── Part 2c — the gated insert: how a relayed report actually enters ───────────────────────────
-- `reportes` has no authenticated INSERT policy (0017); this is the same one-narrow-door pattern
-- as `registrar_reporte_manual` (0052) and the radio relay (0050), plus the vetting check that the
-- lanchero is actually registered — via lancheros_comunidades — for the origin community named.

create or replace function registrar_reporte_relevo(
  p_lanchero    uuid,
  p_comunidad   uuid,
  p_codigo_item text    default null,
  p_familias    integer default null,
  p_urgencia    integer default null,
  p_detalle     text    default null,
  p_descripcion text    default null
) returns table (reporte_id uuid, folio integer)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_org          uuid := convite_organizacion();
  v_uid          uuid := auth.uid();
  v_com_org      uuid;
  v_lanchero_rol text;
  v_item         text := nullif(btrim(p_codigo_item), '');
  v_tipo         text := 'sin_clasificar';
  v_reporte      uuid;
  v_folio        integer;
begin
  -- Same desk as manual entry (§29.3b): a reader, or a session with no staff row, cannot key in a
  -- relayed report either.
  if not convite_es(array['verificador', 'coordinador', 'admin']) then
    raise exception 'Solo verificador, coordinador o admin puede registrar un relevo.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_org is null then
    raise exception 'La sesión no pertenece a ninguna organización.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The origin community has to be the caller's own, exactly like a manual report.
  select organizacion_id into v_com_org from comunidades where id = p_comunidad;
  if v_com_org is null or v_com_org <> v_org then
    raise exception 'La comunidad no pertenece a su organización.'
      using errcode = 'insufficient_privilege';
  end if;

  select rol into v_lanchero_rol from contactos where id = p_lanchero;
  if v_lanchero_rol is null or v_lanchero_rol <> 'lanchero' then
    raise exception 'Ese contacto no está registrado como lanchero.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The vetting boundary PRD-47's stated assumption draws: a lanchero relays only for the
  -- communities registered on their own route.
  if not exists (
    select 1 from lancheros_comunidades lc
     where lc.lanchero_contacto_id = p_lanchero and lc.comunidad_id = p_comunidad
  ) then
    raise exception 'Ese lanchero no está registrado para relevar por esa comunidad.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Knowing the item is knowing the type (0021). Without one, born sin_clasificar (2.12).
  if v_item is not null then
    select tipo into v_tipo from catalogo_items where codigo = v_item and activo;
    if v_tipo is null then
      raise exception 'Ese código de catálogo no existe o está inactivo.'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into reportes
    (organizacion_id, tipo, canal, comunidad_id, relevo_lanchero_id, codigo_item, familias,
     urgencia, detalle_libre, descripcion, payload_crudo)
  values (
    v_org,
    v_tipo,
    'relevo',
    p_comunidad,
    p_lanchero,
    case when v_tipo = 'sin_clasificar' then null else v_item end,
    p_familias,
    p_urgencia,
    nullif(btrim(p_detalle), ''),
    nullif(btrim(p_descripcion), ''),
    jsonb_build_object('relevo', true, 'capturado_por', v_uid, 'lanchero_contacto_id', p_lanchero)
  )
  returning id, folio into v_reporte, v_folio;

  return query select v_reporte, v_folio;
end;
$$;

comment on function registrar_reporte_relevo(uuid, uuid, text, integer, integer, text, text) is
  'PRD-47: the one door a signed-in verificador/coordinador/admin uses to relay a report a registered lanchero carried out of a dark community. Checks role, organisation, that the lanchero is registered (rol=''lanchero'') and vetted for that origin community (lancheros_comunidades), then writes a canal=relevo report recording both the lanchero and the origin community. Promotion to a pedido still needs a named verifier.';

grant execute on function registrar_reporte_relevo(uuid, uuid, text, integer, integer, text, text)
  to authenticated;
