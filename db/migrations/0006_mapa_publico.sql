-- The only thing an unauthenticated caller may ever read.
--
-- Non-negotiable 2.4: aggregated by design. No coordinates, no community names, no phone
-- numbers, no household data. A live map of vulnerable households next to transport
-- schedules is targeting information in a territory with armed actor presence.
--
-- security_invoker is left at its default (false) deliberately: the view runs with its
-- owner's rights, so `anon` reads these counts without being granted any access to the base
-- tables, which stay locked by the RLS policies in 0007. Do not add security_invoker = true
-- here — it would make the view return nothing and invite someone to "fix" it by granting
-- anon direct table access.

create view mapa_publico as
select
  c.municipio,
  c.agrupador,
  ci.familia_label,
  count(*) filter (where p.estado in ('SIN_RUTA', 'SIN_EXISTENCIA', 'SIN_CAPACIDAD', 'LISTO')) as pendientes,
  count(*) filter (where p.estado = 'ENTREGADO') as atendidos
from pedidos p
join comunidades c on c.id = p.comunidad_id
join catalogo_items ci on ci.codigo = p.codigo_item
group by c.municipio, c.agrupador, ci.familia_label;

comment on view mapa_publico is
  'Public aggregate. Every column here is safe to publish; nothing else in the database is.';
