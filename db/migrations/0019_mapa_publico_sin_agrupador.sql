-- PRD decision D6: `mapa_publico` stops grouping by `agrupador`.
--
-- 2.4 is municipality-level counts, and the view in 0006 also grouped by a sub-municipal
-- field. `agrupador` holds values like 'Atrato medio', 'Vía Yuto', 'Río Ichó' — a stretch of
-- river with a handful of settlements on it. Grouping by it turns "Quibdó has 14 pending
-- medical transfers" into "the Atrato medio has 14", which in a basin of thirteen
-- communities is close enough to naming them. That is the threat model 2.4 describes, in a
-- territory with armed actor presence, so the column comes out of the public surface.
--
-- `comunidades.agrupador` itself stays: it is a useful operational grouping behind RLS, and
-- the damage-clustering alert in the spec is defined over it. Only the public view loses it.
--
-- A view column cannot be dropped with `create or replace`, so this drops and recreates.
-- That discards the grants, which is why 0015's revoke/grant pair is repeated below rather
-- than left to the earlier migration.

drop view if exists mapa_publico;

create view mapa_publico as
select
  c.municipio,
  ci.familia_label,
  count(*) filter (where p.estado in ('SIN_RUTA', 'SIN_EXISTENCIA', 'SIN_CAPACIDAD', 'LISTO')) as pendientes,
  count(*) filter (where p.estado = 'ENTREGADO') as atendidos
from pedidos p
join comunidades c on c.id = p.comunidad_id
join catalogo_items ci on ci.codigo = p.codigo_item
group by c.municipio, ci.familia_label;

comment on view mapa_publico is
  'Public aggregate. Every column here is safe to publish; nothing else in the database is.';

-- security_invoker stays at its default (false) deliberately, exactly as in 0006: the view
-- runs with its owner's rights so `anon` reads these counts without any access to the base
-- tables. Setting it true would make the view return nothing and invite someone to "fix"
-- that by granting anon direct table access.

revoke all on public.mapa_publico from anon, authenticated;
grant select on public.mapa_publico to anon, authenticated;
