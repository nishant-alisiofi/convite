-- An admin turns capabilities off for their own organisation, and says whether its data may
-- leave for Google Workspace.
--
-- ── Why a second layer instead of letting an admin edit `techo_permisos` ─────────────────────
--
-- `convite_puede(cap)` is an AND of two facts (0047): the caller's ROLE exercises the capability,
-- and the ORGANISATION's ceiling grants it. The ceiling is the platform's instrument — it is what
-- admission decides and what `convite_membresia_cabe_en_techo` clips memberships to — so handing
-- an org admin a form that writes it would let any organisation grant itself whatever it was
-- refused at admission. The ceiling is exactly the thing a tenant must not be able to raise.
--
-- So this adds a third fact that can only ever SUBTRACT. `permisos_admin` holds explicit denials:
-- a key set to false is off, and a key that is absent inherits whatever the ceiling says. An
-- admin can therefore switch off despatch for their organisation, and can never switch on
-- anything admission withheld. `convite_puede` gains one clause and stays an AND, so every
-- direction it can move is towards refusing.
--
-- This is the separation the product already believes in elsewhere: the platform decides what an
-- organisation MAY do, the organisation decides what it DOES.
--
-- ── The consent key ─────────────────────────────────────────────────────────────────────────
--
-- `datos_externos` is new, and it is a consent rather than a feature flag. PRD-34 §28.4 gates
-- Drive behind «explicit sharing config and strip EXIF first», which reads as a build-order
-- problem; it is really a question for the partner: is this an organisation willing to have
-- operational data — including photographs of damaged houses, §13 — live inside Google. That is a
-- position an organisation holds, not a switch engineering flips, and it belongs next to the
-- other things they declare about themselves.
--
-- Recorded and enforced here; nothing reads it yet, because §28.4.4's «Conectar con Google» is
-- unbuilt. It exists first on purpose: the gate should be in place before the door.

alter table organizaciones
  add column permisos_admin jsonb not null default '{}'::jsonb;

comment on column organizaciones.permisos_admin is
  'Explicit denials an org admin sets for their own organisation. false = off; absent = inherit techo_permisos. Can only narrow the ceiling, never raise it — see convite_puede.';

-- The ceiling gains the consent key so admission can withhold it, exactly like acceso_sensible
-- (0063). Absent means false: an organisation that has never said yes has not said yes.
comment on column organizaciones.techo_permisos is
  'Capability ceiling set at admission (0042/0047/0063). Keys: comunidades_alcance, direcciones_hogar, inventario_nodo, despacho, agendamiento, evaluacion, puede_delegar, acceso_sensible, and datos_externos (0069 — consent for operational data to reach Google Workspace).';

create or replace function convite_puede(p_cap text) returns boolean
language sql stable security definer set search_path = public as $puede$
  select exists (
    select 1
      from convite_membresias_activas() m
      join organizaciones o on o.id = m.organizacion_id
     where convite_rol_ejerce(m.rol, p_cap)
       and coalesce((o.techo_permisos ->> p_cap)::boolean, false)
       -- The admin's own denials. Absent inherits; only an explicit false removes. This clause
       -- can never widen the result, so the function is still the ceiling's servant.
       and coalesce((o.permisos_admin ->> p_cap)::boolean, true)
  )
$puede$;

comment on function convite_puede(text) is
  'PRD-16 (§29.5): the caller''s effective capabilities across every active membership — role exercises it AND the org ceiling grants it AND the org admin has not switched it off (0069). Computed per request, never cached.';

/**
 * Set the organisation's own denials.
 *
 * Takes the full map each time rather than one key at a time: the form shows every switch, so it
 * knows every answer, and a partial write would make «absent» ambiguous between «inherit» and
 * «this form did not mention it».
 */
create or replace function convite_fijar_permisos_admin(p_permisos jsonb)
returns void
language plpgsql security invoker
as $$
declare
  v_org uuid := convite_organizacion();
  v_clave text;
begin
  if not convite_es(array['admin']) then
    raise exception 'Solo un admin cambia los permisos de su organización.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_org is null then
    raise exception 'La sesión no pertenece a ninguna organización.'
      using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_permisos) <> 'object' then
    raise exception 'Los permisos tienen que venir como objeto.' using errcode = 'check_violation';
  end if;

  -- Only booleans, and only known capabilities. An unknown key would sit in the column looking
  -- meaningful and gating nothing, which is how a permission screen starts lying.
  for v_clave in select jsonb_object_keys(p_permisos) loop
    if v_clave not in ('direcciones_hogar', 'inventario_nodo', 'despacho', 'agendamiento',
                       'evaluacion', 'puede_delegar', 'acceso_sensible', 'datos_externos') then
      raise exception 'Capacidad desconocida: %', v_clave using errcode = 'check_violation';
    end if;
    if jsonb_typeof(p_permisos -> v_clave) <> 'boolean' then
      raise exception 'La capacidad % tiene que ser verdadero o falso.', v_clave
        using errcode = 'check_violation';
    end if;
  end loop;

  update organizaciones set permisos_admin = p_permisos where id = v_org;

  insert into auditoria (actor_id, accion, entidad, entidad_id, despues)
  values (auth.uid(), 'organizacion.permisos', 'organizaciones', v_org,
          jsonb_build_object('permisos_admin', p_permisos));
end;
$$;

comment on function convite_fijar_permisos_admin is
  'An org admin switches their own organisation''s capabilities off. Validates keys and types, audited. Cannot raise the admission ceiling — convite_puede ANDs both.';

grant execute on function convite_fijar_permisos_admin(jsonb) to authenticated;

-- ── The tools an organisation already works in, widened ─────────────────────────────────────
--
-- 0065 asked the question with a list drawn from what a coordinator has on their own phone —
-- WhatsApp, Drive, Sheets, Calendar, Excel, radio, paper. That is the right list for a community
-- council and the wrong one for an NGO, and PRD-34 §28.3's "import ≥ export" only pays off if the
-- answer names something we could actually read from.
--
-- KoboToolbox is the one that matters most. It is the standard data-collection tool in
-- humanitarian work — ODK-based, free for non-profits, with UN agencies running their own
-- instances — so a partner arriving with three years of assessments almost certainly has them in
-- Kobo, not in a spreadsheet. ODK itself is listed separately because organisations run it
-- directly, and ActivityInfo because it is the long-term information-management counterpart Kobo
-- is repeatedly compared against.
--
-- `otra` matters more than any of the named ones. Kobo's dominance in humanitarian work is well
-- evidenced globally; that Colombian partner organisations in particular use it is an INFERENCE
-- and was not confirmed. §28.3 says «ask what exists before designing anything», and a fixed list
-- of guesses is not asking — it is offering somebody our assumptions and recording which one they
-- picked. `otra` is how the question can come back with an answer nobody here thought of, the
-- same escape hatch TIPOS_ORGANIZACION carries as `otro` «so the registry never has to reject a
-- real organisation just to record it».
--
-- Adding a value is a one-line ALTER by design (text + check, never an enum), which is the whole
-- reason the vocabulary was modelled that way — so a wrong guess here is cheap to correct once
-- partners have actually answered.

alter table organizaciones drop constraint organizaciones_herramientas_check;
alter table organizaciones add constraint organizaciones_herramientas_check
  check (herramientas <@ array[
    'whatsapp', 'google_drive', 'google_sheets', 'google_calendar', 'excel', 'radio', 'papel',
    'kobotoolbox', 'odk', 'activityinfo',
    'otra', 'ninguna'
  ]::text[]);
