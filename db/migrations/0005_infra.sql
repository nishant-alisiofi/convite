-- Job queue and audit log.

create table jobs (
  id                      uuid primary key default gen_random_uuid(),
  tipo                    text not null,
  payload                 jsonb not null default '{}'::jsonb,
  estado                  text not null default 'pendiente',
  intentos                integer not null default 0,
  max_intentos            integer not null default 5,
  correr_en               timestamptz not null default now(),
  tomado_en               timestamptz,
  ultimo_error            text,
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),

  constraint jobs_estado_check check (estado in ('pendiente', 'corriendo', 'hecho', 'fallido'))
);

comment on table jobs is
  'Section 3: a table plus a worker route invoked by cron. No Redis, no BullMQ in v1. Webhooks return 200 first and enqueue here; the matcher runs from here, never inline in a request.';

create index jobs_pendientes_idx on jobs (estado, correr_en);

create table auditoria (
  id                      uuid primary key default gen_random_uuid(),
  actor_id                uuid references usuarios (id),
  accion                  text not null,
  entidad                 text not null,
  entidad_id              uuid,
  antes                   jsonb,
  despues                 jsonb,
  creado_en               timestamptz not null default now()
);

comment on table auditoria is
  'Section 11: every mutation. This is what makes non-negotiable 2.1 auditable rather than aspirational.';

create index auditoria_entidad_idx on auditoria (entidad, entidad_id);
create index auditoria_creado_idx on auditoria (creado_en);

create trigger jobs_tocar before update on jobs
  for each row execute function tocar_actualizado_en();
