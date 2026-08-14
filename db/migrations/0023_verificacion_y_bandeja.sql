-- Verification: the corrected transcript, a name on every disposition, and the rule that a
-- request only exists because a person put it there.
--
-- M7 is the daily work of this system — somebody reads what arrived, listens to the voice
-- notes, fixes what the machine misheard, throws out the duplicates, and promotes what is
-- real. Three things in the schema have to hold for that to be trustworthy.

-- ── The machine's transcript is not the person's ────────────────────────────────────────
--
-- Non-negotiable 2.12: the original is never overwritten. `adjuntos.transcripcion` is what
-- speech-to-text heard, and it stays exactly that forever — a correction goes in its own
-- column beside it. Otherwise the first fix destroys the only evidence of what the model
-- actually produced, and nobody can ever answer "is the transcriber bad at Chocoano, or did
-- this one person mumble?" — which is the question that decides whether to change provider.

alter table adjuntos
  add column transcripcion_corregida text,
  add column corregida_por uuid references usuarios (id),
  add column corregida_en timestamptz;

-- 2.1: a correction is somebody's claim about what was said. It carries their name or it
-- did not happen.
alter table adjuntos
  add constraint adjuntos_correccion_check
  check (
    (transcripcion_corregida is null and corregida_por is null and corregida_en is null)
    or (transcripcion_corregida is not null and corregida_por is not null and corregida_en is not null)
  );

comment on column adjuntos.transcripcion is
  'What speech-to-text heard. Never edited: a corrected transcript goes in transcripcion_corregida, so the machine''s output stays available to judge the provider by (2.12).';
comment on column adjuntos.transcripcion_corregida is
  'What a person says was actually said. Read this when present, fall back to transcripcion.';

-- ── A name on every disposition ─────────────────────────────────────────────────────────
--
-- The old constraint required a verifier only for VERIFICADO, which left DUPLICADO as the
-- one way to take a report out of the queue with nobody's name on it. Marking a duplicate is
-- the same kind of judgement as verifying — a person read two reports and decided they are
-- one event — and it is the more consequential direction, because it makes a need disappear
-- rather than appear.

alter table reportes drop constraint reportes_verificado_completo_check;

alter table reportes
  add constraint reportes_disposicion_check
  check (estado in ('RECIBIDO', 'CANCELADO') or verificado_por is not null);

comment on column reportes.verificado_por is
  'Who dispositioned this report — verified it or marked it a duplicate. Both are judgements, and 2.1 says neither happens anonymously.';

-- The daily queue: what is waiting, worst first. Section 4.5 orders by urgency then age, and
-- this is the one query the verification screen runs all day.
create index reportes_bandeja_idx
  on reportes (urgencia desc nulls last, creado_en)
  where estado = 'RECIBIDO';

-- ── Nothing reaches `pedidos` without a human action ────────────────────────────────────
--
-- The M7 acceptance, enforced where it cannot be forgotten. Every other guard is a policy or
-- a code path: RLS decides who may insert, and the UI decides which button exists. Neither
-- stops the webhook, a job handler, a migration or a well-meaning script from creating
-- demand that nobody confirmed — and `service_role` bypasses RLS entirely, which is exactly
-- what intake runs as.
--
-- A trigger is not bypassed by anybody. So: a `pedido` may only point at a report that a
-- person has verified, and the person is named on the report.

create or replace function exigir_reporte_verificado() returns trigger
language plpgsql security definer set search_path = public
as $exigir$
declare
  r reportes%rowtype;
begin
  select * into r from reportes where id = new.reporte_id;

  if not found then
    raise exception 'El pedido apunta a un reporte que no existe.';
  end if;

  if r.estado <> 'VERIFICADO' or r.verificado_por is null then
    raise exception
      'Un pedido solo nace de un reporte verificado por una persona (2.1). Reporte % está en %.',
      r.folio, r.estado
      using errcode = 'check_violation';
  end if;

  return new;
end
$exigir$;

comment on function exigir_reporte_verificado() is
  'M7 acceptance: nothing reaches pedidos without a human action. A trigger rather than a policy, because service_role bypasses RLS and intake runs as service_role.';

create trigger pedidos_exigen_verificacion
  before insert on pedidos
  for each row execute function exigir_reporte_verificado();
