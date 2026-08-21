-- A transporter takes down what a community tells them, from their own phone, during the trip.
--
-- PRD-47 built the relay as something a coordinator keys in afterwards: the lanchero says it at
-- the muelle, somebody at a desk types it into /relevo later that day. That is the right shape
-- when the relayer has no account. But a self-registered transporter (FR-18) does have one, and
-- they are standing in the community with the person telling them — which is the only moment when
-- the detail is still first-hand and the follow-up question can still be asked.
--
-- Neither existing writer will take it. `registrar_reporte_manual` (0052) and
-- `registrar_reporte_relevo` (0056) both demand `verificador`/`coordinador`/`admin` AND that the
-- community belong to the caller's own organisation. A transporter is `lectura` in a one-person
-- `aportante` organisation that owns no communities, so they fail both checks. That is correct
-- for those two functions and wrong as a general answer, so this is a third writer with a
-- narrower key rather than a widening of either.
--
-- **The key is the live trip, not a role.** `convite_conduce_hacia` (0016, wired into policy by
-- 0025) is already the product's answer to «may this driver see this place, right now»: it holds
-- only while an envío is theirs AND is out and not yet back. Somebody who ran a trip in March
-- cannot file against that community in August, and a transporter with no active run cannot file
-- at all. Reusing it means this door opens and closes on exactly the same clock as the one that
-- lets them see the stop on the map — one rule, two consequences.
--
-- The report is written into the COMMUNITY's organisation, never the transporter's. A report
-- filed into a one-person aportante org would sit where no coordinator will ever look; it has to
-- land in the queue of whoever actually serves that place.
--
-- `canal = 'relevo'`, the same channel PRD-47 established, because that is what this is: somebody
-- carrying a message out on behalf of people who could not send it themselves. The verification
-- desk already renders that channel with «relevado por», and the report is born RECIBIDO like
-- every other — a transporter can report, and still cannot verify.

create or replace function registrar_reporte_transportista(
  p_comunidad   uuid,
  p_codigo_item text    default null,
  p_familias    integer default null,
  p_urgencia    integer default null,
  p_detalle     text    default null,
  p_descripcion text    default null
) returns table (reporte_id uuid, folio integer)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid     uuid := auth.uid();
  v_com_org uuid;
  v_item    text := nullif(btrim(p_codigo_item), '');
  v_tipo    text := 'sin_clasificar';
  v_reporte uuid;
  v_folio   integer;
begin
  if v_uid is null then
    raise exception 'La sesión no tiene usuario.' using errcode = 'insufficient_privilege';
  end if;

  -- The whole gate. Not «is this person a transporter» — that would let a driver file against
  -- anywhere, for ever, on the strength of a tier. It is «is this person, right now, carrying
  -- something to this community».
  if not convite_conduce_hacia(p_comunidad) then
    raise exception 'Solo se puede reportar desde una comunidad a la que usted lleva un envío en curso.'
      using errcode = 'insufficient_privilege';
  end if;

  select organizacion_id into v_com_org from comunidades where id = p_comunidad;
  if v_com_org is null then
    raise exception 'Esa comunidad no existe.' using errcode = 'check_violation';
  end if;

  -- Knowing the item is knowing the type (0021). Without one, born sin_clasificar (2.12) — and a
  -- transporter is the caller least likely to know the catalogue, so this path will use it often.
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
    v_com_org,
    v_tipo,
    'relevo',
    p_comunidad,
    case when v_tipo = 'sin_clasificar' then null else v_item end,
    p_familias,
    p_urgencia,
    nullif(btrim(p_detalle), ''),
    nullif(btrim(p_descripcion), ''),
    jsonb_build_object('relevo', true, 'desde_viaje', true, 'capturado_por', v_uid)
  )
  returning id, folio into v_reporte, v_folio;

  insert into auditoria (actor_id, accion, entidad, entidad_id, despues)
  values (v_uid, 'reporte.desde_viaje', 'reportes', v_reporte,
          jsonb_build_object('comunidad_id', p_comunidad, 'organizacion_id', v_com_org));

  return query select v_reporte, v_folio;
end;
$$;

comment on function registrar_reporte_transportista is
  'A transporter files a report from the community they are currently delivering to. Gated by convite_conduce_hacia (live trip only), written into the community''s organisation and not the caller''s, canal = relevo, born RECIBIDO. Reporting is not verifying.';

grant execute on function registrar_reporte_transportista(uuid, text, integer, integer, text, text)
  to authenticated;
