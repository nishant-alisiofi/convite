-- Extensions, shared roles and shared helpers.
--
-- Everything in this file is written to be a no-op when it is already present, so the same
-- migration runs unchanged against local docker Postgres and against Supabase (where the
-- roles and the auth schema already exist and are not ours to alter).

create extension if not exists postgis;
create extension if not exists pgcrypto;

-- Supabase ships these roles. Create them locally so the RLS policies in 0007 behave
-- identically in both places.
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$roles$;

grant usage on schema public to anon, authenticated, service_role;

-- Local stand-in for Supabase's auth.uid(). Only created when absent: on Supabase the real
-- function belongs to supabase_auth_admin and must not be replaced.
do $authuid$
begin
  if to_regprocedure('auth.uid()') is null then
    create schema if not exists auth;
    execute $fn$
      create function auth.uid() returns uuid
      language sql stable
      as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid'
    $fn$;
  end if;
end
$authuid$;

-- Keeps `actualizado_en` honest without every writer having to remember it.
create or replace function tocar_actualizado_en() returns trigger
language plpgsql
as $trg$
begin
  new.actualizado_en = now();
  return new;
end
$trg$;
