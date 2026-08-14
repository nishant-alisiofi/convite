import type { Pool, PoolClient } from 'pg'

/**
 * Link quality, measured rather than declared (2.14).
 *
 * `comunidades.tier_conectividad` is a starting guess about a place. This is about a person:
 * what actually happened to the messages we sent them, and when they are actually reachable.
 * The two disagree often — a tier-2 community contains someone whose phone is off six days a
 * week, and a tier-4 one contains the person who walks to the ridge every morning.
 *
 * Recomputed from `mensajes` rather than kept as a running average, because the source rows
 * are already there and a derived number nobody can re-derive is a number nobody can trust.
 * Cheap at basin scale: one contact, one bounded window.
 */

/** How many recent outbound messages the score looks at. */
export const VENTANA_MEDICION = 20

/**
 * How long a message may sit at `enviado` before we count it as never arrived.
 *
 * This is the whole acceptance case: a contact whose messages never reach `entregado` has to
 * stop being offered voice notes. Waiting for a `fallido` that never comes would leave them
 * on WhatsApp forever, because "no news" from a provider is not good news.
 */
export const HORAS_PARA_DAR_POR_PERDIDO = 24

export type MedicionEnlace = {
  calidadEnlace: number | null
  medidas: number
}

/**
 * Recomputes `calidad_enlace` for one contact and writes it back.
 *
 * Delivered or read counts as reaching them. Failed counts as not. Still `enviado` after a
 * day counts as not — see above. Anything younger than that is not yet evidence either way
 * and is left out of the denominator, so a message sent five minutes ago cannot drag
 * somebody's score down.
 *
 * NULL when there is nothing to measure, which is not the same as bad (0010's comment) and
 * is why the policy treats null and zero differently.
 */
export async function recalcularEnlace(
  ejecutor: Pool | PoolClient,
  contactoId: string,
  ahora: Date = new Date(),
): Promise<MedicionEnlace> {
  const { rows } = await ejecutor.query<{ exitosas: string; perdidas: string }>(
    `with recientes as (
       select estado, creado_en
         from mensajes
        where contacto_id = $1 and direccion = 'saliente'
        order by creado_en desc
        limit ${VENTANA_MEDICION}
     )
     select
       count(*) filter (where estado in ('entregado', 'leido')) as exitosas,
       count(*) filter (
         where estado = 'fallido'
            or (estado = 'enviado' and creado_en < $2::timestamptz - make_interval(hours => $3))
       ) as perdidas
       from recientes`,
    [contactoId, ahora, HORAS_PARA_DAR_POR_PERDIDO],
  )

  const exitosas = Number(rows[0]?.exitosas ?? 0)
  const perdidas = Number(rows[0]?.perdidas ?? 0)
  const medidas = exitosas + perdidas
  const calidad = medidas === 0 ? null : Number((exitosas / medidas).toFixed(2))

  await ejecutor.query(
    // Cast explicitly: the parameter is NULL whenever there is nothing to measure, and
    // Postgres cannot infer a type for a bare NULL used only in an assignment and a test.
    `update contactos
        set calidad_enlace = $2::numeric,
            ultima_medicion = case when $2::numeric is null then ultima_medicion else $3::timestamptz end
      where id = $1`,
    [contactoId, calidad, ahora],
  )

  return { calidadEnlace: calidad, medidas }
}

/**
 * Notes that this person was reachable at this hour.
 *
 * `ventana_actividad` is an hour-of-day histogram, and it usually tracks when there is power
 * rather than when someone is awake — which is what makes it worth having: sending at 03:00
 * to a place whose generator runs 18:00–21:00 is a message nobody will ever see.
 *
 * Bogotá time, because the question is what hour it was where they are.
 */
export async function anotarActividad(
  ejecutor: Pool | PoolClient,
  contactoId: string,
  cuando: Date,
): Promise<void> {
  const hora = new Date(cuando.getTime() - 5 * 3_600_000).getUTCHours()
  await ejecutor.query(
    `update contactos
        set ventana_actividad = jsonb_set(
              coalesce(ventana_actividad, '{}'::jsonb),
              array[$2::text],
              to_jsonb(coalesce((ventana_actividad ->> $2)::int, 0) + 1)
            ),
            ultima_medicion = greatest(coalesce(ultima_medicion, $3::timestamptz), $3::timestamptz)
      where id = $1`,
    [contactoId, String(hora), cuando],
  )
}

/**
 * Records whether a media upload from this person ever completed.
 *
 * 0010 calls this the single strongest predictor of whether to invite a voice note, and it
 * is the one measurement that cannot be inferred from delivery receipts: those describe our
 * messages going out, this describes their file coming in. Once true it stays true — one
 * successful upload proves the path exists, and a later failure is a bad afternoon rather
 * than a retraction.
 */
export async function anotarMedia(
  ejecutor: Pool | PoolClient,
  contactoId: string,
  exitosa: boolean,
): Promise<void> {
  await ejecutor.query(
    `update contactos
        set media_exitosa = case when media_exitosa then true else $2 end
      where id = $1`,
    [contactoId, exitosa],
  )
}
