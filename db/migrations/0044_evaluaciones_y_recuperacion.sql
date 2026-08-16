-- PRD-29 — Assessments and recovery (levels 2–4, coverage, bill of materials).
--
-- Level 1 (the `reporte`) is built. This migration plants levels 2–4:
--
--   Level 2 — a verified damage finding becomes a bill of materials (materiales + transporte +
--             mano de obra en días + asistencia técnica), proposed from a template and adjusted by
--             the técnico. It is the link that lets Apadrinar (PRD-12) price and fund a house.
--   Level 3 — the assessment sweep: a surveyor records every in-scope item, not only those that
--             reported. Provenance is a visitor with a date; findings expire.
--   Level 4 — coverage aggregated by vereda and municipality: assessed out of estimated total,
--             with its date. The application code (lib/evaluaciones.ts) does the aggregation; the
--             schema gives it an honest denominator (evaluaciones.total_estimado) and date
--             (evaluaciones.fecha_visita) that both come from the visit that produced them.
--
-- Four tables, all org-scoped like every operational table (0017/0030/0041/0043). The Drizzle
-- mirror is db/schema/evaluaciones.ts; `pnpm db:check` diffs the two. Two rules the schema holds:
--
--   * Response route (§6.2/§17.4): every finding carries `via_de_respuesta`. A `derivacion` names
--     the mandate it goes to and never enters despacho (it is not cargo); the check refuses a
--     derivación with no destino, and a non-derivación that carries one.
--   * Audit (2.1): every write to any of the four tables lands an immutable row in `auditoria`
--     with the actor, action, entity and before/after — the same shape `auditar_apadrinamiento`
--     uses (0041), and for the same reason (a write from a script or psql is recorded too).
--
-- Depends on: organizaciones (0001), comunidades (0001), usuarios (0016), reportes (0003),
-- jornadas (0043), auditoria (0005), and the helpers convite_es / convite_organizacion /
-- convite_es_plataforma (0016), tocar_actualizado_en + auth.uid (0000). All present by 0044.

-- ── plantillas_evaluacion — the multi-domain templates (§21, AC #1/#5) ──────────────────────────
-- A template names a domain and proposes the baseline four components for a repair at severity 2
-- (the reference severity a verified `93` at severity 2 is written against). Application code
-- scales the baseline by the finding's severity and the técnico edits the result.

create table plantillas_evaluacion (
  id                    uuid primary key default gen_random_uuid(),
  organizacion_id       uuid not null references organizaciones (id),
  dominio               text not null,
  codigo                text not null,
  nombre                text not null,
  descripcion           text,
  -- Baseline amounts at severity 2. COP for the three cost components, days for local labour.
  materiales_cop        bigint not null default 0,
  transporte_cop        bigint not null default 0,
  asistencia_tecnica_cop bigint not null default 0,
  mano_de_obra_dias     integer not null default 0,
  activa                boolean not null default true,
  creado_por            uuid references usuarios (id),
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now(),

  constraint plantillas_evaluacion_dominio_check
    check (dominio in ('vivienda', 'educacion', 'salud', 'agua', 'ambiente', 'organizacional')),
  constraint plantillas_evaluacion_materiales_check check (materiales_cop >= 0),
  constraint plantillas_evaluacion_transporte_check check (transporte_cop >= 0),
  constraint plantillas_evaluacion_asistencia_check check (asistencia_tecnica_cop >= 0),
  constraint plantillas_evaluacion_mano_de_obra_check check (mano_de_obra_dias >= 0)
);

-- One code per organisation; the same code may exist under a different centre.
create unique index plantillas_evaluacion_codigo_key
  on plantillas_evaluacion (organizacion_id, codigo);
create index plantillas_evaluacion_organizacion_idx on plantillas_evaluacion (organizacion_id);
create index plantillas_evaluacion_dominio_idx on plantillas_evaluacion (dominio);

comment on table plantillas_evaluacion is
  'PRD-29 (§21): multi-domain assessment templates. Each proposes the baseline four-component repair (materiales/transporte/asistencia técnica in COP, mano de obra en días) at severity 2; generarBom scales by severity and the técnico edits it.';

-- ── evaluaciones — the assessment sweep (§21 Level 3, AC #2/#3) ──────────────────────────────────
-- One sweep = a visit to one community, for one domain, on a date. It carries the provenance its
-- findings inherit (evaluador + fecha_visita) and the expiry beyond which the assessment is stale.
-- total_estimado is the coverage denominator; the assessed count is the number of findings against
-- the sweep. Coverage is per (community, domain) — housing coverage is not water coverage.

create table evaluaciones (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null references organizaciones (id),
  comunidad_id      uuid not null references comunidades (id),
  dominio           text not null,
  -- §22: the `evaluacion` jornada this sweep belongs to, when it was planned as one.
  jornada_id        uuid references jornadas (id),
  -- The visitor. Light identity by name — the offline `evaluador` login is §29.3/PRD-13, not here.
  evaluador_nombre  text not null,
  fecha_visita      date not null,
  -- In-scope items the surveyor estimates at this place (coverage denominator).
  total_estimado    integer not null,
  -- When this sweep's findings go stale. A finding expires; it is not a permanent truth.
  vence_en          date,
  -- Who recorded it (2.1). Signed against auth.uid() by the insert policy.
  registrado_por    uuid references usuarios (id),
  notas             text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  constraint evaluaciones_dominio_check
    check (dominio in ('vivienda', 'educacion', 'salud', 'agua', 'ambiente', 'organizacional')),
  constraint evaluaciones_total_check check (total_estimado > 0),
  -- An assessment that expires before it happened is a data error.
  constraint evaluaciones_vence_check check (vence_en is null or vence_en >= fecha_visita)
);

create index evaluaciones_organizacion_idx on evaluaciones (organizacion_id);
create index evaluaciones_comunidad_idx on evaluaciones (comunidad_id);
create index evaluaciones_dominio_idx on evaluaciones (dominio);
create index evaluaciones_jornada_idx on evaluaciones (jornada_id);

comment on table evaluaciones is
  'PRD-29 (§21 Level 3): one assessment sweep — a visit to a community for a domain on a date. Carries the provenance (evaluador + fecha) its findings inherit and the expiry beyond which it is stale. total_estimado is the coverage denominator; the assessed count is findings against the sweep.';
comment on column evaluaciones.total_estimado is
  'In-scope items the surveyor estimates at this place. Coverage = assessed (findings against this sweep) / total_estimado, dated by fecha_visita. Assessed out of estimated total is not damage count (§21).';

-- ── evaluacion_hallazgos — the findings (§21, AC #2/#6) ──────────────────────────────────────────
-- A finding comes from a sweep (Level 3, evaluacion_id), from a verified damage report (Level 2,
-- reporte_id), or is entered directly against a community. Every finding carries via_de_respuesta:
-- convite (matchable), derivacion (another mandate, surfaced in Derivaciones, never despacho),
-- sin_via (recorded, never queued). A finding in a sweep inherits its provenance and expiry.

create table evaluacion_hallazgos (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null references organizaciones (id),
  -- The sweep this finding was recorded in (Level 3), if any. Cascades with the sweep.
  evaluacion_id     uuid references evaluaciones (id) on delete cascade,
  -- The verified damage report this finding was raised from (Level 2), if any.
  reporte_id        uuid references reportes (id),
  comunidad_id      uuid not null references comunidades (id),
  dominio           text not null,
  descripcion       text not null,
  -- Damage severity 1–3, mirroring reportes.severidad. Null for a non-damage finding.
  severidad         smallint,
  via_de_respuesta  text not null default 'convite',
  -- The organisation/mandate a `derivacion` finding goes to. Required iff via = derivacion.
  derivacion_destino text,
  -- Who recorded it (2.1). Signed against auth.uid() by the insert policy.
  registrado_por    uuid references usuarios (id),
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  constraint evaluacion_hallazgos_dominio_check
    check (dominio in ('vivienda', 'educacion', 'salud', 'agua', 'ambiente', 'organizacional')),
  constraint evaluacion_hallazgos_severidad_check
    check (severidad is null or severidad between 1 and 3),
  constraint evaluacion_hallazgos_via_check
    check (via_de_respuesta in ('convite', 'derivacion', 'sin_via')),
  -- A derivación names the mandate it goes to; anything else carries no destino (§17.4).
  constraint evaluacion_hallazgos_derivacion_check
    check (
      (via_de_respuesta = 'derivacion' and derivacion_destino is not null)
      or (via_de_respuesta <> 'derivacion' and derivacion_destino is null)
    )
);

create index evaluacion_hallazgos_organizacion_idx on evaluacion_hallazgos (organizacion_id);
create index evaluacion_hallazgos_evaluacion_idx on evaluacion_hallazgos (evaluacion_id);
create index evaluacion_hallazgos_reporte_idx on evaluacion_hallazgos (reporte_id);
create index evaluacion_hallazgos_comunidad_idx on evaluacion_hallazgos (comunidad_id);
create index evaluacion_hallazgos_via_idx on evaluacion_hallazgos (via_de_respuesta);

comment on table evaluacion_hallazgos is
  'PRD-29 (§21): an assessment finding, from a sweep (Level 3), a verified report (Level 2) or entered directly. via_de_respuesta routes it: convite (matchable), derivacion (another mandate, never despacho), sin_via (recorded, never queued).';
comment on column evaluacion_hallazgos.via_de_respuesta is
  'convite = matchable, can be costed and dispatched. derivacion = another mandate, surfaced in Derivaciones (§6.2), never enters despacho. sin_via = recorded, never queued.';

-- ── hallazgo_bom — the four-component repair estimate (§21, AC #1/#4/#7) ─────────────────────────
-- Materiales, transporte and asistencia técnica are COP costs; mano de obra local is a supply side
-- — days required, matched by days committed, never a peso line. Each component records required
-- and covered, so an unmet component is legible and feeds the Bandeja stuck-states (AC #4). The
-- fundable amount a sponsor prices against (AC #7) is the sum of the three COP components. One BoM
-- per finding.

create table hallazgo_bom (
  id                            uuid primary key default gen_random_uuid(),
  hallazgo_id                   uuid not null references evaluacion_hallazgos (id) on delete cascade,
  organizacion_id               uuid not null references organizaciones (id),
  origen                        text not null default 'manual',
  -- The template the estimate was proposed from, if any.
  plantilla_id                  uuid references plantillas_evaluacion (id),
  materiales_cop                bigint not null default 0,
  transporte_cop                bigint not null default 0,
  asistencia_tecnica_cop        bigint not null default 0,
  mano_de_obra_dias             integer not null default 0,
  materiales_cubierto_cop       bigint not null default 0,
  transporte_cubierto_cop       bigint not null default 0,
  asistencia_tecnica_cubierto_cop bigint not null default 0,
  mano_de_obra_cubierta_dias    integer not null default 0,
  editado_por                   uuid references usuarios (id),
  creado_en                     timestamptz not null default now(),
  actualizado_en                timestamptz not null default now(),

  constraint hallazgo_bom_origen_check check (origen in ('plantilla', 'manual')),
  constraint hallazgo_bom_materiales_check
    check (materiales_cop >= 0 and materiales_cubierto_cop >= 0),
  constraint hallazgo_bom_transporte_check
    check (transporte_cop >= 0 and transporte_cubierto_cop >= 0),
  constraint hallazgo_bom_asistencia_check
    check (asistencia_tecnica_cop >= 0 and asistencia_tecnica_cubierto_cop >= 0),
  constraint hallazgo_bom_mano_de_obra_check
    check (mano_de_obra_dias >= 0 and mano_de_obra_cubierta_dias >= 0)
);

-- One bill of materials per finding.
create unique index hallazgo_bom_hallazgo_key on hallazgo_bom (hallazgo_id);
create index hallazgo_bom_organizacion_idx on hallazgo_bom (organizacion_id);
create index hallazgo_bom_plantilla_idx on hallazgo_bom (plantilla_id);

comment on table hallazgo_bom is
  'PRD-29 (§21): the four-component repair estimate for a matchable finding. materiales/transporte/asistencia técnica in COP; mano de obra local in días (a supply side, not a cost). required + covered per component makes an unmet component legible (AC #4); the three COP components are the fundable cost Apadrinar prices against (AC #7).';
comment on column hallazgo_bom.mano_de_obra_dias is
  'Local labour required, in days. A supply side (§21): matched by mano_de_obra_cubierta_dias (days committed), never funded as a peso line.';

-- ── Audit trigger ───────────────────────────────────────────────────────────────────────────────
-- A trigger, not an application write, so a change from a script, psql or a future screen is
-- recorded the same way (2.1). SECURITY DEFINER so it can write `auditoria` regardless of the
-- caller's grants — the same shape as auditar_apadrinamiento (0041). `auditoria` has no UPDATE or
-- DELETE policy (0017), so what lands here cannot be edited afterwards.

create or replace function auditar_evaluacion() returns trigger
language plpgsql security definer set search_path = public
as $auditar$
begin
  -- A write that changes nothing is not a decision worth a row.
  if tg_op = 'UPDATE' and to_jsonb(old) is not distinct from to_jsonb(new) then
    return new;
  end if;

  insert into auditoria (actor_id, accion, entidad, entidad_id, antes, despues)
  values (
    auth.uid(),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(new.id, old.id),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end
$auditar$;

comment on function auditar_evaluacion() is
  'Non-negotiable 2.1 for assessments: who created/changed a template, sweep, finding or bill of materials, from what to what, and when. Writes an immutable auditoria row on every insert/update.';

create trigger plantillas_evaluacion_auditar
  after insert or update on plantillas_evaluacion
  for each row execute function auditar_evaluacion();
create trigger plantillas_evaluacion_tocar before update on plantillas_evaluacion
  for each row execute function tocar_actualizado_en();

create trigger evaluaciones_auditar
  after insert or update on evaluaciones
  for each row execute function auditar_evaluacion();
create trigger evaluaciones_tocar before update on evaluaciones
  for each row execute function tocar_actualizado_en();

create trigger evaluacion_hallazgos_auditar
  after insert or update on evaluacion_hallazgos
  for each row execute function auditar_evaluacion();
create trigger evaluacion_hallazgos_tocar before update on evaluacion_hallazgos
  for each row execute function tocar_actualizado_en();

create trigger hallazgo_bom_auditar
  after insert or update on hallazgo_bom
  for each row execute function auditar_evaluacion();
create trigger hallazgo_bom_tocar before update on hallazgo_bom
  for each row execute function tocar_actualizado_en();

-- ── RLS floor ────────────────────────────────────────────────────────────────────────────────────
-- Same order as 0041/0043: enable, revoke everything, grant back exactly what the policies allow,
-- so a half-finished policy set fails towards «staff cannot read» rather than «anon can». Any
-- signed-in operational role reads within its own organisation (a platform admin reaches across
-- organisations for reads, 0034/0041). Recording a sweep or a finding is field work, so a
-- verificador may write those; templates and the bill of materials are costing/coordination work,
-- so they are coordinador + admin. Every insert is signed against auth.uid().

alter table plantillas_evaluacion enable row level security;
revoke all on public.plantillas_evaluacion from anon, authenticated;
grant select, insert, update on public.plantillas_evaluacion to authenticated;

alter table evaluaciones enable row level security;
revoke all on public.evaluaciones from anon, authenticated;
grant select, insert, update on public.evaluaciones to authenticated;

alter table evaluacion_hallazgos enable row level security;
revoke all on public.evaluacion_hallazgos from anon, authenticated;
grant select, insert, update on public.evaluacion_hallazgos to authenticated;

alter table hallazgo_bom enable row level security;
revoke all on public.hallazgo_bom from anon, authenticated;
grant select, insert, update on public.hallazgo_bom to authenticated;

-- plantillas_evaluacion: read any operational role, write coordinador/admin, insert signed.
create policy plantillas_evaluacion_lectura on plantillas_evaluacion
  for select to authenticated
  using (
    convite_es(array['verificador', 'despachador', 'coordinador', 'admin'])
    and (organizacion_id = convite_organizacion() or convite_es_plataforma())
  );

create policy plantillas_evaluacion_agrega on plantillas_evaluacion
  for insert to authenticated
  with check (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
    and creado_por = auth.uid()
  );

create policy plantillas_evaluacion_actualiza on plantillas_evaluacion
  for update to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
  )
  with check (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
  );

-- evaluaciones: read any operational role, write coordinador/verificador/admin, insert signed.
create policy evaluaciones_lectura on evaluaciones
  for select to authenticated
  using (
    convite_es(array['verificador', 'despachador', 'coordinador', 'admin'])
    and (organizacion_id = convite_organizacion() or convite_es_plataforma())
  );

create policy evaluaciones_agrega on evaluaciones
  for insert to authenticated
  with check (
    convite_es(array['verificador', 'coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
    and registrado_por = auth.uid()
  );

create policy evaluaciones_actualiza on evaluaciones
  for update to authenticated
  using (
    convite_es(array['verificador', 'coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
  )
  with check (
    convite_es(array['verificador', 'coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
  );

-- evaluacion_hallazgos: same boundary as sweeps — a surveyor records findings.
create policy evaluacion_hallazgos_lectura on evaluacion_hallazgos
  for select to authenticated
  using (
    convite_es(array['verificador', 'despachador', 'coordinador', 'admin'])
    and (organizacion_id = convite_organizacion() or convite_es_plataforma())
  );

create policy evaluacion_hallazgos_agrega on evaluacion_hallazgos
  for insert to authenticated
  with check (
    convite_es(array['verificador', 'coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
    and registrado_por = auth.uid()
  );

create policy evaluacion_hallazgos_actualiza on evaluacion_hallazgos
  for update to authenticated
  using (
    convite_es(array['verificador', 'coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
  )
  with check (
    convite_es(array['verificador', 'coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
  );

-- hallazgo_bom: costing is coordination — coordinador/admin only. The BoM lives inside the
-- finding's organisation, so both read and write scope through it.
create policy hallazgo_bom_lectura on hallazgo_bom
  for select to authenticated
  using (
    convite_es(array['verificador', 'despachador', 'coordinador', 'admin'])
    and (organizacion_id = convite_organizacion() or convite_es_plataforma())
  );

create policy hallazgo_bom_agrega on hallazgo_bom
  for insert to authenticated
  with check (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
    and editado_por = auth.uid()
    and exists (
      select 1
        from evaluacion_hallazgos h
       where h.id = hallazgo_id
         and h.organizacion_id = convite_organizacion()
    )
  );

create policy hallazgo_bom_actualiza on hallazgo_bom
  for update to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
  )
  with check (
    convite_es(array['coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
    and exists (
      select 1
        from evaluacion_hallazgos h
       where h.id = hallazgo_id
         and h.organizacion_id = convite_organizacion()
    )
  );
