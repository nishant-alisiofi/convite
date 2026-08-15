-- Identity moves into this database.
--
-- Convite borrowed Supabase for one job — «who is this person» — and paid for it with a
-- second database that had to exist and be configured before the panel would answer at all.
-- Staging returned 503 for weeks on exactly that. These four tables are Better Auth's
-- storage; after this migration a deploy that has DATABASE_URL has a working sign-in.
--
-- What does NOT change, and is the whole reason this is safe:
--
--   * `usuarios` is still the staff table and `invitaciones_staff` is still the allowlist.
--     Signing in proves you own an address; `vincular_usuario_staff()` is still the only
--     thing that turns that into access, and only for an address an admin invited (2.10).
--   * RLS is still the boundary. The policies in 0017 read `request.jwt.claims` through
--     `auth.uid()`; `conSesion()` still sets that claim and still assumes the
--     `authenticated` role. Not one policy is touched by this file.
--
-- The join between the two halves is by value: `usuarios.id` is set to `auth_user.id`. So
-- `auth_user.id` has to be a uuid, because `usuarios.id` is one and `auth.uid()` casts the
-- claim. `lib/auth.ts` generates uuids for exactly this reason and the CHECK below is the
-- half of that promise the application cannot bypass — if the generator is ever changed or
-- dropped, sign-up fails here, loudly, instead of every RLS policy quietly raising
-- «invalid input syntax for type uuid» and blanking the panel for everybody.
--
-- English table names, alone in this schema, on purpose: `usuarios` is Convite's staff and
-- `auth_user` is a list of addresses that can read their own mail. Naming them alike is the
-- confusion 2.10 exists to prevent.

create table auth_user (
  id                text primary key,
  nombre            text not null,
  correo            text not null unique,
  correo_verificado boolean not null default false,
  imagen            text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  constraint auth_user_id_es_uuid
    check (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);

comment on table auth_user is
  'Better Auth identity. One row per address that has completed a sign-in. Not staff: that is `usuarios`, and only `vincular_usuario_staff()` writes it (2.10). `id` is text holding a uuid so `usuarios.id` can equal it and auth.uid() can cast it.';

create index auth_user_correo_idx on auth_user (correo);

create table auth_session (
  id             text primary key,
  token          text not null unique,
  vence_en       timestamptz not null,
  ip             text,
  agente         text,
  auth_user_id   text not null references auth_user (id) on delete cascade,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index auth_session_usuario_idx on auth_session (auth_user_id);
create index auth_session_token_idx on auth_session (token);

-- No passwords (Section 3) and no social providers, so this stays empty today. It exists
-- because Better Auth expects it, and because adding a provider later should be a config
-- change rather than a migration run during an incident.
create table auth_account (
  id                       text primary key,
  cuenta_externa_id        text not null,
  proveedor                text not null,
  auth_user_id             text not null references auth_user (id) on delete cascade,
  token_acceso             text,
  token_refresco           text,
  token_id                 text,
  token_acceso_vence_en    timestamptz,
  token_refresco_vence_en  timestamptz,
  alcance                  text,
  contrasena               text,
  creado_en                timestamptz not null default now(),
  actualizado_en           timestamptz not null default now()
);

create index auth_account_usuario_idx on auth_account (auth_user_id);

-- Where a magic link lives between «mandarme el enlace» and the click. One row, consumed on
-- use, expired 15 minutes later either way.
create table auth_verification (
  id             text primary key,
  identificador  text not null,
  valor          text not null,
  vence_en       timestamptz not null,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index auth_verification_identificador_idx on auth_verification (identificador);

-- ── Nobody reaches these through a session ──────────────────────────────────────────────
--
-- 0013 closed the system objects to `anon` and `authenticated` on the principle that a
-- signed-in browser has no business reading anything it was not handed. These are the most
-- literal case of that: `auth_session.token` is a live session, and a role that can select
-- it can impersonate every coordinator at once. The application reaches them as the owner,
-- through Better Auth, and nothing else does.
--
-- RLS is enabled with no policy at all, which denies everything and — unlike a revoke
-- alone — keeps denying if some later migration grants a table-wide select by accident.
--
-- Enabled, never FORCEd. Better Auth reaches these as the table owner, and the owner is
-- exempt from RLS unless forced; forcing it here would leave Better Auth unable to read the
-- session it just wrote, which is «sign-in silently does nothing» rather than a clean error.
-- The `set local role authenticated` in conSesion() is a different role and is caught by
-- the policies-less RLS above, which is the case that matters.
alter table auth_user         enable row level security;
alter table auth_session      enable row level security;
alter table auth_account      enable row level security;
alter table auth_verification enable row level security;

revoke all on auth_user         from anon, authenticated;
revoke all on auth_session      from anon, authenticated;
revoke all on auth_account      from anon, authenticated;
revoke all on auth_verification from anon, authenticated;

-- 0001 described this id as «the Supabase auth uid», which stopped being true above. The
-- shape of the promise is unchanged — it is still an auth provider's user id, still a uuid,
-- still comparable to auth.uid() without a join — but the provider is now this database.
comment on table usuarios is
  'Staff only. id is the auth_user.id of the person who signed in, so RLS can compare against auth.uid() with no join. A row here exists only because an admin invited the address: see vincular_usuario_staff() and non-negotiable 2.10.';

create trigger auth_user_tocar before update on auth_user
  for each row execute function tocar_actualizado_en();
create trigger auth_session_tocar before update on auth_session
  for each row execute function tocar_actualizado_en();
create trigger auth_account_tocar before update on auth_account
  for each row execute function tocar_actualizado_en();
create trigger auth_verification_tocar before update on auth_verification
  for each row execute function tocar_actualizado_en();
