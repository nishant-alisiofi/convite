-- Calls, and the money they cost.
--
-- Section 4.3: intake by missed call. Somebody with no balance and one bar rings us, we
-- REJECT without answering — so the call costs them nothing — and we ring them back. That
-- inversion is the whole promise of the channel, and it means every peso is on our side of
-- the ledger.
--
-- Which is why the budget lands in the same migration as the table. A callback loop that
-- misfires does not fill a log with warnings, it dials real money in a way SMS never can:
-- a retry storm against 200 numbers is a phone bill, at night, with nobody watching. The
-- caps are computed from this table rather than kept as counters, for the same reason
-- `calidad_enlace` is recomputed from `mensajes` — a number nobody can re-derive is a number
-- nobody can trust, and a drifting counter here spends money.
--
-- A blocked callback is a row, not a silence. «We did not call this person» has to be
-- visible and explainable afterwards, or the first question in the morning has no answer.

create table llamadas (
  id                      uuid primary key default gen_random_uuid(),
  organizacion_id         uuid not null references organizaciones (id),
  proveedor               text not null default 'voz_simulador',
  proveedor_llamada_id    text,
  contacto_id             uuid references contactos (id),
  telefono                text not null,
  tipo                    text not null,
  estado                  text not null,
  /** Set only when estado = 'bloqueada': which cap refused it, in words. */
  motivo_bloqueo          text,
  /** The keys pressed, in order. Empty string means they hung up before choosing. */
  ruta_tecleada           text,
  duracion_seg            integer not null default 0,
  costo_usd               numeric(10, 5),
  reporte_id              uuid references reportes (id),
  iniciada_en             timestamptz not null default now(),
  finalizada_en           timestamptz,
  creado_en               timestamptz not null default now(),

  constraint llamadas_tipo_check   check (tipo in ('perdida', 'devolucion')),
  constraint llamadas_estado_check
    check (estado in ('registrada', 'rechazada', 'bloqueada', 'marcando', 'contestada',
                      'grabada', 'a_persona', 'fallida')),
  constraint llamadas_duracion_check check (duracion_seg >= 0),
  constraint llamadas_telefono_e164_check check (telefono ~ '^\+[1-9][0-9]{7,14}$'),
  -- A block has to say why, and nothing else may claim to have been blocked.
  constraint llamadas_bloqueo_check
    check ((estado = 'bloqueada') = (motivo_bloqueo is not null)),
  -- A blocked or rejected call never ran, so it never cost anything.
  constraint llamadas_sin_costo_check
    check (estado not in ('bloqueada', 'rechazada') or duracion_seg = 0)
);

comment on table llamadas is
  'Section 4.3. Every call in and out, including the ones we refused to make: a cap that silently drops a callback is indistinguishable from a bug.';
comment on column llamadas.ruta_tecleada is
  'Which keys the caller pressed. Read as prompt-quality data: if many people abandon at the same step, that prompt is badly recorded, not badly designed.';
comment on column llamadas.tipo is
  'perdida = they rang us and we hung up without answering, so it cost them nothing. devolucion = we rang back, and we pay.';

-- 2.7 again: providers retry call webhooks exactly like message webhooks.
create unique index llamadas_proveedor_id_key
  on llamadas (proveedor, proveedor_llamada_id)
  where proveedor_llamada_id is not null;

-- The caps read these two.
create index llamadas_telefono_idx on llamadas (telefono, iniciada_en);
create index llamadas_iniciada_idx on llamadas (iniciada_en);
create index llamadas_reporte_idx on llamadas (reporte_id);

-- ── The daily voice budget ──────────────────────────────────────────────────────────────
--
-- Goes in `configuracion` rather than an environment variable so a coordinator can change
-- it the day a real emergency justifies more minutes, without a deploy and with an audit row
-- naming who decided. 0020's trigger records the change; its comment says adding a key means
-- adding its check constraint, so here it is.
--
-- 120 minutes is a deliberately conservative starting point: enough for roughly sixty
-- two-minute reports a day, which is more than the basin has ever produced, and small enough
-- that a runaway loop trips it inside an hour instead of overnight.

alter table configuracion add constraint configuracion_presupuesto_voz_check
  check (clave <> 'presupuesto_voz_minutos_dia' or valor ~ '^[0-9]{1,5}$');

insert into configuracion (clave, valor, descripcion) values
  ('presupuesto_voz_minutos_dia', '120',
   'Minutos de llamada saliente que el sistema puede gastar en un día. Al llegar al tope se apagan las devoluciones automáticas; al 70% se avisa al coordinador. Las llamadas entrantes no cuentan: esas se rechazan sin contestar y no cuestan nada.')
on conflict (clave) do nothing;

-- ── The RLS floor for this table ────────────────────────────────────────────────────────
--
-- 2.4: every base table is deny-by-default and `anon` reads `mapa_publico` and nothing else.
-- `llamadas` holds a phone number beside what that person reported and when they were
-- reachable, which makes it one of the tables that matters most in a territory with armed
-- actor presence.
--
-- 0007 already revoked everything and set default privileges to revoke, so a table created
-- now inherits deny. What it needs is the same table-level grant and row policy `mensajes`
-- carries — RLS narrows rows, it does not grant access, so without the grant a coordinator
-- sees nothing and without the policy everyone sees everything.
--
-- Read-only for staff, deliberately. Nothing writes here as a signed-in person: calls are
-- recorded by the intake path running as the owner, and a coordinator editing a call log
-- after the fact is not a thing we want to be possible.

alter table llamadas enable row level security;

grant select on public.llamadas to authenticated;

create policy llamadas_lectura on llamadas
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));
