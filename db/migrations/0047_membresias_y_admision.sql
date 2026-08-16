-- PRD-16 (§29.4–29.7) + PRD-35 (§29.3b) — the per-user permission engine and organisation
-- admission tiers, built ADDITIVELY on top of the RBAC hierarchy from 0034.
--
-- What this migration makes real:
--
--   * A membership join table (`membresias`) — a person belongs to more than one organisation,
--     with a different role and community scope in each (§29.5). Each existing single-org staff
--     row is backfilled to exactly one membership, so nothing that works today changes.
--   * The capability ceiling is ENFORCED (§29.4). Delegation cannot escalate: a grant may only
--     stay within the organisation's `techo_permisos`, may not cross organisations, and may not
--     mint an org admin unless `puede_delegar` is set. Enforced in row-level security through
--     restrictive policies + SECURITY DEFINER helpers, exactly the shape 0034 used for the
--     escalation guard — the database refuses, not the UI, and every grant is logged.
--   * Separation of duties (§29.7): the same person cannot hold both `verificador` and
--     `despachador` in one organisation. Whoever confirms a need is real must not also dispatch.
--   * Offboarding is first-class (§29.6): suspension/termination revoke on the next request,
--     termination cancels the person's active runs (never leave a shipment holding a dead
--     reference), and any address-level membership idle for 45 days auto-suspends. Every state
--     change is audited.
--   * Organisation admission tiers + vouching (§29.3b): a tier is recorded per organisation, an
--     anchor vouches an `avalada` org in one call with a ceiling never above its own, and
--     revoking the vouch suspends the vouched organisation.
--
-- What this migration deliberately does NOT do — because it would have to weaken existing RLS or
-- touch lib/sesion.ts / lib/auth.ts / migration 0017, all out of this WI's safe additive scope:
--
--   * It does NOT drop `usuarios.organizacion_id`. §29.5 wants it gone eventually, but ~30
--     policies in 0017/0030 and `convite_organizacion()` derive from it, and the open sign-in
--     path (0035) writes it. It stays as the person's HOME organisation; the membership layer is
--     added alongside it. The full cutover of session context to a pure union-of-memberships is
--     a follow-up that must rewrite 0017 and the session layer together.
--   * It does NOT re-gate sign-in. `vincular_usuario_staff()` (0035) is untouched; open sign-in
--     still works. A newly linked staff row gets its mirror membership from a trigger, so the
--     open-sign-in default admin also lands in `membresias` with no change to who gets a row.
--   * Not one existing policy is weakened. Everything here is new tables, new helpers, additive
--     permissive policies and restrictive (forbid-only) policies on the new table.

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  Part 1 — organisation admission tier (§29.3b)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- `nivel_admision` records HOW an organisation got in, orthogonal to `tipo` (what kind of org it
-- is, 0042) and `estado_aprobacion` (the approval lifecycle, 0034). Nullable, because every
-- organisation that existed before this column was admitted before tiers existed; the seed org is
-- an anchor by history, and PRD-38's territory seed may set it. `avalado_por` records which
-- anchor vouched an `avalada` org, so a revoked vouch is traceable and its ceiling verifiable
-- against the voucher. The FK is declared here in SQL rather than in the Drizzle mirror, the same
-- way comunidades.region_id is (0042), to keep organizaciones self-contained in core.ts.

alter table organizaciones add column nivel_admision text;
alter table organizaciones add constraint organizaciones_nivel_admision_check
  check (nivel_admision is null
    or nivel_admision in ('ancla', 'avalada', 'aportante', 'observadora'));

comment on column organizaciones.nivel_admision is
  'PRD-35 (§29.3b): how the organisation was admitted — ancla (contract), avalada (vouched), aportante (supply only), observadora (aggregate read). Nullable for organisations admitted before tiers existed.';

alter table organizaciones add column avalado_por uuid references organizaciones (id);

comment on column organizaciones.avalado_por is
  'PRD-35 (§29.3b): the anchor that vouched this avalada organisation in. Set by convite_avalar_organizacion; revoking the vouch (convite_revocar_aval) suspends this org. NULL for anchors and pre-tier organisations.';

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  Part 2 — the membership join table (§29.5)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- One row per (person, organisation, role). `comunidades_alcance` is the membership's own
-- territory scope, always clipped to the organisation's ceiling by the restrictive policy below.
-- `estado` drives offboarding: only `activa` memberships count towards effective permissions, so
-- suspension and termination take effect on the caller's very next request with nothing cached.
-- `ultima_actividad_en` is the dormancy clock — an address-level membership idle past 45 days is
-- auto-suspended (§29.6). Roles are the same controlled set as usuarios.rol_staff.

create table membresias (
  id                  uuid primary key default gen_random_uuid(),
  usuario_id          uuid not null references usuarios (id) on delete cascade,
  organizacion_id     uuid not null references organizaciones (id),
  rol                 text not null,
  -- Communities this membership may act on. Empty = not scoped by community (e.g. an admin whose
  -- reach is the whole org, subject to the org ceiling). Always a subset of the org ceiling.
  comunidades_alcance uuid[] not null default '{}',
  otorgado_por        uuid references usuarios (id),
  otorgado_en         timestamptz not null default now(),
  vence_en            timestamptz,
  estado              text not null default 'activa',
  motivo_baja         text,
  -- The dormancy clock (§29.6). Defaults to now() so a fresh grant is not instantly dormant; the
  -- backfill sets it to now() for every migrated staff row.
  ultima_actividad_en timestamptz not null default now(),
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),

  constraint membresias_rol_check
    check (rol in ('coordinador', 'verificador', 'despachador', 'admin', 'lectura')),
  constraint membresias_estado_check
    check (estado in ('activa', 'suspendida', 'terminada'))
);

comment on table membresias is
  'PRD-16 (§29.5): a person''s membership of an organisation, with a role and a community scope. A person may hold several, in different organisations. Effective permissions are the union of active memberships, each clipped to its org ceiling, computed per request and never cached. Enforcement of the ceiling, no-escalation and separation-of-duties is the restrictive policies below.';

-- One role per person per org: you are their coordinador once, not twice (§29.5).
create unique index membresias_usuario_org_rol_key
  on membresias (usuario_id, organizacion_id, rol);
create index membresias_organizacion_idx on membresias (organizacion_id);
create index membresias_usuario_idx on membresias (usuario_id);
-- The dormancy sweep scans active memberships by their activity clock.
create index membresias_dormancia_idx
  on membresias (ultima_actividad_en) where estado = 'activa';

create trigger membresias_tocar before update on membresias
  for each row execute function tocar_actualizado_en();

-- ── Backfill: every existing staff row becomes exactly one membership ─────────────────────────
--
-- Runs as the migration owner, so RLS (below) does not apply — pre-existing rows are grandfathered
-- in even if their org ceiling is still empty. AC (PRD-16 #4): a single-org user becomes exactly
-- one membership row with no access change. A verificador's community scope is carried across from
-- usuarios_comunidades so the migrated membership means exactly what the staff row meant.

insert into membresias (usuario_id, organizacion_id, rol, comunidades_alcance, otorgado_en, ultima_actividad_en, estado)
select u.id,
       u.organizacion_id,
       u.rol_staff,
       coalesce(
         (select array_agg(uc.comunidad_id) from usuarios_comunidades uc where uc.usuario_id = u.id),
         '{}'::uuid[]
       ),
       u.creado_en,
       now(),
       case when u.activo then 'activa' else 'suspendida' end
  from usuarios u
on conflict (usuario_id, organizacion_id, rol) do nothing;

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  Part 3 — the enforcement helpers (§29.4, §29.7)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- All SECURITY DEFINER + STABLE, exactly like convite_rol()/convite_es_plataforma(): a policy on
-- membresias that queried membresias would recurse, and the ceiling lives on organizaciones which
-- authenticated cannot freely read. Reading through these helpers keeps the answer authoritative
-- and identical between the policies and the application.

-- Which capability a role actually EXERCISES. The role side of the effective permission; the org
-- ceiling is the clip applied on top of it. Derived from the "Sees" column of §29.3 mapped onto
-- the §29.4 ceiling fields.
create or replace function convite_rol_ejerce(p_rol text, p_cap text) returns boolean
language sql immutable as $ejerce$
  select case p_cap
    when 'despacho'          then p_rol in ('coordinador', 'admin', 'despachador')
    when 'inventario_nodo'   then p_rol in ('coordinador', 'admin', 'despachador')
    when 'agendamiento'      then p_rol in ('coordinador', 'admin')
    when 'evaluacion'        then p_rol in ('coordinador', 'admin', 'verificador')
    when 'direcciones_hogar' then p_rol in ('coordinador', 'admin', 'despachador', 'verificador')
    when 'puede_delegar'     then p_rol = 'admin'
    else false
  end
$ejerce$;

comment on function convite_rol_ejerce(text, text) is
  'PRD-16 (§29.3/§29.4): whether a role exercises a capability. The role side of an effective permission; convite_membresia_capacidad clips it by the org ceiling.';

-- Does a proposed membership FIT the organisation''s ceiling (§29.4)? Two things:
--   * the role''s capability requirements are within the ceiling (a despachador needs despacho, a
--     verificador needs evaluacion, an org admin needs puede_delegar — this is «may not grant
--     org_admin unless puede_delegar» and «may grant only within the ceiling»)
--   * the requested community scope is a subset of the ceiling''s comunidades_alcance ('todas'
--     means unlimited)
-- Fails closed: an org with no ceiling row, or a '{}' ceiling, grants nothing.
create or replace function convite_membresia_cabe_en_techo(
  p_org uuid, p_rol text, p_comunidades uuid[]
) returns boolean
language plpgsql stable security definer set search_path = public as $cabe$
declare
  techo jsonb;
  alcance jsonb;
begin
  select o.techo_permisos into techo from organizaciones o where o.id = p_org;
  if techo is null then
    return false;
  end if;

  -- The role's PRIMARY capability must be within the ceiling — the one without which the role is
  -- meaningless (a despachador that cannot dispatch, an org admin that cannot delegate, a
  -- verificador in an org not cleared to assess). Secondary capabilities a role merely MAY exercise
  -- (e.g. a verificador seeing household addresses) are NOT a grant gate; they are clipped at
  -- permission-evaluation time by convite_membresia_capacidad, so a verificador in an org that does
  -- not hold addresses is still a valid verificador, just without address access. This keeps «may
  -- grant only capabilities within the ceiling» (§29.4) enforced at the DB without forbidding a
  -- role whose ceiling is simply narrower than everything it could theoretically touch.
  if p_rol = 'despachador' and not coalesce((techo ->> 'despacho')::boolean, false) then
    return false;
  end if;
  if p_rol = 'verificador' and not coalesce((techo ->> 'evaluacion')::boolean, false) then
    return false;
  end if;
  if p_rol = 'admin' and not coalesce((techo ->> 'puede_delegar')::boolean, false) then
    return false;
  end if;

  -- Community scope must be within the ceiling.
  alcance := techo -> 'comunidades_alcance';
  if jsonb_typeof(alcance) = 'string' and (alcance #>> '{}') = 'todas' then
    return true;                                   -- unlimited reach
  end if;
  if coalesce(array_length(p_comunidades, 1), 0) = 0 then
    return true;                                   -- no reach requested is always within any ceiling
  end if;
  if jsonb_typeof(alcance) <> 'array' then
    return false;                                  -- reach requested, none allowed
  end if;
  -- Every requested community must appear in the ceiling''s array.
  return not exists (
    select 1 from unnest(p_comunidades) c
     where not (alcance ? c::text)
  );
end
$cabe$;

comment on function convite_membresia_cabe_en_techo(uuid, text, uuid[]) is
  'PRD-16 (§29.4): whether a membership grant fits the org ceiling — role capabilities within techo_permisos, community scope a subset of comunidades_alcance. Fails closed. The restrictive policy membresias_dentro_del_techo is built on it.';

-- Separation of duties (§29.7): the same person cannot hold both verificador and despachador in
-- one organisation. Reads membresias with DEFINER rights so the policy that calls it does not
-- recurse. Only active siblings count.
create or replace function convite_membresia_viola_separacion(
  p_usuario uuid, p_org uuid, p_rol text
) returns boolean
language sql stable security definer set search_path = public as $sod$
  select case
    when p_rol = 'verificador' then exists (
      select 1 from membresias m
       where m.usuario_id = p_usuario and m.organizacion_id = p_org
         and m.rol = 'despachador' and m.estado = 'activa')
    when p_rol = 'despachador' then exists (
      select 1 from membresias m
       where m.usuario_id = p_usuario and m.organizacion_id = p_org
         and m.rol = 'verificador' and m.estado = 'activa')
    else false
  end
$sod$;

comment on function convite_membresia_viola_separacion(uuid, uuid, text) is
  'PRD-16 (§29.7): true when adding this role would let one person both verify and dispatch in the same org. Deliberate and must survive convenience arguments.';

-- Who may administer memberships in an organisation: a platform admin (any org), a home-org
-- admin, or someone holding an active admin membership in that org. Multi-org correct without
-- touching session context — a person who is admin of org B by membership can delegate there
-- even though their home org is A.
create or replace function convite_administra_org(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $adm$
  select convite_es_plataforma()
      or (p_org = convite_organizacion() and convite_es(array['admin']))
      or exists (
        select 1 from membresias m
         where m.usuario_id = auth.uid() and m.organizacion_id = p_org
           and m.rol = 'admin' and m.estado = 'activa'
           and (m.vence_en is null or m.vence_en > now()))
$adm$;

comment on function convite_administra_org(uuid) is
  'PRD-16 (§29.4): whether the caller may administer memberships in an org — platform admin, home-org admin, or admin-by-membership. The cross-org gate for grants: an org admin can only write memberships in orgs they administer.';

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  Part 4 — effective permissions (§29.5): union of active memberships, clipped, never cached
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- STABLE functions that read the live tables every call. There is no cache; a suspension is
-- visible on the next request because these re-read `estado` each time. Additive: no existing
-- policy is rewired to use them — they are the substrate for the membership layer, the tests, and
-- the eventual session-context cutover.

-- The caller''s active, non-expired memberships in active organisations. Revoking a vouch
-- (organizaciones.activo = false) drops the whole org''s memberships here at once.
create or replace function convite_membresias_activas()
returns table (organizacion_id uuid, rol text, comunidades_alcance uuid[])
language sql stable security definer set search_path = public as $activas$
  select m.organizacion_id, m.rol, m.comunidades_alcance
    from membresias m
    join organizaciones o on o.id = m.organizacion_id
   where m.usuario_id = auth.uid()
     and m.estado = 'activa'
     and (m.vence_en is null or m.vence_en > now())
     and o.activo
$activas$;

comment on function convite_membresias_activas() is
  'PRD-16 (§29.5): the caller''s active, non-expired memberships in active organisations. Read live every call — never cached — so offboarding takes effect on the next request.';

-- Whether the caller effectively holds a capability IN A GIVEN ORG: they hold an active
-- membership there whose role exercises the capability AND whose org ceiling grants it. This is
-- what makes «different permissions per org» concrete — the same person can have despacho in one
-- org and not another.
create or replace function convite_membresia_capacidad(p_org uuid, p_cap text) returns boolean
language sql stable security definer set search_path = public as $cap$
  select exists (
    select 1
      from convite_membresias_activas() m
      join organizaciones o on o.id = m.organizacion_id
     where m.organizacion_id = p_org
       and convite_rol_ejerce(m.rol, p_cap)
       and coalesce((o.techo_permisos ->> p_cap)::boolean, false)
  )
$cap$;

comment on function convite_membresia_capacidad(uuid, text) is
  'PRD-16 (§29.5): whether the caller effectively holds a capability in a specific org (role exercises it AND org ceiling grants it). The per-org effective permission.';

-- The union across all the caller''s active memberships: do they hold the capability ANYWHERE.
create or replace function convite_puede(p_cap text) returns boolean
language sql stable security definer set search_path = public as $puede$
  select exists (
    select 1
      from convite_membresias_activas() m
      join organizaciones o on o.id = m.organizacion_id
     where convite_rol_ejerce(m.rol, p_cap)
       and coalesce((o.techo_permisos ->> p_cap)::boolean, false)
  )
$puede$;

comment on function convite_puede(text) is
  'PRD-16 (§29.5): the union of the caller''s effective capabilities across every active membership, each clipped to its org ceiling. Computed per request, never cached.';

grant execute on function convite_rol_ejerce(text, text) to authenticated;
grant execute on function convite_membresia_cabe_en_techo(uuid, text, uuid[]) to authenticated;
grant execute on function convite_membresia_viola_separacion(uuid, uuid, text) to authenticated;
grant execute on function convite_administra_org(uuid) to authenticated;
grant execute on function convite_membresias_activas() to authenticated;
grant execute on function convite_membresia_capacidad(uuid, text) to authenticated;
grant execute on function convite_puede(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  Part 5 — RLS on membresias: read for the right people, writes bounded by the ceiling
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Same order as every table in 0007/0017/0042: enable, revoke everything, grant back exactly what
-- the policies need, so a half-finished policy set fails towards «staff cannot read» rather than
-- «anon can». anon gets nothing — the esquema test asserts anon reaches only mapa_publico.

alter table membresias enable row level security;
revoke all on public.membresias from anon, authenticated;
grant select, insert, update, delete on public.membresias to authenticated;

-- ── Permissive: who can SEE and WRITE memberships ────────────────────────────────────────────
--
-- An admin (platform, home-org, or admin-by-membership) manages memberships in the orgs they
-- administer. This is also the cross-org gate: convite_administra_org is false for an org you do
-- not administer, so the WITH CHECK forbids granting into another organisation (§29.4 «may not
-- grant across organisations»).
create policy membresias_admin on membresias
  for all to authenticated
  using (convite_administra_org(organizacion_id))
  with check (convite_administra_org(organizacion_id));

-- Everyone sees their own memberships (the org switcher and effective-permission UI need this).
create policy membresias_propias on membresias
  for select to authenticated
  using (usuario_id = auth.uid());

-- A coordinador sees their home-org team, read only (they run the day to day, they do not grant).
create policy membresias_equipo_lectura on membresias
  for select to authenticated
  using (convite_es(array['coordinador']) and organizacion_id = convite_organizacion());

-- ── Restrictive: the DB refuses an escalating or duty-conflicting grant ───────────────────────
--
-- Restrictive policies AND with the permissive ones, so they can only FORBID, never grant. `using
-- (true)` leaves reads and row-visibility exactly as the permissive policies set them; the whole
-- effect is in WITH CHECK, on INSERT and UPDATE. Both guards only bite an ACTIVE row: suspending
-- or terminating a grandfathered, out-of-ceiling membership must always be possible (offboarding
-- must never be blocked by the ceiling), so a non-active target skips the checks.

-- «Delegation cannot escalate»: a granted (active) membership must fit the org ceiling — role
-- capabilities within techo_permisos, community scope a subset, org admin only if puede_delegar.
create policy membresias_dentro_del_techo on membresias
  as restrictive
  for all to authenticated
  using (true)
  with check (
    estado <> 'activa'
    or convite_membresia_cabe_en_techo(organizacion_id, rol, comunidades_alcance)
  );

comment on policy membresias_dentro_del_techo on membresias is
  'PRD-16 (§29.4): delegation cannot escalate. An active membership must fit the org ceiling; any attempt beyond it fails at the database. Offboarding (estado <> activa) is exempt so a grandfathered row can always be closed.';

-- Separation of duties (§29.7): no one holds verificador and despachador in the same org.
create policy membresias_separacion_de_deberes on membresias
  as restrictive
  for all to authenticated
  using (true)
  with check (
    estado <> 'activa'
    or not convite_membresia_viola_separacion(usuario_id, organizacion_id, rol)
  );

comment on policy membresias_separacion_de_deberes on membresias is
  'PRD-16 (§29.7): verificador cannot dispatch, despachador cannot verify — the same person may not hold both roles in one organisation.';

-- ── Audit: every grant, suspension and termination is logged (§29.6) ─────────────────────────
--
-- A trigger, so the audit row is written no matter which path changed the state (a direct
-- authenticated INSERT, or a SECURITY DEFINER offboarding function). SECURITY DEFINER so it can
-- write auditoria regardless of RLS; actor is auth.uid(), which is NULL for the migration backfill
-- (skipped on INSERT) and for a system dormancy sweep (logged, actor NULL = system).
create or replace function convite_auditar_membresia() returns trigger
language plpgsql security definer set search_path = public as $aud$
begin
  if tg_op = 'INSERT' then
    -- Skip the migration backfill (owner context, no session): those are grandfathered, not grants.
    if auth.uid() is null then
      return new;
    end if;
    insert into auditoria (actor_id, accion, entidad, entidad_id, despues)
      values (auth.uid(), 'membresia.otorgada', 'membresias', new.id,
              jsonb_build_object(
                'usuario_id', new.usuario_id,
                'organizacion_id', new.organizacion_id,
                'rol', new.rol,
                'comunidades_alcance', to_jsonb(new.comunidades_alcance),
                'estado', new.estado));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.estado is distinct from old.estado then
      insert into auditoria (actor_id, accion, entidad, entidad_id, antes, despues)
        values (auth.uid(), 'membresia.' || new.estado, 'membresias', new.id,
                jsonb_build_object('estado', old.estado, 'motivo_baja', old.motivo_baja),
                jsonb_build_object('estado', new.estado, 'motivo_baja', new.motivo_baja));
    end if;
    return new;
  end if;
  return new;
end
$aud$;

create trigger membresias_auditar after insert or update on membresias
  for each row execute function convite_auditar_membresia();

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  Part 6 — offboarding (§29.6)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- SECURITY DEFINER, matching convite_decidir_centro: the state change, the side effects and the
-- audit are one atomic thing and the permission is checked in one legible place. Suspension and
-- termination both flip `estado`, which the effective-permission helpers re-read every request, so
-- access is revoked on the caller''s very next request with nothing cached. Termination also
-- cancels the person''s active runs — a departed employee must never keep a live shipment holding
-- household addresses.

create or replace function convite_suspender_membresia(p_membresia uuid, p_motivo text) returns text
language plpgsql security definer set search_path = public as $susp$
declare
  m membresias%rowtype;
begin
  if auth.uid() is null then return 'sin_sesion'; end if;
  select * into m from membresias mm where mm.id = p_membresia;
  if not found then return 'no_existe'; end if;
  if not convite_administra_org(m.organizacion_id) then return 'sin_permiso'; end if;
  if m.estado = 'terminada' then return 'ya_terminada'; end if;

  update membresias set estado = 'suspendida', motivo_baja = p_motivo, actualizado_en = now()
   where id = p_membresia;                                        -- trigger writes the audit row
  return 'suspendida';
end
$susp$;

comment on function convite_suspender_membresia(uuid, text) is
  'PRD-16 (§29.6): suspend a membership. Reversible; revokes on the next request (the effective-permission helpers only count active memberships). Audited by the membresias trigger.';

create or replace function convite_reactivar_membresia(p_membresia uuid) returns text
language plpgsql security definer set search_path = public as $react$
declare
  m membresias%rowtype;
begin
  if auth.uid() is null then return 'sin_sesion'; end if;
  select * into m from membresias mm where mm.id = p_membresia;
  if not found then return 'no_existe'; end if;
  if not convite_administra_org(m.organizacion_id) then return 'sin_permiso'; end if;
  if m.estado = 'terminada' then return 'ya_terminada'; end if;
  -- Reinstating must still fit the ceiling: the default drifts closed, reopening is deliberate.
  if not convite_membresia_cabe_en_techo(m.organizacion_id, m.rol, m.comunidades_alcance) then
    return 'excede_techo';
  end if;
  if convite_membresia_viola_separacion(m.usuario_id, m.organizacion_id, m.rol) then
    return 'viola_separacion';
  end if;

  update membresias set estado = 'activa', motivo_baja = null,
         ultima_actividad_en = now(), actualizado_en = now()
   where id = p_membresia;
  return 'activa';
end
$react$;

comment on function convite_reactivar_membresia(uuid) is
  'PRD-16 (§29.6): one-click reinstate of a suspended membership. Re-checks ceiling and separation of duties — reopening is deliberate. Cannot revive a terminated membership.';

create or replace function convite_terminar_membresia(p_membresia uuid, p_motivo text) returns text
language plpgsql security definer set search_path = public as $term$
declare
  m membresias%rowtype;
  c_id uuid;
  cancelados jsonb;
begin
  if auth.uid() is null then return 'sin_sesion'; end if;
  select * into m from membresias mm where mm.id = p_membresia;
  if not found then return 'no_existe'; end if;
  if not convite_administra_org(m.organizacion_id) then return 'sin_permiso'; end if;

  update membresias set estado = 'terminada', motivo_baja = p_motivo, actualizado_en = now()
   where id = p_membresia;                                        -- trigger writes the audit row

  -- Termination cancels the person''s active runs: never leave a shipment holding a dead
  -- reference (§29.6, couples to PRD-13 offline bundles). A staff member drives as their linked
  -- contacto; find live runs by that contacto and cancel them.
  select u.contacto_id into c_id from usuarios u where u.id = m.usuario_id;
  if c_id is not null then
    with canceladas as (
      update envios
         set estado = 'CANCELADO',
             notas = trim(both ' |' from coalesce(notas, '') || ' | baja de membresía: ' || p_motivo),
             actualizado_en = now()
       where responsable_id = c_id
         and estado in ('PLANEADO', 'DESPACHADO', 'EN_RUTA')
      returning id
    )
    select coalesce(jsonb_agg(id), '[]'::jsonb) into cancelados from canceladas;

    if cancelados <> '[]'::jsonb then
      insert into auditoria (actor_id, accion, entidad, entidad_id, despues)
        values (auth.uid(), 'envios.cancelados_por_baja', 'membresias', p_membresia,
                jsonb_build_object('envios', cancelados, 'motivo', p_motivo));
    end if;
  end if;

  -- Calendar feed URLs are revoked with the membership (§29.6 / §28.1). The .ics feed is PRD-34
  -- and has no table yet; when it lands, revoke it here. Recorded so the coupling is not lost.
  return 'terminada';
end
$term$;

comment on function convite_terminar_membresia(uuid, text) is
  'PRD-16 (§29.6): terminate a membership. Revokes on the next request and cancels the person''s active runs so no shipment holds a dead reference. Audited (the state change by the trigger, the run cancellations explicitly). Calendar-feed revocation couples to PRD-34.';

-- Dormancy auto-suspend (§29.6): any address-level membership idle 45 days suspends automatically
-- — the default drifts closed. Address-level = the role sees household addresses AND the org
-- ceiling actually grants direcciones_hogar. Run by the scheduled worker (no session) or a
-- platform admin; returns how many it closed. -1 = caller not allowed.
create or replace function convite_suspender_membresias_inactivas() returns int
language plpgsql security definer set search_path = public as $dorm$
declare
  n int;
begin
  if auth.uid() is not null and not convite_es_plataforma() then
    return -1;
  end if;

  with caducas as (
    update membresias m
       set estado = 'suspendida',
           motivo_baja = 'Inactividad de 45 días (suspensión automática, §29.6)',
           actualizado_en = now()
      from organizaciones o
     where o.id = m.organizacion_id
       and m.estado = 'activa'
       and coalesce((o.techo_permisos ->> 'direcciones_hogar')::boolean, false)
       and convite_rol_ejerce(m.rol, 'direcciones_hogar')
       and coalesce(m.ultima_actividad_en, m.otorgado_en) < now() - interval '45 days'
    returning m.id
  )
  select count(*) into n from caducas;                            -- trigger audits each suspension
  return n;
end
$dorm$;

comment on function convite_suspender_membresias_inactivas() is
  'PRD-16 (§29.6): auto-suspend address-level memberships idle for 45 days — the default drifts closed. Run by the worker (no session) or a platform admin. Each suspension is audited by the membresias trigger.';

-- Record activity so the dormancy clock is honest. The application should call this on a
-- request that used address-level access; wiring it into lib/sesion.ts is a follow-up (that file
-- is out of this WI''s scope). Bumps the caller''s active memberships in the org.
create or replace function convite_tocar_actividad_membresia(p_org uuid) returns void
language sql security definer set search_path = public as $toca$
  update membresias
     set ultima_actividad_en = now()
   where usuario_id = auth.uid() and organizacion_id = p_org and estado = 'activa'
$toca$;

comment on function convite_tocar_actividad_membresia(uuid) is
  'PRD-16 (§29.6): bump the dormancy clock for the caller''s active memberships in an org. Application hook for «no activity for 45 days»; lib/sesion.ts wiring is a follow-up.';

grant execute on function convite_suspender_membresia(uuid, text) to authenticated;
grant execute on function convite_reactivar_membresia(uuid) to authenticated;
grant execute on function convite_terminar_membresia(uuid, text) to authenticated;
grant execute on function convite_suspender_membresias_inactivas() to authenticated;
grant execute on function convite_tocar_actividad_membresia(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  Part 7 — organisation admission and vouching (§29.3b)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- SECURITY DEFINER, because setting an org''s tier and ceiling writes organizaciones, which
-- authenticated cannot update (0017 grants it SELECT only). The vouch is the fast path: an anchor
-- admits an avalada org in one call, with a ceiling never above its own.

-- Whether ceiling `hijo` is contained by ceiling `padre` (every capability ≤, community scope a
-- subset). The cap that keeps a vouched org from ever holding more than its voucher.
create or replace function convite_techo_contenido(hijo jsonb, padre jsonb) returns boolean
language plpgsql immutable as $cont$
declare
  cap text;
  h_alc jsonb;
  p_alc jsonb;
begin
  foreach cap in array array['direcciones_hogar', 'inventario_nodo', 'despacho', 'agendamiento',
                             'evaluacion', 'puede_delegar'] loop
    if coalesce((hijo ->> cap)::boolean, false)
       and not coalesce((padre ->> cap)::boolean, false) then
      return false;
    end if;
  end loop;

  h_alc := hijo -> 'comunidades_alcance';
  p_alc := padre -> 'comunidades_alcance';
  if jsonb_typeof(p_alc) = 'string' and (p_alc #>> '{}') = 'todas' then
    return true;                                   -- parent unlimited contains anything
  end if;
  if jsonb_typeof(h_alc) = 'string' and (h_alc #>> '{}') = 'todas' then
    return false;                                  -- child unlimited, parent not → exceeds
  end if;
  if jsonb_typeof(h_alc) <> 'array' then
    return true;                                   -- child requests no reach
  end if;
  if jsonb_typeof(p_alc) <> 'array' then
    return coalesce(jsonb_array_length(h_alc), 0) = 0;  -- parent has none: child must too
  end if;
  return not exists (
    select 1 from jsonb_array_elements_text(h_alc) e
     where not (p_alc ? e)
  );
end
$cont$;

comment on function convite_techo_contenido(jsonb, jsonb) is
  'PRD-35 (§29.3b): whether one capability ceiling is contained by another — every boolean cap ≤ and the community scope a subset. A vouched org''s ceiling is never above its voucher''s.';

-- An anchor vouches an organisation into the avalada tier (§29.3b) — admitted in minutes, with a
-- ceiling never above the voucher''s, the vouch recorded. The voucher is a platform admin or a
-- home-org admin; the proposed ceiling must be contained by the voucher''s org ceiling.
create or replace function convite_avalar_organizacion(
  p_objetivo uuid, p_motivo text, p_techo jsonb
) returns text
language plpgsql security definer set search_path = public as $aval$
declare
  uid uuid := auth.uid();
  voucher_org uuid;
  voucher_techo jsonb;
  obj organizaciones%rowtype;
begin
  if uid is null then return 'sin_sesion'; end if;
  if not (convite_es_plataforma() or convite_es(array['admin'])) then
    return 'sin_permiso';
  end if;

  select u.organizacion_id into voucher_org from usuarios u where u.id = uid and u.activo;
  if voucher_org is null then return 'sin_organizacion'; end if;

  select * into obj from organizaciones o where o.id = p_objetivo;
  if not found then return 'no_existe'; end if;
  if p_objetivo = voucher_org then return 'no_autoaval'; end if;

  select o.techo_permisos into voucher_techo from organizaciones o where o.id = voucher_org;
  if not convite_techo_contenido(coalesce(p_techo, '{}'::jsonb), coalesce(voucher_techo, '{}'::jsonb)) then
    return 'excede_techo';                         -- ceiling never above the voucher''s
  end if;

  update organizaciones
     set nivel_admision = 'avalada',
         aval_motivo = p_motivo,
         avalado_por = voucher_org,
         techo_permisos = coalesce(p_techo, '{}'::jsonb),
         estado_aprobacion = 'aprobada',
         activo = true,
         actualizado_en = now()
   where id = p_objetivo;

  insert into auditoria (actor_id, accion, entidad, entidad_id, antes, despues)
    values (uid, 'organizacion.avalada', 'organizaciones', p_objetivo,
            jsonb_build_object('nivel_admision', obj.nivel_admision,
                               'estado_aprobacion', obj.estado_aprobacion,
                               'activo', obj.activo),
            jsonb_build_object('nivel_admision', 'avalada', 'aval_motivo', p_motivo,
                               'avalado_por', voucher_org, 'techo_permisos', coalesce(p_techo, '{}'::jsonb)));
  return 'avalada';
end
$aval$;

comment on function convite_avalar_organizacion(uuid, text, jsonb) is
  'PRD-35 (§29.3b): an anchor vouches an org into the avalada tier — admitted in minutes, ceiling never above the voucher''s, vouch recorded in aval_motivo/avalado_por. Refuses a ceiling that exceeds the voucher''s.';

-- Revoking a vouch suspends the vouched organisation (§29.3b). Its memberships fall out of
-- convite_membresias_activas() at once because that helper requires organizaciones.activo.
create or replace function convite_revocar_aval(p_objetivo uuid, p_motivo text) returns text
language plpgsql security definer set search_path = public as $rev$
declare
  uid uuid := auth.uid();
  obj organizaciones%rowtype;
begin
  if uid is null then return 'sin_sesion'; end if;
  select * into obj from organizaciones o where o.id = p_objetivo;
  if not found then return 'no_existe'; end if;
  if obj.avalado_por is null then return 'no_avalada'; end if;
  if not (convite_es_plataforma()
          or (convite_es(array['admin']) and convite_organizacion() = obj.avalado_por)) then
    return 'sin_permiso';
  end if;

  update organizaciones set activo = false, actualizado_en = now() where id = p_objetivo;

  insert into auditoria (actor_id, accion, entidad, entidad_id, antes, despues)
    values (uid, 'organizacion.aval_revocado', 'organizaciones', p_objetivo,
            jsonb_build_object('activo', obj.activo, 'avalado_por', obj.avalado_por),
            jsonb_build_object('activo', false, 'motivo', p_motivo));
  return 'suspendida';
end
$rev$;

comment on function convite_revocar_aval(uuid, text) is
  'PRD-35 (§29.3b): revoke a vouch — suspends the vouched org (activo = false), so its memberships stop counting on the next request. Only the vouching org''s admin or a platform admin.';

-- A platform admin sets a non-avalada tier and its ceiling: ancla (contract path), aportante
-- (supply only) or observadora (aggregate read). aportante and observadora touch NO community
-- data (§29.3b), so their ceiling may not grant household addresses or any community reach.
create or replace function convite_fijar_nivel_admision(
  p_objetivo uuid, p_nivel text, p_techo jsonb
) returns text
language plpgsql security definer set search_path = public as $niv$
declare
  uid uuid := auth.uid();
  obj organizaciones%rowtype;
  techo jsonb := coalesce(p_techo, '{}'::jsonb);
  alcance jsonb;
begin
  if uid is null then return 'sin_sesion'; end if;
  if not convite_es_plataforma() then return 'sin_permiso'; end if;
  if p_nivel not in ('ancla', 'aportante', 'observadora') then return 'nivel_invalido'; end if;

  select * into obj from organizaciones o where o.id = p_objetivo;
  if not found then return 'no_existe'; end if;

  -- The supply-side tiers hold no community data (§29.3b).
  if p_nivel in ('aportante', 'observadora') then
    alcance := techo -> 'comunidades_alcance';
    if coalesce((techo ->> 'direcciones_hogar')::boolean, false) then
      return 'tier_sin_datos_comunidad';
    end if;
    if alcance is not null
       and not (jsonb_typeof(alcance) = 'array' and jsonb_array_length(alcance) = 0) then
      return 'tier_sin_datos_comunidad';
    end if;
  end if;

  update organizaciones
     set nivel_admision = p_nivel, techo_permisos = techo,
         estado_aprobacion = 'aprobada', actualizado_en = now()
   where id = p_objetivo;

  insert into auditoria (actor_id, accion, entidad, entidad_id, antes, despues)
    values (uid, 'organizacion.nivel_fijado', 'organizaciones', p_objetivo,
            jsonb_build_object('nivel_admision', obj.nivel_admision),
            jsonb_build_object('nivel_admision', p_nivel, 'techo_permisos', techo));
  return p_nivel;
end
$niv$;

comment on function convite_fijar_nivel_admision(uuid, text, jsonb) is
  'PRD-35 (§29.3b): a platform admin sets an org''s admission tier and ceiling for ancla/aportante/observadora. aportante and observadora may hold no community data (no direcciones_hogar, no community reach).';

grant execute on function convite_techo_contenido(jsonb, jsonb) to authenticated;
grant execute on function convite_avalar_organizacion(uuid, text, jsonb) to authenticated;
grant execute on function convite_revocar_aval(uuid, text) to authenticated;
grant execute on function convite_fijar_nivel_admision(uuid, text, jsonb) to authenticated;

-- ── Keep the open-sign-in path landing in membresias too ─────────────────────────────────────
--
-- vincular_usuario_staff() (0035) writes a usuarios row; a trigger mirrors that into one
-- membership so a newly linked staff member (invited OR open sign-in) has the membership the
-- permission engine reads. The function itself is NOT touched — the auth invariant and open
-- sign-in behaviour are unchanged; this only reflects the row it already writes into the new
-- table. Community scope is copied from usuarios_comunidades, which 0035 writes before the
-- usuarios row is committed (same transaction), so it is visible here.
create or replace function convite_membresia_desde_usuario() returns trigger
language plpgsql security definer set search_path = public as $mdu$
begin
  insert into membresias (usuario_id, organizacion_id, rol, comunidades_alcance, otorgado_en, ultima_actividad_en, estado)
    values (new.id, new.organizacion_id, new.rol_staff,
            coalesce((select array_agg(uc.comunidad_id) from usuarios_comunidades uc
                       where uc.usuario_id = new.id), '{}'::uuid[]),
            now(), now(), case when new.activo then 'activa' else 'suspendida' end)
  on conflict (usuario_id, organizacion_id, rol) do nothing;
  return new;
end
$mdu$;

create trigger usuarios_reflejar_membresia after insert on usuarios
  for each row execute function convite_membresia_desde_usuario();

comment on function convite_membresia_desde_usuario() is
  'PRD-16 (§29.5): mirror a newly created staff row into membresias so the permission engine sees it. vincular_usuario_staff() (0035) is untouched — this only reflects the row it writes; the auth invariant and open sign-in are unchanged.';
