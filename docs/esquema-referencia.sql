-- Red de Ayuda — esquema de referencia
-- Fuente: especificacion-tecnica.md §7. NO es una migración: las migraciones reales se escriben
-- contra el ORM y el sistema de migraciones de Orgánico Studio, cuando tengamos el repo.
-- Convención: text + check en lugar de enum de Postgres (agregar un valor a un enum en
-- producción es doloroso; a un check constraint no).
-- Requiere PostGIS (verificar disponibilidad en su proveedor — punto del intake §2).

-- ── 7.1 Comunidades ─────────────────────────────────────────────────────────
create table comunidades (
    id                     uuid primary key default gen_random_uuid(),
    codigo                 text unique not null,   -- va impreso en la tarjeta
    nombre                 text not null,
    tipo                   text not null,          -- vereda, corregimiento, resguardo...
    municipio              text not null,
    agrupador              text,                   -- cuenca, subregión: el agrupador operativo
    ubicacion              geometry(Point,4326) not null,
    familias_estimadas     int,
    tier_conectividad      smallint not null check (tier_conectividad between 1 and 4),
    intervalo_chequeo_dias int,                    -- alimenta la alerta de silencio
    organizacion_aliada    text,
    activa                 boolean not null default true,
    creado_en              timestamptz not null default now()
);
create index idx_comunidades_ubicacion on comunidades using gist (ubicacion);

-- ── 7.2 Catálogo configurable ───────────────────────────────────────────────
-- El catálogo es configuración, no código: cambiarlo no debe requerir un despliegue.
create table catalogo_items (
    codigo        char(2) primary key,        -- '31'
    familia       char(1) not null,           -- '3'
    familia_label text not null,              -- 'Abrigo y albergue'
    item_label    text not null,              -- 'Cobijas, hamacas, toldillos'
    tipo          text not null default 'necesidad' check (tipo in ('necesidad','dano')),
    ayuda_texto   text,                       -- lo que dice el bot al elegirlo
    pide_detalle  boolean not null default false,  -- fuerza texto o voz (ej. 22)
    urgencia_min  smallint,                   -- ej. 23 => 3
    entregable    boolean not null default true,   -- false para 53 (deriva, no entrega)
    orden         int not null,
    activo        boolean not null default true
);

-- ── 7.3 Reportes (era `necesidades`) ────────────────────────────────────────
create table reportes (
    id               uuid primary key default gen_random_uuid(),
    folio            serial unique,          -- corto, para dictarlo por teléfono
    tipo             text not null default 'necesidad' check (tipo in ('necesidad','dano')),
    canal            text not null,          -- whatsapp, sms, ivr, kobo, radio, papel, web
    contacto_id      uuid references contactos(id),
    comunidad_id     uuid not null references comunidades(id),

    codigo_item      char(2) references catalogo_items(codigo),
    familias         int,                    -- necesidades
    urgencia         smallint check (urgencia between 1 and 3),
    severidad        smallint check (severidad between 1 and 3),   -- daños
    detalle_libre    text,                   -- ítems con pide_detalle
    descripcion      text,
    afecta_ruta_id   uuid references rutas(id),

    ubicacion        geometry(Point,4326),   -- null => se usa la de la comunidad
    ubicacion_fuente text,                   -- pin_whatsapp, comunidad, declarada, manual

    estado           text not null default 'RECIBIDO',
    motivo_cierre    text,
    verificado_por   uuid references contactos(id),
    verificado_en    timestamptz,
    reporte_padre_id uuid references reportes(id),   -- si es DUPLICADO

    payload_crudo    jsonb,                  -- lo que llegó tal cual; salva vidas al depurar
    creado_en        timestamptz not null default now(),
    actualizado_en   timestamptz not null default now()
);
create index idx_reportes_cola on reportes(tipo, estado, urgencia desc, creado_en);

-- Estados (se validan en aplicación, no en check, para poder evolucionar):
--   Tier 1:   RECIBIDO → VERIFICADO → RESERVADO → EN_TRANSITO → ENTREGADO
--   Tier 2-4: RECIBIDO → VERIFICADO → EN_COLA → ASIGNADO → DESPACHADO → ENTREGADO
--   Daños:    RECIBIDO → VERIFICADO → RESUELTO
--   Todas las rutas admiten CANCELADO y DUPLICADO.

-- ── 7.4 Adjuntos ────────────────────────────────────────────────────────────
create table adjuntos (
    id            uuid primary key default gen_random_uuid(),
    reporte_id    uuid references reportes(id) on delete cascade,
    entrega_id    uuid,
    tipo          text not null,            -- audio, foto, firma, documento
    storage_key   text not null,            -- clave propia, NUNCA la URL del proveedor
    mime          text,
    bytes         int,
    duracion_seg  int,
    hash_sha256   text,
    transcripcion text,
    transcripcion_confianza numeric(3,2),
    exif_removido boolean not null default false,
    creado_en     timestamptz not null default now()
);

-- ── 7.5 Resto de tablas — borrador nuestro; el detalle se ajusta a su ORM ───

create table contactos (
    id             uuid primary key default gen_random_uuid(),
    telefono       text unique,             -- E.164; nulo para roles sin teléfono
    nombre         text,
    rol            text not null check (rol in ('reportante','verificador','transportista','coordinador')),
    comunidad_id   uuid references comunidades(id),
    canal_preferido text,
    idioma         text,
    consentimiento_en timestamptz,          -- Ley 1581: autorización previa, expresa e informada
    ultimo_contacto timestamptz,
    creado_en      timestamptz not null default now()
);

create table envios (
    id                 uuid primary key default gen_random_uuid(),
    modo_transporte    text not null,       -- fluvial, terrestre, mula, aereo
    responsable_id     uuid references contactos(id),
    salida_programada  timestamptz,
    capacidad_familias int,
    costo_combustible  numeric(12,2),
    estado             text not null default 'PROPUESTO',
    creado_en          timestamptz not null default now()
);

create table envio_items (
    envio_id          uuid not null references envios(id),
    reporte_id        uuid not null references reportes(id),
    familias_asignadas int,
    orden_parada      int,
    primary key (envio_id, reporte_id)
);

create table entregas (
    id                 uuid primary key default gen_random_uuid(),
    envio_id           uuid references envios(id),
    reporte_id         uuid references reportes(id),
    codigo_confirmacion char(4) not null,   -- impreso en el manifiesto; se concilia después
    canal_confirmacion text,                -- sms, ivr, radio
    familias_atendidas int,
    confirmado_en      timestamptz,
    creado_en          timestamptz not null default now()
);

-- La tabla de idempotencia. No es opcional.
create table mensajes (
    id           uuid primary key default gen_random_uuid(),
    direccion    text not null check (direccion in ('entrada','salida')),
    canal        text not null,
    id_externo   text,                      -- id del proveedor
    telefono     text,
    cuerpo       text,
    payload      jsonb,
    creado_en    timestamptz not null default now()
);
create unique index idx_mensajes_idempotencia on mensajes(canal, id_externo)
    where id_externo is not null;

-- Sostiene los topes de gasto de voz.
create table llamadas (
    id            uuid primary key default gen_random_uuid(),
    telefono      text not null,
    tipo          text not null check (tipo in ('perdida_entrante','devolucion')),
    id_externo    text,
    duracion_seg  int,
    costo         numeric(12,4),
    ruta_tecleada text,                     -- para detectar prompts mal grabados
    creado_en     timestamptz not null default now()
);

-- Grafo origen-destino. Un radio de 5 km en línea recta no significa nada cuando el camino
-- real es fluvial o de trocha. Un daño verificado desactiva filas de esta tabla — lo hace una
-- persona, nunca el reporte solo.
create table rutas (
    id            uuid primary key default gen_random_uuid(),
    origen_id     uuid not null references comunidades(id),
    destino_id    uuid not null references comunidades(id),
    modo          text not null,            -- fluvial, terrestre, mula
    minutos       int,
    costo_estimado numeric(12,2),
    temporada     text,                     -- el mismo par puede tener filas por temporada
    activa        boolean not null default true,
    desactivada_por uuid references contactos(id),
    desactivada_en  timestamptz
);

-- ── 7.6 Vista pública — agregada por diseño ─────────────────────────────────
-- Nada público consulta las tablas base. Coordenadas exactas, teléfonos y nombres solo detrás
-- de autenticación, y solo para el transportista asignado durante su ventana.
create view mapa_publico as
select c.municipio, c.agrupador, ci.familia_label,
       count(*) filter (where r.estado in ('VERIFICADO','EN_COLA','ASIGNADO')) as pendientes,
       count(*) filter (where r.estado = 'ENTREGADO')                          as atendidos,
       st_centroid(st_collect(c.ubicacion))                                    as centroide
from reportes r
join comunidades c     on c.id = r.comunidad_id
join catalogo_items ci on ci.codigo = r.codigo_item
where r.tipo = 'necesidad'
group by c.municipio, c.agrupador, ci.familia_label;
