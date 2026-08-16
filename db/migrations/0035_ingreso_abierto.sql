-- Open sign-in: proving you control an email or a number is enough to get an account.
--
-- The invariant this product shipped with — «a usuarios row exists only because an admin
-- invited the address or the number AND the person proved they control it» — is removed here
-- by founder decision. The allowlist (invitaciones_staff) is no longer a GATE; it is now an
-- OPTIONAL pre-assignment. Anyone who proves possession (magic link, WhatsApp code, or a
-- password set later) gets a working staff record with panel access.
--
-- What each half becomes:
--
--   * WITH a matching invitation (by phone first, then email — exactly as before): the row is
--     created from the invitation, carrying its rol_staff, organizacion_id, es_plataforma and
--     any invitaciones_comunidades. An invitation pre-assigns role/org/platform; it no longer
--     decides whether you get in.
--   * WITHOUT a matching invitation (the new open path): the row is still created, with a
--     default role of 'admin', es_plataforma = false, and organizacion_id set to the
--     earliest-created active organisation — the same selection scripts/sembrar-plataforma.ts
--     uses. If somehow no active organisation exists, one is created the way that script does
--     (named 'Alisio', aprobada, activo) so prod and staging behave consistently.
--
-- What deliberately does NOT change:
--
--   * The platform tier stays an ELEVATION, never a default. es_plataforma is only ever set
--     from an invitation that carries it (CORREOS_STAFF → platform via sembrar-plataforma.ts);
--     an uninvited sign-in is never granted it. The escalation guard from 0034
--     (invitaciones_no_escalar) is untouched.
--   * The ya_existe guard (one auth id, one staff row) and the ya_vinculada guard (0029 — one
--     person invited by both address and number does not end up with two staff records) both
--     stay exactly as they were.
--   * RLS is not touched. An uninvited admin is a normal, non-platform staff member scoped to
--     their (default) organisation by the existing policies in 0017/0030; nothing here widens
--     the data boundary. This migration only changes who gets a row, not what a row may read.
--
-- Only the function body changes; there is no schema change, so the Drizzle mirror in
-- db/schema needs no update and `pnpm db:check` stays empty.

create or replace function vincular_usuario_staff() returns text
language plpgsql security definer set search_path = public
as $vincular$
declare
  uid uuid := auth.uid();
  correo_sesion text := correo_normalizado(coalesce(auth.jwt() ->> 'email', ''));
  telefono_sesion text := nullif(trim(coalesce(auth.jwt() ->> 'telefono', '')), '');
  inv invitaciones_staff%rowtype;
  org_id uuid;
  total_orgs int;
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

  if inv.id is null then
    select i.* into inv from invitaciones_staff i where i.correo = correo_sesion;
  end if;

  -- ── The invitation exists: use it as a pre-assignment (unchanged from 0034) ──────────────
  if inv.id is not null then
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
  end if;

  -- ── No invitation: open sign-in. Possession alone is enough ──────────────────────────────
  --
  -- Default organisation = earliest-created active org, matching sembrar-plataforma.ts so an
  -- uninvited admin lands in the same place a bootstrap would put the platform team. es_plataforma
  -- is false: the platform tier is an elevation carried only by an invitation, never the default.

  select o.id into org_id from organizaciones o where o.activo order by o.creado_en limit 1;

  if org_id is null then
    -- Mirror sembrar-plataforma.ts: only create when there is truly no organisation at all; an
    -- inactive-but-present one is a state to fix, not a reason to stand up a second.
    select count(*) into total_orgs from organizaciones;
    if total_orgs > 0 then
      raise exception
        'Existen organizaciones pero ninguna activa; no se crea una segunda. Reactive una en organizaciones.activo.';
    end if;

    insert into organizaciones (nombre, estado_aprobacion, activo)
      values ('Alisio', 'aprobada', true)
    on conflict (nombre) do nothing
    returning id into org_id;

    if org_id is null then
      -- Lost a race to another sign-in that created it; read back the row it wrote.
      select o.id into org_id from organizaciones o where o.nombre = 'Alisio';
    end if;
  end if;

  insert into usuarios (id, rol_staff, organizacion_id, es_plataforma)
    values (uid, 'admin', org_id, false);

  insert into auditoria (actor_id, accion, entidad, entidad_id, despues)
    values (uid, 'usuario.vinculado', 'usuarios', uid,
            jsonb_build_object(
              'rol_staff', 'admin',
              'organizacion_id', org_id,
              'es_plataforma', false,
              'sin_invitacion', true,
              'via', case when telefono_sesion is not null then 'whatsapp' else 'correo' end));

  return 'creado';
end
$vincular$;

comment on function vincular_usuario_staff() is
  'Links a fresh sign-in to a staff record. Possession alone is enough (open sign-in, 0035): with a matching invitation it copies rol_staff/organizacion_id/es_plataforma and any invitaciones_comunidades; without one it creates a default admin (es_plataforma false) in the earliest active organisation. Invitations pre-assign, they do not gate. The platform tier is set only from an invitation. Keeps the ya_existe and ya_vinculada (0029) guards.';
