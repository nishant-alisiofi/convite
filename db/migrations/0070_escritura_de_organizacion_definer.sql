-- Three organisation writers were silently doing nothing.
--
-- `organizaciones` carries exactly one policy — `organizaciones_lectura`, for SELECT (0017).
-- There is no INSERT or UPDATE policy at all, which is deliberate: the table is written through
-- named SECURITY DEFINER functions that each carry their own check, never by an open policy.
-- `convite_fijar_ubicacion_organizacion` (0036) is the pattern, and it says so.
--
-- The three functions added last night did not follow it. They were written `security invoker`,
-- so their UPDATE ran as the caller, RLS matched no rows, and — because an UPDATE that affects
-- zero rows is not an error — every one of them returned success having changed nothing.
--
-- The visible symptom was an onboarding loop with no error message anywhere: the form submitted,
-- the function reported success, the panel gate re-read `onboarding_completado_en`, still found
-- null, and sent the person back to /comenzar. Forever. Nothing was broken enough to log.
--
-- Two changes, and the second matters as much as the first:
--
--   1. SECURITY DEFINER, with `set search_path = public`, matching 0036. The admin check inside
--      each function is what authorises the write — that check was always there and was never
--      the problem.
--   2. Every one of them now asserts it actually updated a row. A silent no-op is the worst
--      failure mode available to a permissions-bearing function: it looks exactly like success
--      to every caller, and the only evidence is a person stuck on a screen.

create or replace function convite_declarar_organizacion(
  p_intenciones text[],
  p_herramientas text[],
  p_fase text,
  p_alcance_rural boolean
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := convite_organizacion();
  v_antes jsonb;
  v_filas integer;
begin
  if not convite_es(array['admin']) then
    raise exception 'solo un admin declara la organización' using errcode = 'insufficient_privilege';
  end if;
  if v_org is null then
    raise exception 'sin organización en la sesión' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(cardinality(p_intenciones), 0) = 0 then
    raise exception 'hay que decir al menos para qué está la organización'
      using errcode = 'check_violation';
  end if;

  select jsonb_build_object(
           'intenciones', to_jsonb(o.intenciones),
           'herramientas', to_jsonb(o.herramientas),
           'fase', o.fase,
           'alcance_rural', o.alcance_rural,
           'onboarding_completado_en', o.onboarding_completado_en
         )
    into v_antes
    from organizaciones o
   where o.id = v_org;

  update organizaciones
     set intenciones = p_intenciones,
         herramientas = coalesce(p_herramientas, '{}'),
         fase = p_fase,
         alcance_rural = p_alcance_rural,
         onboarding_completado_en = now()
   where id = v_org;

  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'no se pudo declarar la organización (% filas afectadas)', v_filas
      using errcode = 'internal_error';
  end if;

  insert into auditoria (actor_id, accion, entidad, entidad_id, antes, despues)
  values (
    auth.uid(), 'organizacion.declarada', 'organizaciones', v_org, v_antes,
    jsonb_build_object(
      'intenciones', to_jsonb(p_intenciones),
      'herramientas', to_jsonb(coalesce(p_herramientas, '{}'::text[])),
      'fase', p_fase,
      'alcance_rural', p_alcance_rural
    )
  );
end;
$$;

create or replace function convite_fijar_canales_organizacion(
  p_whatsapp text,
  p_voz      text,
  p_workspace text
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := convite_organizacion();
  v_filas integer;
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

  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'no se pudieron fijar los canales (% filas afectadas)', v_filas
      using errcode = 'internal_error';
  end if;

  insert into auditoria (actor_id, accion, entidad, entidad_id, despues)
  values (auth.uid(), 'organizacion.canales', 'organizaciones', v_org,
          jsonb_build_object('whatsapp', nullif(btrim(p_whatsapp), ''),
                             'voz', nullif(btrim(p_voz), ''),
                             'workspace', nullif(btrim(p_workspace), '')));
end;
$$;

create or replace function convite_fijar_permisos_admin(p_permisos jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := convite_organizacion();
  v_clave text;
  v_filas integer;
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

  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'no se pudieron fijar los permisos (% filas afectadas)', v_filas
      using errcode = 'internal_error';
  end if;

  insert into auditoria (actor_id, accion, entidad, entidad_id, despues)
  values (auth.uid(), 'organizacion.permisos', 'organizaciones', v_org,
          jsonb_build_object('permisos_admin', p_permisos));
end;
$$;
