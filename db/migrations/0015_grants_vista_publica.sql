-- Tighten the public view, and record what we cannot tighten.
--
-- `grant select ... to anon` in 0007 did not replace the blanket grant Supabase's default
-- privileges had already attached: anon held INSERT, UPDATE, DELETE and TRUNCATE on
-- `mapa_publico` as well. Those are inert on a view over RLS-protected tables, but 2.4 says
-- the boundary is enforced in Postgres and "inert" is not the same as "absent".

revoke all on public.mapa_publico from anon, authenticated;
grant select on public.mapa_publico to anon, authenticated;

-- What remains, and why it is not fixable here:
--
-- `spatial_ref_sys` and `geometry_columns` are owned by `supabase_admin` and were granted
-- to anon by that role's default privileges. We connect as `postgres`, which is not the
-- owner, so REVOKE against them silently does nothing. Moving PostGIS to its own schema
-- would solve it, but the extension does not support SET SCHEMA.
--
-- The exposure is schema metadata, not data: which tables carry geometry columns. No
-- Convite row is reachable through either object. Two ways to close it properly, both
-- deployment decisions rather than migrations:
--
--   1. Do not expose any schema through PostgREST. The app talks to Postgres directly over
--      the wire and uses Supabase only for auth, so anon has no network path at all. The
--      M12 public page can serve `mapa_publico` from our own route.
--   2. Ask Supabase support to re-own the PostGIS objects, or install the extension into
--      `extensions` on a fresh project before any other migration runs.
--
-- tests/esquema.db.test.ts asserts the boundary in those terms: no Convite table is
-- reachable by anon, and `mapa_publico` is SELECT-only.
