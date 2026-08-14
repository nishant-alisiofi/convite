-- Close the objects that are in `public` but are not application tables.
--
-- Found by running the 2.4 tests against a real Supabase project: the deny-by-default floor
-- in 0007 walks a hand-written list of our own tables, so anything created outside that
-- list stayed readable by `anon`. Two kinds slipped through:
--
--   * `_migraciones`, created by scripts/migrate.ts before any migration runs. Harmless
--     content, but it is our table and the rule is that anon reads `mapa_publico` and
--     nothing else.
--   * PostGIS's own metadata — `spatial_ref_sys`, `geometry_columns`, `geography_columns`.
--     `create extension postgis` put them in `public` because that is where we asked for
--     it. Nothing anon does needs them: the public view runs with its owner's rights.
--
-- Guarded so this is a no-op wherever an object is absent.

do $cerrar$
declare
  objeto text;
begin
  foreach objeto in array array[
    '_migraciones', 'spatial_ref_sys', 'geometry_columns', 'geography_columns'
  ]
  loop
    if to_regclass(format('public.%I', objeto)) is not null then
      execute format('revoke all on public.%I from anon, authenticated', objeto);
    end if;
  end loop;

  -- Only our own table can take RLS; the PostGIS ones belong to the extension.
  if to_regclass('public._migraciones') is not null then
    execute 'alter table public._migraciones enable row level security';
  end if;
end
$cerrar$;
