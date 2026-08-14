-- PostGIS grants its metadata to PUBLIC, and `anon` inherits from PUBLIC — so the revoke
-- in 0013, which named `anon` directly, did nothing. Revoke from PUBLIC instead and hand
-- access back to the signed-in roles.
--
-- These objects hold no Convite data: `spatial_ref_sys` is the static EPSG table, and
-- `geometry_columns` / `geography_columns` are catalogue views. What they do leak to an
-- unauthenticated caller is our schema — which tables carry geometry, and therefore where
-- the coordinates live. Under 2.4 that is worth closing even though it is metadata rather
-- than data.
--
-- `authenticated` keeps SELECT because ST_Transform and friends look up SRIDs at runtime,
-- and an RLS-scoped query from a staff session must not fail for want of a reference table.

do $postgis$
declare
  objeto text;
begin
  foreach objeto in array array['spatial_ref_sys', 'geometry_columns', 'geography_columns']
  loop
    if to_regclass(format('public.%I', objeto)) is not null then
      execute format('revoke all on public.%I from public', objeto);
      execute format('grant select on public.%I to authenticated, service_role', objeto);
    end if;
  end loop;
end
$postgis$;
