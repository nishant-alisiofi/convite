-- Org-scope the WRITE policies on rutas_restriccion_cadena_frio.
--
-- Codex validation of build aa02969 found: migration 0058 org-scoped the READ policy but split
-- the old `FOR ALL` write policy into insert/update/delete that kept the ROLE-ONLY predicate —
-- so a coordinador/admin of Org A could still INSERT (or update/delete) a cold-chain restriction
-- on Org B's route. That is a cross-org write leak.
--
-- Fix: every write now also requires the route to belong to the caller's organisation, via the
-- same parent chain the read policy (0058) already uses:
--   rutas_restriccion_cadena_frio.ruta_id -> rutas.{origen_id,destino_id} -> comunidades.organizacion_id
-- Writes are NOT widened to platform admins (they read across orgs by 0034, but do not write),
-- matching how existencia_lotes / proveedor_existencias / pagos_lanchero scope their writes.
-- No other policy is touched; the read policy from 0058 is left exactly as-is.

drop policy rutas_restriccion_agrega on rutas_restriccion_cadena_frio;
create policy rutas_restriccion_agrega on rutas_restriccion_cadena_frio
  for insert to authenticated
  with check (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1
        from rutas r
        join comunidades co on co.id = r.origen_id
        join comunidades cd on cd.id = r.destino_id
       where r.id = rutas_restriccion_cadena_frio.ruta_id
         and (co.organizacion_id = convite_organizacion() or cd.organizacion_id = convite_organizacion())
    )
  );

drop policy rutas_restriccion_actualiza on rutas_restriccion_cadena_frio;
create policy rutas_restriccion_actualiza on rutas_restriccion_cadena_frio
  for update to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1
        from rutas r
        join comunidades co on co.id = r.origen_id
        join comunidades cd on cd.id = r.destino_id
       where r.id = rutas_restriccion_cadena_frio.ruta_id
         and (co.organizacion_id = convite_organizacion() or cd.organizacion_id = convite_organizacion())
    )
  )
  with check (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1
        from rutas r
        join comunidades co on co.id = r.origen_id
        join comunidades cd on cd.id = r.destino_id
       where r.id = rutas_restriccion_cadena_frio.ruta_id
         and (co.organizacion_id = convite_organizacion() or cd.organizacion_id = convite_organizacion())
    )
  );

drop policy rutas_restriccion_elimina on rutas_restriccion_cadena_frio;
create policy rutas_restriccion_elimina on rutas_restriccion_cadena_frio
  for delete to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1
        from rutas r
        join comunidades co on co.id = r.origen_id
        join comunidades cd on cd.id = r.destino_id
       where r.id = rutas_restriccion_cadena_frio.ruta_id
         and (co.organizacion_id = convite_organizacion() or cd.organizacion_id = convite_organizacion())
    )
  );
