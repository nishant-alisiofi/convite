-- Offers, volunteers, and first-mile pickup.
--
-- Why `ofertas` is not `existencias`: in the first week of a response the supply is in
-- people's houses, not in warehouses, and node inventory goes uncounted for days. A matcher
-- that reads only `existencias` reports "nobody has this" on a screen that simultaneously
-- lists eight people who do. That was the most consequential bug observed in a live system,
-- and Section 8 now forbids reaching SIN_EXISTENCIA without having looked here.

create table ofertas (
  id                    uuid primary key default gen_random_uuid(),
  contacto_id           uuid not null references contactos (id),
  -- Non-negotiable 2.12: the original is never overwritten. Transcripts get corrected and
  -- classifications get revised; this column is what we can always go back to.
  texto_original        text not null,
  codigo_item           char(2) references catalogo_items (codigo),
  -- Nullable on purpose. «🍲 90» states no quantity, and inventing one is worse than
  -- asking (2.12).
  cantidad              integer,
  unidad                text,
  confianza             numeric(3, 2),
  requiere_aclaracion   boolean not null default false,
  ubicacion             geometry(Point, 4326),
  -- Non-negotiable 2.16: a private address plus a name plus "has supplies" is a target.
  -- Public and read-only views get sector or neighbourhood; this column is visible only to
  -- the assigned pickup driver inside their assignment window, enforced in RLS.
  direccion_texto       text,
  ubicacion_fuente      text,
  ubicacion_precision_m integer,
  perecedero            boolean not null default false,
  vence_en              timestamptz,
  necesita_recogida     boolean not null default true,
  estado                text not null default 'SIN_CLASIFICAR',
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now(),

  constraint ofertas_estado_check check (estado in (
    'SIN_CLASIFICAR', 'DISPONIBLE', 'RESERVADA', 'RECOGIDA', 'EN_NODO', 'VENCIDA', 'RETIRADA'
  )),
  constraint ofertas_cantidad_check  check (cantidad is null or cantidad > 0),
  constraint ofertas_confianza_check check (confianza is null or confianza between 0 and 1),
  -- An offer nobody could classify cannot be matched against a request. It is still a live
  -- lead for a coordinator to phone — that is what SIN_CLASIFICAR is for.
  constraint ofertas_clasificacion_check
    check (codigo_item is not null or estado in ('SIN_CLASIFICAR', 'RETIRADA')),
  -- Non-negotiable 2.15: a perishable that cannot be sorted by deadline is not a
  -- perishable, it is a surprise.
  constraint ofertas_perecedero_check check (not perecedero or vence_en is not null),
  constraint ofertas_ubicacion_fuente_check
    check (ubicacion_fuente is null or ubicacion_fuente in ('gps', 'centroide', 'referida', 'manual')),
  constraint ofertas_ubicacion_declarada_check
    check (
      (ubicacion is null and ubicacion_fuente is null)
      or (ubicacion is not null and ubicacion_fuente is not null and ubicacion_precision_m is not null)
    )
);

comment on table ofertas is
  'Supply held by individuals. Section 8: never report SIN_EXISTENCIA without having checked this table.';
comment on column ofertas.vence_en is
  'Perishables outrank everything, sorted by this ascending, irrespective of request urgency. Cooked meals for tomorrow do not wait behind blankets.';

create index ofertas_estado_item_idx on ofertas (estado, codigo_item);
create index ofertas_perecedero_idx on ofertas (vence_en) where perecedero and estado = 'DISPONIBLE';
create index ofertas_ubicacion_gix on ofertas using gist (ubicacion);
create index ofertas_aclaracion_idx on ofertas (creado_en) where requiere_aclaracion;

create table voluntarios (
  id                  uuid primary key default gen_random_uuid(),
  contacto_id         uuid not null references contactos (id),
  nodo_id             uuid not null references nodos (id),
  tipo_labor          text not null,
  disponible_desde    timestamptz not null,
  disponible_hasta    timestamptz not null,
  estado              text not null default 'OFRECIDO',
  creado_en           timestamptz not null default now(),

  constraint voluntarios_labor_check
    check (tipo_labor in ('clasificar', 'cargar', 'cocinar', 'atender')),
  constraint voluntarios_estado_check
    check (estado in ('OFRECIDO', 'CONFIRMADO', 'CANCELADO', 'COMPLETADO')),
  constraint voluntarios_ventana_check check (disponible_hasta > disponible_desde)
);

comment on table voluntarios is
  'Capacity that does not move. Volunteers match to nodes with unprocessed intake, not to requests (Section 9.6).';

create index voluntarios_nodo_idx on voluntarios (nodo_id, disponible_desde);

create table recogidas (
  id                  uuid primary key default gen_random_uuid(),
  oferta_id           uuid not null references ofertas (id) on delete cascade,
  nodo_destino_id     uuid not null references nodos (id),
  capacidad_id        uuid references capacidades (id),
  orden_parada        integer not null default 0,
  estado              text not null default 'PLANEADA',
  recogido_en         timestamptz,
  creado_en           timestamptz not null default now(),

  constraint recogidas_estado_check
    check (estado in ('PLANEADA', 'EN_CURSO', 'RECOGIDA', 'FALLIDA', 'CANCELADA')),
  constraint recogidas_recogida_check
    check (estado <> 'RECOGIDA' or recogido_en is not null)
);

comment on table recogidas is
  'First mile: scattered urban addresses collected into one node, over roads. A different routing problem from delivery, and the one place Google Route Matrix genuinely helps (Section 9.5).';

create unique index recogidas_oferta_key on recogidas (oferta_id) where estado <> 'CANCELADA';

-- The matcher may now source a request from an offer instead of node stock, in which case
-- the plan includes a pickup leg.
alter table pedidos
  add column oferta_sugerida uuid references ofertas (id);

alter table emparejamientos
  add column oferta_id uuid references ofertas (id);

comment on column pedidos.oferta_sugerida is
  'Set when the plan sources from an individual offer rather than counted node stock (Section 8, step 2).';

create trigger ofertas_tocar before update on ofertas
  for each row execute function tocar_actualizado_en();
