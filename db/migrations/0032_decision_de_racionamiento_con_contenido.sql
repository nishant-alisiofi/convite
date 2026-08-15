-- The rationing record has to name the people it rationed.
--
-- 0025 required that a shipment cutting somebody short carry a `decisiones_asignacion` row
-- before it could be dispatched (2.9). It checked that a row *existed*. `pedidos_atendidos`
-- and `pedidos_postergados` both default to `[]`, so a row naming a rule and a person and
-- nobody else satisfied it — reproduced: a shipment that short-changed a request dispatched
-- clean with a decision recording zero served requests.
--
-- That is the failure 2.9 is written against, not a technicality. «A deferred community with
-- nobody to argue with is how the reporter network dies» — and a decision that records no
-- names leaves exactly nobody to argue with, while looking on the board like due process was
-- followed. An empty audit record is worse than an absent one: the absent one is visibly
-- missing.
--
-- What is checked, and what is deliberately not:
--
--   * `pedidos_atendidos` must name every request on this shipment that got less than it
--     asked for. Those are the people who were cut, and the record exists to say who they
--     were and by how much. This is the load-bearing rule.
--   * It must only name requests actually on this shipment. A decision citing folios from
--     somewhere else is not about this dispatch.
--   * A folio cannot be in both lists. Served and deferred are contradictory, and a record
--     that says both says nothing.
--   * `pedidos_postergados` is NOT required to reference this shipment — by construction it
--     is the opposite: `plan.ts` fills it with requests left off every shipment. Requiring
--     them to be on this one would forbid the correct value.
--
-- Unchanged: a shipment that fills every request it carries still needs no decision row.
-- Nobody was made to wait, so there is nothing to justify.

create or replace function exigir_decision_de_asignacion() returns trigger
language plpgsql security definer set search_path = public
as $exigir$
declare
  asignadas integer;
  recortados integer;
  decision decisiones_asignacion%rowtype;
  faltan text;
  ajenos text;
  ambiguos text;
begin
  -- Only on the transition into dispatched. Editing a shipment that is already out, or
  -- cancelling one, is not this rule's business.
  if new.estado <> 'DESPACHADO' or old.estado is not distinct from 'DESPACHADO' then
    return new;
  end if;

  select coalesce(sum(ei.familias_asignadas), 0),
         count(*) filter (where ei.familias_asignadas < p.familias)
    into asignadas, recortados
    from envio_items ei
    join pedidos p on p.id = ei.pedido_id
   where ei.envio_id = new.id;

  -- Carried over from 0025 unchanged. Rewriting the body around it is how it nearly got
  -- dropped: `create or replace` replaces the whole function, so every rule the old one
  -- carried has to be re-stated, and a rule that quietly disappears in a security fix is a
  -- worse outcome than the bug being fixed.
  if asignadas = 0 then
    raise exception 'No se despacha un envío vacío: no tiene paradas.'
      using errcode = 'check_violation';
  end if;

  -- The boat does not get bigger because the queue is long.
  if asignadas > new.cupo_familias then
    raise exception
      'El envío lleva % familias y el cupo es %. Reparta menos o consiga más transporte.',
      asignadas, new.cupo_familias
      using errcode = 'check_violation';
  end if;

  if recortados = 0 then
    return new;
  end if;

  select * into decision from decisiones_asignacion d where d.envio_id = new.id;

  if not found then
    raise exception
      'Hay % pedido(s) que reciben menos de lo que pidieron. Registre la decisión de asignación antes de despachar (2.9).',
      recortados
      using errcode = 'check_violation';
  end if;

  if jsonb_array_length(decision.pedidos_atendidos) = 0 then
    raise exception
      'La decisión de asignación no dice a quién se le repartió. Un registro vacío no es un registro (2.9).'
      using errcode = 'check_violation';
  end if;

  -- Everybody who was cut has to be named. This is the whole point of the record.
  select string_agg(r.folio::text, ', ' order by r.folio) into faltan
    from envio_items ei
    join pedidos p on p.id = ei.pedido_id
    join reportes r on r.id = p.reporte_id
   where ei.envio_id = new.id
     and ei.familias_asignadas < p.familias
     and not exists (
       select 1 from jsonb_array_elements(decision.pedidos_atendidos) e
        where (e ->> 'folio') = r.folio::text
     );

  if faltan is not null then
    raise exception
      'La decisión no menciona el/los folio(s) % , que recibieron menos de lo que pidieron (2.9).',
      faltan
      using errcode = 'check_violation';
  end if;

  -- And it may only talk about this shipment.
  select string_agg(distinct e.folio, ', ') into ajenos
    from jsonb_array_elements(decision.pedidos_atendidos) as elem
    cross join lateral (select elem ->> 'folio' as folio) e
   where e.folio is not null
     and not exists (
       select 1 from envio_items ei
         join pedidos p on p.id = ei.pedido_id
         join reportes r on r.id = p.reporte_id
        where ei.envio_id = new.id and r.folio::text = e.folio
     );

  if ajenos is not null then
    raise exception
      'La decisión menciona el/los folio(s) %, que no van en este envío.', ajenos
      using errcode = 'check_violation';
  end if;

  -- Served and deferred at once is not a decision.
  select string_agg(distinct a.folio, ', ') into ambiguos
    from jsonb_array_elements(decision.pedidos_atendidos) as ea
    cross join lateral (select ea ->> 'folio' as folio) a
   where exists (
     select 1 from jsonb_array_elements(decision.pedidos_postergados) as ep
      where (ep ->> 'folio') = a.folio
   );

  if ambiguos is not null then
    raise exception
      'La decisión dice que el/los folio(s) % fueron atendidos y postergados a la vez.', ambiguos
      using errcode = 'check_violation';
  end if;

  return new;
end
$exigir$;

comment on function exigir_decision_de_asignacion() is
  'Non-negotiable 2.9. A shipment that cuts somebody short cannot dispatch without a decision that names who was cut, only talks about this shipment, and does not claim the same folio was both served and deferred.';

-- One shipment, one rationing decision. Two rows could disagree about who was deferred, and
-- the trigger above reads a single row — which without this would be an arbitrary one.
create unique index decisiones_envio_key on decisiones_asignacion (envio_id);
