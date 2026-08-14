-- Make the local stand-ins for Supabase's auth helpers behave like the real ones.
--
-- 0000 creates `auth.uid()` locally so the RLS policies "behave identically in both places".
-- They did not. The shim reads `request.jwt.claim.sub` — the legacy GoTrue setting — while
-- everything that opens a session sets `request.jwt.claims`, the JSON blob Supabase actually
-- uses: `conSesion()` in lib/sesion.ts, `vincularStaff()`, and the `como()` helper in
-- tests/rls.db.test.ts. So locally `auth.uid()` is NULL for every signed-in session,
-- `convite_rol()` returns NULL with it, and every policy that grants access denies instead.
--
-- The visible symptom was 8 failures in tests/rls.db.test.ts, all of them the "SÍ puede"
-- half of the suite. The "NO puede" half passed the whole time, which is the dangerous part:
-- a session with no identity is refused by everything, so the negative assertions hold even
-- when the policies are doing nothing at all. Against the hosted project the same 116 tests
-- pass, because there `auth.uid()` is Supabase's own and reads the blob.
--
-- Three gaps, all of them local-only:
--
--   1. `auth.uid()` ignores `request.jwt.claims`.
--   2. `auth.jwt()` does not exist, so `vincular_usuario_staff()` — the magic-link path that
--      turns an invited address into a staff row — dies with «function auth.jwt() does not
--      exist» on a local run. The SECURITY DEFINER helpers hide this from the suite; nothing
--      covers that function yet.
--   3. `authenticated` has no USAGE on schema `auth`, so the four policies in 0017 that call
--      `auth.uid()` directly (rather than through a SECURITY DEFINER helper) raise
--      «permission denied for schema auth». The tests count any error as a refusal, so this
--      also passed for the wrong reason.
--
-- Every block below is guarded to be a no-op on Supabase: we only touch objects this role
-- owns, and only when they do not already understand the claims blob.

do $uid$
begin
  -- Supabase's own auth.uid() already reads `request.jwt.claims`, and belongs to
  -- supabase_auth_admin. Both halves of the condition keep us off it.
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'auth'
       and p.proname = 'uid'
       and pg_get_userbyid(p.proowner) = current_user
       and p.prosrc not like '%request.jwt.claims%'
  ) then
    execute $fn$
      create or replace function auth.uid() returns uuid
      language sql stable
      as $body$
        select coalesce(
          nullif(current_setting('request.jwt.claim.sub', true), ''),
          nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
        )::uuid
      $body$
    $fn$;
  end if;
end
$uid$;

do $jwt$
begin
  if to_regprocedure('auth.jwt()') is null then
    execute $fn$
      create function auth.jwt() returns jsonb
      language sql stable
      as $body$
        select coalesce(
          nullif(current_setting('request.jwt.claim', true), ''),
          nullif(current_setting('request.jwt.claims', true), '')
        )::jsonb
      $body$
    $fn$;
  end if;
end
$jwt$;

-- On Supabase these grants are already in place and the schema is not ours to alter.
do $acceso$
begin
  if exists (
    select 1 from pg_namespace
     where nspname = 'auth' and pg_get_userbyid(nspowner) = current_user
  ) then
    execute 'grant usage on schema auth to anon, authenticated, service_role';
    execute 'grant execute on all functions in schema auth to anon, authenticated, service_role';
  end if;
end
$acceso$;
