-- Which approved template a queued message would need, if it goes out late.
--
-- 2.14's queue holds a message until the person reappears. That wait is exactly what can
-- push a send past WhatsApp's 24-hour window, and outside it only an approved utility
-- template may be sent — so the row has to remember which one. Without this column the
-- sender reaching a queued message after the window closed has two choices: drop it, or
-- send free text that Meta refuses. Both lose a folio somebody is waiting on.
--
-- Nullable, because most queued messages are answered inside the window and go out as
-- ordinary text. A name here is a *reference*, not proof of anything: decision D4 is still
-- open and not one of the five templates in docs/plantillas-whatsapp.md has been approved.
-- The column records intent; the sender still has to fail closed until they clear.
--
-- Deliberately not a check constraint against a fixed list. Templates are Meta-side
-- configuration that changes without a deploy, and a constraint here would turn "the partner
-- got a sixth template approved" into a migration.

alter table salidas_pendientes add column plantilla text;

comment on column salidas_pendientes.plantilla is
  'Approved utility template to use if this goes out after the 24-hour window closes (2.14). NULL means ordinary text, which is only legal inside the window. Names come from docs/plantillas-whatsapp.md; D4 has not approved any of them yet.';
