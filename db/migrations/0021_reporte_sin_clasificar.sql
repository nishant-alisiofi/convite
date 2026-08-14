-- A reporte may exist without us knowing yet what kind of thing it is.
--
-- 2.13 says the record is created ON RECEIPT, never on confirmation: if the person walks
-- away, or the signal dies, or they never answer our question, the report still exists and a
-- coordinator can still act on it. 2.12 says returning null must be cheaper than guessing.
--
-- Those two rules collide against `reportes_tipo_check`, which allowed only 'necesidad' and
-- 'dano'. Intake has to write a row the moment a message lands, and at that moment nobody —
-- not the driver, which never classifies (contract §4), and not the normalizer, which is M4
-- and gated on a corpus that does not exist — can say which of the two it is. «La creciente
-- nos entró a las casas» is honestly both or neither until somebody reads it.
--
-- Without a third value the only way to satisfy 2.13 is to default every intake to
-- 'necesidad', which is precisely the guess 2.12 forbids, and it would quietly fabricate
-- demand statistics out of damage reports.
--
-- So: 'sin_clasificar', following the precedent already set on the supply side, where
-- `ofertas.estado` carries SIN_CLASIFICAR and 0011 calls it «a first-class state, not an
-- error» for the same reason (Section 9.4). «Muchas cosas!! De todo!!!» is a phone call a
-- coordinator makes, never a row we refuse.
--
-- This widens `reportes` only. `catalogo_items_tipo_check` keeps the original two values —
-- a catalogue entry that does not know what it is would be a different and much worse bug.

alter table reportes drop constraint reportes_tipo_check;

alter table reportes add constraint reportes_tipo_check
  check (tipo in ('necesidad', 'dano', 'sin_clasificar'));

-- Knowing the catalogue item is knowing the type: `catalogo_items.tipo` decides it. So a row
-- that claims not to be classified must not also carry an item, or half a classification
-- gets written and nothing downstream can tell which half to trust.
alter table reportes add constraint reportes_sin_clasificar_sin_item_check
  check (tipo <> 'sin_clasificar' or codigo_item is null);

comment on column reportes.tipo is
  'necesidad | dano | sin_clasificar. The third is the honest state of a message received but not yet understood (2.12, 2.13). It can never become a pedido: pedidos.codigo_item is NOT NULL and an unclassified reporte has none.';
