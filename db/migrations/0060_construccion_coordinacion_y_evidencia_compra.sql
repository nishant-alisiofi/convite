-- Three follow-ups, one migration because none touches the others' tables.

-- ── 1. FR-45: «Plásticos y tejas» (codigo 33) resolves to construcción ─────────────────────────
--
-- 0054 backfilled the three coarse aid families onto the existing catalogue by family digit, and
-- left family 3 (abrigo/albergue) entirely NULL — correct for cobijas, colchonetas and the kit de
-- cocina, but wrong for code 33: roofing plastic and tejas is a repair/building material, the
-- same kind of good as family 7's «láminas de zinc» (already construcción), not shelter bedding.
-- Left unmapped, the Inventario/Informes construcción partition read zero even though code 33
-- already carries real demand — the one abrigo item that should never have stayed null.
--
-- Both seed sources (db/seed/territorio.sql, db/seed/catalogo.ts) now insert code 33 with
-- familia_ayuda = 'construccion' directly; this statement is the backfill for a database that
-- already ran 0054 and seeded before this change.

update catalogo_items set familia_ayuda = 'construccion' where codigo = '33';

-- ── 2. FR-45: `/coordinacion` (Cobertura) can filter demand by family ───────────────────────────
--
-- `convite_coordinacion_demanda()` (0052) already aggregates pendientes/atendidos by municipio;
-- it just never let the caller narrow that to one of the three FR-45 families, so Cobertura had
-- no way to answer "how much of what's pending here is construcción". An optional
-- `p_familia_ayuda` parameter, defaulting to null (no filter, same output as before), joins
-- through `catalogo_items` the same way the demanda numbers already key off `pedidos.codigo_item`.
-- The old zero-argument overload is dropped so there is exactly one signature to grant and call.

drop function if exists convite_coordinacion_demanda();

create function convite_coordinacion_demanda(p_familia_ayuda text default null)
returns table (municipio text, pendientes bigint, atendidos bigint)
language sql stable security definer set search_path = public
as $$
  select c.municipio,
         count(*) filter (
           where p.estado in ('ABIERTO', 'SIN_RUTA', 'SIN_EXISTENCIA', 'SIN_CAPACIDAD', 'LISTO', 'EN_CAMINO')
         ) as pendientes,
         count(*) filter (where p.estado = 'ENTREGADO') as atendidos
    from pedidos p
    join comunidades c on c.id = p.comunidad_id
    left join catalogo_items ci on ci.codigo = p.codigo_item
   where p_familia_ayuda is null or ci.familia_ayuda = p_familia_ayuda
   group by c.municipio
   order by c.municipio
$$;

comment on function convite_coordinacion_demanda(text) is
  'PRD-35 (§29.3b) + FR-45: municipality-level demand counts (pending vs attended) aggregated across every organisation, optionally narrowed to one of the three coarse aid families (alimentos/medicinas/construccion). Null = every family, same output as the original zero-argument version. An aggregate over a municipality identifies nobody.';

grant execute on function convite_coordinacion_demanda(text) to authenticated;

-- ── 3. PRD-9: closing evidence cannot be filed before verification ──────────────────────────────
--
-- The six-step chain's own state (`compras_locales.estado`) cannot skip a step — 0049's check
-- constraints see to that — but nothing stopped `compra_local_evidencias` (a child table, not a
-- state transition of the row itself) from taking a `foto`/`documento`/`acta` row — step 6's
-- closing evidence — while the purchase was still sitting at `AUTORIZADA` or `COMPRADA`, before
-- verification (step 4) ever happened. `recibo` is exempt: `registrarRecibo` files it in the same
-- transaction that moves the compra to `COMPRADA`, before verification exists, so it is step 3's
-- own evidence, not step 6's. Same posture as every other boundary in this module (lib/compra-
-- local/datos.ts: "RLS is the real boundary... this module never re-implements those guards") —
-- the `with check` refuses the insert outright, not just the panel's form.

drop policy compra_local_evidencias_agrega on compra_local_evidencias;

create policy compra_local_evidencias_agrega on compra_local_evidencias
  for insert to authenticated
  with check (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and subido_por = auth.uid()
    and exists (
      select 1 from compras_locales c
       where c.id = compra_id and c.organizacion_id = convite_organizacion()
         and (tipo = 'recibo' or c.estado in ('VERIFICADA', 'DISTRIBUIDA', 'CERRADA'))
    )
  );
