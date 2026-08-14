-- Row level security: deny by default.
--
-- Non-negotiable 2.4 says the public boundary is enforced in Postgres, not in the frontend.
-- This migration closes everything. The per-role policies of Section 11 (lectura,
-- verificador, despachador, coordinador, admin, and the time-windowed transporter policy)
-- are added in M3 as grants and policies on top of this floor — so the failure mode of a
-- half-finished policy set is "staff cannot read", never "anon can".

do $rls$
declare
  t text;
begin
  foreach t in array array[
    'organizaciones', 'comunidades', 'contactos', 'usuarios', 'usuarios_comunidades',
    'catalogo_items', 'reportes', 'adjuntos', 'mensajes', 'conversaciones',
    'nodos', 'existencias', 'pedidos', 'rutas', 'capacidades', 'emparejamientos',
    'envios', 'envio_items', 'entregas', 'decisiones_asignacion',
    'jobs', 'auditoria'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$rls$;

-- The single public door. `anon` may read the aggregate and nothing else; the view runs
-- with owner rights (see 0006), so this grant does not open the base tables.
grant select on public.mapa_publico to anon, authenticated;

-- Future tables must not leak by default either.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
