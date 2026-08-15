-- A pedido stays tied to the verified need it came from, for its whole life.
--
-- 0023 put a trigger on `pedidos` so nothing reaches the board without a person having
-- verified it (2.1, M7). It fired `before insert` only, and `pedidos_coordina` in 0017 lets a
-- despachador update every column — so the guarantee lasted exactly as long as nobody ran an
-- UPDATE. Repointing `reporte_id` at a RECIBIDO report walked straight past it. Reproduced:
-- `UPDATE 1`, and the pedido then sat on the board sourced from something nobody had looked at.
--
-- Second hole in the same check: it asked for `estado` and `verificado_por` but never for
-- `tipo`. A damage report — «the bridge is out», not a request for anything — could be
-- verified and then inserted as a pedido, which is demand nobody expressed. 2.12 says never
-- guess what somebody meant; turning a damage report into a supply request is exactly that
-- guess, made by the schema.
--
-- And nothing tied the pedido's own `comunidad_id` / `codigo_item` to the report's, so a row
-- could claim a verified source while describing a different community's need for a different
-- item. All seven pedidos in the seed already agree with their source; this makes that an
-- invariant rather than a coincidence.

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

  -- A need, not a damage report and not something still unclassified. Promoting either would
  -- be the schema deciding what somebody meant (2.12).
  if r.tipo <> 'necesidad' then
    raise exception
      'Un pedido solo nace de un reporte de necesidad. Reporte % es de tipo «%».',
      r.folio, r.tipo
      using errcode = 'check_violation';
  end if;

  if r.codigo_item is null then
    raise exception
      'El reporte % no dice qué se necesita, así que no puede volverse un pedido.', r.folio
      using errcode = 'check_violation';
  end if;

  -- The pedido describes the report it came from, not a different need wearing its id.
  if new.comunidad_id <> r.comunidad_id then
    raise exception
      'El pedido dice una comunidad distinta a la del reporte % que lo origina.', r.folio
      using errcode = 'check_violation';
  end if;

  if new.codigo_item <> r.codigo_item then
    raise exception
      'El pedido dice un artículo distinto al del reporte % que lo origina.', r.folio
      using errcode = 'check_violation';
  end if;

  return new;
end
$exigir$;

comment on function exigir_reporte_verificado() is
  'M7 acceptance: nothing reaches pedidos without a human action, and it stays that way. Checks the source report is a verified NEED with an item, and that the pedido still describes that same report. A trigger rather than a policy, because service_role bypasses RLS and intake runs as service_role.';

-- ── Also on the way out of the insert ───────────────────────────────────────────────────
--
-- Scoped with WHEN so the matcher's constant `estado` updates do not pay for a lookup they
-- cannot invalidate. Only a change to the binding itself re-opens the question.

drop trigger if exists pedidos_exigen_verificacion_al_cambiar on pedidos;

create trigger pedidos_exigen_verificacion_al_cambiar
  before update on pedidos
  for each row
  when (
    old.reporte_id is distinct from new.reporte_id
    or old.comunidad_id is distinct from new.comunidad_id
    or old.codigo_item is distinct from new.codigo_item
  )
  execute function exigir_reporte_verificado();
