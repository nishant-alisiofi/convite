-- PRD-11 — Radio as a real inbound channel (the fourth channel), ingested, never operated.
--
-- Convite is NOT a radio network operator (§2): it never transmits and it does not run a net. It
-- INGESTS from a licensed community net that already exists and is already accepted. Whether such
-- a net operates in a given community, and whether keying traffic onto it is safe, is a judgement
-- about that community's real situation — so radio ingestion is OFF for every community until
-- someone with a name attests otherwise, and that attestation EXPIRES after six months and needs
-- active re-confirmation. Defaults drift closed: no attestation means no radio; a lapsed one means
-- no radio.
--
-- This migration adds two radio-only tables and the functions that gate ingestion. It changes
-- nothing on `reportes`: a relayed report is an ordinary `reportes` row tagged `canal = 'radio'`
-- (the enum has carried it since 0003), and the gated insert is done by a SECURITY DEFINER
-- function rather than by opening a broad INSERT policy on `reportes`. The `canal` value and the
-- ability to mark a report second-hand already exist; what was missing — and is added here — is
-- the per-community permission model with expiry and the two-people relay record.

-- ── The attestation: what makes radio ingestion legal for one community ──────────────────────
-- One live row per (organisation, community). `uso_seguro` is the safety half — a row may record
-- that a net exists yet that use is not safe, and that row does not permit ingestion. Re-
-- confirmation is an upsert on the unique (organizacion_id, comunidad_id): an expired attestation
-- is never silently extended, it is re-made, with a fresh `atestado_en`/`expira_en` and attestor.

create table radio_permitido (
  id               uuid primary key default gen_random_uuid(),
  -- Direct owning organisation, like `puntos_conexion` (0040): the scope is on the row, not on a
  -- join that could later be widened. RLS binds reads and writes to it.
  organizacion_id  uuid not null references organizaciones (id),
  comunidad_id     uuid not null references comunidades (id),
  -- Who confirmed. A name on the decision (2.1).
  atestado_por     uuid not null references usuarios (id),
  -- Which existing licensed net was confirmed to operate here. We ingest from it; we never run it.
  red_descrita     text not null,
  -- The safety half. Only `true` permits ingestion — drift closed.
  uso_seguro       boolean not null default false,
  atestado_en      timestamptz not null default now(),
  -- Six months on, by default. The gate reads this; a past value is simply not permitted.
  expira_en        timestamptz not null default (now() + interval '6 months'),
  -- An attestation can be pulled before it lapses. A revocation carries a name too (2.1).
  revocado_en      timestamptz,
  revocado_por     uuid references usuarios (id),
  notas            text,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),

  -- An attestation that expires before it is made is a data error, not a permission.
  constraint radio_permitido_vigencia_check check (expira_en > atestado_en),
  -- A revocation is somebody's decision, so it carries their name and its time together.
  constraint radio_permitido_revocacion_check check (
    (revocado_en is null and revocado_por is null)
    or (revocado_en is not null and revocado_por is not null)
  )
);

-- One live attestation per community, per organisation. Re-confirmation updates this row.
create unique index radio_permitido_org_comunidad_key
  on radio_permitido (organizacion_id, comunidad_id);
create index radio_permitido_comunidad_idx on radio_permitido (comunidad_id);
create index radio_permitido_organizacion_idx on radio_permitido (organizacion_id);

comment on table radio_permitido is
  'PRD-11 (§2/§5.8): per-community attestation that radio ingestion is legal and safe here. Off by default (no row = not permitted); expires after six months; a not-safe or revoked row does not permit. Convite ingests from an existing licensed net, never operates one.';
comment on column radio_permitido.uso_seguro is
  'The safety half of the attestation. Only true permits ingestion; a net may exist while use is unsafe.';
comment on column radio_permitido.expira_en is
  'Six months from the attestation by default. The gate refuses a past value — attestations are re-confirmed, never silently extended.';

create trigger radio_permitido_tocar before update on radio_permitido
  for each row execute function tocar_actualizado_en();

-- ── The relay record: the two people every radio relay carries ───────────────────────────────
-- The speaker heard on the air, and the operator who relayed and keyed it in — both recorded,
-- never one (§6, §5.8). `capturado_por` is the signed-in staff member who saved it, for system
-- accountability, and is separate from the field operator. No transcription-confidence column:
-- on radio there is no promised transcription accuracy, so the operator's typing
-- (`reportes.detalle_libre`) is the record, not a machine transcript to be scored.

create table radio_relevos (
  id               uuid primary key default gen_random_uuid(),
  -- One relay, one report. Cascades so removing a report removes its relay provenance with it.
  reporte_id       uuid not null unique references reportes (id) on delete cascade,
  organizacion_id  uuid not null references organizaciones (id),
  comunidad_id     uuid not null references comunidades (id),
  -- The person heard on the air — whose need or damage this is.
  hablante         text not null,
  -- The operator who relayed it and keyed it in, by name (they are rarely a system user).
  operador         text not null,
  -- The signed-in staff member who saved the relay. System accountability, not the operator.
  capturado_por    uuid not null references usuarios (id),
  creado_en        timestamptz not null default now(),

  -- Two people, both actually named — an empty string is not a name.
  constraint radio_relevos_hablante_check check (length(btrim(hablante)) > 0),
  constraint radio_relevos_operador_check check (length(btrim(operador)) > 0)
);

create index radio_relevos_organizacion_idx on radio_relevos (organizacion_id);
create index radio_relevos_comunidad_idx on radio_relevos (comunidad_id);

comment on table radio_relevos is
  'PRD-11 (§5.8): one row per radio-relayed report, naming the two people a relay carries — the speaker and the operator who keyed it in. Second-hand by definition, so its report always needs a human verification before it can become a pedido. Insertion is gated by radio_relevos_exige_permiso.';

-- ── The gate: is radio ingestion permitted here, right now ───────────────────────────────────
-- SECURITY DEFINER + STABLE so it reads `radio_permitido` regardless of the caller's own row
-- access, and so the answer is the same from a policy, a trigger, or the application. Defaults
-- closed on every axis: no row, not safe, revoked, or expired all return false.

create or replace function convite_radio_permitido(p_comunidad uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from radio_permitido rp
     where rp.comunidad_id = p_comunidad
       and rp.organizacion_id = p_org
       and rp.uso_seguro
       and rp.revocado_en is null
       and rp.expira_en > now()
  )
$$;

comment on function convite_radio_permitido(uuid, uuid) is
  'PRD-11: whether radio ingestion is permitted for a community in an organisation right now — a live, safe, unrevoked, unexpired attestation. Defaults closed: no row is a no.';

grant execute on function convite_radio_permitido(uuid, uuid) to authenticated;

-- The structural guarantee: a relay cannot be recorded for a community whose radio is not
-- permitted. This fires for every insert regardless of role, so even the SECURITY DEFINER path
-- below cannot slip a relay past a lapsed attestation.
create or replace function radio_relevos_exige_permiso() returns trigger
language plpgsql set search_path = public
as $$
begin
  if not convite_radio_permitido(new.comunidad_id, new.organizacion_id) then
    raise exception 'La radio no está habilitada para esta comunidad, o su atestación venció.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger radio_relevos_exige_permiso before insert on radio_relevos
  for each row execute function radio_relevos_exige_permiso();

-- ── The gated insert: how a relay actually enters ────────────────────────────────────────────
-- `reportes` has no authenticated INSERT policy (0017) — intake writes as the owner role from a
-- job. A signed-in coordinator keying in a relay therefore cannot insert directly, so this
-- SECURITY DEFINER function is the one narrow door, exactly like `vincular_usuario_staff()`. It
-- checks the caller's role and organisation, requires both people, enforces the radio gate, then
-- writes the report (canal = 'radio', second-hand) and its relay row in one statement each. The
-- report is born RECIBIDO: a relay never arrives pre-verified, and promoting it to a pedido still
-- needs a named verifier (the `reportes` invariant), which is what «second-hand always requires
-- verification» means in the database.

create or replace function registrar_relevo_radio(
  p_comunidad uuid,
  p_hablante  text,
  p_operador  text,
  p_detalle   text,
  p_tipo      text default 'sin_clasificar'
) returns table (reporte_id uuid, folio integer)
language plpgsql security definer set search_path = public
as $$
-- The OUT column `folio` shares a name with `reportes.folio`; resolve any such clash to the
-- column, so `returning id, folio into …` reads the inserted row rather than the OUT parameter.
#variable_conflict use_column
declare
  v_org     uuid := convite_organizacion();
  v_uid     uuid := auth.uid();
  v_com_org uuid;
  v_reporte uuid;
  v_folio   integer;
begin
  -- Keying in a relay is verification-desk work (§6): a reader, or a session with no staff row,
  -- cannot. A despachador dispatches; they do not create reports.
  if not convite_es(array['verificador', 'coordinador', 'admin']) then
    raise exception 'Solo verificador, coordinador o admin puede registrar un relevo de radio.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_org is null then
    raise exception 'La sesión no pertenece a ninguna organización.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The community has to be the caller's own. The relay is about a place they operate in.
  select organizacion_id into v_com_org from comunidades where id = p_comunidad;
  if v_com_org is null or v_com_org <> v_org then
    raise exception 'La comunidad no pertenece a su organización.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Two people, both named (§5.8). Checked here for a clear message; the table's own checks and
  -- the gate trigger are the backstops.
  if p_hablante is null or btrim(p_hablante) = '' then
    raise exception 'Un relevo de radio nombra a quien habló.' using errcode = 'check_violation';
  end if;
  if p_operador is null or btrim(p_operador) = '' then
    raise exception 'Un relevo de radio nombra al operador que lo transmitió.'
      using errcode = 'check_violation';
  end if;

  -- Defaults drift closed: off by default and expired are the same refusal.
  if not convite_radio_permitido(p_comunidad, v_org) then
    raise exception 'La radio no está habilitada para esta comunidad, o su atestación venció.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into reportes (organizacion_id, tipo, canal, comunidad_id, detalle_libre, payload_crudo)
  values (
    v_org,
    p_tipo,
    'radio',
    p_comunidad,
    nullif(btrim(p_detalle), ''),
    jsonb_build_object('segunda_mano', true, 'hablante', p_hablante, 'relatado_por', p_operador)
  )
  returning id, folio into v_reporte, v_folio;

  insert into radio_relevos
    (reporte_id, organizacion_id, comunidad_id, hablante, operador, capturado_por)
  values (v_reporte, v_org, p_comunidad, p_hablante, p_operador, v_uid);

  return query select v_reporte, v_folio;
end;
$$;

comment on function registrar_relevo_radio(uuid, text, text, text, text) is
  'PRD-11 (§5.8): the one door a signed-in coordinator uses to key in a radio relay. Checks role, organisation, the two people, and the radio gate, then writes a canal=radio, second-hand report (born RECIBIDO) plus its relay row. Promotion to a pedido still needs a named verifier.';

grant execute on function registrar_relevo_radio(uuid, text, text, text, text) to authenticated;

-- ── RLS floor first, exactly as 0040/0043 do it ──────────────────────────────────────────────
-- Enable, revoke, grant back, so a half-finished policy set fails towards "staff cannot read"
-- rather than "anon can". Note: the report-writing path above is the SECURITY DEFINER function,
-- so these policies do NOT need to grant a direct INSERT to satisfy the app.

alter table radio_permitido enable row level security;
revoke all on public.radio_permitido from anon, authenticated;
grant select, insert, update, delete on public.radio_permitido to authenticated;

alter table radio_relevos enable row level security;
revoke all on public.radio_relevos from anon, authenticated;
grant select, insert, update, delete on public.radio_relevos to authenticated;

-- Read the attestation: any signed-in staff role, within their own organisation (a platform
-- admin reaches across for reads, as elsewhere). The community needs to know whether its radio
-- is on, and until when.
create policy radio_permitido_lectura on radio_permitido
  for select to authenticated
  using (
    convite_es(array['verificador', 'despachador', 'coordinador', 'admin'])
    and (organizacion_id = convite_organizacion() or convite_es_plataforma())
  );

-- Attest, re-confirm and revoke: a coordinator's decision. Deciding a net exists and that use is
-- safe is not a reader's call, and it is not a dispatcher's. Enforced with `with check` too, so a
-- row can neither be created for, nor moved to, another organisation.
create policy radio_permitido_coordina on radio_permitido
  for all to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
  )
  with check (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
  );

-- Read a relay: the verification desk, within their own organisation. This is where a relayed
-- report is read against its two people before anyone believes it.
create policy radio_relevos_lectura on radio_relevos
  for select to authenticated
  using (
    convite_es(array['verificador', 'despachador', 'coordinador', 'admin'])
    and (organizacion_id = convite_organizacion() or convite_es_plataforma())
  );

-- A direct write policy is intentionally NOT created: relays enter only through
-- registrar_relevo_radio() (SECURITY DEFINER), which is the gate. Leaving authenticated without
-- an INSERT/UPDATE policy means a direct insert is refused, so the door is the only door.
