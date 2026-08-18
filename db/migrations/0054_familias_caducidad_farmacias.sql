-- FR-45 / FR-43 / FR-44 — field feedback from Chocó (Doña Marta), relayed by Nishant
-- 2026-08-17. Three correlated inventory asks, one migration because they share the same
-- tables (catalogo_items, existencias, proveedores_locales):
--
--   FR-45  three coarse aid families (alimentos / medicinas / construcción) on the catalogue,
--          on top of its existing finer families, so Inventario/Informes can filter by them.
--   FR-43  expiry tracking for perishable lots of counted node stock, honestly optional.
--   FR-44  a local pharmacy as a structurally-tracked supply source tied to a community.

-- ── FR-45: the three coarse families ────────────────────────────────────────────────────────
--
-- Not a rebuild of the catalogue's own family/tipo taxonomy — a coarser field-facing rollup on
-- top of it. Only items that are genuinely food, medicine or construction material get a value;
-- shelter kits, hygiene, niñez, medios de vida (outside herramientas/semillas) and daños stay
-- NULL, which is the honest answer (2.12 / BUG-23: never invent a classification to fill a
-- field). See the comment on FAMILIAS_AYUDA in db/schema/vocabulario.ts.

alter table catalogo_items add column familia_ayuda text;

alter table catalogo_items add constraint catalogo_items_familia_ayuda_check
  check (familia_ayuda is null or familia_ayuda in ('alimentos', 'medicinas', 'construccion'));

-- Backfill by the catalogue's existing family digit, which is stable across both the real
-- registry catalogue (sembrar:territorio, families 1-7/9) and the local demo overlay
-- (db:seed, families 1-6/9) — except family '6', whose meaning differs between the two
-- ("Partería" kits in the registry, "Medios de vida" tools/seeds in the demo overlay), so
-- that one case is disambiguated by the item label instead of the family digit.
update catalogo_items set familia_ayuda =
  case
    when familia = '1' then 'alimentos'      -- Alimentación y agua
    when familia = '2' then 'medicinas'      -- Salud (incl. insumos de diabetes)
    when familia = '7' then 'construccion'   -- Vivienda: zinc, madera, cemento, herramientas…
    when familia = '6' and item_label ilike '%herramienta%' then 'construccion'
    when familia = '6' and item_label ilike '%semilla%' then 'alimentos'
    when familia = '6' then 'medicinas'      -- Partería: kits prenatal/parto
    else null                                -- Albergue, higiene, niñez, daños: not one of the three
  end;

-- ── FR-43: perishable-item flag + expiry lots ───────────────────────────────────────────────
--
-- `perecedero` flags a catalogue LINE whose counted node stock always carries a shelf life —
-- packaged food, medicine, water-treatment tablets. Distinct from `ofertas.perecedero`, which
-- marks one donor's free-text offer (a cooked meal is perishable however its item code's usual
-- stock behaves); this is about counted stock tracked by catalogue code, where the code itself
-- is a reliable signal.

alter table catalogo_items add column perecedero boolean not null default false;

update catalogo_items set perecedero = true
 where codigo in ('11', '13', '21', '22', '24', '25', '44');

-- `existencias` is one row per (nodo, item) — a running count, never a batch. A lot is a
-- subdivision of that row: how much of a specific batch, and when it expires. Lots need not
-- sum to the parent's `cantidad` — logging the batch that matters (soonest to expire) without
-- re-deriving the whole count is the same spirit as `existencias.cantidad` itself.

create table existencia_lotes (
  id                  uuid primary key default gen_random_uuid(),
  existencia_id       uuid not null references existencias (id) on delete cascade,
  cantidad            integer not null,
  -- Honest and optional (2.3, BUG-23): NULL reads «sin fecha», never a fabricated date.
  fecha_caducidad     date,
  contado_en          timestamptz not null default now(),
  contado_por         uuid not null references usuarios (id),
  notas               text,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),

  constraint existencia_lotes_cantidad_check check (cantidad > 0)
);

create index existencia_lotes_existencia_idx on existencia_lotes (existencia_id);
-- Only the lots that carry a date need to be found fast for "soonest expiry first" — mirrors
-- ofertas_perecedero_idx.
create index existencia_lotes_caducidad_idx on existencia_lotes (fecha_caducidad)
  where fecha_caducidad is not null;

comment on table existencia_lotes is
  'FR-43: a subdivision of one existencias row (a batch), carrying an optional expiry date. Lots need not sum to the parent cantidad. fecha_caducidad NULL means genuinely unknown, never guessed (2.3, BUG-23).';

create trigger existencia_lotes_tocar before update on existencia_lotes
  for each row execute function tocar_actualizado_en();

-- RLS: same shape as its parent `existencias` (0017) — role-gated, not org-scoped, because
-- `existencias` itself carries no organizacion_id and neither does a lot hanging off it.
alter table existencia_lotes enable row level security;
revoke all on public.existencia_lotes from anon, authenticated;
grant select, insert, update, delete on public.existencia_lotes to authenticated;

create policy existencia_lotes_lectura on existencia_lotes
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));

create policy existencia_lotes_agrega on existencia_lotes
  for insert to authenticated
  with check (convite_es(array['coordinador', 'admin']) and contado_por = auth.uid());

-- Update/delete carry no actor check, same as the parent `existencias_coordina` (0017) — a
-- coordinator correcting a colleague's count is routine, not a violation.
create policy existencia_lotes_corrige on existencia_lotes
  for update to authenticated
  using (convite_es(array['coordinador', 'admin']))
  with check (convite_es(array['coordinador', 'admin']));

create policy existencia_lotes_elimina on existencia_lotes
  for delete to authenticated
  using (convite_es(array['coordinador', 'admin']));

-- ── FR-44: a local pharmacy, structurally tracked ───────────────────────────────────────────
--
-- Medicine already sitting in a community's pharmacy is faster and cheaper than shipping it in
-- — the supply-side twin of PRD-9 (compra local financiada). A pharmacy is a proveedor_local
-- whose stock is tracked item by item rather than only in the free-text `suministra` column.

alter table proveedores_locales add column es_farmacia boolean not null default false;

alter table proveedores_locales add constraint proveedores_locales_farmacia_comunidad_check
  check (not es_farmacia or comunidad_id is not null);

-- One row per (proveedor, item), the same shape as `existencias` for node stock, so Existencias
-- and Compra local can read pharmacy stock the way they already read counted stock.
-- organizacion_id is denormalised from the parent, same pattern as compras_locales (0049), so
-- RLS reads it directly rather than joining through proveedores_locales on every row check.

create table proveedor_existencias (
  id                  uuid primary key default gen_random_uuid(),
  organizacion_id     uuid not null references organizaciones (id),
  proveedor_id        uuid not null references proveedores_locales (id) on delete cascade,
  codigo_item         char(2) not null references catalogo_items (codigo),
  cantidad            integer not null default 0,
  contado_en          timestamptz not null default now(),
  contado_por         uuid not null references usuarios (id),
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),

  constraint proveedor_existencias_cantidad_check check (cantidad >= 0)
);

create index proveedor_existencias_organizacion_idx on proveedor_existencias (organizacion_id);
create unique index proveedor_existencias_proveedor_item_key
  on proveedor_existencias (proveedor_id, codigo_item);

comment on table proveedor_existencias is
  'FR-44: structured stock for a proveedor_local (in practice, a pharmacy — es_farmacia). Same shape as existencias, so it reads the same way in Existencias and Compra local.';

create trigger proveedor_existencias_tocar before update on proveedor_existencias
  for each row execute function tocar_actualizado_en();

-- RLS: same role split and org-scoping as its parent `proveedores_locales` (0049) — reads are
-- org-scoped with a platform-admin cross-org read; writes are coordinador/admin/despachador
-- (matching who may work Compra local day to day), scoped to their own organisation.

alter table proveedor_existencias enable row level security;
revoke all on public.proveedor_existencias from anon, authenticated;
grant select, insert, update, delete on public.proveedor_existencias to authenticated;

create policy proveedor_existencias_lectura on proveedor_existencias
  for select to authenticated
  using (
    convite_es(array['verificador', 'despachador', 'coordinador', 'admin'])
    and (organizacion_id = convite_organizacion() or convite_es_plataforma())
  );

create policy proveedor_existencias_agrega on proveedor_existencias
  for insert to authenticated
  with check (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and organizacion_id = convite_organizacion()
    and contado_por = auth.uid()
  );

create policy proveedor_existencias_actualiza on proveedor_existencias
  for update to authenticated
  using (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and organizacion_id = convite_organizacion()
  )
  with check (
    convite_es(array['coordinador', 'admin', 'despachador'])
    and organizacion_id = convite_organizacion()
  );
