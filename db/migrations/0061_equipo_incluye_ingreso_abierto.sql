-- Equipo (app/(panel)/equipo) only ever listed `invitaciones_staff` rows. That was correct
-- until 0035: open sign-in means a `usuarios` row can now exist with **no invitation at
-- all** — anyone who proves possession of an address or a number becomes staff (default
-- `admin`, in the earliest active organisation) with nothing in `invitaciones_staff` to join
-- against. That account has full panel access and no row on the one screen meant to manage
-- staff, so there was no button anywhere to deactivate it. This is the missing management
-- surface, not a change to who gets in — open sign-in stays exactly as 0035 left it.
--
-- Why this needs a function instead of widening the page's own SQL: showing an open-sign-in
-- member's address or number means reading `auth_user`, and 0028 closes that table to the
-- `authenticated` role on purpose (`revoke all ... ; enable row level security` with no
-- policy at all — a signed-in browser has no business reading Better Auth's own table).
-- `security definer`, owned by the migration role and therefore exempt from that RLS the same
-- way `vincular_usuario_staff()` already is, is the sanctioned way through. Bypassing RLS
-- means the authorisation has to be written by hand here — re-checking the admin/platform
-- gate and deriving the caller's own organisation with the same helpers the RLS policies use
-- (`convite_organizacion()`, `convite_es()`, `convite_es_plataforma()`) — the same reasoning
-- as the escalation guard in 0034.
--
-- The listing itself is a full outer join of `usuarios` (every staff row of the caller's own
-- organisation, invited or not) with `invitaciones_staff` (so a still-pending invitation
-- nobody has claimed yet keeps showing up exactly as before) on the key the invitation already
-- carries, `invitaciones_staff.usuario_id`. Three shapes come out of it:
--   * invited and joined  — both sides present, exactly today's row.
--   * invited, not joined — only the invitation side; still "Invitado".
--   * open sign-in        — only the `usuarios` side; new, and the point of this migration.
--
-- No schema changes: no new column, no new table. The Drizzle mirror in db/schema needs no
-- update and `pnpm db:check` stays empty.

create or replace function convite_equipo() returns table (
  id uuid,
  correo text,
  telefono text,
  rol_staff text,
  usado_en timestamptz,
  usuario_id uuid,
  usuario_activo boolean
)
language plpgsql stable security definer set search_path = public
as $convite_equipo$
declare
  org_id uuid := convite_organizacion();
begin
  -- Same gate as the page (`puedeGestionar`), re-checked here because a security definer
  -- function bypasses RLS entirely — the row-visibility rule has to live in the function body
  -- instead, or there is none.
  if org_id is null or not (convite_es(array['admin']) or convite_es_plataforma()) then
    raise exception 'Solo el admin de la organización gestiona su equipo.';
  end if;

  return query
    select
      coalesce(i.id, u.id)              as id,
      coalesce(i.correo, au.correo)     as correo,
      coalesce(i.telefono, au.telefono) as telefono,
      coalesce(i.rol_staff, u.rol_staff) as rol_staff,
      i.usado_en,
      coalesce(i.usuario_id, u.id)      as usuario_id,
      u.activo                          as usuario_activo
      from usuarios u
      full outer join invitaciones_staff i on i.usuario_id = u.id
      left join auth_user au on au.id = u.id::text
     where coalesce(u.organizacion_id, i.organizacion_id) = org_id
       and coalesce(u.es_plataforma, i.es_plataforma, false) = false
     order by coalesce(i.creado_en, u.creado_en);
end
$convite_equipo$;

comment on function convite_equipo() is
  'Equipo (§2.4): every staff row of the caller''s own organisation, invited (invitaciones_staff, including still-pending ones) or open-sign-in (0035, no invitation at all), in one shape. security definer so it may read auth_user (closed to authenticated by 0028) for the open-sign-in half''s address/number; re-derives the caller''s org and re-checks the admin/platform gate internally since bypassing RLS means the authorisation is not free. Excludes platform-tier rows, same as the query it replaces.';

grant execute on function convite_equipo() to authenticated;
