-- The Adaptive Retry Protocol (PRD-15, Supplement v4 §6.1).
--
-- Weak 2G causes two related failure modes: the outbound IVR call drops before any webhook
-- fires, or a delayed callback rings hours after the person has moved out of coverage. Two
-- columns carry the state that answers both:
--
--   llamada_origen_id  — on a 'devolucion' row, the 'perdida' row that triggered it. Without
--                         this, "2 hours from the original missed call" has nothing to measure
--                         against once a callback is not placed the instant the ring arrives.
--   sms_reintento_en    — set the moment the one allowed SMS retry actually goes out, so a
--                         re-run of the retry job (or a duplicate failure signal) cannot send
--                         it twice. «Retry once» is enforced here, not trusted to the caller.
--
-- Both are nullable: most calls need neither (a 'perdida' row never retries anything, and a
-- 'devolucion' row that connects never needs the SMS fallback).

alter table llamadas add column llamada_origen_id uuid references llamadas (id);
alter table llamadas add column sms_reintento_en timestamptz;

alter table llamadas add constraint llamadas_origen_check
  check (llamada_origen_id is null or tipo = 'devolucion');

comment on column llamadas.llamada_origen_id is
  'Only on tipo = devolucion: the perdida row that triggered this callback. The TTL clock (§6.1) reads iniciada_en off this row, not off the callback''s own.';
comment on column llamadas.sms_reintento_en is
  'When the one allowed SMS retry (§6.1) actually went out for this failed callback. Null means it either has not fired yet or was abandoned past the 2h TTL — never both attempted and forgotten.';
