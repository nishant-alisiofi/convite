-- Seven of the ten collection nodes had no location, so the map could not draw them.
--
-- `territorio.sql` inserts the registry nodes as `(nombre, tipo, comunidad_id, activo)` — no
-- `ubicacion` column at all. Every acopio in the registry, Bodega Quibdó included, was therefore
-- unmappable: `representacionDe` returns `ausente` and the node falls into the «Sin ubicar» text
-- list under the map instead of onto it. «A centre with nodes around it» had no nodes to draw.
--
-- The fix is not to invent coordinates. Nobody here knows which building in Quibdó the bodega
-- is, and non-negotiable 2.2 exists to stop us pretending otherwise — a stored point never
-- travels without its declared source and radius.
--
-- But we do not need to invent anything, because every one of these nodes already sits in a
-- community whose position we hold. Acopio Istmina is in Istmina; Istmina is at 5.16, -76.685
-- as a `centroide` good to a kilometre. Inheriting that says exactly as much as we actually
-- know — «somewhere in this town, within about a kilometre» — which is what `centroide` means
-- in this schema, and no more.
--
-- Note this is the opposite call from the one `scripts/seed.ts` makes for pedidos, which
-- deliberately carry no geometry because «borrowing the community centroid would be inventing a
-- precision». The difference is real: a pedido comes from a household that is somewhere in the
-- community and emphatically not at its centre, so the centroid would overstate what we know
-- about that household. A bodega serving Istmina *is* in Istmina. Inheriting is honest for the
-- node and dishonest for the request.
--
-- Only fills the gap: a node that already carries a `manual` fix keeps it. The three nodes the
-- demo seed located by hand (Bodega Central Quibdó ±250, Acopio Tagachí ±500, Acopio Pizarro
-- ±300) are more precise than their community and must not be coarsened.

update nodos n
   set ubicacion = c.ubicacion,
       ubicacion_fuente = 'centroide',
       ubicacion_precision_m = coalesce(c.ubicacion_precision_m, 1000)
  from comunidades c
 where c.id = n.comunidad_id
   and n.ubicacion is null
   and c.ubicacion is not null;

-- Deliberately NOT a trigger or a default. A node created from now on should be located by the
-- person who knows where it is — the inheritance is a floor for registry rows that arrived
-- without one, not the way locations are meant to be set. A trigger would quietly make
-- «centroide» the permanent answer for every future node and nobody would ever place one
-- properly again.

comment on column nodos.ubicacion_fuente is
  'How the node''s point was obtained. `centroide` here often means inherited from its community (migration 0066): we know the town, not the building. `manual` means somebody placed it deliberately and is more precise — never overwrite one with an inherited value.';

-- ---------------------------------------------------------------------------
-- The organisations' own points.
--
-- `organizaciones.ubicacion` was null for every row, so «este centro» was never on the map —
-- the page read the column and printed it as two decimal numbers underneath instead. There is
-- no organizacion → comunidad foreign key, so unlike the nodes above these cannot be inherited;
-- they have to be stated.
--
-- Stated at the MUNICIPAL SEAT, `centroide`, ±1000 m — not at a street address, and that is a
-- deliberate choice rather than a limit of what could be found.
--
-- ASOREDIPARCHOCÓ (Asociación de la Red Interétnica de Parteras y Parteros del Chocó, founded
-- 2010, ~1.050 asociados across 30 municipios) publishes that its sede is in Quibdó and no more
-- than that; Quibdó ±1 km is therefore the whole of what is actually known.
--
-- Where a precise address *is* published — Red Departamental de Mujeres Chocoanas is registered
-- at a specific carrera in Quibdó, NIT 818000238-3 — we still do not store it. These are women's
-- organisations in a conflict-affected department, and PRD-multiciudad §2 is explicit that
-- copying Ayudas Pereira's public directory of addresses is «the single most important thing not
-- to copy»: what is a convenience in Pereira after an earthquake is a target list here. That is
-- what non-negotiables 2.4 and 2.16 are for. Municipality-level is indistinguishable at map zoom
-- and carries none of that risk.
-- ---------------------------------------------------------------------------

update organizaciones o
   set ubicacion = c.ubicacion,
       ubicacion_fuente = 'centroide',
       ubicacion_precision_m = coalesce(c.ubicacion_precision_m, 1000)
  from comunidades c
 where o.ubicacion is null
   and (
     (o.nombre = 'ASOREDIPARCHOCÓ' and c.codigo = 'CH-QUI')
     or (o.nombre = 'Fundación Herencia de Timbiquí' and c.codigo = 'CA-TIM')
   );
