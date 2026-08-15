-- The verifier's territory now reaches the tables hanging off a report.
--
-- Section 11 scopes a `verificador` to their own communities, and 0017 enforced that on
-- `reportes` and `pedidos` — but not on the three tables that hold the actual contents of a
-- report. `contactos_lectura`, `mensajes_lectura` and `adjuntos_lectura` asked for a role and
-- nothing else, so a verifier working the Atrato medio could read Paimadó's phone numbers, the
-- raw text of what people wrote in, the stored payloads, the storage keys, and the transcripts
-- of their voice notes.
--
-- Those are the most sensitive rows in this database. 2.6 says the media never leaves our own
-- storage; 2.16 says a home address plus a name plus «has supplies» is a target. Both are about
-- keeping this material from travelling further than the work requires, and a scope that stops
-- at the parent table is not a scope.
--
-- It survived because it is invisible from the obvious angle: a query that reaches a message
-- through a join on `reportes` comes back empty even with the child policy wide open, because
-- the *parent* policy filters the join. It only shows up when the child row is fetched by id.
-- The tests added alongside this migration do exactly that.
--
-- The fix is one predicate, applied uniformly. `convite_alcanza_comunidad` already returns TRUE
-- for every role that is not a verificador, so adding it narrows the one role that is supposed
-- to be narrow and changes nothing for coordinador, admin or despachador. No role list moves.

-- ── Resolving a child row's community without tripping over RLS ─────────────────────────
--
-- SECURITY DEFINER for the same reason every helper in 0016 is: a policy on `mensajes` that
-- sub-queried `reportes` would have the `reportes` policy applied to the subquery, so the
-- answer would depend on a second policy rather than on the territory. Same answer today,
-- quietly different the day 0017 changes. This reads the parent row directly and asks the
-- territory question once.

create or replace function convite_alcanza_reporte(objetivo uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    -- No parent to place it in. A verifier is scoped by territory, so a row that belongs to
    -- no territory is not theirs; every other role is unaffected by the scope anyway.
    when objetivo is null then convite_rol() is not null and convite_rol() <> 'verificador'
    else exists (
      select 1 from reportes r
       where r.id = objetivo and convite_alcanza_comunidad(r.comunidad_id)
    )
  end
$$;

comment on function convite_alcanza_reporte(uuid) is
  'Whether the caller may reach a row hanging off this report. Territory for a verificador; true for any other staff role. NULL parent means «not placeable», which only a verificador is refused for.';

grant execute on function convite_alcanza_reporte(uuid) to authenticated;

-- ── Contacts ────────────────────────────────────────────────────────────────────────────
-- The community is on the row itself. A contact with no community — a transporter, somebody
-- offering supplies — is not part of any verifier's territory, and `convite_alcanza_comunidad`
-- already answers false for a NULL, which is the direction to fail in.

drop policy contactos_lectura on contactos;

create policy contactos_lectura on contactos
  for select to authenticated
  using (
    convite_es(array['verificador', 'despachador', 'coordinador', 'admin'])
    and convite_alcanza_comunidad(comunidad_id)
  );

-- ── Messages ────────────────────────────────────────────────────────────────────────────
-- Two ways to place one: the report it was classified into, or — before it has been
-- classified at all — the community of whoever sent it. Both are checked, because an
-- unclassified inbound message from another territory is exactly as private as a classified
-- one, and dropping the second path would leave the whole intake queue readable.

drop policy mensajes_lectura on mensajes;

create policy mensajes_lectura on mensajes
  for select to authenticated
  using (
    convite_es(array['verificador', 'despachador', 'coordinador', 'admin'])
    and (
      convite_alcanza_reporte(reporte_id)
      or exists (
        select 1 from contactos ct
         where ct.id = mensajes.contacto_id
           and convite_alcanza_comunidad(ct.comunidad_id)
      )
    )
  );

-- ── Attachments ─────────────────────────────────────────────────────────────────────────
-- Placed by their report. One attached to a delivery instead (`entrega_id`) has no report, so
-- a verificador does not reach it — deliveries are the despachador's half of the work.

drop policy adjuntos_lectura on adjuntos;

create policy adjuntos_lectura on adjuntos
  for select to authenticated
  using (
    convite_es(array['verificador', 'despachador', 'coordinador', 'admin'])
    and convite_alcanza_reporte(reporte_id)
  );

-- Correcting a transcript is already limited to verificador/coordinador/admin. Same territory
-- rule: a verifier may not fix the words on a recording they are not allowed to hear.
drop policy adjuntos_corrige on adjuntos;

create policy adjuntos_corrige on adjuntos
  for update to authenticated
  using (
    convite_es(array['verificador', 'coordinador', 'admin'])
    and convite_alcanza_reporte(reporte_id)
  )
  with check (
    convite_es(array['verificador', 'coordinador', 'admin'])
    and convite_alcanza_reporte(reporte_id)
  );
