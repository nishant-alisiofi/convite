-- The public aggregate stops naming municipalities that are one community.
--
-- 0019 answered decision D6 by dropping `agrupador` from this view, on the reasoning that
-- «in a basin of thirteen communities» a sub-municipal grouping is «close enough to naming
-- them». That reasoning was right and it was not finished: it stopped one level too high.
--
-- Of the five municipalities in the seeded basin, **four contain exactly one community**:
--
--     Quibdó        9   Boca de Tanandó, Guayabal, Las Mercedes, Pacurita, Quibdó,
--                       San Francisco de Ichó, Tagachí, Tutunendo, Winandó
--     Atrato        1   Yuto
--     Bojayá        1   Bellavista
--     Medio Atrato  1   Beté
--     Río Quito     1   Paimadó
--
-- So «Bojayá · Alimentación y agua · 7 pendientes», published to `anon`, is not an aggregate
-- at all. It is the sentence "Bellavista has seven households without food", readable by
-- anybody, about a village of 430 families reachable only by a boat that comes when it
-- comes. Non-negotiable 2.4 exists because that sentence is targeting information in a
-- territory with armed actor presence, and the view was emitting it while being called
-- aggregated — which is worse than emitting it honestly, because nobody was checking.
--
-- The reference schema's version of this was a `st_centroid(st_collect(...))` column, whose
-- degenerate case is the same defect wearing coordinates: the centroid of one community is
-- that community's location. That column never made it into the implemented view, so this
-- migration does not have to remove it. The identity leak survived without it.
--
-- The rule now: **a municipality is named only if it holds at least UMBRAL communities.**
-- Everything else becomes one basin-wide bucket, so the totals stay complete and no row is
-- about somebody in particular.

-- Three is the smallest threshold at which a named row is about a group rather than a
-- person or a place. It is a constant in the view rather than a setting because loosening
-- it is a decision that should require reading this comment.
--
-- What this deliberately does NOT do: apply the same threshold per published row, i.e.
-- require three distinct communities to have reported *that family of need* before the row
-- appears. At this basin's size that would suppress nearly everything — Quibdó's nine
-- communities currently produce two-community rows — and the residual ambiguity it would
-- buy (which of nine, rather than which of nine) is small next to what it would cost a
-- donor trying to see the scale of the response. Revisit if the basin grows.

drop view if exists mapa_publico;

create view mapa_publico as
with tamano_municipio as (
  select municipio, count(*) as comunidades
    from comunidades
   where activa
   group by municipio
)
select
  case
    when t.comunidades >= 3 then c.municipio
    else 'Otras zonas de la cuenca'
  end as municipio,
  ci.familia_label,
  count(*) filter (
    where p.estado in ('SIN_RUTA', 'SIN_EXISTENCIA', 'SIN_CAPACIDAD', 'LISTO')
  ) as pendientes,
  count(*) filter (where p.estado = 'ENTREGADO') as atendidos
from pedidos p
join comunidades c on c.id = p.comunidad_id
join tamano_municipio t on t.municipio = c.municipio
join catalogo_items ci on ci.codigo = p.codigo_item
group by 1, ci.familia_label;

comment on view mapa_publico is
  'The single public door. Municipality-level counts, and only for municipalities holding at least three communities — a municipality that is one village is that village (2.4). Every column here is safe to publish; nothing else in the database is.';

-- security_invoker stays at its default (false), exactly as in 0006 and 0019: the view runs
-- with its owner's rights so `anon` reads these counts with no access to the base tables.
-- Setting it true would make the view return nothing and invite somebody to "fix" that by
-- granting anon direct table access.

revoke all on public.mapa_publico from anon, authenticated;
grant select on public.mapa_publico to anon, authenticated;
