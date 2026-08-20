-- PRD-49 — sensitive-disclosure handling: redaction, escalation, and the `verificador_vulnerable`
-- role (Supplement v4 §3, §6.3), plus the v4 additions to PRD-16 (§29.3 roles table) and PRD-37
-- (§29.4 ceiling key `acceso_sensible`).
--
-- The problem this closes: today a GBV/domestic-violence disclosure arriving through any channel
-- lands in the standard Verificación queue exactly like a supply request — visible to any
-- verificador/despachador with community access, on the same ~24h cadence. Neither is acceptable
-- for a live distress disclosure.
--
-- The mechanism, end to end:
--
--   * `reportes.sensible` — a routing decision, never a diagnosis (v3 §27b.3, unchanged). Set by a
--     distress-term match at intake (lib/canales/intake.ts, checked against `terminos_riesgo`) or
--     by hand by a verifier (`convite_marcar_reporte_sensible` below).
--   * Redaction is PHYSICAL, not a query-time filter. The instant a report is flagged, its
--     identifying content — detalle_libre, descripcion, ubicacion*, contacto_id — is MOVED out of
--     `reportes` into `reportes_contenido_protegido`, a table with its own RLS floor. Every
--     existing consumer of `reportes` (bandeja, mapa, matching, this migration's own new policies)
--     reads NULL for those columns on a flagged report with ZERO code changes elsewhere, because
--     the value is not there to read — not because a query remembered to hide it. Audio and
--     transcript (`adjuntos`) stay in place; a new RESTRICTIVE policy hides the whole row instead,
--     since an adjunto has no "still show the shell" requirement the way a reporte's folio does.
--   * `verificador_vulnerable` (new role) is the only login that reaches the moved content — via
--     the SAME membership + `techo_permisos` ceiling machinery PRD-16 already built (0047), gated
--     on one new documented key, `acceso_sensible`. No new permission mechanism: this migration
--     only teaches `convite_rol_ejerce` and `convite_membresia_cabe_en_techo` the one new
--     role/capability pair, exactly the shape `despachador`/`despacho` already has.
--   * Escalation is a DB row, not a queue poll. `convite_marcar_reporte_sensible` writes
--     `alertas_proteccion` in the SAME transaction that flags the report, so the signal exists the
--     instant the flag is set — it does not wait for anyone's next dashboard check. Delivery
--     (actually sending the SMS/WhatsApp) is a separate, idempotent step
--     (`lib/verificacion/sensibles.ts`), because network I/O has no place inside a SQL function.
--
-- Two tables are PARTNER DATA, deliberately empty:
--
--   * `terminos_riesgo` — the distress-term list. Choosing what triggers the flag is a partner/
--     clinically-informed decision (Red de Mujeres / ASOREDIPARCHOCÓ), never an engineering
--     default. Zero active rows means the matcher never fires: no false triggers.
--   * `contactos_proteccion` — who the protection leads are, per organisation. Also a partner/
--     founder decision (echoes v3 §34's open "who holds org_admin"). The escalation mechanism is
--     fully wired against this table with zero rows — it just has nowhere to send until one exists.
--
-- Both are ordinary org-admin-writable config tables; populating either is later an INSERT, never
-- a migration.

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  Part 1 — the role: `verificador_vulnerable` in the vocabulary, ceiling-gated (PRD-16 v4)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Added to BOTH the home-role vocabulary (`usuarios.rol_staff`) and the membership vocabulary
-- (`membresias.rol`) — the same controlled set, per 0047's comment on `membresias_rol_check`.
-- Deliberately NOT added to the admin-invite dropdown's role set (there isn't one in SQL to
-- change — ROLES_TRABAJADOR is TS-only, ~0034's invitaciones flow): granting straight through
-- `usuarios.rol_staff` via an ordinary staff invitation has no ceiling check at all (0047's own
-- documented scope — "does NOT re-gate sign-in"), which would let any org admin hand out
-- `verificador_vulnerable` with no `acceso_sensible` ceiling behind it. The only path that is
-- actually ceiling-gated is the `membresias` grant, which `convite_membresia_cabe_en_techo` (Part 2
-- below) now refuses unless the org's ceiling carries `acceso_sensible: true`. This migration adds
-- the value to both check constraints because the vocabulary is genuinely shared (0047's own
-- comment: "Roles are the same controlled set as usuarios.rol_staff") — but every RLS policy that
-- unlocks un-redacted sensitive content in this migration keys off the ceiling-checked membership
-- path (`convite_ve_reporte_sensible`), never off bare `usuarios.rol_staff`.

alter table usuarios drop constraint usuarios_rol_staff_check;
alter table usuarios add constraint usuarios_rol_staff_check
  check (rol_staff in ('coordinador', 'verificador', 'despachador', 'admin', 'lectura',
                        'verificador_vulnerable'));

alter table membresias drop constraint membresias_rol_check;
alter table membresias add constraint membresias_rol_check
  check (rol in ('coordinador', 'verificador', 'despachador', 'admin', 'lectura',
                 'verificador_vulnerable'));

comment on column organizaciones.techo_permisos is
  'PRD-37 (§29.4): capability ceiling set by the approving body. jsonb per §29.4 (comunidades_alcance, direcciones_hogar, inventario_nodo, despacho, agendamiento, evaluacion, puede_delegar) plus PRD-49''s acceso_sensible (may this org''s staff hold verificador_vulnerable). Default {} grants nothing (fail closed). Enforced by PRD-16/PRD-49.';

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  Part 2 — teaching the existing ceiling machinery the new role/capability pair
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Full replace, not ALTER — Postgres has no "add one more WHEN to a CASE" statement. Every branch
-- below is copied verbatim from 0047; the only change in each function is the one new line, called
-- out in a comment.

create or replace function convite_rol_ejerce(p_rol text, p_cap text) returns boolean
language sql immutable as $ejerce$
  select case p_cap
    when 'despacho'          then p_rol in ('coordinador', 'admin', 'despachador')
    when 'inventario_nodo'   then p_rol in ('coordinador', 'admin', 'despachador')
    when 'agendamiento'      then p_rol in ('coordinador', 'admin')
    when 'evaluacion'        then p_rol in ('coordinador', 'admin', 'verificador')
    when 'direcciones_hogar' then p_rol in ('coordinador', 'admin', 'despachador', 'verificador')
    when 'puede_delegar'     then p_rol = 'admin'
    -- PRD-49: the one capability verificador_vulnerable exercises — nothing else, so it never
    -- picks up despacho/evaluacion/etc. just by existing in the role vocabulary.
    when 'acceso_sensible'   then p_rol = 'verificador_vulnerable'
    else false
  end
$ejerce$;

comment on function convite_rol_ejerce(text, text) is
  'PRD-16 (§29.3/§29.4) + PRD-49: whether a role exercises a capability. The role side of an effective permission; convite_membresia_capacidad clips it by the org ceiling.';

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

  if p_rol = 'despachador' and not coalesce((techo ->> 'despacho')::boolean, false) then
    return false;
  end if;
  if p_rol = 'verificador' and not coalesce((techo ->> 'evaluacion')::boolean, false) then
    return false;
  end if;
  if p_rol = 'admin' and not coalesce((techo ->> 'puede_delegar')::boolean, false) then
    return false;
  end if;
  -- PRD-49: verificador_vulnerable's own primary gate — an org may not be granted the role at
  -- all unless its ceiling explicitly opts in. Same shape as the three checks above.
  if p_rol = 'verificador_vulnerable'
     and not coalesce((techo ->> 'acceso_sensible')::boolean, false) then
    return false;
  end if;

  alcance := techo -> 'comunidades_alcance';
  if jsonb_typeof(alcance) = 'string' and (alcance #>> '{}') = 'todas' then
    return true;
  end if;
  if coalesce(array_length(p_comunidades, 1), 0) = 0 then
    return true;
  end if;
  if jsonb_typeof(alcance) <> 'array' then
    return false;
  end if;
  return not exists (
    select 1 from unnest(p_comunidades) c
     where not (alcance ? c::text)
  );
end
$cabe$;

comment on function convite_membresia_cabe_en_techo(uuid, text, uuid[]) is
  'PRD-16 (§29.4) + PRD-49: whether a membership grant fits the org ceiling — role capabilities within techo_permisos (including verificador_vulnerable/acceso_sensible), community scope a subset of comunidades_alcance. Fails closed.';

-- 0047's own trigger mirrors ANY new usuarios.rol_staff into an ACTIVE membresias row, running
-- SECURITY DEFINER — which means it bypasses membresias_dentro_del_techo (a RESTRICTIVE policy on
-- `authenticated`, not on the definer). That is fine for every role that predates PRD-49, because
-- none of them is ceiling-gated at the point of being someone's HOME role. verificador_vulnerable
-- is the first one that must be, so this is a full replace adding exactly one guard: skip the
-- mirror — silently, not an error, since a staff row is still created either way — when the role
-- is verificador_vulnerable and the org's ceiling does not carry acceso_sensible. Every other role
-- mirrors exactly as before; this is the same door membresias_dentro_del_techo already closes for
-- an explicit grant, closed here for the one path that runs with owner privileges and skips it.
create or replace function convite_membresia_desde_usuario() returns trigger
language plpgsql security definer set search_path = public as $mdu$
declare
  alcance uuid[];
begin
  alcance := coalesce(
    (select array_agg(uc.comunidad_id) from usuarios_comunidades uc where uc.usuario_id = new.id),
    '{}'::uuid[]
  );

  if new.rol_staff = 'verificador_vulnerable'
     and not convite_membresia_cabe_en_techo(new.organizacion_id, new.rol_staff, alcance) then
    return new;
  end if;

  insert into membresias (usuario_id, organizacion_id, rol, comunidades_alcance, otorgado_en, ultima_actividad_en, estado)
    values (new.id, new.organizacion_id, new.rol_staff, alcance,
            now(), now(), case when new.activo then 'activa' else 'suspendida' end)
  on conflict (usuario_id, organizacion_id, rol) do nothing;
  return new;
end
$mdu$;

comment on function convite_membresia_desde_usuario() is
  'PRD-16 (§29.5): mirror a newly created staff row into membresias so the permission engine sees it. PRD-49: the one exception — verificador_vulnerable only mirrors if the org''s ceiling already carries acceso_sensible, closing the same door membresias_dentro_del_techo closes for an explicit grant (this trigger runs SECURITY DEFINER and would otherwise bypass it). vincular_usuario_staff() (0035) is untouched.';

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  Part 3 — the sensitivity flag + who may see the un-redacted content of a flagged report
-- ════════════════════════════════════════════════════════════════════════════════════════════

alter table reportes add column sensible boolean not null default false;
alter table reportes add column sensible_motivo text;
alter table reportes add column sensible_marcado_por uuid references usuarios (id);
alter table reportes add column sensible_marcado_en timestamptz;

alter table reportes add constraint reportes_sensible_motivo_check
  check (sensible_motivo is null or sensible_motivo in ('termino_detectado', 'manual'));
-- Mirrors reportes_verificacion_check's shape: a flag carries its own timestamp or it isn't one.
alter table reportes add constraint reportes_sensible_marcado_check
  check ((not sensible) = (sensible_motivo is null and sensible_marcado_en is null));
-- 2.1: a manual judgement carries a name; an automated term match has none to give.
alter table reportes add constraint reportes_sensible_manual_check
  check (sensible_motivo is distinct from 'manual' or sensible_marcado_por is not null);

comment on column reportes.sensible is
  'PRD-49: a routing flag, never a diagnosis (v3 §27b.3). Set by a distress-term match at intake or by hand (convite_marcar_reporte_sensible). Redaction of detalle_libre/descripcion/ubicacion*/contacto_id is enforced by PHYSICALLY MOVING those values to reportes_contenido_protegido the instant this flips true — this column only routes and displays as urgent.';

-- The escalation surface: flagged reports, worst first, independent of and bypassing the ordinary
-- urgencia-sorted bandeja cadence (reportes_bandeja_idx, migration 0003).
create index reportes_sensible_idx on reportes (creado_en) where sensible;

-- The moved payload. One row per flagged report. Written only by convite_marcar_reporte_sensible
-- (SECURITY DEFINER) or by intake itself (which, for an auto-flagged report, never lets the value
-- land in `reportes` in the first place — see lib/canales/intake.ts). No INSERT/UPDATE/DELETE
-- grant to `authenticated` at all: the function is the only door in, regardless of what any policy
-- says, which is why the GRANT statement below only ever mentions SELECT.
create table reportes_contenido_protegido (
  reporte_id             uuid primary key references reportes (id) on delete cascade,
  detalle_libre          text,
  descripcion            text,
  ubicacion              geometry(Point, 4326),
  ubicacion_fuente       text,
  ubicacion_precision_m  integer,
  contacto_id            uuid references contactos (id),
  creado_en              timestamptz not null default now(),

  constraint reportes_contenido_protegido_ubicacion_fuente_check
    check (ubicacion_fuente is null
      or ubicacion_fuente in ('gps', 'centroide', 'referida', 'manual'))
);

comment on table reportes_contenido_protegido is
  'PRD-49: the un-redacted payload of a flagged report — detail, location, contact (Scope §2). Physically separate from reportes so a redacted read is structurally incapable of returning this content, regardless of which query touches reportes. Read-gated to verificador_vulnerable via convite_ve_reporte_sensible; written only by convite_marcar_reporte_sensible or trusted (RLS-bypassing) intake code.';

-- Who may reach a specific flagged report's protected content or its sensitive adjuntos: an active
-- verificador_vulnerable membership in the report's own organisation, whose org ceiling still
-- carries acceso_sensible (checked live, never cached — same discipline as convite_membresia_capacidad),
-- and whose community scope covers the report's community (empty scope = org-wide, exactly like
-- convite_membresia_cabe_en_techo already treats an unscoped admin/despachador membership).
--
-- Deliberately does NOT short-circuit for convite_es_plataforma(). Every other helper in this
-- codebase widens for the platform tier; this one does not, on purpose — PRD-49's acceptance
-- criteria are explicit that verificador_vulnerable is "the only role" that sees this content, with
-- no stated platform-admin carve-out, and GBV disclosure is exactly the content this product's own
-- non-negotiables (v3 §2) say to keep the narrowest possible circle around.
create or replace function convite_ve_reporte_sensible(p_reporte uuid) returns boolean
language sql stable security definer set search_path = public as $ve$
  select exists (
    select 1
      from convite_membresias_activas() m
      join organizaciones o on o.id = m.organizacion_id
      join reportes r on r.id = p_reporte
     where m.rol = 'verificador_vulnerable'
       and m.organizacion_id = r.organizacion_id
       and coalesce((o.techo_permisos ->> 'acceso_sensible')::boolean, false)
       and (
         coalesce(array_length(m.comunidades_alcance, 1), 0) = 0
         or r.comunidad_id = any(m.comunidades_alcance)
       )
  )
$ve$;

comment on function convite_ve_reporte_sensible(uuid) is
  'PRD-49 AC #3: whether the caller may see a specific flagged report''s un-redacted content — active verificador_vulnerable membership in the report''s org, ceiling-gated (acceso_sensible), community-scoped. Deliberately excludes convite_es_plataforma() — see the function''s own comment.';

grant execute on function convite_ve_reporte_sensible(uuid) to authenticated;

-- ── RLS: reportes_contenido_protegido ────────────────────────────────────────────────────────

alter table reportes_contenido_protegido enable row level security;
revoke all on public.reportes_contenido_protegido from anon, authenticated;
grant select on public.reportes_contenido_protegido to authenticated;

create policy reportes_contenido_protegido_lectura on reportes_contenido_protegido
  for select to authenticated
  using (convite_ve_reporte_sensible(reporte_id));

-- ── RLS: the base reportes row for a flagged report, additive to 0017's reportes_lectura ──────
--
-- 0017's reportes_lectura keys off convite_es() (usuarios.rol_staff, the HOME role) and would
-- refuse a caller whose only claim to the role is a membresias row (the ceiling-gated path this
-- migration actually requires — see Part 1). This is a NEW, additive permissive policy — it does
-- not touch 0017's text — so a verificador_vulnerable can find the (redacted-of-PII, but present)
-- reportes row their protected content hangs off, without widening what anyone else can see.

create policy reportes_lectura_vulnerable on reportes
  for select to authenticated
  using (sensible and convite_ve_reporte_sensible(id));

-- ── RLS: adjuntos — audio + transcript are hidden entirely for a flagged report ────────────────
--
-- adjuntos_lectura (0017) is a flat role check with NO row scoping at all today — every
-- verificador/despachador/coordinador/admin sees every adjunto. A RESTRICTIVE policy is the
-- correct tool: it can only narrow, never grant, so it cannot interact badly with any existing or
-- future permissive policy on this table. For a non-sensitive report's adjunto (or one with no
-- reporte_id at all — the entrega-linked kind, 0004) the `not exists` branch is true and nothing
-- changes. For a flagged report's adjunto, only convite_ve_reporte_sensible unlocks it — hiding the
-- WHOLE row (storage_key, transcripcion, transcripcion_corregida together) is the right grain here,
-- unlike reportes, because an adjunto has no "keep the folio visible" requirement.

create policy adjuntos_sensible_oculta on adjuntos
  as restrictive
  for all to authenticated
  using (
    not exists (select 1 from reportes r where r.id = adjuntos.reporte_id and r.sensible)
    or convite_ve_reporte_sensible(adjuntos.reporte_id)
  )
  with check (
    not exists (select 1 from reportes r where r.id = adjuntos.reporte_id and r.sensible)
    or convite_ve_reporte_sensible(adjuntos.reporte_id)
  );

-- A verificador_vulnerable still needs a PERMISSIVE grant to reach adjuntos at all — 0017's
-- adjuntos_lectura checks convite_es(array['verificador', ...]), which their home role will not
-- match if they hold the role only by membership (Part 1). Additive; scoped to exactly the rows
-- the restrictive policy above would otherwise let through.

create policy adjuntos_lectura_vulnerable on adjuntos
  for select to authenticated
  using (convite_ve_reporte_sensible(adjuntos.reporte_id));

-- ── RLS: contactos — the same additive-reach problem, scoped to a protected contact only ──────

create policy contactos_lectura_vulnerable on contactos
  for select to authenticated
  using (
    exists (
      select 1 from reportes_contenido_protegido rcp
       where rcp.contacto_id = contactos.id
         and convite_ve_reporte_sensible(rcp.reporte_id)
    )
  );

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  Part 4 — partner-data config: distress terms and protection-lead contacts (BOTH EMPTY)
-- ════════════════════════════════════════════════════════════════════════════════════════════

create table terminos_riesgo (
  id          uuid primary key default gen_random_uuid(),
  termino     text not null,
  activo      boolean not null default true,
  notas       text,
  creado_en   timestamptz not null default now()
);

create unique index terminos_riesgo_termino_key on terminos_riesgo (lower(termino));
create index terminos_riesgo_activo_idx on terminos_riesgo (activo);

comment on table terminos_riesgo is
  'PRD-49: PARTNER DATA, deliberately empty. The distress-term list the intake matcher checks against to auto-flag a report sensible. Choosing what triggers the flag is a Red de Mujeres / ASOREDIPARCHOCÓ decision, never an engineering default — zero active rows means the matcher never fires (no false triggers). Populating this is an INSERT once the partner list arrives, never a migration.';

alter table terminos_riesgo enable row level security;
revoke all on public.terminos_riesgo from anon, authenticated;
grant select, insert, update, delete on public.terminos_riesgo to authenticated;

create policy terminos_riesgo_lectura on terminos_riesgo
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin',
                          'verificador_vulnerable']));

create policy terminos_riesgo_admin_escribe on terminos_riesgo
  for all to authenticated
  using (convite_es(array['admin']))
  with check (convite_es(array['admin']));

create table contactos_proteccion (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null references organizaciones (id),
  nombre            text not null,
  telefono          text not null,
  canal_preferido   text not null default 'whatsapp',
  activo            boolean not null default true,
  creado_en         timestamptz not null default now(),

  constraint contactos_proteccion_canal_check check (canal_preferido in ('whatsapp', 'sms')),
  constraint contactos_proteccion_telefono_e164_check
    check (telefono ~ '^\+[1-9][0-9]{7,14}$')
);

create index contactos_proteccion_organizacion_idx on contactos_proteccion (organizacion_id);

comment on table contactos_proteccion is
  'PRD-49: PARTNER DATA, deliberately empty. Who the organisation''s protection lead(s) are — where the urgent escalation alert goes. Designating these people is a partner/founder decision (echoes v3 §34''s open "who holds org_admin"), never an engineering default. The escalation mechanism is fully wired against this table with zero rows; it has nowhere to send until at least one activo row exists.';

alter table contactos_proteccion enable row level security;
revoke all on public.contactos_proteccion from anon, authenticated;
grant select, insert, update, delete on public.contactos_proteccion to authenticated;

create policy contactos_proteccion_lectura on contactos_proteccion
  for select to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and (organizacion_id = convite_organizacion() or convite_es_plataforma())
  );

create policy contactos_proteccion_admin_escribe on contactos_proteccion
  for all to authenticated
  using (
    convite_es(array['admin'])
    and (organizacion_id = convite_organizacion() or convite_es_plataforma())
  )
  with check (
    convite_es(array['admin'])
    and (organizacion_id = convite_organizacion() or convite_es_plataforma())
  );

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  Part 5 — the escalation signal
-- ════════════════════════════════════════════════════════════════════════════════════════════

create table alertas_proteccion (
  id                       uuid primary key default gen_random_uuid(),
  reporte_id               uuid not null references reportes (id) on delete cascade,
  organizacion_id          uuid not null references organizaciones (id),
  contacto_proteccion_id   uuid references contactos_proteccion (id),
  -- PRD-34 §28.1's discretion rule, applied explicitly here: the payload this row's sender may
  -- ever transmit is folio + tipo. Never join back to reportes_contenido_protegido from a sender.
  folio                    integer not null,
  canal                    text not null default 'whatsapp',
  estado                   text not null default 'pendiente',
  enviado_en               timestamptz,
  error                    text,
  creado_en                timestamptz not null default now(),

  constraint alertas_proteccion_canal_check check (canal in ('whatsapp', 'sms')),
  constraint alertas_proteccion_estado_check check (estado in ('pendiente', 'enviado', 'fallido')),
  constraint alertas_proteccion_envio_check
    check (estado <> 'enviado' or enviado_en is not null)
);

create index alertas_proteccion_reporte_idx on alertas_proteccion (reporte_id);
create index alertas_proteccion_pendiente_idx on alertas_proteccion (creado_en)
  where estado = 'pendiente';

comment on table alertas_proteccion is
  'PRD-49 §6.3: the urgent escalation signal. One row per attempt to reach a protection lead about a flagged report, written in the SAME transaction that flags it — the signal exists the instant the flag is set, never waiting on the ordinary bandeja cadence. contacto_proteccion_id is nullable: a report can be flagged (and its escalation "fired" in the bypass-the-cadence sense) with zero configured contacts; it just has nowhere to send. Delivery is a separate step — lib/verificacion/sensibles.ts — because network I/O has no place in a SQL function. No INSERT/UPDATE/DELETE grant to authenticated: writes come only from convite_marcar_reporte_sensible, intake, and the trusted (owner-connection) sender.';

alter table alertas_proteccion enable row level security;
revoke all on public.alertas_proteccion from anon, authenticated;
grant select on public.alertas_proteccion to authenticated;

create policy alertas_proteccion_lectura on alertas_proteccion
  for select to authenticated
  using (
    (
      convite_es(array['coordinador', 'admin'])
      and (organizacion_id = convite_organizacion() or convite_es_plataforma())
    )
    or convite_ve_reporte_sensible(reporte_id)
  );

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  Part 6 — flagging a report by hand
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- Mirrors convite_decidir_centro's shape (0034): a SECURITY DEFINER function is the right tool
-- because the state transition, the content move, the audit row and the escalation signal are one
-- atomic decision, and the permission check belongs in one legible place rather than spread across
-- policies that would otherwise need to see reportes_contenido_protegido to do their job. Who may
-- call it mirrors reportes_verifica (0017) — the same people who already work the general queue.
--
-- Deliberately does NOT accept a `p_motivo` argument: every call through this function is a human
-- decision, so `sensible_motivo` is always 'manual' here. The 'termino_detectado' path is intake's
-- own code (lib/canales/intake.ts), which runs with owner privileges and never routes through this
-- function — it has no auth.uid() to check permission against in the first place.

create or replace function convite_marcar_reporte_sensible(p_reporte uuid) returns text
language plpgsql security definer set search_path = public as $marcar$
declare
  uid uuid := auth.uid();
  fila reportes%rowtype;
begin
  if uid is null then
    return 'sin_sesion';
  end if;

  select * into fila from reportes where id = p_reporte for update;
  if not found then
    return 'no_existe';
  end if;

  if fila.sensible then
    return 'ya_sensible';
  end if;

  if not (
    convite_es(array['coordinador', 'admin'])
    or (convite_es(array['verificador']) and convite_alcanza_comunidad(fila.comunidad_id))
  ) then
    return 'sin_permiso';
  end if;

  insert into reportes_contenido_protegido
    (reporte_id, detalle_libre, descripcion, ubicacion, ubicacion_fuente, ubicacion_precision_m,
     contacto_id)
  values
    (p_reporte, fila.detalle_libre, fila.descripcion, fila.ubicacion, fila.ubicacion_fuente,
     fila.ubicacion_precision_m, fila.contacto_id)
  on conflict (reporte_id) do update
    set detalle_libre = excluded.detalle_libre,
        descripcion = excluded.descripcion,
        ubicacion = excluded.ubicacion,
        ubicacion_fuente = excluded.ubicacion_fuente,
        ubicacion_precision_m = excluded.ubicacion_precision_m,
        contacto_id = excluded.contacto_id;

  update reportes
     set sensible = true,
         sensible_motivo = 'manual',
         sensible_marcado_por = uid,
         sensible_marcado_en = now(),
         detalle_libre = null,
         descripcion = null,
         ubicacion = null,
         ubicacion_fuente = null,
         ubicacion_precision_m = null,
         contacto_id = null
   where id = p_reporte;

  insert into auditoria (actor_id, accion, entidad, entidad_id, despues)
    values (uid, 'reporte.marcado_sensible', 'reportes', p_reporte,
            jsonb_build_object('motivo', 'manual'));

  -- The escalation signal: one alert row per active protection-lead contact for this org, right
  -- now, in this transaction. Zero contacts configured means zero rows — the report is still
  -- flagged and still bypasses the ordinary cadence via `sensible` itself; there is simply nowhere
  -- to send yet.
  insert into alertas_proteccion (reporte_id, organizacion_id, contacto_proteccion_id, folio, canal)
  select p_reporte, fila.organizacion_id, cp.id, fila.folio, cp.canal_preferido
    from contactos_proteccion cp
   where cp.organizacion_id = fila.organizacion_id and cp.activo;

  return 'marcado';
end
$marcar$;

comment on function convite_marcar_reporte_sensible(uuid) is
  'PRD-49: a verifier/coordinador/admin flags an already-received report sensible by hand. Moves detalle_libre/descripcion/ubicacion*/contacto_id to reportes_contenido_protegido, nulls them on reportes, sets the flag with a name and a timestamp, audits it, and writes one alertas_proteccion row per active protection-lead contact for the org. Refuses a caller outside reportes_verifica''s own permission shape, and refuses an already-flagged report (idempotent no-op, not an error, so a double-click cannot lose data).';

grant execute on function convite_marcar_reporte_sensible(uuid) to authenticated;
