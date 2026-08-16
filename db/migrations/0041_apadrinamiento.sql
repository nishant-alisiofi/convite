-- PRD-12 — «Apadrina una partera»: earmarked sponsorship tied to one beneficiary end to end.
--
-- The funding side of the three-sided marketplace. A sponsor (`padrino`) commits funds to one
-- beneficiary — a partera, her community, or a shared pool — and the commitment is traceable
-- the whole way: the earmark on `apadrinamientos`, and every peso of it applied to a real
-- `pedido`/`entrega` on `apadrinamiento_asignaciones`. Committed minus applied is the balance a
-- funded local purchase (PRD-9) will draw on; this migration only records and traces it, no
-- payment rails (out of v1 scope).
--
-- Two rules the schema, not the UI, has to hold:
--
--   * Privacy (Ley 1581, mirroring the public-view discipline in 0027): a sponsor is only ever
--     shown a consented, aggregated `beneficiario_etiqueta` — never a real name, number, health
--     detail or coordinate. `apadrinamientos_consentida_check` refuses to let a sponsorship tied
--     to a *named* community go `activo` until that partera has consented, so «no profile
--     without consent» is an invariant rather than a screen's good intentions.
--
--   * Audit (2.1): every write to either table lands an immutable row in `auditoria` with the
--     actor, the action, the entity and the before/after — the same shape `auditar_configuracion`
--     uses, and for the same reason (a write from a script or psql is recorded like any other).

-- ── The earmark: sponsor ↔ beneficiary ↔ amount/purpose ─────────────────────────────────────

create table apadrinamientos (
  id                          uuid primary key default gen_random_uuid(),
  -- Org-scoped like every operational table (0017 / 0030). RLS binds reads and writes to it.
  organizacion_id             uuid not null references organizaciones (id),
  -- The beneficiary community when the earmark names one; NULL is a shared pool with no single
  -- partera behind it. A named community is the one that must carry consent (check below).
  comunidad_id                uuid references comunidades (id),
  -- The privacy-safe display name a sponsor sees — «Partera del Atrato medio», never a real
  -- name, number or coordinate (2.16). Required, so nothing forces a screen to fall back to raw
  -- community identity to have something to show.
  beneficiario_etiqueta       text not null,
  -- Lightweight sponsor identification (no login in v1, mirroring the donor model).
  padrino_nombre              text not null,
  padrino_contacto            text,
  padrino_tipo                text not null default 'individuo',
  -- What the money is earmarked for — «insumos de partería», «transporte», etc.
  proposito                   text not null,
  -- Committed amount in COP. Applications on `apadrinamiento_asignaciones` draw this down.
  monto_cop                   bigint not null,
  recurrencia                 text not null default 'unico',
  estado                      text not null default 'activo',
  -- Consent captured from the partera before any profile reaches a sponsor.
  consentimiento_beneficiario boolean not null default false,
  consentimiento_en           timestamptz,
  -- Who recorded it (2.1). Signed against auth.uid() by the insert policy.
  creado_por                  uuid references usuarios (id),
  notas                       text,
  creado_en                   timestamptz not null default now(),
  actualizado_en              timestamptz not null default now(),

  constraint apadrinamientos_monto_check check (monto_cop > 0),
  constraint apadrinamientos_tipo_check check (padrino_tipo in ('individuo', 'organizacion')),
  constraint apadrinamientos_recurrencia_check check (recurrencia in ('unico', 'mensual')),
  constraint apadrinamientos_estado_check
    check (estado in ('activo', 'pausado', 'completado', 'cancelado')),
  -- A consent flag without a timestamp is not a consent record (2.1 shape).
  constraint apadrinamientos_consentimiento_check
    check (consentimiento_beneficiario = false or consentimiento_en is not null),
  -- AC #2: an earmark tied to a named community cannot be shown to a sponsor (be `activo`)
  -- until that partera has consented. A pool has no partera, so it is unaffected.
  constraint apadrinamientos_consentida_check
    check (comunidad_id is null or estado <> 'activo' or consentimiento_beneficiario)
);

create index apadrinamientos_organizacion_idx on apadrinamientos (organizacion_id);
create index apadrinamientos_comunidad_idx on apadrinamientos (comunidad_id);
create index apadrinamientos_estado_idx on apadrinamientos (estado);

comment on table apadrinamientos is
  'PRD-12 sponsorship: a padrino earmarks funds to one beneficiary (a partera/community or a pool). Privacy-safe by construction — sponsors see beneficiario_etiqueta, never PII; a named community cannot go activo without consent (apadrinamientos_consentida_check).';
comment on column apadrinamientos.beneficiario_etiqueta is
  'Aggregated, consented label shown to a sponsor. Never a real name, phone, health detail or coordinate (Ley 1581 / 2.16).';
comment on column apadrinamientos.monto_cop is
  'Committed COP. The sum of apadrinamiento_asignaciones.monto_aplicado_cop for this row is what has been drawn; the difference is the balance PRD-9 (funded local purchase) can spend.';

-- ── The trace: which real demand each peso funded ───────────────────────────────────────────
--
-- Append-only and immutable, exactly like `decisiones_asignacion` and `entregas`: a funding
-- decision, once recorded, is not edited or deleted (no UPDATE/DELETE grant or policy below).
-- `pedido_id` is the demand it paid for; `entrega_id` carries the trace all the way to a
-- confirmed delivery.

create table apadrinamiento_asignaciones (
  id                  uuid primary key default gen_random_uuid(),
  apadrinamiento_id   uuid not null references apadrinamientos (id) on delete cascade,
  pedido_id           uuid references pedidos (id),
  entrega_id          uuid references entregas (id),
  -- Amount of the earmark applied here, in COP. Summed over a sponsorship it is ≤ its monto_cop.
  monto_aplicado_cop  bigint not null,
  concepto            text,
  -- Who applied it (2.1). Signed against auth.uid() by the insert policy.
  aplicado_por        uuid references usuarios (id),
  creado_en           timestamptz not null default now(),

  constraint apadrinamiento_asignaciones_monto_check check (monto_aplicado_cop > 0),
  -- A funding application has to point at something it funded.
  constraint apadrinamiento_asignaciones_destino_check
    check (pedido_id is not null or entrega_id is not null)
);

create index apadrinamiento_asignaciones_apadrinamiento_idx
  on apadrinamiento_asignaciones (apadrinamiento_id);
create index apadrinamiento_asignaciones_pedido_idx on apadrinamiento_asignaciones (pedido_id);
create index apadrinamiento_asignaciones_entrega_idx on apadrinamiento_asignaciones (entrega_id);

comment on table apadrinamiento_asignaciones is
  'PRD-12 traceability: how much of a sponsorship funded which pedido/entrega. Append-only and immutable, mirroring decisiones_asignacion — the trace has to survive.';

-- ── The audit row ───────────────────────────────────────────────────────────────────────────
--
-- A trigger rather than an application write, so a change from a script, a psql session or a
-- future screen is recorded the same way. `auditoria` has no UPDATE or DELETE policy (0017), so
-- what lands here cannot be edited afterwards. SECURITY DEFINER so it can write `auditoria`
-- regardless of the caller's grants — the same as `auditar_configuracion` (0020).

create or replace function auditar_apadrinamiento() returns trigger
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

comment on function auditar_apadrinamiento() is
  'Non-negotiable 2.1 for sponsorships: who created/changed an earmark or applied its funds, from what to what, and when. Writes an immutable auditoria row on every insert/update.';

create trigger apadrinamientos_auditar
  after insert or update on apadrinamientos
  for each row execute function auditar_apadrinamiento();

create trigger apadrinamientos_tocar before update on apadrinamientos
  for each row execute function tocar_actualizado_en();

create trigger apadrinamiento_asignaciones_auditar
  after insert on apadrinamiento_asignaciones
  for each row execute function auditar_apadrinamiento();

-- ── RLS floor ─────────────────────────────────────────────────────────────────────────────
--
-- Same order as 0007/0012/0020: enable, revoke everything, then grant back exactly what the
-- policies allow, so a half-finished policy set fails towards «staff cannot read» rather than
-- «anon can». Sponsorship is funding/coordination work, so it is coordinador + admin; a
-- platform admin reaches across organisations for reads only (0034), never for writes.

alter table apadrinamientos enable row level security;
revoke all on public.apadrinamientos from anon, authenticated;
grant select, insert, update on public.apadrinamientos to authenticated;

create policy apadrinamientos_lectura on apadrinamientos
  for select to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and (organizacion_id = convite_organizacion() or convite_es_plataforma())
  );

-- Admin/coordinator only, within their own organisation, and signed: you may record your own
-- decision and nobody else's (the same guard `configuracion_admin_agrega` uses).
create policy apadrinamientos_agrega on apadrinamientos
  for insert to authenticated
  with check (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
    and creado_por = auth.uid()
  );

create policy apadrinamientos_actualiza on apadrinamientos
  for update to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
  )
  with check (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
  );

alter table apadrinamiento_asignaciones enable row level security;
revoke all on public.apadrinamiento_asignaciones from anon, authenticated;
-- No UPDATE or DELETE: an application is immutable once recorded.
grant select, insert on public.apadrinamiento_asignaciones to authenticated;

create policy apadrinamiento_asignaciones_lectura on apadrinamiento_asignaciones
  for select to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1
        from apadrinamientos a
       where a.id = apadrinamiento_id
         and (a.organizacion_id = convite_organizacion() or convite_es_plataforma())
    )
  );

create policy apadrinamiento_asignaciones_agrega on apadrinamiento_asignaciones
  for insert to authenticated
  with check (
    convite_es(array['coordinador', 'admin'])
    and aplicado_por = auth.uid()
    and exists (
      select 1
        from apadrinamientos a
       where a.id = apadrinamiento_id
         and a.organizacion_id = convite_organizacion()
    )
  );
