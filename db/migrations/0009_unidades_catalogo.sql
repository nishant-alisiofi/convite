-- Unit words for the catalogue.
--
-- Section 8 requires `motivo` to be a sentence a coordinator reads: «Hay 18 mercados en
-- Tutunendo, pero nadie va para allá esta semana». Producing "18 mercados" from the label
-- "Mercado y alimentos" is not something code can do in Spanish, and non-negotiable 2.8
-- forbids a lookup table of codes in the source. So the plural is what it always was:
-- catalogue data, editable from the Catálogo screen alongside the label.
--
-- Nullable, because an item added tomorrow may not have them yet; the sentence builder
-- falls back to the label.

alter table catalogo_items
  add column unidad_singular text,
  add column unidad_plural   text;

comment on column catalogo_items.unidad_plural is
  'How a person counts this item out loud: «18 mercados», «40 bidones de agua». Used verbatim in pedidos.motivo.';
