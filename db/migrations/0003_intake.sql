-- Intake: what people told us, the media they sent, every message, and live flow state.

create table reportes (
  id                      uuid primary key default gen_random_uuid(),
  folio                   integer generated always as identity,
  organizacion_id         uuid not null references organizaciones (id),
  tipo                    text not null,
  canal                   text not null,
  contacto_id             uuid references contactos (id),
  comunidad_id            uuid references comunidades (id),
  codigo_item             char(2) references catalogo_items (codigo),
  familias                integer,
  urgencia                smallint,
  severidad               smallint,
  detalle_libre           text,
  descripcion             text,
  ubicacion               geometry(Point, 4326),
  ubicacion_fuente        text,
  ubicacion_precision_m   integer,
  estado                  text not null default 'RECIBIDO',
  verificado_por          uuid references usuarios (id),
  verificado_en           timestamptz,
  reporte_padre_id        uuid references reportes (id),
  payload_crudo           jsonb,
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),

  constraint reportes_tipo_check   check (tipo in ('necesidad', 'dano')),
  constraint reportes_canal_check  check (canal in ('whatsapp', 'sms', 'ivr', 'radio', 'papel', 'web')),
  constraint reportes_estado_check check (estado in ('RECIBIDO', 'VERIFICADO', 'DUPLICADO', 'CANCELADO')),
  constraint reportes_ubicacion_fuente_check
    check (ubicacion_fuente is null or ubicacion_fuente in ('gps', 'centroide', 'referida', 'manual')),
  constraint reportes_urgencia_check  check (urgencia is null or urgencia between 1 and 3),
  constraint reportes_severidad_check check (severidad is null or severidad between 1 and 3),
  constraint reportes_familias_check  check (familias is null or familias > 0),

  -- Non-negotiable 2.2: a point with no declared source, or a source with no radius, is a
  -- coordinate whose precision we have invented.
  constraint reportes_ubicacion_declarada_check
    check (
      (ubicacion is null and ubicacion_fuente is null)
      or (ubicacion is not null and ubicacion_fuente is not null and ubicacion_precision_m is not null)
    ),
  constraint reportes_gps_exacto_check
    check (ubicacion_fuente is distinct from 'gps' or ubicacion_precision_m = 0),

  -- Non-negotiable 2.1: verification is a human action recorded with a user id and a
  -- timestamp, or it did not happen.
  constraint reportes_verificacion_check
    check (
      (verificado_por is null and verificado_en is null)
      or (verificado_por is not null and verificado_en is not null)
    ),
  constraint reportes_verificado_completo_check
    check (estado <> 'VERIFICADO' or verificado_por is not null),
  constraint reportes_duplicado_check
    check (estado <> 'DUPLICADO' or reporte_padre_id is not null),
  constraint reportes_no_autopadre_check
    check (reporte_padre_id is null or reporte_padre_id <> id)
);

comment on column reportes.folio is
  'The number read back to the reporter: «quedó registrado con el número 472».';
comment on column reportes.payload_crudo is
  'Exactly what the provider sent. A parser bug must always be recoverable from this.';

create unique index reportes_folio_key on reportes (folio);
create index reportes_estado_idx on reportes (estado);
create index reportes_comunidad_idx on reportes (comunidad_id);
create index reportes_creado_idx on reportes (creado_en);
create index reportes_ubicacion_gix on reportes using gist (ubicacion);

create table adjuntos (
  id                      uuid primary key default gen_random_uuid(),
  reporte_id              uuid references reportes (id) on delete cascade,
  entrega_id              uuid,  -- FK added in 0004, once `entregas` exists
  tipo                    text not null,
  storage_key             text not null,
  mime                    text,
  bytes                   bigint,
  duracion_seg            integer,
  hash_sha256             text,
  transcripcion           text,
  transcripcion_confianza numeric(4, 3),
  exif_removido           boolean not null default false,
  creado_en               timestamptz not null default now(),

  constraint adjuntos_tipo_check  check (tipo in ('audio', 'foto', 'firma')),
  constraint adjuntos_dueno_check check (num_nonnulls(reporte_id, entrega_id) = 1),
  -- Non-negotiable 2.5: WhatsApp photos can carry GPS. No photo is stored un-stripped.
  constraint adjuntos_exif_check  check (tipo <> 'foto' or exif_removido),
  -- Non-negotiable 2.6: our own object storage key, never the provider URL. WhatsApp media
  -- URLs expire in minutes, so a stored URL is a guaranteed future 404.
  constraint adjuntos_no_url_proveedor_check check (storage_key !~* '^https?://')
);

create index adjuntos_reporte_idx on adjuntos (reporte_id);
create index adjuntos_entrega_idx on adjuntos (entrega_id);

create table mensajes (
  id                      uuid primary key default gen_random_uuid(),
  organizacion_id         uuid not null references organizaciones (id),
  proveedor               text not null default 'whatsapp_cloud',
  proveedor_mensaje_id    text,
  direccion               text not null,
  canal                   text not null,
  telefono                text,
  contacto_id             uuid references contactos (id),
  reporte_id              uuid references reportes (id),
  cuerpo                  text,
  plantilla               text,
  estado                  text,
  costo_usd               numeric(10, 5),
  payload                 jsonb,
  creado_en               timestamptz not null default now(),

  constraint mensajes_direccion_check check (direccion in ('entrante', 'saliente')),
  constraint mensajes_canal_check     check (canal in ('whatsapp', 'sms', 'ivr', 'radio', 'papel', 'web')),
  constraint mensajes_estado_check
    check (estado is null or estado in ('recibido', 'encolado', 'enviado', 'entregado', 'leido', 'fallido'))
);

-- Non-negotiable 2.7: providers retry. This index IS the idempotency check — insert first,
-- and on unique violation discard and return 200.
create unique index mensajes_proveedor_id_key
  on mensajes (proveedor, proveedor_mensaje_id)
  where proveedor_mensaje_id is not null;

create index mensajes_telefono_idx on mensajes (telefono);
create index mensajes_creado_idx on mensajes (creado_en);

create table conversaciones (
  id                      uuid primary key default gen_random_uuid(),
  contacto_id             uuid not null references contactos (id) on delete cascade,
  flujo                   text not null,
  paso                    text not null,
  payload_parcial         jsonb not null default '{}'::jsonb,
  expira_en               timestamptz not null,
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now()
);

comment on table conversaciones is
  'Section 6.5. Flows stay at 3–4 exchanges: every round trip costs the person battery and, since Meta began charging for service messages, money.';

create unique index conversaciones_contacto_key on conversaciones (contacto_id);
create index conversaciones_expira_idx on conversaciones (expira_en);

create trigger reportes_tocar before update on reportes
  for each row execute function tocar_actualizado_en();
create trigger conversaciones_tocar before update on conversaciones
  for each row execute function tocar_actualizado_en();
