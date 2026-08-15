-- Two holes in the one page anybody can see.
--
-- ── 1. The generic bucket was not anonymising anything ──────────────────────────────────
--
-- 0027 folded municipalities holding fewer than three communities into «Otras zonas de la
-- cuenca», so that a municipality which is really one village stops being a label for that
-- village (2.4). It put no floor on the bucket itself, and that is the whole trick: the
-- bucket only hides somebody if several somebodies are inside it.
--
-- Live, in the current seed, every fallback row came from exactly ONE community:
--
--   Otras zonas de la cuenca | Agua, saneamiento e higiene | 1 pendiente   ← one village
--   Otras zonas de la cuenca | Alimentación y agua         | 1 pendiente   ← one village
--   Otras zonas de la cuenca | Salud                       | 1 pendiente   ← one village
--
-- «Somewhere in the basin, one household needs medicine» is a smaller haystack than it looks
-- in a region where a reader knows which villages are small and which are reachable. And it
-- gets worse on its own: deactivate communities and the bucket narrows without anybody
-- editing anything.
--
-- So the fallback bucket now carries the same threshold the named rows get: a row appears
-- only if at least three distinct communities are behind it, and is suppressed otherwise.
-- Suppressed, not merged upward — there is nowhere safer to put it, and a slightly
-- incomplete public total is a smaller cost than publishing which village needs medicine.
--
-- Deliberately NOT changed: named municipalities still publish per-row without the
-- three-community test. 0027 argued that at this basin's size it would suppress nearly
-- everything (Quibdó's nine communities produce two-community rows) for a small gain in
-- ambiguity, and that argument still holds. The fallback bucket is different in kind: it is
-- the row that *claims* to be anonymous.
--
-- ── 2. Verified demand disappeared while the matcher was down ───────────────────────────
--
-- `pendientes` counted SIN_RUTA, SIN_EXISTENCIA, SIN_CAPACIDAD and LISTO — every state the
-- matcher assigns — but not ABIERTO, which is where a pedido sits before the matcher has
-- looked at it. A verified request therefore counted as neither pending nor attended, its
-- row summed to zero, and the page drops zero rows: during a matcher outage the public page
-- would say «no requests» while verified, unserved demand was sitting in the table.
--
-- That is the failure mode this page exists to not have. It is the number an aid organisation
-- reads to decide whether to come, and it must never quietly under-report the ask because a
-- background job is behind.

drop view if exists mapa_publico;

create view mapa_publico as
with tamano_municipio as (
  select municipio, count(*) as comunidades
    from comunidades
   where activa
   group by municipio
),
etiquetado as (
  select
    case when t.comunidades >= 3 then c.municipio else 'Otras zonas de la cuenca' end as municipio,
    t.comunidades >= 3 as nombrado,
    ci.familia_label,
    p.estado,
    p.comunidad_id
  from pedidos p
  join comunidades c on c.id = p.comunidad_id
  join tamano_municipio t on t.municipio = c.municipio
  join catalogo_items ci on ci.codigo = p.codigo_item
)
select
  municipio,
  familia_label,
  count(*) filter (
    -- ABIERTO included: a verified request the matcher has not reached yet is still somebody
    -- waiting, and leaving it out let real demand vanish behind a stalled job.
    where estado in ('ABIERTO', 'SIN_RUTA', 'SIN_EXISTENCIA', 'SIN_CAPACIDAD', 'LISTO')
  ) as pendientes,
  count(*) filter (where estado = 'ENTREGADO') as atendidos
from etiquetado
group by municipio, familia_label, nombrado
having
  -- A named municipality already cleared the three-community test to be named at all.
  nombrado
  -- The generic bucket has to clear it per row, or it is a label for one village.
  or count(distinct comunidad_id) >= 3;

comment on view mapa_publico is
  'The single public door. Municipality-level counts, named only for municipalities holding at least three communities (2.4); everything else folds into one basin-wide bucket, and a bucket row is published only when at least three distinct communities are behind it — otherwise the generic label would be naming the village it claims to hide. Pending includes ABIERTO so verified demand does not disappear when the matcher is behind. Every column here is safe to publish; nothing else in the database is.';

-- security_invoker stays at its default (false), exactly as in 0006, 0019 and 0027: the view
-- runs with its owner's rights so `anon` reads these counts with no access to the base tables.
revoke all on public.mapa_publico from anon, authenticated;
grant select on public.mapa_publico to anon, authenticated;
