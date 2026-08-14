-- Dispatch: the rationing record, several offers covering one request, and the driver's
-- window finally connected to something.
--
-- Three gaps that only appear the first time anybody tries to send a boat.

-- ── Several offers, one request ─────────────────────────────────────────────────────────
--
-- PRD §6, the offer aggregation gap: eight people offering two mercados each do not satisfy
-- a request for twelve, even though together they plainly do. Splitting a request across
-- offers is allocation, and §13 says humans decide — so this is a person selecting offers,
-- and each selection is its own `emparejamientos` row carrying the share it covers.
--
-- The old index made that impossible: unique on (pedido_id, capacidad_id) means one row per
-- request per trip, so the second offer collided with the first. Adding `oferta_id` keeps
-- the property the index existed for — the matcher proposing the same thing twice on
-- consecutive sweeps is still refused, because a proposal with no offer and no capacity
-- still collides under NULLS NOT DISTINCT — while letting a human attach several distinct
-- offers to one request.

drop index emparejamientos_pedido_capacidad_key;

create unique index emparejamientos_pedido_fuente_key
  on emparejamientos (pedido_id, capacidad_id, oferta_id) nulls not distinct;

comment on column emparejamientos.cantidad is
  'Families this source covers, not the whole request. Several confirmed rows can add up to one pedido when a coordinator combines offers (PRD §6).';

-- ── The rationing record ────────────────────────────────────────────────────────────────
--
-- Non-negotiable 2.9: when supply is short, record the rule, the person, and who was
-- deferred. `decisiones_asignacion` has existed since 0004 and nothing has ever required
-- one, because nothing had ever been dispatched.
--
-- A trigger, not a policy, for the same reason as the pedidos guard in 0023: RLS binds
-- human sessions, and `service_role` — which is what every job and webhook runs as —
-- bypasses it entirely. The gate has to sit where nobody can walk around it.
--
-- "Insufficient supply" is defined here as **any carried request being served with fewer
-- families than it asked for**. That is the moment somebody is deferred, which is precisely
-- what `pedidos_atendidos` / `pedidos_postergados` exist to record. A shipment that fills
-- every request it carries needs no such row: nobody was made to wait.

create or replace function exigir_decision_de_asignacion() returns trigger
language plpgsql security definer set search_path = public
as $exigir$
declare
  asignadas integer;
  recortados integer;
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

  if recortados > 0 and not exists (
    select 1 from decisiones_asignacion d where d.envio_id = new.id
  ) then
    raise exception
      'Hay % pedido(s) que reciben menos de lo que pidieron. Registre la decisión de asignación antes de despachar (2.9).',
      recortados
      using errcode = 'check_violation';
  end if;

  return new;
end
$exigir$;

comment on function exigir_decision_de_asignacion() is
  'Non-negotiable 2.9. A shipment that shorts somebody cannot leave until a person has recorded the rule they applied and who they deferred. A trigger because service_role bypasses RLS.';

create trigger envios_exigen_decision
  before update on envios
  for each row execute function exigir_decision_de_asignacion();

-- The rationing record is append-only by construction: 0017 gives it a SELECT policy and an
-- INSERT policy and deliberately no UPDATE or DELETE, so no role can revise who was
-- deferred after the fact. Said out loud here because that absence is the feature.
comment on table decisiones_asignacion is
  'Non-negotiable 2.9. Written by the despachador who made the call, in their own name, and never editable by anyone — a deferred community with nobody to argue with is how the reporter network dies.';

-- ── The driver's window ─────────────────────────────────────────────────────────────────
--
-- `convite_conduce_hacia()` was written in 0016 and, until now, referenced by no policy at
-- all: the one function whose whole purpose is to time-limit a transporter's access was
-- inert. A driver reaching the panel saw nothing, and would have been handed their stops on
-- paper or over WhatsApp instead — which is the outcome Section 11 was trying to avoid.
--
-- These four policies are additive: RLS combines permissive policies with OR, so staff
-- access is unchanged and a transporter gains exactly their own live trip. The window is
-- both halves of 0016's rule — the shipment is theirs, AND it is out and not yet back.
-- Somebody who ran a trip in March cannot pull coordinates in August.

create policy envio_items_transportista on envio_items
  for select to authenticated
  using (
    convite_conduce_hacia((select p.comunidad_id from pedidos p where p.id = envio_items.pedido_id))
  );

create policy pedidos_transportista on pedidos
  for select to authenticated
  using (convite_conduce_hacia(comunidad_id));

-- The stop itself: name and coordinates, for the duration of the trip and no longer.
create policy comunidades_transportista on comunidades
  for select to authenticated
  using (convite_conduce_hacia(id));

-- The four digits the receiving leader reads back. Useless to anyone not on the trip, and
-- unavailable to the driver once the trip is closed.
create policy entregas_transportista on entregas
  for select to authenticated
  using (
    convite_conduce_hacia((select p.comunidad_id from pedidos p where p.id = entregas.pedido_id))
  );
