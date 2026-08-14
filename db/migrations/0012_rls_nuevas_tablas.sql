-- Extend the deny-by-default RLS floor from 0007 to the tables added since.
--
-- Non-negotiable 2.16 in particular: `ofertas.direccion_texto` is a private home address
-- next to a name and "has supplies". It is exactly as sensitive as a community location,
-- and the per-role policies in M3 must reveal it only to the assigned pickup driver inside
-- their assignment window. Until those policies exist, nobody but the service role reads it.

do $rls$
declare
  t text;
begin
  foreach t in array array['salidas_pendientes', 'ofertas', 'voluntarios', 'recogidas']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$rls$;
