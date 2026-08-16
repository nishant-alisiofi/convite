import type { PoolClient } from 'pg'

/**
 * Radio ingestion, from the coordinator's side (PRD-11, §2, §5.8).
 *
 * Two surfaces sit on top of the schema in db/schema/radio.ts:
 *
 *   1. Attestation management — which communities have radio ingestion turned on, by whom, and
 *      until when. Off by default and expiring by design, so this reads the current state and
 *      lets a coordinator attest, re-confirm, or revoke.
 *   2. Relay intake — keying in a report heard on the air, naming the two people it carries.
 *
 * Every function here takes the RLS-bound client from `conSesion` (lib/sesion.ts): reads and the
 * attestation writes go through the row-level policies, and the relay insert goes through the
 * SECURITY DEFINER `registrar_relevo_radio` function, which is the one gated door into `reportes`
 * for a signed-in coordinator.
 */

/** Why radio is or is not currently on for a community. Drift-closed: absent/expired/revoked = off. */
export type EstadoRadio = 'permitido' | 'vencido' | 'revocado' | 'inseguro' | 'nunca'

export type ComunidadRadio = {
  comunidadId: string
  nombre: string
  municipio: string
  /** 1 data reliable · 2 intermittent · 3 voice/SMS only · 4 radio relay only. */
  tierConectividad: number
  estado: EstadoRadio
  /** True only when a live, safe, unrevoked, unexpired attestation exists. */
  permitido: boolean
  redDescrita: string | null
  atestadoPor: string | null
  atestadoEn: Date | null
  expiraEn: Date | null
  notas: string | null
}

/**
 * Every community in the caller's organisation, with its radio state. The left join is the whole
 * point: a community with no attestation row comes back `nunca`, which is the off-by-default the
 * doctrine wants surfaced rather than hidden.
 */
export async function estadoRadioPorComunidad(client: PoolClient): Promise<ComunidadRadio[]> {
  const { rows } = await client.query<{
    comunidad_id: string
    nombre: string
    municipio: string
    tier_conectividad: number
    red_descrita: string | null
    uso_seguro: boolean | null
    atestado_por_nombre: string | null
    atestado_en: Date | null
    expira_en: Date | null
    revocado_en: Date | null
    notas: string | null
  }>(
    `select c.id                as comunidad_id,
            c.nombre,
            c.municipio,
            c.tier_conectividad,
            rp.red_descrita,
            rp.uso_seguro,
            ct.nombre            as atestado_por_nombre,
            rp.atestado_en,
            rp.expira_en,
            rp.revocado_en,
            rp.notas
       from comunidades c
       left join radio_permitido rp
         on rp.comunidad_id = c.id and rp.organizacion_id = c.organizacion_id
       left join usuarios u on u.id = rp.atestado_por
       left join contactos ct on ct.id = u.contacto_id
      where c.activa
      order by c.tier_conectividad desc, c.municipio, c.nombre`,
  )

  const ahora = Date.now()
  return rows.map((r) => {
    let estado: EstadoRadio
    if (r.atestado_en == null) estado = 'nunca'
    else if (r.revocado_en != null) estado = 'revocado'
    else if (!r.uso_seguro) estado = 'inseguro'
    else if (r.expira_en != null && r.expira_en.getTime() <= ahora) estado = 'vencido'
    else estado = 'permitido'
    return {
      comunidadId: r.comunidad_id,
      nombre: r.nombre,
      municipio: r.municipio,
      tierConectividad: r.tier_conectividad,
      estado,
      permitido: estado === 'permitido',
      redDescrita: r.red_descrita,
      atestadoPor: r.atestado_por_nombre,
      atestadoEn: r.atestado_en,
      expiraEn: r.expira_en,
      notas: r.notas,
    }
  })
}

/** Communities whose radio is on right now — the only ones a relay may be keyed in for. */
export async function comunidadesPermitidas(
  client: PoolClient,
): Promise<{ id: string; nombre: string; municipio: string }[]> {
  const { rows } = await client.query<{ id: string; nombre: string; municipio: string }>(
    `select c.id, c.nombre, c.municipio
       from comunidades c
       join radio_permitido rp
         on rp.comunidad_id = c.id and rp.organizacion_id = c.organizacion_id
      where c.activa
        and rp.uso_seguro
        and rp.revocado_en is null
        and rp.expira_en > now()
      order by c.municipio, c.nombre`,
  )
  return rows
}

/**
 * Attest, or re-confirm, that radio ingestion is legal and safe for a community. An upsert on the
 * (organizacion, comunidad) pair: re-confirmation resets the six-month clock and re-names the
 * attestor, and clears any prior revocation. `atestadoPor` is the signed-in staff member.
 */
export async function atestarRadio(
  client: PoolClient,
  args: {
    organizacionId: string
    comunidadId: string
    atestadoPor: string
    redDescrita: string
    usoSeguro: boolean
    notas: string | null
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const red = args.redDescrita.trim()
  if (!red) return { ok: false, error: 'Diga de qué red licenciada estamos hablando.' }
  try {
    await client.query(
      `insert into radio_permitido
         (organizacion_id, comunidad_id, atestado_por, red_descrita, uso_seguro,
          atestado_en, expira_en, revocado_en, revocado_por, notas)
       values ($1, $2, $3, $4, $5, now(), now() + interval '6 months', null, null, $6)
       on conflict (organizacion_id, comunidad_id) do update
         set atestado_por = excluded.atestado_por,
             red_descrita = excluded.red_descrita,
             uso_seguro   = excluded.uso_seguro,
             atestado_en  = excluded.atestado_en,
             expira_en    = excluded.expira_en,
             revocado_en  = null,
             revocado_por = null,
             notas        = excluded.notas`,
      [args.organizacionId, args.comunidadId, args.atestadoPor, red, args.usoSeguro, args.notas],
    )
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'No se pudo atestar.' }
  }
}

/** Pull a community's radio permission before it lapses. Carries a name (2.1). */
export async function revocarRadio(
  client: PoolClient,
  args: { organizacionId: string; comunidadId: string; revocadoPor: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { rowCount } = await client.query(
      `update radio_permitido
          set revocado_en = now(), revocado_por = $3
        where organizacion_id = $1 and comunidad_id = $2 and revocado_en is null`,
      [args.organizacionId, args.comunidadId, args.revocadoPor],
    )
    if (rowCount === 0) return { ok: false, error: 'No había una atestación vigente que revocar.' }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'No se pudo revocar.' }
  }
}

/**
 * Key in a report heard over the radio. Goes through `registrar_relevo_radio` (SECURITY DEFINER):
 * it checks role, organisation, the two people, and the radio gate, then writes a `canal = 'radio'`
 * second-hand report (born RECIBIDO) and its relay row. The folio comes back so the operator can
 * be told the number, as on every other channel.
 */
export async function registrarRelevo(
  client: PoolClient,
  args: { comunidadId: string; hablante: string; operador: string; detalle: string; tipo?: string },
): Promise<{ ok: true; folio: number; reporteId: string } | { ok: false; error: string }> {
  const hablante = args.hablante.trim()
  const operador = args.operador.trim()
  const detalle = args.detalle.trim()
  if (!hablante) return { ok: false, error: 'Nombre a quien habló por la radio.' }
  if (!operador) return { ok: false, error: 'Nombre al operador que lo transmitió.' }
  if (!detalle) return { ok: false, error: 'Escriba lo que se dijo — su escritura es el registro.' }
  const tipo = args.tipo === 'necesidad' || args.tipo === 'dano' ? args.tipo : 'sin_clasificar'
  try {
    const { rows } = await client.query<{ reporte_id: string; folio: number }>(
      `select reporte_id, folio from registrar_relevo_radio($1, $2, $3, $4, $5)`,
      [args.comunidadId, hablante, operador, detalle, tipo],
    )
    const fila = rows[0]
    if (!fila) return { ok: false, error: 'No se pudo registrar el relevo.' }
    return { ok: true, folio: fila.folio, reporteId: fila.reporte_id }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'No se pudo registrar el relevo.' }
  }
}

/** Recent relays, for the panel to show what has come in by radio lately. */
export async function relevosRecientes(
  client: PoolClient,
  limite = 10,
): Promise<
  {
    folio: number
    comunidad: string
    hablante: string
    operador: string
    detalle: string | null
    estado: string
    creadoEn: Date
  }[]
> {
  const { rows } = await client.query<{
    folio: number
    comunidad: string
    hablante: string
    operador: string
    detalle: string | null
    estado: string
    creado_en: Date
  }>(
    `select r.folio,
            c.nombre        as comunidad,
            rel.hablante,
            rel.operador,
            r.detalle_libre as detalle,
            r.estado,
            rel.creado_en
       from radio_relevos rel
       join reportes r on r.id = rel.reporte_id
       join comunidades c on c.id = rel.comunidad_id
      order by rel.creado_en desc
      limit $1`,
    [limite],
  )
  return rows.map((r) => ({
    folio: r.folio,
    comunidad: r.comunidad,
    hablante: r.hablante,
    operador: r.operador,
    detalle: r.detalle,
    estado: r.estado,
    creadoEn: r.creado_en,
  }))
}
