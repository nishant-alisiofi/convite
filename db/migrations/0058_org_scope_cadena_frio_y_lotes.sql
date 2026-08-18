-- Security fix — release blocker #2 / cross-cutting check "New-table RLS is org-scoped"
-- (staging validation, build 8894a2c, 2026-08-18): three policies added since multi-org
-- landed (0034) were role-gated only, with no organisation or parent-ownership predicate,
-- so a coordinador/admin/despachador/verificador in one organisation could read (and in one
-- case write) rows that belong to a different organisation's node or route:
--
--   * `existencia_lotes` (0054)                — read AND write were role-only.
--   * `nodos_almacenamiento_frio` (0046)       — read was role-only (write already scoped).
--   * `rutas_restriccion_cadena_frio` (0046)   — read was role-only. Its ONLY read policy was
--     in fact `rutas_restriccion_coordina`, a single `FOR ALL` policy — which in Postgres RLS
--     covers SELECT too, and permissive policies OR together. So even narrowing
--     `rutas_restriccion_lectura` alone is not sufcient: the `FOR ALL` policy's role-only
--     `USING` still grants every coordinador/admin an unscoped SELECT no matter what the
--     dedicated read policy says. `rutas_restriccion_coordina` is split below into separate
--     INSERT/UPDATE/DELETE policies with the exact same role-only predicate it already had —
--     the write permission is unchanged, only the incidental SELECT grant hiding inside `FOR
--     ALL` is removed. This is deliberate, not a narrowing of writes: `rutas` themselves have
--     no owning organisation and `rutas_coordina` (0017) has never scoped route edits to one
--     org — a route is shared infrastructure between two communities, coordinated by whichever
--     org is moving something along it.
--
-- None of `existencia_lotes`, `nodos_almacenamiento_frio` or `rutas_restriccion_cadena_frio`
-- carries its own `organizacion_id`, so each predicate below reaches the owning organisation
-- through the same parent chain its sibling policies already use:
--
--   existencia_lotes  -> existencias.nodo_id -> nodos.comunidad_id -> comunidades.organizacion_id
--   nodos_almacenamiento_frio.nodo_id        -> nodos.comunidad_id -> comunidades.organizacion_id
--   rutas_restriccion_cadena_frio.ruta_id    -> rutas.{origen_id,destino_id} -> comunidades.organizacion_id
--
-- The nodos_almacenamiento_frio chain is exactly the one `nodos_almacenamiento_admin_escribe`
-- (0046) already uses for writes. A ruta touches two communities that need not share an
-- organisation, so its read is granted to a caller whose organisation owns EITHER endpoint —
-- narrower than "any role, any org" (the leak), no narrower than legitimate multi-org
-- coordination on a shared leg requires.
--
-- Platform-admin cross-org reads (0034, `convite_es_plataforma()`) are preserved on every
-- read policy touched here, exactly as `proveedor_existencias_lectura` (0054),
-- `pagos_lanchero_lectura` (0056) and `lancheros_comunidades_lectura` (0056) already do. Writes
-- are not widened to the platform tier, matching those same three tables.
--
-- Every other policy is untouched. `existencias_lectura`, `nodos_lectura`, `rutas_lectura` and
-- `comunidades_lectura` (0017) stay role-only on purpose — they are the shared-territory
-- reference read a coordinator across the whole basin relies on, unchanged since 0017 and
-- explicitly left alone by 0034 ("not one existing policy is weakened... what it does NOT
-- touch is the data boundary"). This migration does not reopen that question; it closes the
-- three narrower leaks Codex named.

-- ── existencia_lotes (0054): read AND write become org-scoped ──────────────────────────────

drop policy existencia_lotes_lectura on existencia_lotes;
drop policy existencia_lotes_agrega on existencia_lotes;
drop policy existencia_lotes_corrige on existencia_lotes;
drop policy existencia_lotes_elimina on existencia_lotes;

create policy existencia_lotes_lectura on existencia_lotes
  for select to authenticated
  using (
    convite_es(array['verificador', 'despachador', 'coordinador', 'admin'])
    and (
      convite_es_plataforma()
      or exists (
        select 1
          from existencias e
          join nodos n on n.id = e.nodo_id
          join comunidades c on c.id = n.comunidad_id
         where e.id = existencia_lotes.existencia_id
           and c.organizacion_id = convite_organizacion()
      )
    )
  );

create policy existencia_lotes_agrega on existencia_lotes
  for insert to authenticated
  with check (
    convite_es(array['coordinador', 'admin'])
    and contado_por = auth.uid()
    and exists (
      select 1
        from existencias e
        join nodos n on n.id = e.nodo_id
        join comunidades c on c.id = n.comunidad_id
       where e.id = existencia_lotes.existencia_id
         and c.organizacion_id = convite_organizacion()
    )
  );

-- Update/delete still carry no actor check, same as the parent `existencias_coordina` (0017) —
-- a coordinator correcting a colleague's count is routine, not a violation. What changes is
-- that "colleague" now means "in the same organisation as the node the lot hangs off of".

create policy existencia_lotes_corrige on existencia_lotes
  for update to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1
        from existencias e
        join nodos n on n.id = e.nodo_id
        join comunidades c on c.id = n.comunidad_id
       where e.id = existencia_lotes.existencia_id
         and c.organizacion_id = convite_organizacion()
    )
  )
  with check (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1
        from existencias e
        join nodos n on n.id = e.nodo_id
        join comunidades c on c.id = n.comunidad_id
       where e.id = existencia_lotes.existencia_id
         and c.organizacion_id = convite_organizacion()
    )
  );

create policy existencia_lotes_elimina on existencia_lotes
  for delete to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    and exists (
      select 1
        from existencias e
        join nodos n on n.id = e.nodo_id
        join comunidades c on c.id = n.comunidad_id
       where e.id = existencia_lotes.existencia_id
         and c.organizacion_id = convite_organizacion()
    )
  );

-- ── nodos_almacenamiento_frio (0046): read becomes org-scoped ──────────────────────────────
-- Write (nodos_almacenamiento_admin_escribe) already joins nodos -> comunidades the same way —
-- only the read policy was missing the predicate.

drop policy nodos_almacenamiento_lectura on nodos_almacenamiento_frio;

create policy nodos_almacenamiento_lectura on nodos_almacenamiento_frio
  for select to authenticated
  using (
    convite_es(array['verificador', 'despachador', 'coordinador', 'admin'])
    and (
      convite_es_plataforma()
      or exists (
        select 1 from nodos n
          join comunidades c on c.id = n.comunidad_id
         where n.id = nodos_almacenamiento_frio.nodo_id
           and c.organizacion_id = convite_organizacion()
      )
    )
  );

-- ── rutas_restriccion_cadena_frio (0046): read becomes org-scoped ──────────────────────────
-- A route has no owning organisation of its own — it connects two communities that may belong
-- to different organisations. Readable by an organisation that owns either endpoint, which is
-- who has a legitimate stake in whether the leg is cold-chain apt.

drop policy rutas_restriccion_lectura on rutas_restriccion_cadena_frio;

create policy rutas_restriccion_lectura on rutas_restriccion_cadena_frio
  for select to authenticated
  using (
    convite_es(array['verificador', 'despachador', 'coordinador', 'admin'])
    and (
      convite_es_plataforma()
      or exists (
        select 1
          from rutas r
          join comunidades co on co.id = r.origen_id
          join comunidades cd on cd.id = r.destino_id
         where r.id = rutas_restriccion_cadena_frio.ruta_id
           and (co.organizacion_id = convite_organizacion() or cd.organizacion_id = convite_organizacion())
      )
    )
  );

-- `rutas_restriccion_coordina` was a single `FOR ALL` policy — its role-only `USING` also
-- granted SELECT, unscoped, which is what let the read leak survive a narrower dedicated read
-- policy above. Split into INSERT/UPDATE/DELETE so the read path runs through
-- `rutas_restriccion_lectura` alone. Same role check as before, same organisations able to
-- write — nothing about who may write is any different than it was.

drop policy rutas_restriccion_coordina on rutas_restriccion_cadena_frio;

create policy rutas_restriccion_agrega on rutas_restriccion_cadena_frio
  for insert to authenticated
  with check (convite_es(array['coordinador', 'admin']));

create policy rutas_restriccion_actualiza on rutas_restriccion_cadena_frio
  for update to authenticated
  using (convite_es(array['coordinador', 'admin']))
  with check (convite_es(array['coordinador', 'admin']));

create policy rutas_restriccion_elimina on rutas_restriccion_cadena_frio
  for delete to authenticated
  using (convite_es(array['coordinador', 'admin']));
