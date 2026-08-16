-- PRD-8 — Transport of PEOPLE, not only goods (PRD v3 §25).
--
-- The marketplace already moves supplies. This adds the distinct case of moving a person: a
-- partera out for surgery or a specialist, a patient to a health post. The record carries a
-- person, not a quantity — but the match is the same one the goods engine makes: a person who
-- needs to reach care is demand, and a vehicle going that way with a free seat is capacity. The
-- matcher reuses the capacity path (lib/traslados/emparejador.ts over `capacidades` and the route
-- graph); what differs is the unit (seats + a time window) and the privacy posture.
--
-- §25 also names what a trip out of the basin costs: river, road, sometimes air, plus lodging,
-- food, accompaniment and a RETURN leg — so those are columns, not an afterthought.
--
-- Two things the schema, not the UI, holds:
--   * Privacy (Ley 1581): `persona_etiqueta` is the safe, aggregated label; `persona_nombre`,
--     `persona_telefono` and `motivo_detalle` are PII/health data reached only through the RLS
--     floor below, and never added to `mapa_publico`. A role without scope sees nothing.
--   * Audit (2.1): every write lands an immutable row in `auditoria`, the same shape 0041 uses.

create table traslados_persona (
  id                        uuid primary key default gen_random_uuid(),
  -- Org-scoped like every operational table (0017 / 0030). RLS binds reads and writes to it.
  organizacion_id           uuid not null references organizaciones (id),
  -- The intake record this came from, when it arrived through a channel (AC #1). NULL when a
  -- coordinator entered it directly on the panel.
  reporte_id                uuid references reportes (id),

  -- Who travels (PII posture) --------------------------------------------------------------
  -- The privacy-safe label — «Partera del Atrato medio». Required, so no screen falls back to
  -- the real name to have something to show (same discipline as beneficiario_etiqueta in 0041).
  persona_etiqueta          text not null,
  -- The named person and their number. PII: readable only behind the RLS floor.
  persona_nombre            text,
  persona_telefono          text,
  -- Seats needed: the person plus anyone accompanying them. The matcher's cupo analogue.
  personas                  integer not null default 1,
  -- Why they travel — a category, never a diagnosis. Clinical detail, if any, in motivo_detalle.
  motivo_categoria          text not null,
  motivo_detalle            text,
  necesidad_accesibilidad   text,

  -- The trip ------------------------------------------------------------------------------
  origen_comunidad_id       uuid not null references comunidades (id),
  destino_comunidad_id      uuid not null references comunidades (id),
  ventana_desde             timestamptz not null,
  ventana_hasta             timestamptz not null,

  -- What §25 says the trip actually needs -------------------------------------------------
  requiere_alojamiento      boolean not null default false,
  requiere_alimentacion     boolean not null default false,
  requiere_acompanamiento   boolean not null default false,
  -- The RETURN leg — the half a goods shipment never has.
  requiere_regreso          boolean not null default false,
  regreso_ventana_desde     timestamptz,
  regreso_ventana_hasta     timestamptz,

  -- State + the matcher's proposal --------------------------------------------------------
  estado                    text not null default 'SOLICITADO',
  motivo                    text,
  -- The outbound vehicle the matcher proposed / a human confirmed (2.1). A proposal is a row
  -- with despachado_por IS NULL; it has committed no seat.
  capacidad_id              uuid references capacidades (id),
  regreso_capacidad_id      uuid references capacidades (id),

  -- The human dispatch + arrival confirmation (outbound) ----------------------------------
  despachado_por            uuid references usuarios (id),
  despachado_en             timestamptz,
  codigo_llegada            char(4),
  llegada_confirmada_en     timestamptz,
  llegada_confirmada_canal  text,

  -- The human dispatch + arrival confirmation (return) ------------------------------------
  regreso_despachado_por    uuid references usuarios (id),
  regreso_despachado_en     timestamptz,
  codigo_regreso            char(4),
  regreso_confirmado_en     timestamptz,

  creado_por                uuid references usuarios (id),
  notas                     text,
  creado_en                 timestamptz not null default now(),
  actualizado_en            timestamptz not null default now(),

  constraint traslados_persona_estado_check
    check (estado in ('SOLICITADO', 'SIN_RUTA', 'SIN_CAPACIDAD', 'LISTO', 'DESPACHADO',
                      'EN_CAMINO', 'LLEGO', 'REGRESO_DESPACHADO', 'REGRESADO', 'CERRADO',
                      'CANCELADO')),
  constraint traslados_persona_motivo_check
    check (motivo_categoria in ('parto', 'cirugia', 'especialista', 'urgencia', 'control',
                                'acompanamiento', 'otro')),
  constraint traslados_persona_personas_check check (personas > 0),
  constraint traslados_persona_no_bucle_check check (origen_comunidad_id <> destino_comunidad_id),
  constraint traslados_persona_ventana_check check (ventana_hasta >= ventana_desde),
  -- A return leg is not a real plan without a window to travel back in (§25).
  constraint traslados_persona_regreso_ventana_check
    check (not requiere_regreso
           or (regreso_ventana_desde is not null and regreso_ventana_hasta is not null
               and regreso_ventana_hasta >= regreso_ventana_desde)),
  -- Same shape as envios_despacho_check: nothing past LISTO exists without a person and a
  -- timestamp attached to the decision (2.1).
  constraint traslados_persona_despacho_check
    check (estado in ('SOLICITADO', 'SIN_RUTA', 'SIN_CAPACIDAD', 'LISTO', 'CANCELADO')
           or (despachado_por is not null and despachado_en is not null)),
  -- A return can only be dispatched for a trip that asked for one.
  constraint traslados_persona_regreso_pedido_check
    check (regreso_despachado_por is null or requiere_regreso),
  constraint traslados_persona_codigo_llegada_check
    check (codigo_llegada is null or codigo_llegada ~ '^[0-9]{4}$'),
  constraint traslados_persona_codigo_regreso_check
    check (codigo_regreso is null or codigo_regreso ~ '^[0-9]{4}$'),
  -- An arrival cannot be confirmed without the code it is confirmed against.
  constraint traslados_persona_llegada_check
    check (llegada_confirmada_en is null or codigo_llegada is not null),
  constraint traslados_persona_regreso_llegada_check
    check (regreso_confirmado_en is null or codigo_regreso is not null)
);

create index traslados_persona_organizacion_idx on traslados_persona (organizacion_id);
create index traslados_persona_estado_idx on traslados_persona (estado);
create index traslados_persona_origen_idx on traslados_persona (origen_comunidad_id);
create index traslados_persona_destino_idx on traslados_persona (destino_comunidad_id);

comment on table traslados_persona is
  'PRD-8 transport of people (§25). Demand is a person needing to reach care; capacity is a vehicle going that way with free seats — matched by seats + window over the same route graph as goods. Carries a return leg, lodging/food/accompaniment. PII (persona_nombre, motivo_detalle) sits behind the RLS floor and is never in mapa_publico.';
comment on column traslados_persona.persona_etiqueta is
  'Aggregated, safe label shown where PII must not be — «Partera del Atrato medio». Never the real name, number or health reason (Ley 1581).';
comment on column traslados_persona.personas is
  'Seats needed: the person plus accompaniment. Matched against capacidades.cupo_familias, reusing the capacity path rather than a second matcher.';

-- ── Audit + touch triggers ──────────────────────────────────────────────────────────────────
-- A trigger, not an application write, so a change from a script or psql is recorded the same way
-- (mirrors auditar_apadrinamiento in 0041). SECURITY DEFINER so it can write auditoria regardless
-- of the caller's grants.

create or replace function auditar_traslado_persona() returns trigger
language plpgsql security definer set search_path = public
as $auditar$
begin
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

comment on function auditar_traslado_persona() is
  'Non-negotiable 2.1 for people transport: who created/dispatched/confirmed a trip, from what to what, and when. Writes an immutable auditoria row on every insert/update.';

create trigger traslados_persona_auditar
  after insert or update on traslados_persona
  for each row execute function auditar_traslado_persona();

create trigger traslados_persona_tocar before update on traslados_persona
  for each row execute function tocar_actualizado_en();

-- ── RLS floor ─────────────────────────────────────────────────────────────────────────────
-- Same order as 0041: enable, revoke everything, grant back exactly what the policies allow, so a
-- half-finished policy set fails towards «staff cannot read» rather than «anon can». People
-- transport is coordination + dispatch work carrying PII, so it is coordinador/admin/despachador;
-- a verificador (territory-scoped) and a lectura role see nothing — which is the point of AC #4.
-- A platform admin reaches across organisations for reads only (0034), never for writes.

alter table traslados_persona enable row level security;
revoke all on public.traslados_persona from anon, authenticated;
grant select, insert, update on public.traslados_persona to authenticated;

create policy traslados_persona_lectura on traslados_persona
  for select to authenticated
  using (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and (organizacion_id = convite_organizacion() or convite_es_plataforma())
  );

create policy traslados_persona_agrega on traslados_persona
  for insert to authenticated
  with check (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and organizacion_id = convite_organizacion()
    and creado_por = auth.uid()
  );

create policy traslados_persona_actualiza on traslados_persona
  for update to authenticated
  using (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and organizacion_id = convite_organizacion()
  )
  with check (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and organizacion_id = convite_organizacion()
  );
