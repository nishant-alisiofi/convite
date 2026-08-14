-- The season as an audited setting, a name on every deactivated route, and the first-mile
-- pickup clustering.
--
-- Three things M8 needs from the database, all of them versions of the same rule: a change
-- that quietly alters what the engine believes must carry the name of whoever made it.
--
-- `CONVITE_TEMPORADA` was an environment variable. Getting it wrong does not raise an
-- error — it silently changes which communities the engine believes are reachable, because
-- `rutas.temporada` filters the graph. Winandó has no row in `seca`, so flipping the wrong
-- way makes a community vanish from the plan with nothing in any log to say why. A value
-- with that much reach belongs in a table with an audit row behind it, not in a deploy.

-- ── Settings ────────────────────────────────────────────────────────────────────────────

create table configuracion (
  clave                   text primary key,
  valor                   text not null,
  descripcion             text,
  -- Null only for the values this migration seeds: nobody has changed them yet. Every
  -- later write carries a person, enforced by the RLS policy below (2.1).
  actualizado_por         uuid references usuarios (id),
  actualizado_en          timestamptz not null default now(),
  creado_en               timestamptz not null default now(),

  -- A controlled vocabulary per key, in the same shape as the conditional checks elsewhere
  -- in this schema. The engine reads this column and branches on it; an unrecognised value
  -- would fall through to a default and look like a working system with a wrong answer.
  constraint configuracion_temporada_check
    check (clave <> 'temporada' or valor in ('lluvias', 'seca'))
);

comment on table configuracion is
  'Operational settings a coordinator changes without a deploy. Every change writes an auditoria row — see auditar_configuracion(). Read through lib/temporada.ts, which falls back to the environment variable when the row is missing.';
comment on column configuracion.clave is
  'Stable identifier read by code. Adding a key means adding its check constraint above.';

-- Seeded before the audit trigger exists, deliberately: the default is where the system
-- starts, not a decision somebody made, and `actualizado_por` stays null to say so. The
-- first audit row is written by the first person who changes it.
insert into configuracion (clave, valor, descripcion) values
  ('temporada', 'lluvias',
   'Temporada que el emparejador usa para decidir qué tramos están abiertos. Chocó es uno de los lugares más lluviosos del mundo, así que lluvias es el estado normal.')
on conflict (clave) do nothing;

-- ── The audit row ───────────────────────────────────────────────────────────────────────
--
-- A trigger rather than an application write, so a change made from a script, a psql
-- session or a future admin screen is recorded the same way. `auditoria` has no UPDATE or
-- DELETE policy (0017), so what lands here cannot be edited afterwards.

create or replace function auditar_configuracion() returns trigger
language plpgsql security definer set search_path = public
as $auditar$
begin
  -- A write that changes nothing is not a decision worth a row.
  if tg_op = 'UPDATE' and old.valor is not distinct from new.valor then
    return new;
  end if;

  insert into auditoria (actor_id, accion, entidad, entidad_id, antes, despues)
  values (
    new.actualizado_por,
    'configuracion.cambio',
    'configuracion',
    -- entidad_id is a uuid and this table is keyed by text, so the key travels in the
    -- payload instead of being coerced into something that is not an id.
    null,
    case when tg_op = 'UPDATE'
      then jsonb_build_object('clave', old.clave, 'valor', old.valor)
      else null
    end,
    jsonb_build_object('clave', new.clave, 'valor', new.valor)
  );
  return new;
end
$auditar$;

comment on function auditar_configuracion() is
  'Non-negotiable 2.1 applied to settings: who changed the season, from what, to what, and when.';

create trigger configuracion_auditar
  after insert or update on configuracion
  for each row execute function auditar_configuracion();

create trigger configuracion_tocar before update on configuracion
  for each row execute function tocar_actualizado_en();

-- RLS floor first, exactly as 0007 and 0012 do it, so a half-finished policy set fails
-- towards "staff cannot read" rather than "anon can".
alter table configuracion enable row level security;
revoke all on public.configuracion from anon, authenticated;

-- No DELETE grant and no DELETE policy: removing the temporada row would send the engine
-- back to the environment variable with nothing on screen to say the setting had gone.
grant select, insert, update on public.configuracion to authenticated;

create policy configuracion_lectura on configuracion
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));

-- Admin only, and it must be signed. `actualizado_por = auth.uid()` is the same guard
-- `decisiones_registra` uses: you may record your own decision and nobody else's.
create policy configuracion_admin_escribe on configuracion
  for update to authenticated
  using (convite_es(array['admin']))
  with check (convite_es(array['admin']) and actualizado_por = auth.uid());

create policy configuracion_admin_agrega on configuracion
  for insert to authenticated
  with check (convite_es(array['admin']) and actualizado_por = auth.uid());

-- ── A name on every closed route ────────────────────────────────────────────────────────
--
-- Section 9.3: «un botón de "desactivar ruta afectada" que pide confirmación y registra
-- quién lo hizo». The reference schema in docs/esquema-referencia.sql carried these two
-- columns and the implemented table lost them, so until now closing the MER→TAG chokepoint
-- — which cuts off Tagachí, Beté and Bellavista at once — left no trace of who decided it.
--
-- The check is the same shape as `envios_despacho_check`: the state that matters cannot be
-- reached without a person and a timestamp attached to it.

alter table rutas
  add column desactivada_por uuid references usuarios (id),
  add column desactivada_en  timestamptz;

alter table rutas
  add constraint rutas_desactivacion_check
  check (activa or (desactivada_por is not null and desactivada_en is not null));

comment on column rutas.desactivada_por is
  'Who closed this leg. A damage report never deactivates a route on its own (2.1) — a person does, after verifying it, and `notas` says why.';

-- ── First mile ──────────────────────────────────────────────────────────────────────────
--
-- Collecting scattered donations in town is a different problem from delivering upriver:
-- many stops within a few hundred metres of each other, over roads, feeding one node. The
-- matcher's provisional answer was a 15 km straight line, which inside Quibdó means "the
-- whole town and then some" and gives a coordinator no idea what order to drive in.
--
-- This groups offers that are genuinely next to each other and returns ONE ordered run, so
-- six donations across three neighbourhoods come back as six numbered stops rather than six
-- separate errands. Clustering happens here rather than in the browser because the
-- coordinates never reach the browser: 0017 revoked `ofertas.ubicacion` from
-- `authenticated`, and 2.16 is the reason.
--
-- Distances are computed on the geography type — real metres on the ellipsoid — and the
-- clustering is done in UTM 18N, the zone Chocó actually falls in, so `radio_grupo_m` means
-- metres rather than a fraction of a degree that varies with latitude.

create or replace function recogidas_sugeridas(
  nodo_destino    uuid,
  radio_grupo_m   integer default 400,
  radio_alcance_m integer default 5000
)
returns table (
  orden          integer,
  grupo          integer,
  oferta_id      uuid,
  metros_al_nodo integer,
  perecedero     boolean,
  vence_en       timestamptz
)
language sql stable security definer set search_path = public
as $recogidas$
  with destino as (
    -- The authorisation gate. Same rule as `convite_recoge_oferta`: a coordinator planning
    -- the run may see where the goods are, and nobody else may. No row here means no rows
    -- out, so an unauthorised caller learns nothing, not even how many offers exist.
    select n.ubicacion
      from nodos n
     where n.id = nodo_destino
       and n.ubicacion is not null
       and convite_es(array['coordinador', 'admin'])
  ),
  recogibles as (
    select o.id, o.ubicacion, o.perecedero, o.vence_en,
           st_distance(o.ubicacion::geography, d.ubicacion::geography) as metros
      from ofertas o
      cross join destino d
     where o.necesita_recogida
       and o.estado = 'DISPONIBLE'
       and o.ubicacion is not null
       and st_dwithin(o.ubicacion::geography, d.ubicacion::geography, radio_alcance_m)
  ),
  agrupadas as (
    select r.*,
           st_clusterdbscan(st_transform(r.ubicacion, 32618), radio_grupo_m, 1) over () as celda
      from recogibles r
  ),
  -- Renumber the clusters into the order the run visits them. Perishables first (2.15):
  -- cooked lunches for tomorrow set the departure time for the whole trip, so the
  -- neighbourhood holding them leads. Everything else is nearest-first from the node.
  grupos as (
    select celda,
           row_number() over (order by min(vence_en) nulls last, min(metros))::integer as grupo
      from agrupadas
     group by celda
  )
  select row_number() over (order by g.grupo, a.vence_en nulls last, a.metros)::integer as orden,
         g.grupo,
         a.id,
         a.metros::integer,
         a.perecedero,
         a.vence_en
    from agrupadas a
    join grupos g on g.celda = a.celda
   order by orden
$recogidas$;

comment on function recogidas_sugeridas(uuid, integer, integer) is
  'One ordered pickup run into a node, grouped by neighbourhood. Returns no address and no coordinate: the address leaves the database only through direccion_de_oferta() (2.16).';

grant execute on function recogidas_sugeridas(uuid, integer, integer) to authenticated;
