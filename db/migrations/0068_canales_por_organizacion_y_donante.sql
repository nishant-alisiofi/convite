-- Two things, both of which are really the same thing: an organisation is a tenant, and a tenant
-- arrives with its own way of being contacted.
--
-- ── 1. Channel identity per organisation ──────────────────────────────────────────────────────
--
-- `waba_phone_number_id` has been on `organizaciones` since the beginning, but it is a Meta
-- identifier — it routes an inbound webhook and cannot be dialled, texted or printed on a poster.
-- So there was no answer anywhere in the schema to «what number does this organisation answer
-- on», which is the first thing a partner has and the first thing a community needs.
--
-- This is also how the product scales past one basin. PRD-multiciudad M2 asks «one WhatsApp
-- number or one per city?» and answers one per city, because a message from an unknown number
-- cannot be attributed to a tenant on a shared line, and one WABA's rate limits and one
-- suspension would then be everybody's. The same argument applies to the voice number and to
-- Workspace: each partner brings their own, and the platform records rather than supplies them.
--
--   telefono_whatsapp   the business number the WABA answers on, E.164. Dialable and printable.
--   telefono_voz        the Infobip voice number for missed-call callback (PRD-15), E.164.
--   dominio_workspace   the partner's Google Workspace domain, for the Calendar/Meet work in
--                       PRD-34 §28.4.4. Recorded now because onboarding already asks which tools
--                       they use and had nowhere to put the answer.
--
-- ── 2. A donor can offer something without an account ─────────────────────────────────────────
--
-- `ofertas` has existed since the beginning and **nothing outside the seed has ever written a
-- row**: both its policies are staff-only, so an offer could only be keyed in by a coordinator
-- who had already been told about it by other means. docs/tipos-de-usuario-y-accesos.md §2.2
-- calls the self-service donor path «Nuevo» and it stayed new.
--
-- Giving is the one thing a stranger arrives wanting to do, and §1's whole principle is that
-- friction scales with power: a donor sees nothing sensitive and should meet no wall. So this is
-- a SECURITY DEFINER writer with a deliberately small surface — it creates or reuses a `donante`
-- contact from a name and a number, writes one offer, and can do nothing else.

alter table organizaciones add column telefono_whatsapp text;
alter table organizaciones add column telefono_voz text;
alter table organizaciones add column dominio_workspace text;

-- E.164 or nothing. A half-formatted number is worse than a missing one: it looks dialable, gets
-- printed on something, and fails in the field rather than here.
alter table organizaciones add constraint organizaciones_telefono_whatsapp_check
  check (telefono_whatsapp is null or telefono_whatsapp ~ '^\+[1-9][0-9]{7,14}$');
alter table organizaciones add constraint organizaciones_telefono_voz_check
  check (telefono_voz is null or telefono_voz ~ '^\+[1-9][0-9]{7,14}$');

-- Unique so two tenants cannot claim the same line. Inbound attribution depends on it.
create unique index organizaciones_telefono_whatsapp_key
  on organizaciones (telefono_whatsapp) where telefono_whatsapp is not null;
create unique index organizaciones_telefono_voz_key
  on organizaciones (telefono_voz) where telefono_voz is not null;

comment on column organizaciones.telefono_whatsapp is
  'The dialable WhatsApp Business number, E.164. Distinct from waba_phone_number_id, which is a Meta routing identifier and cannot be dialled or printed.';
comment on column organizaciones.telefono_voz is
  'The Infobip voice number this organisation answers missed calls on (PRD-15), E.164. One per tenant — a shared line cannot attribute an unknown caller to an organisation.';
comment on column organizaciones.dominio_workspace is
  'The partner''s Google Workspace domain, for the Calendar/Meet integration in PRD-34 §28.4.4. Recorded, not yet used.';

create or replace function convite_fijar_canales_organizacion(
  p_whatsapp text,
  p_voz      text,
  p_workspace text
) returns void
language plpgsql security invoker
as $$
declare
  v_org uuid := convite_organizacion();
begin
  if not convite_es(array['admin']) then
    raise exception 'Solo un admin cambia los canales de su organización.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_org is null then
    raise exception 'La sesión no pertenece a ninguna organización.'
      using errcode = 'insufficient_privilege';
  end if;

  update organizaciones
     set telefono_whatsapp = nullif(btrim(p_whatsapp), ''),
         telefono_voz = nullif(btrim(p_voz), ''),
         dominio_workspace = nullif(btrim(p_workspace), '')
   where id = v_org;

  insert into auditoria (actor_id, accion, entidad, entidad_id, despues)
  values (auth.uid(), 'organizacion.canales', 'organizaciones', v_org,
          jsonb_build_object('whatsapp', nullif(btrim(p_whatsapp), ''),
                             'voz', nullif(btrim(p_voz), ''),
                             'workspace', nullif(btrim(p_workspace), '')));
end;
$$;

grant execute on function convite_fijar_canales_organizacion(text, text, text) to authenticated;

-- ── The donor's offer ─────────────────────────────────────────────────────────────────────────

-- Which tenant the offer belongs to. `ofertas` reaches an organisation only through
-- contacto → comunidad today, which is null for a donor who belongs to no community — and
-- PRD-multiciudad is explicit that the tenant key wants denormalising onto every row rather than
-- reached through a join. Nullable because existing rows predate it.
alter table ofertas add column organizacion_id uuid references organizaciones (id);

update ofertas o
   set organizacion_id = c.organizacion_id
  from contactos ct
  join comunidades c on c.id = ct.comunidad_id
 where ct.id = o.contacto_id and o.organizacion_id is null;

comment on column ofertas.organizacion_id is
  'Which organisation the offer was made to. Denormalised rather than reached through contacto → comunidad, because a self-service donor belongs to no community.';

/*
 * NOTE, deliberately left as a follow-up rather than changed here: `ofertas_lectura` and
 * `ofertas_coordina` (0017) are role-gated and NOT organisation-scoped, so today every approved
 * organisation's staff can read every offer. That was harmless with one tenant and is not once
 * there are several. Scoping those two policies to `organizacion_id = convite_organizacion()` is
 * a behaviour change to a shipped surface and belongs in its own migration with its own test,
 * next to the same treatment for the other pre-tenant tables.
 */

create or replace function registrar_oferta_donante(
  p_organizacion uuid,
  p_nombre       text,
  p_telefono     text,
  p_texto        text,
  p_codigo_item  text    default null,
  p_cantidad     numeric default null,
  p_unidad       text    default null
) returns table (oferta_id uuid)
language plpgsql security definer set search_path = public
as $$
declare
  v_tel     text := nullif(btrim(p_telefono), '');
  v_nombre  text := nullif(btrim(p_nombre), '');
  v_texto   text := nullif(btrim(p_texto), '');
  v_item    text := nullif(btrim(p_codigo_item), '');
  v_contacto uuid;
  v_oferta   uuid;
begin
  if v_tel is null or v_tel !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Hace falta un número en formato internacional, así: +573001112233.'
      using errcode = 'check_violation';
  end if;
  if v_nombre is null then
    raise exception 'Hace falta un nombre.' using errcode = 'check_violation';
  end if;
  if v_texto is null then
    raise exception 'Diga qué puede aportar.' using errcode = 'check_violation';
  end if;

  -- The offer must be made TO somebody. An approved organisation only: a pending one has no desk
  -- to receive it, and letting an offer name an unapproved organisation would make this function
  -- a way to discover which ones exist.
  if not exists (
    select 1 from organizaciones
     where id = p_organizacion
       and estado_aprobacion = 'aprobada'
       and activo
       -- Not an aportante. Those are the one-person organisations FR-18 mints for a
       -- self-registered transporter — they exist to hold somebody's boat, have an empty
       -- permission ceiling and no desk, and an offer sent there would be received by nobody.
       -- Without this the first approved organisation happened to be one, which is exactly what
       -- the dry run of this migration turned up.
       and coalesce(nivel_admision, '') <> 'aportante'
  ) then
    raise exception 'Esa organización no está recibiendo aportes.' using errcode = 'check_violation';
  end if;

  if v_item is not null and not exists (
    select 1 from catalogo_items where codigo = v_item and activo
  ) then
    raise exception 'Ese código de catálogo no existe o está inactivo.' using errcode = 'check_violation';
  end if;

  -- Reuse the contact if this number has offered before. A donor who gives twice is one person,
  -- not two, and 2.10 still holds: a number on an offer opens no panel.
  select id into v_contacto from contactos where telefono = v_tel;
  if v_contacto is null then
    insert into contactos (telefono, nombre, rol, canal_preferido)
    values (v_tel, v_nombre, 'donante', 'whatsapp')
    returning id into v_contacto;
  end if;

  -- `texto_original` is what they wrote, kept verbatim (M4's invariant): the classifier may
  -- propose a code later, and the person's own words are never overwritten by it.
  insert into ofertas
    (contacto_id, organizacion_id, texto_original, codigo_item, cantidad, unidad,
     requiere_aclaracion, perecedero, necesita_recogida, estado)
  values (
    v_contacto, p_organizacion, v_texto, v_item, p_cantidad, nullif(btrim(p_unidad), ''),
    -- Unclassified until somebody classifies it. `ofertas_clasificacion_check` enforces the same
    -- rule the report pipeline follows (2.12, 0021): without a catalogue code the row says so
    -- rather than guessing, and `requiere_aclaracion` is how the desk knows to ask.
    v_item is null, false, true,
    case when v_item is null then 'SIN_CLASIFICAR' else 'DISPONIBLE' end
  )
  returning id into v_oferta;

  return query select v_oferta;
end;
$$;

comment on function registrar_oferta_donante is
  'Self-service donor offer (tipos-de-usuario §2.2). Creates or reuses a donante contact from a name and an E.164 number and writes one offer to an approved organisation. Deliberately tiny: it can do nothing else, and grants the donor no session and no read.';

grant execute on function registrar_oferta_donante(uuid, text, text, text, text, numeric, text)
  to anon, authenticated;
