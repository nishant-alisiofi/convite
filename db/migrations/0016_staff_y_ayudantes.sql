-- Staff provisioning and the helper functions the policies are built from.
--
-- Non-negotiable 2.10: community members never log in. Only the people in this file can
-- authenticate, and only because an admin put their address on a list first.

-- ── Who is allowed to become staff ──────────────────────────────────────────────────────

create table invitaciones_staff (
  id                uuid primary key default gen_random_uuid(),
  correo            text not null,
  rol_staff         text not null,
  organizacion_id   uuid not null references organizaciones (id),
  invitado_por      uuid references usuarios (id),
  usado_en          timestamptz,
  usuario_id        uuid references usuarios (id),
  creado_en         timestamptz not null default now(),

  constraint invitaciones_rol_check
    check (rol_staff in ('coordinador', 'verificador', 'despachador', 'admin', 'lectura')),
  constraint invitaciones_correo_check check (correo = lower(correo) and correo like '%@%')
);

comment on table invitaciones_staff is
  'Allowlist. Signing in with a magic link proves you own an address; it does not make you staff. Without a row here, an authenticated session has no `usuarios` record and therefore no access to anything (2.10).';

create unique index invitaciones_correo_key on invitaciones_staff (correo);

-- Which communities a verificador is scoped to, carried through the invitation so an admin
-- can set it before the person ever signs in.
create table invitaciones_comunidades (
  invitacion_id  uuid not null references invitaciones_staff (id) on delete cascade,
  comunidad_id   uuid not null references comunidades (id) on delete cascade
);

create unique index invitaciones_comunidades_key
  on invitaciones_comunidades (invitacion_id, comunidad_id);

-- ── Reading the caller's identity ───────────────────────────────────────────────────────
--
-- All SECURITY DEFINER and STABLE. They have to bypass RLS: a policy on `usuarios` that
-- queried `usuarios` to decide access would recurse forever.

create or replace function convite_rol() returns text
language sql stable security definer set search_path = public
as $$
  select u.rol_staff from usuarios u where u.id = auth.uid() and u.activo
$$;

comment on function convite_rol() is
  'rol_staff of the caller, or NULL when the session has no active staff record.';

create or replace function convite_organizacion() returns uuid
language sql stable security definer set search_path = public
as $$
  select u.organizacion_id from usuarios u where u.id = auth.uid() and u.activo
$$;

create or replace function convite_es(roles text[]) returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(convite_rol() = any(roles), false)
$$;

/*
 * Communities a verificador may act on. Anyone with a broader role sees them all — the
 * scoping exists to keep a verifier in their own territory, not to hide the basin from a
 * coordinator.
 */
create or replace function convite_alcanza_comunidad(objetivo uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when convite_rol() is null then false
    when convite_rol() <> 'verificador' then true
    else exists (
      select 1 from usuarios_comunidades uc
       where uc.usuario_id = auth.uid() and uc.comunidad_id = objetivo
    )
  end
$$;

/*
 * Section 11: a transporter sees exact stops only for their own shipment, and only between
 * dispatch and completion. Both halves matter — the window is why a driver who ran one trip
 * in March cannot still pull coordinates in August.
 */
create or replace function convite_conduce_hacia(comunidad uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from envios e
      join usuarios u on u.id = auth.uid() and u.contacto_id = e.responsable_id
      join envio_items ei on ei.envio_id = e.id
      join pedidos p on p.id = ei.pedido_id
     where p.comunidad_id = comunidad
       and e.estado in ('DESPACHADO', 'EN_RUTA')
       and e.despachado_en is not null
       and e.regreso_real is null
  )
$$;

/*
 * Non-negotiable 2.16: a home address plus a name plus "has supplies" is a target. Only the
 * driver assigned to collect it, while the run is live — or a coordinator planning it.
 */
create or replace function convite_recoge_oferta(oferta uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select convite_es(array['coordinador', 'admin'])
      or exists (
        select 1
          from recogidas r
          join capacidades c on c.id = r.capacidad_id
          join usuarios u on u.id = auth.uid() and u.contacto_id = c.contacto_id
         where r.oferta_id = oferta
           and r.estado in ('PLANEADA', 'EN_CURSO')
      )
$$;

-- ── Turning a magic link into a staff record ────────────────────────────────────────────

create or replace function correo_normalizado(valor text) returns text
language sql immutable as $$ select lower(trim(valor)) $$;

/*
 * Called once after sign-in. Creates the `usuarios` row if — and only if — an admin has
 * already put this verified address on the allowlist, and copies across the verifier's
 * community scope.
 *
 * Deliberately not a trigger on auth.users: that table belongs to supabase_auth_admin, and
 * an explicit call keeps the rule visible in the codebase rather than buried in the auth
 * schema.
 */
create or replace function vincular_usuario_staff() returns text
language plpgsql security definer set search_path = public
as $vincular$
declare
  uid uuid := auth.uid();
  correo_sesion text := correo_normalizado(coalesce(auth.jwt() ->> 'email', ''));
  inv invitaciones_staff%rowtype;
begin
  if uid is null then
    return 'sin_sesion';
  end if;

  if exists (select 1 from usuarios u where u.id = uid) then
    return 'ya_existe';
  end if;

  select i.* into inv from invitaciones_staff i where i.correo = correo_sesion;
  if not found then
    -- Authenticated, but not staff. No row, no access.
    return 'sin_invitacion';
  end if;

  insert into usuarios (id, rol_staff, organizacion_id)
    values (uid, inv.rol_staff, inv.organizacion_id);

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
            jsonb_build_object('rol_staff', inv.rol_staff, 'correo', inv.correo));

  return 'creado';
end
$vincular$;

grant execute on function vincular_usuario_staff() to authenticated;
grant execute on function convite_rol() to authenticated;
grant execute on function convite_organizacion() to authenticated;

alter table invitaciones_staff enable row level security;
alter table invitaciones_comunidades enable row level security;
revoke all on invitaciones_staff from anon, authenticated;
revoke all on invitaciones_comunidades from anon, authenticated;
