-- FR-42 — Fast person/beneficiary search over `contactos`, matched by partial name, phone
-- (local or E.164) and community name, accent- and case-insensitive, and indexed rather than a
-- full scan.
--
-- Field feedback (Doña Marta, Red de Mujeres Chocanas, relayed 2026-08-17): finding one person
-- in the registry means drilling through Comunidades today. On a weak connection a coordinator
-- needs one box and one keystroke, not a drill-down.
--
-- What this migration adds, and nothing else:
--   * `unaccent` and `pg_trgm` — the two extensions substring, accent-insensitive search needs.
--   * `normaliza_busqueda(text)` — a single-source-of-truth wrapper. `unaccent()` itself is
--     classified STABLE, not IMMUTABLE (it can be re-pointed at a different dictionary via
--     search_path), which Postgres will not accept in a generated column or an index expression.
--     The wrapper pins `search_path` to `public` and asserts IMMUTABLE — the standard, documented
--     way to use `unaccent` for indexing (the dictionary here is never swapped at runtime), and
--     the same function normalizes both the stored column and every search term, so the two sides
--     of the comparison can never drift apart.
--   * `nombre_normalizado` (generated, stored) on `contactos` and `comunidades`, and
--     `telefono_digitos` (generated, stored) on `contactos` — digits-only, so a search for
--     "3001234567" matches a stored "+573001234567" as a substring regardless of which form the
--     coordinator typed.
--   * A GIN trigram index on each generated column. `LIKE '%termino%'` on a trigram-indexed
--     column is an index scan, not a sequential one — the shape AC #4 asks for.
--
-- Nothing here touches a policy, a grant, or a role. `contactos` and `comunidades` are already
-- granted to `authenticated` in 0017 and RLS-gated by `contactos_lectura` / `comunidades_lectura`
-- (verificador/despachador/coordinador/admin only — `lectura` reads neither table today, and
-- stays that way). The search helper in lib/personas/busqueda.ts runs under `conSesion()` like
-- every other read in the panel, so a search is exactly as scoped as browsing Comunidades already
-- is — never wider. `contactos` carries no address column, so there is no PII boundary to widen.

create extension if not exists unaccent;
create extension if not exists pg_trgm;

create or replace function normaliza_busqueda(texto text) returns text
language sql immutable parallel safe
set search_path = public
as $$
  select lower(unaccent(coalesce(texto, '')))
$$;

comment on function normaliza_busqueda(text) is
  'FR-42: accent- and case-fold a name/term for search. The one place this happens, so a stored nombre_normalizado column and a search term run through it are always comparable. unaccent() is STABLE in Postgres (search_path could in theory repoint the dictionary); pinning search_path here is what makes it safe to mark this wrapper IMMUTABLE and use it in a generated column and its index.';

-- A generated column's own expression needs no grant — it runs as part of the DML, same as a
-- DEFAULT or a CHECK. Calling it directly from a search query, as lib/personas/busqueda.ts does,
-- does: like every convite_* helper in 0016/0017/0034, an authenticated session otherwise has no
-- standing EXECUTE on a function it did not create (Supabase revokes the PUBLIC default that
-- local Docker Postgres still grants; see 0000's comment on the two-environment target).
grant execute on function normaliza_busqueda(text) to authenticated;

-- ── contactos: name + phone ────────────────────────────────────────────────────────────────

alter table contactos
  add column nombre_normalizado text generated always as (normaliza_busqueda(nombre)) stored,
  add column telefono_digitos text generated always as (regexp_replace(telefono, '\D', '', 'g')) stored;

comment on column contactos.nombre_normalizado is
  'FR-42: lower + unaccent of nombre, kept in step by the database. Matched with LIKE against a normalized search term over the trigram index below — never recomputed ad hoc in a query.';
comment on column contactos.telefono_digitos is
  'FR-42: digits only, so a coordinator typing a local number ("3001234567") or the full E.164 ("+573001234567") both hit the same substring in a stored "+573001234567".';

create index contactos_nombre_normalizado_trgm_idx
  on contactos using gin (nombre_normalizado gin_trgm_ops);
create index contactos_telefono_digitos_trgm_idx
  on contactos using gin (telefono_digitos gin_trgm_ops);

-- ── comunidades: name, so a search also finds "who is in Tagachí" ─────────────────────────

alter table comunidades
  add column nombre_normalizado text generated always as (normaliza_busqueda(nombre)) stored;

comment on column comunidades.nombre_normalizado is
  'FR-42: same normalization as contactos.nombre_normalizado, so a person search can also match by their community''s name ("quibdo" finds people in Quibdó).';

create index comunidades_nombre_normalizado_trgm_idx
  on comunidades using gin (nombre_normalizado gin_trgm_ops);
