-- The three sides of the marketplace: stock, demand, and the capacity to move between them.

-- ── Supply ──────────────────────────────────────────────────────────────────────────────

create table nodos (
  id                      uuid primary key default gen_random_uuid(),
  comunidad_id            uuid not null references comunidades (id),
  nombre                  text not null,
  tipo                    text not null,
  responsable_id          uuid references contactos (id),
  ubicacion               geometry(Point, 4326),
  ubicacion_fuente        text,
  ubicacion_precision_m   integer,
  activo                  boolean not null default true,
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),

  constraint nodos_tipo_check check (tipo in ('bodega', 'acopio')),
  constraint nodos_ubicacion_fuente_check
    check (ubicacion_fuente is null or ubicacion_fuente in ('gps', 'centroide', 'referida', 'manual')),
  constraint nodos_ubicacion_declarada_check
    check (
      (ubicacion is null and ubicacion_fuente is null)
      or (ubicacion is not null and ubicacion_fuente is not null and ubicacion_precision_m is not null)
    )
);

create unique index nodos_comunidad_nombre_key on nodos (comunidad_id, nombre);
create index nodos_comunidad_idx on nodos (comunidad_id);
create index nodos_ubicacion_gix on nodos using gist (ubicacion);

create table existencias (
  id                      uuid primary key default gen_random_uuid(),
  nodo_id                 uuid not null references nodos (id) on delete cascade,
  codigo_item             char(2) not null references catalogo_items (codigo),
  cantidad                integer not null default 0,
  contado_en              timestamptz not null,
  contado_por             uuid not null references usuarios (id),
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),

  constraint existencias_cantidad_check check (cantidad >= 0)
);

comment on table existencias is
  'Non-negotiable 2.3: inventory is never a promise. contado_en and contado_por are NOT NULL because a figure with no last-count sends someone on a three-hour trip to an empty store. Every surface showing cantidad must show contado_en beside it.';

create unique index existencias_nodo_item_key on existencias (nodo_id, codigo_item);

-- ── Demand ──────────────────────────────────────────────────────────────────────────────

create table pedidos (
  id                      uuid primary key default gen_random_uuid(),
  reporte_id              uuid not null references reportes (id),
  comunidad_id            uuid not null references comunidades (id),
  codigo_item             char(2) not null references catalogo_items (codigo),
  familias                integer not null,
  urgencia                smallint not null default 1,
  estado                  text not null default 'ABIERTO',
  motivo                  text,
  nodo_sugerido           uuid references nodos (id),
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),

  constraint pedidos_estado_check check (estado in (
    'ABIERTO', 'SIN_RUTA', 'SIN_EXISTENCIA', 'SIN_CAPACIDAD',
    'LISTO', 'EN_CAMINO', 'ENTREGADO', 'CANCELADO'
  )),
  constraint pedidos_familias_check check (familias > 0),
  constraint pedidos_urgencia_check check (urgencia between 1 and 3)
);

comment on column pedidos.estado is
  'Which side of the marketplace is missing. This classification is the product: "12 await transport, 8 await donation, 3 are cut off" is a set of phone calls; "38 pending" is not.';
comment on column pedidos.motivo is
  'Plain Spanish, shown verbatim in the UI: «Hay 18 mercados en Tutunendo, pero nadie va para allá esta semana».';

create index pedidos_estado_idx on pedidos (estado);
create index pedidos_comunidad_idx on pedidos (comunidad_id);
create unique index pedidos_reporte_key on pedidos (reporte_id);

-- ── Movement ────────────────────────────────────────────────────────────────────────────

create table rutas (
  id                      uuid primary key default gen_random_uuid(),
  origen_id               uuid not null references comunidades (id),
  destino_id              uuid not null references comunidades (id),
  modo                    text not null,
  minutos                 integer,
  distancia_m             integer,
  costo_estimado_cop      bigint,
  temporada               text not null default 'todo_el_ano',
  fuente                  text not null default 'manual',
  activa                  boolean not null default true,
  notas                   text,
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),

  constraint rutas_modo_check      check (modo in ('lancha', 'chalupa', 'carretera', 'trocha', 'avioneta')),
  constraint rutas_temporada_check check (temporada in ('todo_el_ano', 'lluvias', 'seca')),
  constraint rutas_fuente_check    check (fuente in ('google', 'manual')),
  constraint rutas_no_bucle_check  check (origen_id <> destino_id),
  constraint rutas_minutos_check   check (minutos is null or minutos > 0),
  -- Section 7.3: Google has no river data — no route, no travel time, no seasonality. A
  -- fluvial leg marked fuente='google' means someone fell back to straight-line distance,
  -- which is meaningless when the real path is 90 minutes upriver.
  constraint rutas_fluvial_manual_check
    check (fuente <> 'google' or modo not in ('lancha', 'chalupa'))
);

comment on table rutas is
  'Directed edges — upstream and downstream are not the same trip. The same pair may appear twice with different temporada: a leg navigable in lluvias can be impassable in seca. The matcher''s reachability check runs over this table and never over a Google API call.';

create unique index rutas_tramo_key on rutas (origen_id, destino_id, modo, temporada);
create index rutas_origen_idx on rutas (origen_id);
create index rutas_destino_idx on rutas (destino_id);
create index rutas_activa_idx on rutas (activa);

create table capacidades (
  id                      uuid primary key default gen_random_uuid(),
  contacto_id             uuid not null references contactos (id),
  modo                    text not null,
  origen_nodo_id          uuid not null references nodos (id),
  hasta_comunidad_id      uuid not null references comunidades (id),
  sale_en                 timestamptz not null,
  cupo_familias           integer not null,
  estado                  text not null default 'OFRECIDA',
  notas                   text,
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),

  constraint capacidades_modo_check   check (modo in ('lancha', 'chalupa', 'carretera', 'trocha', 'avioneta')),
  constraint capacidades_estado_check check (estado in ('OFRECIDA', 'COMPROMETIDA', 'CANCELADA', 'COMPLETADA')),
  constraint capacidades_cupo_check   check (cupo_familias > 0)
);

comment on table capacidades is
  'The thin side. Stock can be found and routes can be opened; somebody actually travelling that week usually cannot, which is why SIN_CAPACIDAD is its own bucket.';

create index capacidades_estado_idx on capacidades (estado);
create index capacidades_sale_idx on capacidades (sale_en);

create table envios (
  id                      uuid primary key default gen_random_uuid(),
  codigo                  text not null,
  modo                    text not null,
  responsable_id          uuid not null references contactos (id),
  origen_nodo_id          uuid not null references nodos (id),
  salida_programada       timestamptz,
  salida_real             timestamptz,
  regreso_real            timestamptz,
  cupo_familias           integer not null,
  costo_combustible_cop   bigint,
  estado                  text not null default 'PLANEADO',
  notas                   text,
  despachado_por          uuid references usuarios (id),
  despachado_en           timestamptz,
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),

  constraint envios_modo_check   check (modo in ('lancha', 'chalupa', 'carretera', 'trocha', 'avioneta')),
  constraint envios_estado_check check (estado in ('PLANEADO', 'DESPACHADO', 'EN_RUTA', 'COMPLETADO', 'CANCELADO')),
  constraint envios_cupo_check   check (cupo_familias > 0),
  -- Non-negotiable 2.1: nothing dispatches without a name and a timestamp on it.
  constraint envios_despacho_check
    check (estado in ('PLANEADO', 'CANCELADO') or (despachado_por is not null and despachado_en is not null))
);

create unique index envios_codigo_key on envios (codigo);
create index envios_estado_idx on envios (estado);

create table emparejamientos (
  id                      uuid primary key default gen_random_uuid(),
  pedido_id               uuid not null references pedidos (id) on delete cascade,
  nodo_id                 uuid not null references nodos (id),
  capacidad_id            uuid references capacidades (id),
  cantidad                integer not null,
  propuesto_en            timestamptz not null default now(),
  confirmado_por          uuid references usuarios (id),
  confirmado_en           timestamptz,
  envio_id                uuid references envios (id),

  constraint emparejamientos_cantidad_check check (cantidad > 0),
  constraint emparejamientos_confirmacion_check
    check (
      (confirmado_por is null and confirmado_en is null)
      or (confirmado_por is not null and confirmado_en is not null)
    ),
  constraint emparejamientos_envio_check
    check (envio_id is null or confirmado_por is not null)
);

comment on table emparejamientos is
  'Non-negotiable 2.1: the matcher proposes, a human commits. A row with confirmado_por IS NULL has moved no stock and committed no boat, and may be discarded freely.';

-- NULLS NOT DISTINCT so a proposal with no capacity yet cannot be duplicated on every
-- matcher run. (Postgres 15+.)
create unique index emparejamientos_pedido_capacidad_key
  on emparejamientos (pedido_id, capacidad_id) nulls not distinct;
create index emparejamientos_pedido_idx on emparejamientos (pedido_id);

create table envio_items (
  id                      uuid primary key default gen_random_uuid(),
  envio_id                uuid not null references envios (id) on delete cascade,
  pedido_id               uuid not null references pedidos (id),
  familias_asignadas      integer not null,
  orden_parada            integer not null default 0,

  constraint envio_items_familias_check check (familias_asignadas > 0)
);

create unique index envio_items_key on envio_items (envio_id, pedido_id);

create table entregas (
  id                      uuid primary key default gen_random_uuid(),
  envio_id                uuid not null references envios (id) on delete cascade,
  pedido_id               uuid not null references pedidos (id),
  codigo_confirmacion     char(4) not null,
  confirmado              boolean not null default false,
  confirmado_por_id       uuid references contactos (id),
  confirmado_canal        text,
  confirmado_en           timestamptz,
  familias_atendidas      integer,
  observaciones           text,
  creado_en               timestamptz not null default now(),

  constraint entregas_codigo_check check (codigo_confirmacion ~ '^[0-9]{4}$'),
  constraint entregas_canal_check
    check (confirmado_canal is null or confirmado_canal in ('whatsapp', 'sms', 'ivr', 'radio', 'papel', 'web')),
  constraint entregas_confirmacion_check
    check (not confirmado or (confirmado_en is not null and confirmado_canal is not null))
);

comment on column entregas.codigo_confirmacion is
  'Read back by the receiving leader over WhatsApp, SMS or phone. Unique within a shipment, not globally — four digits are for a person to dictate, not for security.';

create unique index entregas_envio_codigo_key on entregas (envio_id, codigo_confirmacion);
create unique index entregas_envio_pedido_key on entregas (envio_id, pedido_id);

create table decisiones_asignacion (
  id                      uuid primary key default gen_random_uuid(),
  envio_id                uuid not null references envios (id) on delete cascade,
  regla_aplicada          text not null,
  confirmado_por          uuid not null references usuarios (id),
  confirmado_en           timestamptz not null default now(),
  pedidos_atendidos       jsonb not null default '[]'::jsonb,
  pedidos_postergados     jsonb not null default '[]'::jsonb,
  nota                    text
);

comment on table decisiones_asignacion is
  'Non-negotiable 2.9. When supply is short, record the rule, the person, and who was deferred. A deferred community with nobody to argue with is how the reporter network dies.';

create index decisiones_envio_idx on decisiones_asignacion (envio_id);

-- Deferred from 0003: adjuntos may hang off a delivery (a signature photo).
alter table adjuntos
  add constraint adjuntos_entrega_id_fkey
  foreign key (entrega_id) references entregas (id) on delete cascade;

create trigger nodos_tocar before update on nodos
  for each row execute function tocar_actualizado_en();
create trigger existencias_tocar before update on existencias
  for each row execute function tocar_actualizado_en();
create trigger pedidos_tocar before update on pedidos
  for each row execute function tocar_actualizado_en();
create trigger rutas_tocar before update on rutas
  for each row execute function tocar_actualizado_en();
create trigger capacidades_tocar before update on capacidades
  for each row execute function tocar_actualizado_en();
create trigger envios_tocar before update on envios
  for each row execute function tocar_actualizado_en();
