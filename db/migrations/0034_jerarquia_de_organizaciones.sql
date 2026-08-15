-- The organisation hierarchy: a platform tier above centre admins, and centre approval.
--
-- The spec (docs/tipos-de-usuario-y-accesos.md §2.4, §2.5, §4) describes three things this
-- migration makes real, and one it deliberately does not:
--
--   * A platform tier (Alisio / us) above a centre's own admin — approves centres, reaches
--     across organisations. Modelled as a flag, `usuarios.es_plataforma`, not a sixth role.
--   * A centre approval lifecycle: an organisation is `pendiente`, `aprobada`, or `rechazada`,
--     and only an approved one operates.
--   * A per-org centre admin who invites their own workers — already enforced by the
--     `invitaciones_admin` policy in 0017 (`organizacion_id = convite_organizacion()`); this
--     file only closes the one hole that let a centre admin escalate to the platform tier.
--
-- What it does NOT touch is the data boundary. RLS (0017 + 0030) already decides which rows a
-- session reads; this is the actions/hierarchy layer on top of it. Not one existing policy is
-- weakened — the platform tier is added additively, and the only existing policy that changes
-- is tightened (the escalation guard). The helpers `convite_alcanza_comunidad` and
-- `convite_alcanza_reporte` gain a platform short-circuit that only ever widens, and only for
-- a platform admin.

-- ── The platform tier ───────────────────────────────────────────────────────────────────
--
-- A flag rather than a role. `rol_staff` is which desk you work and drives ~30 policies through
-- `convite_es(array[...])`; a platform admin still has one of those desks (they are an `admin`
-- in their own organisation). Being platform is the cross-org elevation on top, so it rides
-- alongside `rol_staff` the way `activo` does, and every existing policy keeps its exact
-- meaning.

alter table usuarios add column es_plataforma boolean not null default false;

comment on column usuarios.es_plataforma is
  '§2.5: the platform tier (Alisio). A cross-org elevation on top of rol_staff, not a role. Approves centres and reaches across organisations (see convite_es_plataforma). Set only from a platform invitation; a centre admin cannot grant it.';

-- The invitation carries it, so `vincular_usuario_staff()` can copy it onto the staff row the
-- same way it copies the role. Defaults false: an ordinary worker invitation is not platform.
alter table invitaciones_staff add column es_plataforma boolean not null default false;

comment on column invitaciones_staff.es_plataforma is
  'Whether this invitation grants the platform tier (§2.5). Copied onto usuarios.es_plataforma by vincular_usuario_staff(). Only a platform admin may create one — enforced by invitaciones_no_escalar below.';

-- ── The centre approval lifecycle ───────────────────────────────────────────────────────
--
-- Added with a `pendiente` default so a centre requested after this migration starts pending,
-- then every organisation that already existed is backfilled to `aprobada` in the same
-- migration — the seed organisation has been operating since day one and must not be locked out
-- by a column that did not exist when it was created.

alter table organizaciones add column estado_aprobacion text not null default 'pendiente';

alter table organizaciones add constraint organizaciones_estado_aprobacion_check
  check (estado_aprobacion in ('pendiente', 'aprobada', 'rechazada'));

update organizaciones set estado_aprobacion = 'aprobada';

comment on column organizaciones.estado_aprobacion is
  '§2.4 / §4: a centre handles aid and PII, so it operates only once the platform approves it. pendiente → aprobada | rechazada. Only aprobada reaches the panel (gate in app/(panel)/layout.tsx). Pre-existing organisations were backfilled to aprobada by 0034.';

-- ── Reading the caller''s platform tier ─────────────────────────────────────────────────
--
-- SECURITY DEFINER and STABLE, exactly like `convite_rol()` in 0016 and for the same reason: a
-- policy that queried `usuarios` to decide access to `usuarios` would recurse. Reads the table
-- (the source of truth) rather than a claim, so deactivating a platform admin takes effect on
-- their next request the way it already does for `rol_staff`.

create or replace function convite_es_plataforma() returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select u.es_plataforma from usuarios u where u.id = auth.uid() and u.activo),
    false
  )
$$;

comment on function convite_es_plataforma() is
  'True when the caller is a platform admin (§2.5). The one place the cross-org tier is read, so the answer cannot drift between the policies and the helpers that consult it.';

grant execute on function convite_es_plataforma() to authenticated;

-- ── The platform admin reaches across organisations ─────────────────────────────────────
--
-- Both helpers already answer TRUE for every role that is not a verificador, so a platform
-- admin (an `admin`) is unaffected by the territory scope today. The explicit short-circuit is
-- added anyway, so a platform admin reaches every community and every report regardless of what
-- role they happen to hold — and, crucially, it only ever WIDENS, and only for a platform
-- admin. For everybody else `convite_es_plataforma()` is false and the branch below is dead, so
-- the behaviour of 0016/0030 is unchanged for every non-platform session.

create or replace function convite_alcanza_comunidad(objetivo uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when convite_es_plataforma() then true
    when convite_rol() is null then false
    when convite_rol() <> 'verificador' then true
    else exists (
      select 1 from usuarios_comunidades uc
       where uc.usuario_id = auth.uid() and uc.comunidad_id = objetivo
    )
  end
$$;

create or replace function convite_alcanza_reporte(objetivo uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when convite_es_plataforma() then true
    -- No parent to place it in. A verifier is scoped by territory, so a row that belongs to
    -- no territory is not theirs; every other role is unaffected by the scope anyway.
    when objetivo is null then convite_rol() is not null and convite_rol() <> 'verificador'
    else exists (
      select 1 from reportes r
       where r.id = objetivo and convite_alcanza_comunidad(r.comunidad_id)
    )
  end
$$;

comment on function convite_alcanza_reporte(uuid) is
  'Whether the caller may reach a row hanging off this report. Territory for a verificador; true for any other staff role and for a platform admin. NULL parent means «not placeable», which only a verificador is refused for.';

-- ── Approving or rejecting a centre ─────────────────────────────────────────────────────
--
-- A SECURITY DEFINER function rather than a bare UPDATE policy, matching `vincular_usuario_staff`
-- in 0016: the decision, the state transition and the audit row are one atomic thing, and the
-- permission is checked in one legible place. It refuses anything but a platform admin, and it
-- refuses to re-decide a centre that is no longer pending — an approval is a one-way door, and
-- flipping an already-approved centre back to pending is not a thing this exposes.

create or replace function convite_decidir_centro(objetivo uuid, decision text) returns text
language plpgsql security definer set search_path = public
as $decidir$
declare
  uid uuid := auth.uid();
  actual text;
begin
  if uid is null then
    return 'sin_sesion';
  end if;

  if not convite_es_plataforma() then
    return 'sin_permiso';
  end if;

  if decision not in ('aprobada', 'rechazada') then
    return 'decision_invalida';
  end if;

  select o.estado_aprobacion into actual from organizaciones o where o.id = objetivo;
  if not found then
    return 'no_existe';
  end if;

  if actual <> 'pendiente' then
    return 'ya_decidida';
  end if;

  update organizaciones
     set estado_aprobacion = decision, actualizado_en = now()
   where id = objetivo;

  insert into auditoria (actor_id, accion, entidad, entidad_id, antes, despues)
    values (uid, 'organizacion.' || decision, 'organizaciones', objetivo,
            jsonb_build_object('estado_aprobacion', actual),
            jsonb_build_object('estado_aprobacion', decision));

  return decision;
end
$decidir$;

comment on function convite_decidir_centro(uuid, text) is
  '§4: a platform admin approves or rejects a pending centre. The only path that moves organizaciones.estado_aprobacion from pendiente. Refuses non-platform callers and already-decided centres, and writes the decision to auditoria.';

grant execute on function convite_decidir_centro(uuid, text) to authenticated;

-- ── The platform admin manages across organisations ─────────────────────────────────────
--
-- Additive permissive policies (policies OR together, so these cannot narrow anything an
-- existing policy already allowed). They give the platform tier what §3''s capability matrix
-- grants it: manage staff and invitations in any organisation, not just its own. A centre
-- admin is untouched — their reach stays their own org through the 0017 policies.
--
-- `invitaciones_plataforma` is also what makes «a platform admin sees across organisations»
-- true and testable: the 0017 `invitaciones_admin` policy scopes a centre admin''s view of the
-- allowlist to `organizacion_id = convite_organizacion()`, and this widens it back to all
-- organisations for the platform tier only.

create policy usuarios_plataforma on usuarios
  for all to authenticated
  using (convite_es_plataforma())
  with check (convite_es_plataforma());

create policy invitaciones_plataforma on invitaciones_staff
  for all to authenticated
  using (convite_es_plataforma())
  with check (convite_es_plataforma());

-- ── The escalation guard ────────────────────────────────────────────────────────────────
--
-- The one existing behaviour this migration changes, and it tightens rather than loosens. The
-- `invitaciones_admin` policy (0017) lets a centre admin write invitations for their own
-- organisation, and says nothing about `es_plataforma` — so without this, a centre admin could
-- invite somebody as a platform admin and hand out the cross-org tier they were never given.
--
-- A RESTRICTIVE policy is the right tool: restrictive policies AND with the permissive ones, so
-- this cannot grant anything, only forbid. It forbids writing an invitation with
-- `es_plataforma = true` unless the caller is already a platform admin. `using (true)` leaves
-- reads and the row-visibility of the permissive policies exactly as they were; the whole effect
-- is in the WITH CHECK, on INSERT and UPDATE. Ordinary worker invitations (es_plataforma false)
-- pass it untouched, which is every invitation that exists today.

create policy invitaciones_no_escalar on invitaciones_staff
  as restrictive
  for all to authenticated
  using (true)
  with check (not es_plataforma or convite_es_plataforma());

comment on policy invitaciones_no_escalar on invitaciones_staff is
  'A centre admin invites workers, never platform admins (§2.4/§2.5). Only a platform admin may create an invitation carrying the platform tier.';

-- ── Linking a sign-in to its staff record — now carrying the platform flag ───────────────
--
-- The same function as 0029, re-created here with one addition: it copies `es_plataforma` from
-- the invitation onto the staff row, exactly as it already copies the role. Everything else is
-- unchanged — phone-first matching, the `ya_vinculada` guard against one person ending up with
-- two staff records, the audit row. The invariant it enforces is unchanged too: a `usuarios`
-- row (platform or not) exists only because an admin invited the address or the number AND the
-- person proved they control it. There is no path here that creates a platform admin without
-- both.

create or replace function vincular_usuario_staff() returns text
language plpgsql security definer set search_path = public
as $vincular$
declare
  uid uuid := auth.uid();
  correo_sesion text := correo_normalizado(coalesce(auth.jwt() ->> 'email', ''));
  telefono_sesion text := nullif(trim(coalesce(auth.jwt() ->> 'telefono', '')), '');
  inv invitaciones_staff%rowtype;
begin
  if uid is null then
    return 'sin_sesion';
  end if;

  if exists (select 1 from usuarios u where u.id = uid) then
    return 'ya_existe';
  end if;

  -- By number first: a phone sign-in carries a placeholder address (Better Auth requires an
  -- email on every user), and matching that against the allowlist would never hit.
  if telefono_sesion is not null then
    select i.* into inv from invitaciones_staff i where i.telefono = telefono_sesion;
  end if;

  if not found or inv.id is null then
    select i.* into inv from invitaciones_staff i where i.correo = correo_sesion;
  end if;

  if not found or inv.id is null then
    -- Authenticated, but not staff. No row, no access.
    return 'sin_invitacion';
  end if;

  -- Already spent by the other door. See 0029: this is the guard against one person ending up
  -- with two staff records.
  if inv.usuario_id is not null and inv.usuario_id <> uid then
    return 'ya_vinculada';
  end if;

  insert into usuarios (id, rol_staff, organizacion_id, es_plataforma)
    values (uid, inv.rol_staff, inv.organizacion_id, inv.es_plataforma);

  insert into usuarios_comunidades (usuario_id, comunidad_id)
    select uid, ic.comunidad_id
      from invitaciones_comunidades ic
     where ic.invitacion_id = inv.id
  on conflict do nothing;

  update invitaciones_staff i
     set usado_en = now(), usuario_id = uid
   where i.id = inv.id;

  insert into auditoria (actor_id, accion, entidad, entidad_id, despues)
    values (uid, 'usuario.vinculado', 'usuarios', uid,
            jsonb_build_object(
              'rol_staff', inv.rol_staff,
              'correo', inv.correo,
              'telefono', inv.telefono,
              'es_plataforma', inv.es_plataforma,
              'via', case when telefono_sesion is not null then 'whatsapp' else 'correo' end));

  return 'creado';
end
$vincular$;
