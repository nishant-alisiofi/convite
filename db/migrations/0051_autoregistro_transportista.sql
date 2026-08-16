-- FR-18 (PRD v3 §29.2–29.3b) — a transporter self-registers as an APORTANTE (the supply side).
--
-- The decision FR-18 raised is resolved by v3's participant model, and it lands where the RBAC
-- threat model already stood: a transporter who merely OFFERS capacity is aportante-shaped —
-- near-immediate, touches no community data, never sees a household address. A transporter who
-- must see exact addresses ON A RUN is the vetted `transportista_avalado` tier (0048's
-- `convite_conduce_hacia` window), which this migration does NOT touch and does NOT grant.
--
-- What this makes real, built ADDITIVELY on the possession sign-in (0035) and the membership /
-- admission engine (0047):
--
--   * A public self-signup path lands the person as an aportante: their own aportante
--     organisation (nivel_admision = 'aportante'), an EMPTY capability ceiling (techo_permisos
--     defaults to '{}'), and a `lectura` staff row. `lectura` is deliberate — it is the one role
--     that appears in NONE of the sensitive read policies in 0017/0030, so a self-signed
--     transporter reads no PII, no coordinate and no household address by construction. The empty
--     ceiling means `convite_puede('direcciones_hogar')` is false as well: both the role gate
--     (0017) and the ceiling gate (0047) deny address access. Not one existing policy is weakened.
--
--   * A supply-side capacity-offer table (`ofertas_transporte`) an aportante can write for
--     themselves. It holds NO community data — no comunidad, no nodo, no coordinate, no household
--     address — only a free-text coverage area, a mode, a family capacity and an availability
--     window. That is exactly the aportante invariant §29.3b encodes ("offers … capacity … touches
--     no community data — supply side only"), so the offer surface cannot become an address leak.
--
-- What this migration deliberately does NOT do:
--   * It does NOT re-gate or weaken sign-in, and it does NOT touch `vincular_usuario_staff()`
--     (0035). The default open sign-in still lands an uninvited person as a home-org admin; the
--     aportante path is a SEPARATE entry (its own SECURITY DEFINER function + its own callback
--     route) so a transporter never falls into the admin default.
--   * It does NOT modify any 0017/0030 policy, any grant, or the transporter time-window in 0048.
--     The address boundary is untouched; everything here is a new table, its own RLS, and one new
--     function.

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  Part 1 — the supply-side capacity offer (§29.1: offering has always been the frictionless side)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- A transporter offering transport capacity. Distinct from `capacidades` (0004), which is the
-- DISPATCH-side record — it references a nodo and a comunidad (community data) and is written by a
-- despachador planning a run. This table is the OFFER: an aportante says "I can move N families
-- around this area, by this mode, in this window", and it carries nothing that could point at a
-- vulnerable household. `area_cobertura` is deliberately free text at municipality / corridor
-- granularity (e.g. «Quibdó – Bojayá por el Atrato»); it is not, and must never become, a stored
-- coordinate or a household address.

create table ofertas_transporte (
  id                  uuid primary key default gen_random_uuid(),
  usuario_id          uuid not null references usuarios (id) on delete cascade,
  organizacion_id     uuid not null references organizaciones (id),
  modo                text not null,
  -- Free-text corridor / area the offer covers. Coarse by design (municipality or river
  -- corridor), never a coordinate or a household address — the aportante tier holds no community
  -- data (§29.3b), and this column is the reason the offer surface stays on the safe side of 2.16.
  area_cobertura      text not null,
  -- The "seats" analogue, in families, matching capacidades.cupo_familias.
  cupo_familias       integer not null,
  disponible_desde    timestamptz,
  disponible_hasta    timestamptz,
  notas               text,
  estado              text not null default 'OFRECIDA',
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),

  constraint ofertas_transporte_modo_check
    check (modo in ('lancha', 'chalupa', 'carretera', 'trocha', 'avioneta')),
  constraint ofertas_transporte_estado_check
    check (estado in ('OFRECIDA', 'RETIRADA')),
  constraint ofertas_transporte_cupo_check check (cupo_familias > 0),
  constraint ofertas_transporte_ventana_check
    check (disponible_hasta is null or disponible_desde is null
           or disponible_hasta > disponible_desde)
);

comment on table ofertas_transporte is
  'FR-18 (§29.3b): transport capacity OFFERED by an aportante (supply side). Holds no community data — no comunidad, nodo, coordinate or household address — only a coarse free-text coverage area. The vetted, address-seeing side of transport is transportista_avalado + convite_conduce_hacia (0048), which this does not touch.';
comment on column ofertas_transporte.area_cobertura is
  'FR-18: coarse coverage corridor (municipality / river), free text. Never a coordinate or a household address — the aportante tier touches no community data.';

create index ofertas_transporte_organizacion_idx on ofertas_transporte (organizacion_id);
create index ofertas_transporte_usuario_idx on ofertas_transporte (usuario_id);
create index ofertas_transporte_estado_idx on ofertas_transporte (estado);

create trigger ofertas_transporte_tocar before update on ofertas_transporte
  for each row execute function tocar_actualizado_en();

-- ── RLS: an aportante manages their OWN offers; dispatch reads offered capacity to use it ──────
--
-- Same order as every table in 0007/0017/0047: enable, revoke everything, grant back exactly what
-- the policies need, so a half-finished policy set fails towards «nobody reads» rather than «anon
-- reads». `anon` gets nothing — the esquema test asserts anon reaches only mapa_publico.

alter table ofertas_transporte enable row level security;
revoke all on public.ofertas_transporte from anon, authenticated;
grant select, insert, update, delete on public.ofertas_transporte to authenticated;

-- The aportante owns their offers: they may read and write only rows that are theirs. This is the
-- capacity-offer ability FR-18 grants — available to a plain `lectura` self-signed transporter,
-- because it is keyed to auth.uid(), not to a PII role.
create policy ofertas_transporte_propias on ofertas_transporte
  for all to authenticated
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

-- Dispatch-side staff read offered capacity so it can actually be put to use. Nothing sensitive
-- lives here (no community data), so a coordinator/despachador/admin — or the platform — reads it
-- like any other supply signal. This is role-based, exactly like capacidades_lectura (0017).
create policy ofertas_transporte_operacion on ofertas_transporte
  for select to authenticated
  using (convite_es(array['despachador', 'coordinador', 'admin']) or convite_es_plataforma());

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  Part 2 — the aportante self-signup (§29.3b: the supply side is the genuinely open tier)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- SECURITY DEFINER, because it writes organizaciones and usuarios, which `authenticated` cannot
-- (0017 grants SELECT on organizaciones only, and usuarios is written by the owner-role linking
-- path). It runs AFTER possession is proven — the caller already has a Better Auth session, so
-- auth.uid() is their verified identity — and it is the aportante analogue of
-- vincular_usuario_staff(): possession alone is enough to offer capacity, but the person lands as
-- a supply-side aportante, never as a home-org admin and never with address access.
--
-- The safety argument, in one place:
--   * role = 'lectura'         → appears in NO sensitive 0017/0030 policy: no PII, no ofertas, no
--                                pedidos, no comunidades detail, no capacidades, no address.
--   * nivel_admision='aportante', techo_permisos = '{}' (default, empty) → convite_puede(*) is
--                                false for everything, so the ceiling gate denies direcciones_hogar
--                                too. Both gates say no.
--   * a lectura member cannot administer memberships (convite_administra_org needs admin), so the
--     aportante cannot self-escalate.

create or replace function convite_autoregistrar_aportante() returns text
language plpgsql security definer set search_path = public as $auto$
declare
  uid uuid := auth.uid();
  correo_sesion text := correo_normalizado(coalesce(auth.jwt() ->> 'email', ''));
  telefono_sesion text := nullif(trim(coalesce(auth.jwt() ->> 'telefono', '')), '');
  nombre_org text;
  org_id uuid;
begin
  if uid is null then
    return 'sin_sesion';
  end if;

  -- One person, one staff row. If they are already staff (invited, an existing coordinator who
  -- also drives, or a prior aportante), keep their identity untouched — never downgrade an
  -- existing account, and stay idempotent if the callback runs twice.
  if exists (select 1 from usuarios u where u.id = uid) then
    return 'ya_existe';
  end if;

  -- A stable, unique name for the aportante organisation. Derived from the proven identity so it
  -- is legible, suffixed with the auth id so the organizaciones.nombre unique index can never
  -- collide (two auth identities for the same person still get distinct rows).
  nombre_org := 'Aportante de transporte · '
    || coalesce(telefono_sesion, nullif(correo_sesion, ''), 'sin contacto')
    || ' [' || uid::text || ']';

  -- The aportante organisation: supply side only. techo_permisos is left at its default '{}', so
  -- the ceiling grants nothing — no household addresses, no community reach (§29.3b / §29.4).
  insert into organizaciones (nombre, tipo, nivel_admision, estado_aprobacion, activo)
    values (nombre_org, 'transportista', 'aportante', 'aprobada', true)
  returning id into org_id;

  -- The staff row. `lectura` is the role that sees nothing sensitive; the reflect trigger from
  -- 0047 mirrors it into `membresias` as a lectura membership automatically.
  insert into usuarios (id, rol_staff, organizacion_id, es_plataforma)
    values (uid, 'lectura', org_id, false);

  insert into auditoria (actor_id, accion, entidad, entidad_id, despues)
    values (uid, 'usuario.autoregistro_aportante', 'usuarios', uid,
            jsonb_build_object(
              'rol_staff', 'lectura',
              'organizacion_id', org_id,
              'nivel_admision', 'aportante',
              'via', case when telefono_sesion is not null then 'whatsapp' else 'correo' end));

  return 'creado';
end
$auto$;

comment on function convite_autoregistrar_aportante() is
  'FR-18 (§29.3b): self-signup for a transporter offering capacity. Requires a proven session (auth.uid()); if the caller is already staff it no-ops (ya_existe). Otherwise it creates the caller''s own aportante organisation (empty ceiling — no addresses, no community reach) and a lectura staff row. lectura + empty ceiling means both the role gate (0017) and the ceiling gate (0047) deny household-address access. Does not touch vincular_usuario_staff() or any existing policy.';

grant execute on function convite_autoregistrar_aportante() to authenticated;
