-- A centre's own point on the map (§5.7).
--
-- Recogidas measures the pickup run from a centre, and until now the only located things
-- were `nodos` and `comunidades`. A signed-in centre can now place itself on the real
-- OpenStreetMap base in the panel, which is where the "there is nowhere to measure from"
-- gap on the pickup screen starts to close.
--
-- Location travels with its honesty, exactly as on `comunidades` and `nodos` (non-negotiable
-- 2.2): a point may exist only alongside a declared source and a stated accuracy radius, so a
-- bare pair can never be stored and silently read as if it were precise.

alter table organizaciones
  add column ubicacion            geometry(Point, 4326),
  add column ubicacion_fuente     text,
  add column ubicacion_precision_m integer;

alter table organizaciones
  add constraint organizaciones_ubicacion_declarada_check
    check (
      (ubicacion is null and ubicacion_fuente is null)
      or (ubicacion is not null and ubicacion_fuente is not null and ubicacion_precision_m is not null)
    ),
  add constraint organizaciones_ubicacion_fuente_check
    check (ubicacion_fuente is null or ubicacion_fuente in ('gps', 'centroide', 'referida', 'manual')),
  add constraint organizaciones_ubicacion_precision_check
    check (ubicacion_precision_m is null or ubicacion_precision_m >= 0);

comment on column organizaciones.ubicacion is
  '§5.7: the centre''s own point, from which the Recogidas run is measured. Never populate without ubicacion_fuente and ubicacion_precision_m (non-negotiable 2.2).';

-- ── The write path ──────────────────────────────────────────────────────────────────────
--
-- A SECURITY DEFINER function rather than an RLS UPDATE policy, on purpose. A broad
-- "admin may update their own organisation" policy is row-level, not column-level, so it
-- would also let a pending centre flip its own `estado_aprobacion` to `aprobada` — the exact
-- self-approval that §4 reserves for the platform tier (convite_decidir_centro). This
-- function touches only the three location columns, re-checks the caller's role, and leaves
-- an auditoria row, so the location can be set without opening that door.
--
-- The source is always `manual`: a person deliberately placed this point and stated its
-- radius. That is what `manual` means in the precision model, and it keeps a centre's own
-- point from ever masquerading as a survey-grade GPS fix it is not.

create or replace function convite_fijar_ubicacion_organizacion(
  p_lat        double precision,
  p_lon        double precision,
  p_precision_m integer
) returns text
language plpgsql security definer set search_path = public
as $fijar$
declare
  uid   uuid := auth.uid();
  org   uuid;
  antes jsonb;
begin
  if not convite_es(array['admin']) then
    return 'sin_permiso';
  end if;

  org := convite_organizacion();
  if org is null then
    return 'sin_organizacion';
  end if;

  if p_lat is null or p_lon is null or p_lat < -90 or p_lat > 90 or p_lon < -180 or p_lon > 180 then
    return 'coordenada_invalida';
  end if;

  if p_precision_m is null or p_precision_m < 0 then
    return 'precision_invalida';
  end if;

  select case
           when o.ubicacion is null then null
           else jsonb_build_object(
             'lat', st_y(o.ubicacion), 'lon', st_x(o.ubicacion),
             'fuente', o.ubicacion_fuente, 'precision_m', o.ubicacion_precision_m)
         end
    into antes
    from organizaciones o
   where o.id = org;

  update organizaciones
     set ubicacion            = st_setsrid(st_makepoint(p_lon, p_lat), 4326),
         ubicacion_fuente     = 'manual',
         ubicacion_precision_m = p_precision_m,
         actualizado_en       = now()
   where id = org;

  insert into auditoria (actor_id, accion, entidad, entidad_id, antes, despues)
    values (uid, 'organizacion.ubicacion', 'organizaciones', org, antes,
            jsonb_build_object('lat', p_lat, 'lon', p_lon,
                               'fuente', 'manual', 'precision_m', p_precision_m));

  return 'ok';
end
$fijar$;

comment on function convite_fijar_ubicacion_organizacion(double precision, double precision, integer) is
  '§5.7: a centre admin sets their own point on the map. The only path that writes organizaciones.ubicacion. Refuses non-admins, touches only the location columns (never estado_aprobacion), and records the change to auditoria. Source is always manual.';

grant execute on function convite_fijar_ubicacion_organizacion(double precision, double precision, integer) to authenticated;
