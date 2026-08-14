-- The item catalogue.
--
-- Non-negotiable 2.8: this is data, not code. Nothing in the repo may switch on an item
-- code, and adding an item for a new territory must never require a deploy.

create table catalogo_items (
  codigo                  char(2) primary key,
  familia                 char(1) not null,
  familia_label           text not null,
  item_label              text not null,
  tipo                    text not null,
  ayuda_texto             text,
  pide_detalle            boolean not null default false,
  urgencia_min            smallint not null default 1,
  entregable              boolean not null default true,
  orden                   integer not null default 0,
  activo                  boolean not null default true,
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),

  constraint catalogo_items_codigo_check  check (codigo ~ '^[0-9]{2}$'),
  constraint catalogo_items_familia_check check (familia = left(codigo, 1)),
  constraint catalogo_items_tipo_check    check (tipo in ('necesidad', 'dano')),
  constraint catalogo_items_urgencia_check check (urgencia_min between 1 and 3)
);

comment on column catalogo_items.codigo is
  'Shown to reporters in the WhatsApp list rows. People learn the codes by use, which is what will make the SMS fallback ("22 12 3") work without a menu.';
comment on column catalogo_items.entregable is
  'False for needs that are not cargo — psychosocial support is met by a visit, not a box.';

create index catalogo_items_orden_idx on catalogo_items (tipo, orden);

create trigger catalogo_items_tocar before update on catalogo_items
  for each row execute function tocar_actualizado_en();
