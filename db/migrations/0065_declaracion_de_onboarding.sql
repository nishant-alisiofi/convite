-- What an organisation says about itself, asked once before it reaches the panel.
--
-- Until now an organisation arrived through /solicitar-centro with four fields — name, a
-- contact, the requester's name, and a free-text `detalle` that is written into an `auditoria`
-- blob and never read again — and then landed straight on /tablero. Everything the product
-- needed to know about it was either inferred later or asked of nobody. These five columns are
-- the questions, asked once, at the only moment the answers are cheap.
--
-- They are DECLARATIONS, not grants. `techo_permisos` (0042/0047) is the ceiling an approver
-- imposes and it stays exactly as it is; nothing here widens what an organisation may do. An
-- organisation saying «transporte» does not acquire despatch — it tells us which questions to
-- ask next and which two thirds of the panel are noise for them.
--
--   intenciones     — what they are here to do. Several, because real organisations do several.
--   herramientas    — what they already work in. PRD-34 §28.3 has said «ask what exists before
--                     designing anything» since August and nothing ever asked; this is the ask.
--   fase            — §18's response phase, stored for the first time. It has existed as a
--                     TypeScript union and a `?fase=` parameter nobody emitted, which is why
--                     §18's «phase decides what the Bandeja leads with» was never buildable.
--                     Per organisation, not global: two organisations on the same river are
--                     routinely in different phases, and one global value would force one of
--                     them to lie.
--   alcance_rural   — whether they need to reach communities off the road network. This is the
--                     single answer that changes the most downstream: PMTiles bundles (PRD-13),
--                     the adaptive channel policy (PRD-15 §20), radio and lanchero relay.
--                     Nullable because «not asked yet» and «no» are different facts.
--   onboarding_completado_en — set once, when the flow is finished. Null is the gate.
--
-- Deliberately columns rather than `configuracion` rows (the shape PRD-36 used for its two
-- acknowledgements): these are queried — «which organisations in emergencia need rural reach»
-- is a question we will ask — and a key-value table answers it only with casts and faith.

alter table organizaciones add column intenciones text[] not null default '{}';
alter table organizaciones add column herramientas text[] not null default '{}';
alter table organizaciones add column fase text;
alter table organizaciones add column alcance_rural boolean;
alter table organizaciones add column onboarding_completado_en timestamptz;

-- Vocabulary enforced with `<@` rather than a per-element trigger: containment against a
-- literal array is one index-free comparison, it rejects the whole write rather than silently
-- keeping the valid half, and adding a seventh intention stays a one-line ALTER. Mirrors how
-- TIPOS_ORGANIZACION is handled — text + check, never an enum type, so the vocabulary can grow
-- without a lock on every row.
alter table organizaciones add constraint organizaciones_intenciones_check
  check (intenciones <@ array['donaciones', 'materiales', 'servicios', 'transporte', 'reportes', 'coordinacion']::text[]);

alter table organizaciones add constraint organizaciones_herramientas_check
  check (herramientas <@ array['whatsapp', 'google_drive', 'google_sheets', 'google_calendar', 'excel', 'radio', 'papel', 'ninguna']::text[]);

alter table organizaciones add constraint organizaciones_fase_check
  check (fase is null or fase in ('impacto', 'emergencia', 'recuperacion', 'ordinario'));

-- A finished onboarding has to have answered something. Without this the flow could mark
-- itself complete on an empty form and the gate would let everyone through for ever after —
-- the failure mode of every onboarding that is technically present and practically skipped.
alter table organizaciones add constraint organizaciones_onboarding_completo_check
  check (
    onboarding_completado_en is null
    or (cardinality(intenciones) > 0 and fase is not null and alcance_rural is not null)
  );

comment on column organizaciones.intenciones is
  'What the organisation says it is here to do (donaciones/materiales/servicios/transporte/reportes/coordinacion). A declaration that routes the product, never a grant — techo_permisos remains the only ceiling.';
comment on column organizaciones.herramientas is
  'The tools the organisation already works in. Asked so PRD-34 §28.3 (import >= export) can be built against what partners actually use. `ninguna` is a real answer — a council on paper is the case the product exists for.';
comment on column organizaciones.fase is
  'The response phase this organisation is operating in (§18). Per organisation, not global: two organisations on the same river are routinely in different phases.';
comment on column organizaciones.alcance_rural is
  'Whether this organisation needs to reach communities off the road network. Null = not asked yet, which is a different fact from false. Drives offline map bundles (PRD-13) and the adaptive channel policy (PRD-15 §20).';
comment on column organizaciones.onboarding_completado_en is
  'When the declaration flow was completed. Null gates an admin into /comenzar before the panel.';

-- Answering is an admin act on one's own organisation, and it is the narrowest possible write:
-- these five columns and nothing else. `organizaciones_admin_escribe` (0017) is a for-all
-- policy scoped to the admin's own org, so the write is already permitted and already scoped —
-- this function exists for the audit row and to keep the column list in one place, the same
-- shape as convite_fijar_nivel_admision (0047).
create or replace function convite_declarar_organizacion(
  p_intenciones text[],
  p_herramientas text[],
  p_fase text,
  p_alcance_rural boolean
) returns void
language plpgsql
security invoker
as $$
declare
  v_org uuid := convite_organizacion();
  v_antes jsonb;
begin
  if not convite_es(array['admin']) then
    raise exception 'solo un admin declara la organización';
  end if;
  if v_org is null then
    raise exception 'sin organización en la sesión';
  end if;
  if coalesce(cardinality(p_intenciones), 0) = 0 then
    raise exception 'hay que decir al menos para qué está la organización';
  end if;

  -- Captured before the update: an organisation may run this again to change its answers
  -- (a response moves from emergencia to recuperación, and saying so is the point), so the
  -- audit row has to carry what it said last time, not only what it says now.
  select jsonb_build_object(
           'intenciones', to_jsonb(o.intenciones),
           'herramientas', to_jsonb(o.herramientas),
           'fase', o.fase,
           'alcance_rural', o.alcance_rural,
           'onboarding_completado_en', o.onboarding_completado_en
         )
    into v_antes
    from organizaciones o
   where o.id = v_org;

  update organizaciones
     set intenciones = p_intenciones,
         herramientas = coalesce(p_herramientas, '{}'),
         fase = p_fase,
         alcance_rural = p_alcance_rural,
         onboarding_completado_en = now()
   where id = v_org;

  insert into auditoria (actor_id, accion, entidad, entidad_id, antes, despues)
  values (
    auth.uid(), 'organizacion.declarada', 'organizaciones', v_org, v_antes,
    jsonb_build_object(
      'intenciones', to_jsonb(p_intenciones),
      'herramientas', to_jsonb(coalesce(p_herramientas, '{}'::text[])),
      'fase', p_fase,
      'alcance_rural', p_alcance_rural
    )
  );
end;
$$;

comment on function convite_declarar_organizacion is
  'Records an organisation''s onboarding declaration and stamps it complete. Admin-only, own organisation only, audited. Widens no permission — techo_permisos is untouched.';
