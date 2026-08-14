import type { Pool, PoolClient } from 'pg'

/**
 * Silence is a signal, not an absence of need (Section 9.8).
 *
 * A community that stops reporting has either stopped needing anything or stopped being able
 * to tell us — and those look identical from here. The whole point of measuring it is that
 * the second case is invisible by construction: nothing errors, no queue backs up, the
 * dashboard is calm. Somebody just goes quiet.
 *
 * Tier-aware, because the interval is a property of the place. `intervalo_chequeo_dias` is
 * shorter where the signal is worse — the seed sets tier 3–4 communities to ten days or
 * less — precisely so that the communities most likely to go dark are the ones we notice
 * fastest.
 *
 * Derived, never stored. Same reason as the link telemetry and the spend caps: an alert
 * table has to be cleaned up, and a stale row saying somebody is silent when they wrote this
 * morning is worse than no alert at all.
 */

/** Three verified damage reports in one place inside this window is an event, not three rows. */
export const HORAS_AGRUPACION_DANOS = 48
export const MINIMO_DANOS_AGRUPADOS = 3

export type ComunidadEnSilencio = {
  comunidadId: string
  codigo: string
  nombre: string
  tier: number
  intervaloDias: number
  /** Days since anything at all arrived from this community. */
  diasEnSilencio: number
  /** The channel that last worked, which is where a check-in should go (2.14). */
  ultimoCanal: string | null
}

/**
 * Communities past their own check-in interval.
 *
 * "Anything at all" means any inbound message or any report — someone confirming a delivery
 * counts as being alive just as much as someone asking for food. Counting only reports would
 * flag a community that talks to us every day.
 *
 * A community we have NEVER heard from is deliberately NOT in this list. It is a different
 * fact and a different action: silence means contact existed and stopped, which is a phone
 * call to someone we have a number for. Never-contacted is onboarding, and on day one it is
 * every community in the basin — alerting on it would make the health check red from the
 * moment it is switched on, which is how a check becomes something everyone ignores. It is
 * counted separately by `comunidadesNuncaVistas` so the number is still visible.
 */
export async function comunidadesEnSilencio(
  ejecutor: Pool | PoolClient,
  ahora: Date = new Date(),
): Promise<ComunidadEnSilencio[]> {
  const { rows } = await ejecutor.query<{
    comunidad_id: string
    codigo: string
    nombre: string
    tier: number
    intervalo: number
    dias: string | null
    ultimo_canal: string | null
  }>(
    `with ultima_senal as (
       select c.id as comunidad_id,
              max(x.cuando) as cuando,
              (array_agg(x.canal order by x.cuando desc))[1] as canal
         from comunidades c
         left join (
           select co.comunidad_id, m.creado_en as cuando, m.canal
             from mensajes m
             join contactos co on co.id = m.contacto_id
            where m.direccion = 'entrante'
           union all
           select r.comunidad_id, r.creado_en as cuando, r.canal
             from reportes r
            where r.comunidad_id is not null
         ) x on x.comunidad_id = c.id
        group by c.id
     )
     select c.id as comunidad_id, c.codigo, c.nombre, c.tier_conectividad as tier,
            c.intervalo_chequeo_dias as intervalo,
            extract(epoch from ($1::timestamptz - u.cuando)) / 86400 as dias,
            u.canal as ultimo_canal
       from comunidades c
       join ultima_senal u on u.comunidad_id = c.id
      where c.activa
        and u.cuando is not null
        and u.cuando < $1::timestamptz - make_interval(days => c.intervalo_chequeo_dias)
      order by dias desc`,
    [ahora],
  )

  return rows.map((r) => ({
    comunidadId: r.comunidad_id,
    codigo: r.codigo,
    nombre: r.nombre,
    tier: r.tier,
    intervaloDias: r.intervalo,
    diasEnSilencio: Number(Number(r.dias).toFixed(1)),
    ultimoCanal: r.ultimo_canal,
  }))
}

/**
 * Communities we have never heard a word from.
 *
 * Not an alarm — a to-do list. On day one it is the whole basin, and it shrinks as the
 * printed cards get handed out. Worth a number on a screen and worth nobody being paged for.
 */
export async function comunidadesNuncaVistas(
  ejecutor: Pool | PoolClient,
  ahora: Date = new Date(),
): Promise<number> {
  const { rows } = await ejecutor.query<{ n: string }>(
    `select count(*) as n
       from comunidades c
      where c.activa
        and not exists (
          select 1 from mensajes m
            join contactos co on co.id = m.contacto_id
           where co.comunidad_id = c.id and m.direccion = 'entrante'
        )
        and not exists (select 1 from reportes r where r.comunidad_id = c.id)`,
  )
  return Number(rows[0]!.n)
}

export type AgrupacionDanos = {
  municipio: string
  agrupador: string | null
  danos: number
  /** The worst severity in the cluster, where anybody bothered to record one. */
  severidadMaxima: number | null
  comunidades: string[]
}

/**
 * Three or more verified damage reports in one sub-municipal grouping within 48 hours.
 *
 * Section 9 calls this early warning, and the framing matters: three landslides along the
 * same stretch of river in two days is ONE event — a storm, a rise, a slide that took several
 * things at once — and reading it as three separate tickets is how a response arrives late
 * and in the wrong shape.
 *
 * Verified only (2.1). An unverified cluster is three people worried, which is worth a phone
 * call and not an alert that reroutes boats.
 *
 * Grouped by `agrupador`, which is why the column still exists on `comunidades` even though
 * PRD D6 took it out of the public view: internally it is exactly the right granularity for
 * "the same stretch of river", and externally it was close enough to naming the community.
 */
export async function agrupacionesDeDanos(
  ejecutor: Pool | PoolClient,
  ahora: Date = new Date(),
): Promise<AgrupacionDanos[]> {
  const { rows } = await ejecutor.query<{
    municipio: string
    agrupador: string | null
    danos: string
    severidad_maxima: number | null
    comunidades: string[]
  }>(
    `select c.municipio,
            c.agrupador,
            count(*) as danos,
            max(r.severidad) as severidad_maxima,
            array_agg(distinct c.nombre) as comunidades
       from reportes r
       join comunidades c on c.id = r.comunidad_id
      where r.tipo = 'dano'
        and r.estado = 'VERIFICADO'
        and r.creado_en >= $1::timestamptz - make_interval(hours => $2)
      group by c.municipio, c.agrupador
     having count(*) >= $3
      order by count(*) desc`,
    [ahora, HORAS_AGRUPACION_DANOS, MINIMO_DANOS_AGRUPADOS],
  )

  return rows.map((r) => ({
    municipio: r.municipio,
    agrupador: r.agrupador,
    danos: Number(r.danos),
    severidadMaxima: r.severidad_maxima,
    comunidades: r.comunidades,
  }))
}
