-- Link quality, and conversations that survive being offline.

-- Non-negotiable 2.14: link quality is measured, not declared.
-- `comunidades.tier_conectividad` is a starting guess and nothing more. These columns hold
-- what we actually observed for this person, recomputed on every inbound message and every
-- delivery callback.
alter table contactos
  add column calidad_enlace    numeric(3, 2),
  add column ventana_actividad jsonb,
  add column media_exitosa     boolean,
  add column ultima_medicion   timestamptz;

alter table contactos
  add constraint contactos_calidad_enlace_check
    check (calidad_enlace is null or calidad_enlace between 0 and 1);

comment on column contactos.calidad_enlace is
  'Observed link quality, 0..1. NULL means never measured — which is not the same as bad.';
comment on column contactos.media_exitosa is
  'Has a media upload from this contact EVER completed? The single strongest predictor of whether to invite a voice note. NULL = never attempted, false = attempted and failed.';
comment on column contactos.ventana_actividad is
  'Hour-of-day distribution of inbound messages: when this person is actually reachable, which usually tracks when there is power.';

-- Non-negotiable 2.13: no flow may require a live session. A reply arriving three days
-- later must still attach to the right record, so the window is days and never minutes.
alter table conversaciones
  alter column expira_en set default now() + interval '7 days';

alter table conversaciones
  add constraint conversaciones_ventana_en_dias_check
    check (expira_en >= creado_en + interval '1 day');

comment on column conversaciones.expira_en is
  'Days, never minutes (2.13). State exists to attach a late reply to the right record — it is never a precondition for creating one.';

-- Non-negotiable 2.14: outbound for a poor link is queued and piggybacked on the person''s
-- next inbound message, batched into one digest. Never five messages fired at once when
-- somebody reappears.
create table salidas_pendientes (
  id                  uuid primary key default gen_random_uuid(),
  contacto_id         uuid not null references contactos (id) on delete cascade,
  cuerpo              text not null,
  prioridad           smallint not null default 5,
  canal_sugerido      text,
  intentos            integer not null default 0,
  enviar_despues_de   timestamptz not null default now(),
  enviado_en          timestamptz,
  creado_en           timestamptz not null default now(),

  constraint salidas_prioridad_check check (prioridad between 1 and 9),
  constraint salidas_canal_check
    check (canal_sugerido is null or canal_sugerido in ('whatsapp', 'sms', 'ivr', 'radio', 'papel', 'web'))
);

comment on table salidas_pendientes is
  'The piggyback queue. Every row must be useful on its own if it is the last message that gets through (2.13) — nothing here exists only to advance a state machine.';

create index salidas_pendientes_contacto_idx
  on salidas_pendientes (contacto_id, enviar_despues_de)
  where enviado_en is null;
