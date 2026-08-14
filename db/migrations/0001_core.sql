-- Organisations, communities, contacts, staff users.

create table organizaciones (
  id                      uuid primary key default gen_random_uuid(),
  nombre                  text not null,
  waba_phone_number_id    text,
  waba_id                 text,
  activo                  boolean not null default true,
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now()
);

comment on table organizaciones is
  'Partner organisations. We operate under a partner WABA, so WhatsApp config is scoped per organisation from v1 even though there is exactly one row.';

create unique index organizaciones_nombre_key on organizaciones (nombre);

create table comunidades (
  id                      uuid primary key default gen_random_uuid(),
  organizacion_id         uuid not null references organizaciones (id),
  codigo                  text not null,
  nombre                  text not null,
  tipo                    text not null,
  municipio               text not null,
  agrupador               text,
  ubicacion               geometry(Point, 4326),
  ubicacion_fuente        text not null default 'centroide',
  ubicacion_precision_m   integer not null default 1000,
  familias_estimadas      integer,
  tier_conectividad       smallint not null default 2,
  intervalo_chequeo_dias  integer not null default 14,
  activa                  boolean not null default true,
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),

  constraint comunidades_tipo_check
    check (tipo in ('cabecera', 'corregimiento', 'vereda', 'resguardo', 'consejo_comunitario')),
  constraint comunidades_ubicacion_fuente_check
    check (ubicacion_fuente in ('gps', 'centroide', 'referida', 'manual')),
  constraint comunidades_tier_check
    check (tier_conectividad between 1 and 4),
  constraint comunidades_precision_check
    check (ubicacion_precision_m >= 0),
  constraint comunidades_chequeo_check
    check (intervalo_chequeo_dias > 0),
  constraint comunidades_ubicacion_declarada_check
    check (ubicacion is null or ubicacion_fuente is not null)
);

comment on column comunidades.ubicacion_fuente is
  'Non-negotiable 2.2. A centroid is not a pin: the map renders a dashed ~1000 m circle for centroide and ~2000 m for referida, never a dot.';
comment on column comunidades.tier_conectividad is
  '1 data reliable, 2 intermittent, 3 voice/SMS only, 4 radio relay only.';

create unique index comunidades_codigo_key on comunidades (codigo);
create index comunidades_municipio_idx on comunidades (municipio);
create index comunidades_ubicacion_gix on comunidades using gist (ubicacion);

create table contactos (
  id                      uuid primary key default gen_random_uuid(),
  telefono                text not null,
  nombre                  text,
  rol                     text not null default 'reportante',
  comunidad_id            uuid references comunidades (id),
  canal_preferido         text not null default 'whatsapp',
  idioma                  text not null default 'es',
  acepta_llamadas         boolean not null default true,
  ultimo_contacto_en      timestamptz,
  activo                  boolean not null default true,
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),

  constraint contactos_rol_check
    check (rol in ('reportante', 'verificador', 'transportista', 'coordinador', 'donante')),
  constraint contactos_canal_check
    check (canal_preferido in ('whatsapp', 'sms', 'ivr', 'radio', 'papel')),
  constraint contactos_telefono_e164_check
    check (telefono ~ '^\+[1-9][0-9]{7,14}$')
);

comment on table contactos is
  'Non-negotiable 2.10: community members never log in. A phone number is the whole identity — no password, no app install.';

create unique index contactos_telefono_key on contactos (telefono);
create index contactos_comunidad_idx on contactos (comunidad_id);

create table usuarios (
  id                      uuid primary key,
  contacto_id             uuid references contactos (id),
  rol_staff               text not null,
  organizacion_id         uuid not null references organizaciones (id),
  activo                  boolean not null default true,
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),

  constraint usuarios_rol_staff_check
    check (rol_staff in ('coordinador', 'verificador', 'despachador', 'admin', 'lectura'))
);

comment on table usuarios is
  'Staff only. id is the Supabase auth uid so RLS can compare against auth.uid() with no join.';

create index usuarios_organizacion_idx on usuarios (organizacion_id);

-- Which communities a verificador may act on (Section 11).
create table usuarios_comunidades (
  usuario_id              uuid not null references usuarios (id) on delete cascade,
  comunidad_id            uuid not null references comunidades (id) on delete cascade
);

create unique index usuarios_comunidades_key on usuarios_comunidades (usuario_id, comunidad_id);

create trigger comunidades_tocar before update on comunidades
  for each row execute function tocar_actualizado_en();
create trigger contactos_tocar before update on contactos
  for each row execute function tocar_actualizado_en();
create trigger organizaciones_tocar before update on organizaciones
  for each row execute function tocar_actualizado_en();
create trigger usuarios_tocar before update on usuarios
  for each row execute function tocar_actualizado_en();
