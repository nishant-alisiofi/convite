-- Signing in by WhatsApp, alongside the emailed link.
--
-- A coordinator in the basin has WhatsApp before they have working email — it is the channel
-- the whole intake side of this product already runs on (M5). Asking them to open a mailbox to
-- get into the panel is asking for the one thing the field office may not have. So: same
-- allowlist, same staff record, same RLS, second door.
--
-- The email link is NOT replaced. It stays the fallback, and it is what an admin uses when a
-- phone is lost or a number changes.
--
-- ── What this does NOT change ───────────────────────────────────────────────────────────
--
-- Non-negotiable 2.10 still holds, and this migration is written to keep it holding: community
-- members never log in. They are identified by phone number alone, in `contactos`, and nothing
-- here gives a `contactos` row any way to authenticate. Only an address or a number an admin
-- put on `invitaciones_staff` can become staff, and only `vincular_usuario_staff()` writes
-- `usuarios`. The phone number in this file lives on the *invitation* and on `auth_user` —
-- never on `contactos`, which is deliberately a different table for a different kind of person.
--
-- RLS is untouched. No policy in 0017 is edited, because the thing every policy compares
-- against — `usuarios.id` = the Better Auth user id, a uuid — is the same on both paths.

-- ── Better Auth's phone columns ─────────────────────────────────────────────────────────
--
-- Names chosen by the plugin's schema (`phoneNumber` / `phoneNumberVerified`); the SQL side is
-- ours, mapped in db/schema/autenticacion.ts like every other column here.

alter table auth_user add column telefono text unique;
alter table auth_user add column telefono_verificado boolean not null default false;

alter table auth_user add constraint auth_user_telefono_e164_check
  check (telefono is null or telefono ~ '^\+[1-9][0-9]{7,14}$');

comment on column auth_user.telefono is
  'E.164, verified by a one-time code over WhatsApp. Distinct from contactos.telefono, which belongs to a community member who never logs in (2.10).';

-- ── The allowlist takes a number as well as an address ──────────────────────────────────
--
-- `correo` stops being mandatory so an admin can invite somebody who only has WhatsApp. At
-- least one of the two is still required: an invitation that identifies nobody would be a row
-- that silently matches nobody, which is the sort of thing that looks like a permissions bug
-- six months later.

alter table invitaciones_staff alter column correo drop not null;
alter table invitaciones_staff add column telefono text;

alter table invitaciones_staff add constraint invitaciones_identificador_check
  check (correo is not null or telefono is not null);

alter table invitaciones_staff add constraint invitaciones_telefono_e164_check
  check (telefono is null or telefono ~ '^\+[1-9][0-9]{7,14}$');

-- The old unique index assumed a non-null address. Partial, so several phone-only invitations
-- can coexist without colliding on a NULL correo.
drop index invitaciones_correo_key;
create unique index invitaciones_correo_key on invitaciones_staff (correo)
  where correo is not null;
create unique index invitaciones_telefono_key on invitaciones_staff (telefono)
  where telefono is not null;

comment on table invitaciones_staff is
  'Allowlist. Signing in — by emailed link or by WhatsApp code — proves you control an address or a number; it does not make you staff. Without a row here an authenticated session has no `usuarios` record and therefore no access to anything (2.10). One row per person: correo, telefono, or both.';

-- ── Linking a sign-in to its staff record, by either identifier ─────────────────────────
--
-- Same contract as before and the same three answers, plus one new refusal.
--
-- The new refusal is the point. An invitation carrying both an address and a number can be
-- reached by two different sign-ins, and Better Auth issues a *different* user id for each,
-- because a phone sign-in creates its own identity. Without a guard the second one would fall
-- through to the insert and quietly produce a second `usuarios` row: one human, two staff
-- records, two audit trails, and a community scope that has to be maintained twice. So an
-- invitation links exactly once, and the second door answers 'ya_vinculada' — legible, and
-- refusing in the direction that cannot corrupt anything.

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

  -- Already spent by the other door. See the note above: this is the guard against one person
  -- ending up with two staff records.
  if inv.usuario_id is not null and inv.usuario_id <> uid then
    return 'ya_vinculada';
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
            jsonb_build_object(
              'rol_staff', inv.rol_staff,
              'correo', inv.correo,
              'telefono', inv.telefono,
              'via', case when telefono_sesion is not null then 'whatsapp' else 'correo' end));

  return 'creado';
end
$vincular$;
