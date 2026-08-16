-- PRD-35 (§29.3b) — the three deferred pieces of «how an organisation gets in»: the manual-entry
-- zeroth channel, the shared-gazetteer correction desk, and the aggregate coordination read layer.
-- The admission tiers, vouching and membership engine already shipped in 0047; this migration is
-- the part left out of that WI's safe additive scope.
--
-- What this migration makes real:
--
--   * `canal = 'manual'` — the zeroth channel. Stage-0 setup (PRD-36) must work with NO channel at
--     all: once the data agreement is signed, a coordinator types in reports they are already
--     receiving. Manual reports enter through a SECURITY DEFINER door (like the radio relay in
--     0050), born RECIBIDO, tagged with the person who entered them. A live channel attaches later
--     and nothing already entered changes.
--   * The shared community gazetteer's correction desk (§29.3b). Communities are a common registry
--     seeded `verificado_en = NULL` on purpose — nothing counts as verified until the territory
--     says so. A proposal corrects an existing community (name / coordinate / existence) or
--     proposes a new one, matched by name + proximity before creation. Accepting a proposal writes
--     the shared row and STAMPS `verificado_en` — a gazetteer edit authenticated cannot do
--     directly — through a SECURITY DEFINER function gated to a coordinador/admin of the owning org
--     (or a platform admin).
--   * The aggregate coordination read layer, for every tier from the start (§29.3b). The same data
--     `/respuesta` publishes, extended and authenticated: municipality-level demand counts, which
--     communities already have someone working in them, which routes are reported closed. Aggregate
--     and shared facts only — never another organisation's community-level operational detail,
--     which §29.3b says is negotiated bilaterally and never default.
--
-- What this migration deliberately does NOT touch: not one existing policy is weakened; the panel
-- nav is wired elsewhere; lib/auth.ts, lib/sesion.ts, the seed and every other feature are left
-- exactly as they are.

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  Part 1 — the manual channel: widen every canal vocabulary to carry 'manual'
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- `manual` joins the CANALES vocabulary (the TS mirror in db/schema/vocabulario.ts gains it too, so
-- `pnpm db:check` stays clean). Every check constraint that reads CANALES is re-made to include it;
-- CANALES_PREFERIDOS (contactos.canal_preferido) is a narrower list and is left untouched — manual,
-- like web, is a staff-only channel, never a contact preference.

alter table reportes drop constraint reportes_canal_check;
alter table reportes add constraint reportes_canal_check
  check (canal in ('whatsapp', 'sms', 'ivr', 'radio', 'papel', 'web', 'manual'));

alter table mensajes drop constraint mensajes_canal_check;
alter table mensajes add constraint mensajes_canal_check
  check (canal in ('whatsapp', 'sms', 'ivr', 'radio', 'papel', 'web', 'manual'));

alter table entregas drop constraint entregas_canal_check;
alter table entregas add constraint entregas_canal_check
  check (confirmado_canal is null
    or confirmado_canal in ('whatsapp', 'sms', 'ivr', 'radio', 'papel', 'web', 'manual'));

alter table salidas_pendientes drop constraint salidas_canal_check;
alter table salidas_pendientes add constraint salidas_canal_check
  check (canal_sugerido is null
    or canal_sugerido in ('whatsapp', 'sms', 'ivr', 'radio', 'papel', 'web', 'manual'));

-- ── The gated insert: how a manual report actually enters ─────────────────────────────────────
-- `reportes` has no authenticated INSERT policy (0017) — intake writes as the owner role from a
-- job, and the radio relay (0050) added the pattern for a signed-in staff member: a SECURITY
-- DEFINER function is the one narrow door. This is the same door for manual entry. It checks the
-- caller's role and organisation, requires the community to be their own, derives the type from the
-- catalogue item (knowing the item is knowing the type, 0021) or leaves it `sin_clasificar` (2.12 —
-- we never guess), then writes a `canal = 'manual'` report born RECIBIDO, recording the person who
-- entered it in `payload_crudo`. Promotion to a pedido still needs a named verifier, exactly like
-- every other channel — a typed-in report is not a pre-verified one.

create or replace function registrar_reporte_manual(
  p_comunidad   uuid,
  p_codigo_item text    default null,
  p_familias    integer default null,
  p_urgencia    integer default null,
  p_detalle     text    default null,
  p_descripcion text    default null
) returns table (reporte_id uuid, folio integer)
language plpgsql security definer set search_path = public
as $$
-- The OUT column `folio` shares a name with `reportes.folio`; resolve to the column so
-- `returning id, folio into …` reads the inserted row rather than the OUT parameter.
#variable_conflict use_column
declare
  v_org     uuid := convite_organizacion();
  v_uid     uuid := auth.uid();
  v_com_org uuid;
  v_item    text := nullif(btrim(p_codigo_item), '');
  v_tipo    text := 'sin_clasificar';
  v_reporte uuid;
  v_folio   integer;
begin
  -- Keying in a report is verification-desk work (§6): a reader, or a session with no staff row,
  -- cannot. A despachador dispatches; they do not create reports.
  if not convite_es(array['verificador', 'coordinador', 'admin']) then
    raise exception 'Solo verificador, coordinador o admin puede registrar un reporte manual.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_org is null then
    raise exception 'La sesión no pertenece a ninguna organización.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The community has to be the caller's own — a manual report is about a place they operate in.
  select organizacion_id into v_com_org from comunidades where id = p_comunidad;
  if v_com_org is null or v_com_org <> v_org then
    raise exception 'La comunidad no pertenece a su organización.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Knowing the item is knowing the type (0021). Without an item we do not guess (2.12): the
  -- report is born sin_clasificar and a verifier classifies it later.
  if v_item is not null then
    select tipo into v_tipo from catalogo_items where codigo = v_item and activo;
    if v_tipo is null then
      raise exception 'Ese código de catálogo no existe o está inactivo.'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into reportes
    (organizacion_id, tipo, canal, comunidad_id, codigo_item, familias, urgencia,
     detalle_libre, descripcion, payload_crudo)
  values (
    v_org,
    v_tipo,
    'manual',
    p_comunidad,
    case when v_tipo = 'sin_clasificar' then null else v_item end,
    p_familias,
    p_urgencia,
    nullif(btrim(p_detalle), ''),
    nullif(btrim(p_descripcion), ''),
    jsonb_build_object('manual', true, 'capturado_por', v_uid)
  )
  returning id, folio into v_reporte, v_folio;

  return query select v_reporte, v_folio;
end;
$$;

comment on function registrar_reporte_manual(uuid, text, integer, integer, text, text) is
  'PRD-35 (§29.3b): the one door a signed-in coordinator uses to key in a report before any channel exists. Checks role, organisation and community, derives the type from the catalogue item or leaves it sin_clasificar, then writes a canal=manual report born RECIBIDO recording who entered it. Promotion to a pedido still needs a named verifier.';

grant execute on function registrar_reporte_manual(uuid, text, integer, integer, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  Part 2 — the shared community gazetteer's correction desk (§29.3b)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- The table mirrors db/schema/gazetteer.ts. Proposing is an ordinary authenticated INSERT bounded
-- by RLS; accepting is a SECURITY DEFINER function because it writes the shared `comunidades` row.

create table registro_propuestas (
  id                       uuid primary key default gen_random_uuid(),
  -- `correccion` fixes an existing community; `nueva` proposes one the registry lacks.
  tipo_propuesta           text not null,
  -- The community being corrected. NULL for a `nueva` proposal (there is no row yet).
  comunidad_id             uuid references comunidades (id),
  -- The organisation making the proposal — the RLS scope, and the author (2.1).
  organizacion_id          uuid not null references organizaciones (id),
  propuesto_por            uuid not null references usuarios (id),
  nombre_propuesto         text,
  municipio_propuesto      text,
  tipo_comunidad_propuesto text,
  -- A proposed coordinate, with its source and radius (2.2 — they move together, see the check).
  ubicacion_propuesta      geometry(Point, 4326),
  ubicacion_fuente         text,
  ubicacion_precision_m    integer,
  -- The existence half of a correction: false = «not real / duplicate», which deactivates the row
  -- on acceptance rather than deleting it. NULL = the proposal says nothing about existence.
  existe_real              boolean,
  motivo                   text not null,
  estado                   text not null default 'pendiente',
  resuelto_por             uuid references usuarios (id),
  resuelto_en              timestamptz,
  nota_resolucion          text,
  creado_en                timestamptz not null default now(),
  actualizado_en           timestamptz not null default now(),

  constraint registro_propuestas_tipo_check
    check (tipo_propuesta in ('correccion', 'nueva')),
  constraint registro_propuestas_estado_valido_check
    check (estado in ('pendiente', 'aceptada', 'rechazada')),
  -- A correccion points at a community and proposes at least one change; a nueva carries no
  -- community id but must name the place and its municipality.
  constraint registro_propuestas_forma_check check (
    (tipo_propuesta = 'correccion'
       and comunidad_id is not null
       and (nombre_propuesto is not null or ubicacion_propuesta is not null or existe_real is not null))
    or (tipo_propuesta = 'nueva'
       and comunidad_id is null
       and nombre_propuesto is not null
       and municipio_propuesto is not null)
  ),
  constraint registro_propuestas_motivo_check check (length(btrim(motivo)) > 0),
  constraint registro_propuestas_tipo_comunidad_check check (
    tipo_comunidad_propuesto is null
    or tipo_comunidad_propuesto in ('cabecera', 'corregimiento', 'vereda', 'resguardo', 'consejo_comunitario')
  ),
  -- Non-negotiable 2.2: a point with no declared source, or a source with no radius, is a
  -- coordinate we have invented the precision of.
  constraint registro_propuestas_ubicacion_declarada_check check (
    (ubicacion_propuesta is null and ubicacion_fuente is null)
    or (ubicacion_propuesta is not null and ubicacion_fuente is not null and ubicacion_precision_m is not null)
  ),
  constraint registro_propuestas_ubicacion_fuente_check check (
    ubicacion_fuente is null or ubicacion_fuente in ('gps', 'centroide', 'referida', 'manual')
  ),
  constraint registro_propuestas_precision_check check (
    ubicacion_precision_m is null or ubicacion_precision_m >= 0
  ),
  -- 2.1: a resolution is somebody's decision, so it carries their name and its time together.
  constraint registro_propuestas_resolucion_check check (
    (estado = 'pendiente' and resuelto_por is null and resuelto_en is null)
    or (estado <> 'pendiente' and resuelto_por is not null and resuelto_en is not null)
  )
);

create index registro_propuestas_estado_idx on registro_propuestas (estado);
create index registro_propuestas_comunidad_idx on registro_propuestas (comunidad_id);
create index registro_propuestas_organizacion_idx on registro_propuestas (organizacion_id);

comment on table registro_propuestas is
  'PRD-35 (§29.3b): proposals against the shared community gazetteer — a correction to an existing community (name/coordinate/existence) or a proposed new one, matched by name + proximity before creation. Proposing is an authenticated INSERT; accepting stamps verificado_en on the shared comunidades row through convite_resolver_propuesta_registro.';

create trigger registro_propuestas_tocar before update on registro_propuestas
  for each row execute function tocar_actualizado_en();

-- ── RLS floor, exactly as 0047/0050 do it ────────────────────────────────────────────────────
-- Enable, revoke, grant back only what the policies need, so a half-finished policy set fails
-- towards «staff cannot read» rather than «anon can». No update/delete grant: resolution runs as
-- the owner through the SECURITY DEFINER function below, which is the one door.

alter table registro_propuestas enable row level security;
revoke all on public.registro_propuestas from anon, authenticated;
grant select, insert on public.registro_propuestas to authenticated;

-- Propose: a field role, within their own organisation, as themselves, and always as pendiente.
create policy registro_propuestas_propone on registro_propuestas
  for insert to authenticated
  with check (
    convite_es(array['verificador', 'coordinador', 'admin'])
    and organizacion_id = convite_organizacion()
    and propuesto_por = auth.uid()
    and estado = 'pendiente'
  );

-- Read: a platform admin sees all (they steward the shared registry); an organisation sees its own
-- proposals; and a coordinador/admin sees proposals aimed at a community their organisation holds,
-- so a correction to their community surfaces to them for review. Another organisation's proposal
-- about another organisation's community is not visible — bilateral detail is never default (§29.3b).
create policy registro_propuestas_lectura on registro_propuestas
  for select to authenticated
  using (
    convite_es_plataforma()
    or organizacion_id = convite_organizacion()
    or (
      convite_es(array['coordinador', 'admin'])
      and comunidad_id is not null
      and exists (
        select 1 from comunidades c
         where c.id = comunidad_id and c.organizacion_id = convite_organizacion()
      )
    )
  );

-- ── Accepting or rejecting a proposal (§29.3b): the shared-registry write ─────────────────────
-- SECURITY DEFINER because accepting writes `comunidades`, which authenticated cannot update except
-- an admin over their own org (0017). Gated to a coordinador/admin scoped to the org that owns the
-- affected registry row — the community's org for a correccion, the proposing org for a nueva — or
-- a platform admin. Accepting a correccion applies the proposed change AND stamps verificado_en (the
-- territory has now confirmed the row); accepting a nueva creates the community, already verified.

create or replace function convite_resolver_propuesta_registro(
  p_propuesta uuid, p_aceptar boolean, p_nota text default null
) returns text
language plpgsql security definer set search_path = public
as $res$
declare
  uid         uuid := auth.uid();
  pr          registro_propuestas%rowtype;
  v_scope_org uuid;
  v_codigo    text;
  v_antes     jsonb;
begin
  if uid is null then return 'sin_sesion'; end if;

  select * into pr from registro_propuestas where id = p_propuesta;
  if not found then return 'no_existe'; end if;
  if pr.estado <> 'pendiente' then return 'ya_resuelta'; end if;

  -- The org that owns the affected shared-registry row.
  if pr.tipo_propuesta = 'correccion' then
    select organizacion_id into v_scope_org from comunidades where id = pr.comunidad_id;
  else
    v_scope_org := pr.organizacion_id;
  end if;

  if not (convite_es_plataforma()
          or (convite_es(array['coordinador', 'admin']) and convite_organizacion() = v_scope_org)) then
    return 'sin_permiso';
  end if;

  -- A curated snapshot for the audit trail — deliberately no geometry column, so no coordinate is
  -- serialised into auditoria and the row's provenance is still legible.
  v_antes := jsonb_build_object(
    'tipo_propuesta', pr.tipo_propuesta,
    'comunidad_id', pr.comunidad_id,
    'organizacion_id', pr.organizacion_id,
    'nombre_propuesto', pr.nombre_propuesto,
    'motivo', pr.motivo,
    'estado', pr.estado
  );

  if not p_aceptar then
    update registro_propuestas
       set estado = 'rechazada', resuelto_por = uid, resuelto_en = now(),
           nota_resolucion = p_nota, actualizado_en = now()
     where id = p_propuesta;
    insert into auditoria (actor_id, accion, entidad, entidad_id, antes, despues)
      values (uid, 'registro.propuesta_rechazada', 'registro_propuestas', p_propuesta,
              v_antes, jsonb_build_object('estado', 'rechazada', 'nota', p_nota));
    return 'rechazada';
  end if;

  if pr.tipo_propuesta = 'correccion' then
    -- Apply the proposed change and stamp verificado_en: the territory has confirmed this row.
    update comunidades
       set nombre                = coalesce(pr.nombre_propuesto, nombre),
           ubicacion             = coalesce(pr.ubicacion_propuesta, ubicacion),
           ubicacion_fuente      = coalesce(pr.ubicacion_fuente, ubicacion_fuente),
           ubicacion_precision_m = coalesce(pr.ubicacion_precision_m, ubicacion_precision_m),
           activa                = case when pr.existe_real is false then false else activa end,
           verificado_en         = now(),
           actualizado_en        = now()
     where id = pr.comunidad_id;
  else
    -- nueva: create the community under the proposing org, already verified. A synthesised codigo
    -- keeps the unique key; the type defaults to vereda when the proposal did not name one. Location
    -- defaults (centroide / 1000 m) apply when no coordinate was proposed, so 2.2 holds either way.
    v_codigo := 'REG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    insert into comunidades
      (codigo, nombre, tipo, municipio, organizacion_id,
       ubicacion, ubicacion_fuente, ubicacion_precision_m, verificado_en)
    values (
      v_codigo,
      pr.nombre_propuesto,
      coalesce(pr.tipo_comunidad_propuesto, 'vereda'),
      pr.municipio_propuesto,
      pr.organizacion_id,
      pr.ubicacion_propuesta,
      coalesce(pr.ubicacion_fuente, 'centroide'),
      coalesce(pr.ubicacion_precision_m, 1000),
      now()
    );
  end if;

  update registro_propuestas
     set estado = 'aceptada', resuelto_por = uid, resuelto_en = now(),
         nota_resolucion = p_nota, actualizado_en = now()
   where id = p_propuesta;

  insert into auditoria (actor_id, accion, entidad, entidad_id, antes, despues)
    values (uid, 'registro.propuesta_aceptada', 'registro_propuestas', p_propuesta,
            v_antes, jsonb_build_object('estado', 'aceptada', 'nota', p_nota));
  return 'aceptada';
end
$res$;

comment on function convite_resolver_propuesta_registro(uuid, boolean, text) is
  'PRD-35 (§29.3b): accept or reject a gazetteer proposal. Accepting a correccion applies the change and stamps comunidades.verificado_en; accepting a nueva creates the community, already verified. Gated to a coordinador/admin of the owning org, or a platform admin. Audited.';

grant execute on function convite_resolver_propuesta_registro(uuid, boolean, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  Part 3 — the aggregate coordination read layer (§29.3b)
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- «Coordination value at zero privacy cost.» All SECURITY DEFINER + STABLE, granted to every
-- authenticated tier, because §29.3b says every tier — down to observadora — reads this layer, and
-- some of them cannot read the base tables directly. Each returns only aggregate or shared-registry
-- facts: municipality-level demand counts, whether a community has anyone working in it, which
-- route legs are reported closed. None returns another organisation's community-level operational
-- detail (requests, inventory, contacts, assessments) — that is bilateral and never default.

-- Which communities already have someone working in them. Coverage = any organisation has a jornada
-- (not a draft, not cancelled) reaching the community. Community name and municipality are shared
-- registry facts; the boolean is the coordination signal — never who covers it or what they carry.
create or replace function convite_coordinacion_comunidades()
returns table (municipio text, comunidad_id uuid, comunidad text, cubierta boolean)
language sql stable security definer set search_path = public
as $$
  select c.municipio,
         c.id,
         c.nombre,
         exists (
           select 1
             from jornada_paradas jp
             join jornadas j on j.id = jp.jornada_id
            where jp.comunidad_id = c.id
              and j.estado in ('planificada', 'en_curso', 'completada', 'historico')
         ) as cubierta
    from comunidades c
   where c.activa
   order by c.municipio, c.nombre
$$;

comment on function convite_coordinacion_comunidades() is
  'PRD-35 (§29.3b): per-community coverage across the whole basin — whether ANY organisation has a live/past jornada reaching it. Shared-registry facts only (name, municipality, a coverage boolean); never who covers it or with what.';

-- Municipality-level demand, aggregated across every organisation. Pending = a pedido still in the
-- basin (open through en route); attended = delivered. An aggregate over a municipality identifies
-- nobody, which is exactly what makes it safe to show every tier.
create or replace function convite_coordinacion_demanda()
returns table (municipio text, pendientes bigint, atendidos bigint)
language sql stable security definer set search_path = public
as $$
  select c.municipio,
         count(*) filter (
           where p.estado in ('ABIERTO', 'SIN_RUTA', 'SIN_EXISTENCIA', 'SIN_CAPACIDAD', 'LISTO', 'EN_CAMINO')
         ) as pendientes,
         count(*) filter (where p.estado = 'ENTREGADO') as atendidos
    from pedidos p
    join comunidades c on c.id = p.comunidad_id
   group by c.municipio
   order by c.municipio
$$;

comment on function convite_coordinacion_demanda() is
  'PRD-35 (§29.3b): municipality-level demand counts (pending vs attended) aggregated across every organisation. The authenticated, exact version of what /respuesta publishes with k-anonymity. An aggregate over a municipality identifies nobody.';

-- Which route legs are reported closed. Closing a leg cuts off the communities behind it (§9.3), so
-- coordination needs to see it. Origin and destination names are shared-registry facts.
create or replace function convite_coordinacion_tramos_cerrados()
returns table (origen text, destino text, modo text, desactivada_en timestamptz, notas text)
language sql stable security definer set search_path = public
as $$
  select o.nombre, d.nombre, r.modo, r.desactivada_en, r.notas
    from rutas r
    join comunidades o on o.id = r.origen_id
    join comunidades d on d.id = r.destino_id
   where not r.activa
   order by r.desactivada_en desc nulls last
$$;

comment on function convite_coordinacion_tramos_cerrados() is
  'PRD-35 (§29.3b): route legs reported closed, by the community names they connect. Closing a leg cuts off the communities behind it (§9.3), so this is coordination data every tier may read.';

grant execute on function convite_coordinacion_comunidades() to authenticated;
grant execute on function convite_coordinacion_demanda() to authenticated;
grant execute on function convite_coordinacion_tramos_cerrados() to authenticated;
