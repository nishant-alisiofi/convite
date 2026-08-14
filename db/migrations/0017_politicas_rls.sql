-- Per-role RLS policies (Section 11).
--
-- Two rules shape everything here.
--
-- Separation of duties: whoever confirms a need is real must not also be the one deciding
-- it gets skipped. So `verificador` can verify and cannot dispatch; `despachador` can
-- dispatch and cannot verify. Neither is a UI convention — both are enforced below, and the
-- M3 tests assert each direction.
--
-- Infrastructure versus intake: placing a centre, opening a route, editing the catalogue or
-- registering a community are decisions an organisation's `admin` makes. Counting what is
-- inside a centre is a `coordinador` job. And nothing arriving from a phone creates either:
-- reports and offers are written by the service role on behalf of people who never log in
-- (2.10), then promoted by a human.
--
-- `service_role` bypasses RLS entirely and is what the webhook, the matcher and the job
-- worker use. These policies govern human sessions.

-- Table-level grants first: RLS narrows rows, it does not grant access. Without these an
-- authenticated session sees nothing at all, which is the correct failure direction.
do $grants$
declare
  t text;
begin
  -- Readable by any signed-in staff member. `lectura` is narrowed to nothing further down.
  foreach t in array array[
    'organizaciones', 'comunidades', 'catalogo_items', 'nodos', 'rutas',
    'existencias', 'pedidos', 'reportes', 'contactos', 'capacidades',
    'envios', 'envio_items', 'entregas', 'emparejamientos', 'ofertas',
    'voluntarios', 'recogidas', 'decisiones_asignacion', 'adjuntos',
    'mensajes', 'usuarios', 'usuarios_comunidades', 'auditoria',
    'invitaciones_staff', 'invitaciones_comunidades'
  ]
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end
$grants$;

-- ── Identity ────────────────────────────────────────────────────────────────────────────

create policy usuarios_ve_su_propia_fila on usuarios
  for select to authenticated
  using (id = auth.uid() or convite_es(array['coordinador', 'admin']));

create policy usuarios_admin_gestiona on usuarios
  for all to authenticated
  using (convite_es(array['admin']) and organizacion_id = convite_organizacion())
  with check (convite_es(array['admin']) and organizacion_id = convite_organizacion());

create policy usuarios_comunidades_lectura on usuarios_comunidades
  for select to authenticated
  using (usuario_id = auth.uid() or convite_es(array['coordinador', 'admin']));

create policy usuarios_comunidades_admin on usuarios_comunidades
  for all to authenticated
  using (convite_es(array['admin'])) with check (convite_es(array['admin']));

create policy invitaciones_admin on invitaciones_staff
  for all to authenticated
  using (convite_es(array['admin']) and organizacion_id = convite_organizacion())
  with check (convite_es(array['admin']) and organizacion_id = convite_organizacion());

create policy invitaciones_com_admin on invitaciones_comunidades
  for all to authenticated
  using (convite_es(array['admin'])) with check (convite_es(array['admin']));

-- ── Reference data ──────────────────────────────────────────────────────────────────────
-- Everyone with a role reads it; only admin changes it. `lectura` gets nothing: Section 11
-- says aggregate views only, and `mapa_publico` is already granted to authenticated.

create policy organizaciones_lectura on organizaciones
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));

create policy comunidades_lectura on comunidades
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));

create policy comunidades_admin_escribe on comunidades
  for all to authenticated
  using (convite_es(array['admin']) and organizacion_id = convite_organizacion())
  with check (convite_es(array['admin']) and organizacion_id = convite_organizacion());

create policy catalogo_lectura on catalogo_items
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));

create policy catalogo_admin_escribe on catalogo_items
  for all to authenticated
  using (convite_es(array['admin'])) with check (convite_es(array['admin']));

-- ── Centres ─────────────────────────────────────────────────────────────────────────────
-- Deciding where a centre goes belongs to an organisation's admin. A coordinator running
-- the response day to day counts what is in it; they do not open a new one.

create policy nodos_lectura on nodos
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));

create policy nodos_admin_escribe on nodos
  for all to authenticated
  using (
    convite_es(array['admin'])
    and exists (
      select 1 from comunidades c
       where c.id = nodos.comunidad_id and c.organizacion_id = convite_organizacion()
    )
  )
  with check (
    convite_es(array['admin'])
    and exists (
      select 1 from comunidades c
       where c.id = nodos.comunidad_id and c.organizacion_id = convite_organizacion()
    )
  );

-- ── Inventory and routes: the coordinator's desk ────────────────────────────────────────

create policy existencias_lectura on existencias
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));

create policy existencias_coordina on existencias
  for all to authenticated
  using (convite_es(array['coordinador', 'admin']))
  with check (convite_es(array['coordinador', 'admin']));

create policy rutas_lectura on rutas
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));

create policy rutas_coordina on rutas
  for all to authenticated
  using (convite_es(array['coordinador', 'admin']))
  with check (convite_es(array['coordinador', 'admin']));

-- ── Intake: verification, and nothing else ──────────────────────────────────────────────

create policy reportes_lectura on reportes
  for select to authenticated
  using (
    convite_es(array['despachador', 'coordinador', 'admin'])
    or (convite_es(array['verificador']) and convite_alcanza_comunidad(comunidad_id))
  );

create policy reportes_verifica on reportes
  for update to authenticated
  using (
    convite_es(array['coordinador', 'admin'])
    or (convite_es(array['verificador']) and convite_alcanza_comunidad(comunidad_id))
  )
  with check (
    convite_es(array['coordinador', 'admin'])
    or (convite_es(array['verificador']) and convite_alcanza_comunidad(comunidad_id))
  );

create policy adjuntos_lectura on adjuntos
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));

create policy adjuntos_corrige on adjuntos
  for update to authenticated
  using (convite_es(array['verificador', 'coordinador', 'admin']))
  with check (convite_es(array['verificador', 'coordinador', 'admin']));

create policy mensajes_lectura on mensajes
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));

create policy contactos_lectura on contactos
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));

create policy contactos_coordina on contactos
  for all to authenticated
  using (convite_es(array['coordinador', 'admin']))
  with check (convite_es(array['coordinador', 'admin']));

-- ── Requests ────────────────────────────────────────────────────────────────────────────
-- A verificador promotes a verified report into a pedido; that is the only path in
-- (Section 9.8). They may not then decide it gets skipped.

create policy pedidos_lectura on pedidos
  for select to authenticated
  using (
    convite_es(array['despachador', 'coordinador', 'admin'])
    or (convite_es(array['verificador']) and convite_alcanza_comunidad(comunidad_id))
  );

create policy pedidos_verificador_promueve on pedidos
  for insert to authenticated
  with check (
    convite_es(array['coordinador', 'admin'])
    or (convite_es(array['verificador']) and convite_alcanza_comunidad(comunidad_id))
  );

create policy pedidos_coordina on pedidos
  for update to authenticated
  using (convite_es(array['despachador', 'coordinador', 'admin']))
  with check (convite_es(array['despachador', 'coordinador', 'admin']));

-- ── Offers ──────────────────────────────────────────────────────────────────────────────
-- Row access is broad; the home address is not. 2.16 is enforced by the column grant below
-- plus `convite_recoge_oferta`.

create policy ofertas_lectura on ofertas
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));

create policy ofertas_coordina on ofertas
  for all to authenticated
  using (convite_es(array['coordinador', 'admin']))
  with check (convite_es(array['coordinador', 'admin']));

create policy voluntarios_lectura on voluntarios
  for select to authenticated
  using (convite_es(array['despachador', 'coordinador', 'admin']));

create policy voluntarios_coordina on voluntarios
  for all to authenticated
  using (convite_es(array['coordinador', 'admin']))
  with check (convite_es(array['coordinador', 'admin']));

-- ── Dispatch: the despachador's desk ────────────────────────────────────────────────────

create policy capacidades_lectura on capacidades
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));

create policy capacidades_despacha on capacidades
  for all to authenticated
  using (convite_es(array['despachador', 'coordinador', 'admin']))
  with check (convite_es(array['despachador', 'coordinador', 'admin']));

create policy envios_lectura on envios
  for select to authenticated
  using (
    convite_es(array['verificador', 'despachador', 'coordinador', 'admin'])
    or exists (
      select 1 from usuarios u
       where u.id = auth.uid() and u.contacto_id = envios.responsable_id
    )
  );

create policy envios_despacha on envios
  for all to authenticated
  using (convite_es(array['despachador', 'coordinador', 'admin']))
  with check (convite_es(array['despachador', 'coordinador', 'admin']));

create policy envio_items_lectura on envio_items
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));

create policy envio_items_despacha on envio_items
  for all to authenticated
  using (convite_es(array['despachador', 'coordinador', 'admin']))
  with check (convite_es(array['despachador', 'coordinador', 'admin']));

create policy entregas_lectura on entregas
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));

create policy entregas_despacha on entregas
  for all to authenticated
  using (convite_es(array['despachador', 'coordinador', 'admin']))
  with check (convite_es(array['despachador', 'coordinador', 'admin']));

create policy recogidas_lectura on recogidas
  for select to authenticated
  using (convite_es(array['despachador', 'coordinador', 'admin']));

create policy recogidas_despacha on recogidas
  for all to authenticated
  using (convite_es(array['despachador', 'coordinador', 'admin']))
  with check (convite_es(array['despachador', 'coordinador', 'admin']));

create policy emparejamientos_lectura on emparejamientos
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));

create policy emparejamientos_confirma on emparejamientos
  for all to authenticated
  using (convite_es(array['despachador', 'coordinador', 'admin']))
  with check (convite_es(array['despachador', 'coordinador', 'admin']));

-- Non-negotiable 2.9: the rationing record. A despachador writes it because they made the
-- call; nobody may edit or erase one afterwards, which is the whole point of having it.
create policy decisiones_lectura on decisiones_asignacion
  for select to authenticated
  using (convite_es(array['verificador', 'despachador', 'coordinador', 'admin']));

create policy decisiones_registra on decisiones_asignacion
  for insert to authenticated
  with check (
    convite_es(array['despachador', 'coordinador', 'admin'])
    and confirmado_por = auth.uid()
  );

-- ── Audit ───────────────────────────────────────────────────────────────────────────────
-- Readable by those accountable for it, append-only for everyone. No UPDATE or DELETE
-- policy exists, so neither is possible for any authenticated role.

create policy auditoria_lectura on auditoria
  for select to authenticated
  using (convite_es(array['coordinador', 'admin']));

create policy auditoria_escribe on auditoria
  for insert to authenticated
  with check (convite_rol() is not null);

-- ── 2.16: the donor's address ───────────────────────────────────────────────────────────
--
-- RLS filters rows, not columns, so the address needs a column grant. Staff see the offer
-- — item, quantity, whether it is perishable — without ever seeing where the person lives.
-- The pickup driver gets it through `direccion_de_oferta()`, inside their window.

revoke select on ofertas from authenticated;
grant select (
  id, contacto_id, texto_original, codigo_item, cantidad, unidad, confianza,
  requiere_aclaracion, perecedero, vence_en, necesita_recogida, estado,
  creado_en, actualizado_en
) on ofertas to authenticated;

create or replace function direccion_de_oferta(oferta uuid)
returns table (direccion_texto text, lat double precision, lon double precision)
language sql stable security definer set search_path = public
as $$
  select o.direccion_texto, st_y(o.ubicacion), st_x(o.ubicacion)
    from ofertas o
   where o.id = oferta and convite_recoge_oferta(oferta)
$$;

grant execute on function direccion_de_oferta(uuid) to authenticated;

comment on function direccion_de_oferta(uuid) is
  'The only way an address leaves the database. Non-negotiable 2.16: a private home plus a name plus "has supplies" is a target.';
