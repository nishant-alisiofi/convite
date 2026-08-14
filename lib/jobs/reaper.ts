import type { Pool, PoolClient } from 'pg'

/**
 * Reclaiming jobs whose worker died holding them.
 *
 * `tomarUno` only ever claims rows in 'pendiente', so a job left at 'corriendo' is not late,
 * it is gone: nothing will ever pick it up again. A worker killed mid-batch — an OOM, a
 * redeploy that did not drain — silently loses whatever it was carrying, and the only trace
 * is a stale row the health check notices days later.
 *
 * ── Why this is opt-in, one job type at a time ──────────────────────────────────────────
 *
 * Reclaiming turns the queue from at-most-once into at-least-once, and that is a promise the
 * handlers have to be able to keep. A handler that was half-finished when its worker died
 * gets run again from the top; if it is not idempotent, the second run does the damaging
 * half twice.
 *
 * So nothing is reclaimed unless its type is listed below with a reason. The default stays
 * exactly as it was — detected by the health endpoint, recovered by a human — which is worse
 * for lost work and better for lost money.
 *
 * The line is drawn at sending. A duplicated download costs a few kilobytes; a duplicated
 * message costs somebody's trust in a system that is already asking them to believe an
 * automated number will help.
 */

export type TipoIdempotente = {
  tipo: string
  /** Why re-running this from the top is safe. Written down so the list cannot grow quietly. */
  porque: string
}

export const TIPOS_IDEMPOTENTES: TipoIdempotente[] = [
  {
    tipo: 'descargar_media',
    porque:
      'la clave de almacenamiento se deriva del contenido, así que una segunda descarga ' +
      'escribe el mismo archivo; el adjunto se inserta en la misma transacción que cierra ' +
      'el job, así que un job muerto no dejó fila que duplicar. No manda nada.',
  },
]

const REINTENTABLES = new Set(TIPOS_IDEMPOTENTES.map((t) => t.tipo))

export type ResultadoRescate = {
  /** Returned to 'pendiente' to be run again. */
  rescatados: number
  /** Left alone because their type has not declared itself safe to repeat. */
  dejados: number
}

/**
 * Returns stale claims of declared-idempotent types to the queue.
 *
 * Runs from the worker loop rather than as a job: a queue cannot recover itself, because the
 * job that would do the recovering waits behind the same stall.
 *
 * The attempt is NOT rolled back — a job that hangs its worker every time would otherwise be
 * reclaimed forever. It keeps its attempt count and eventually exhausts its retries like any
 * other failure, which is the honest outcome for work that cannot complete.
 */
export async function rescatarJobsColgados(
  ejecutor: Pool | PoolClient,
  minutosColgado: number,
  ahora: Date = new Date(),
): Promise<ResultadoRescate> {
  const tipos = [...REINTENTABLES]

  const { rows } = await ejecutor.query<{ rescatados: string }>(
    `with viejos as (
       select id, tipo
         from jobs
        where estado = 'corriendo'
          and tomado_en < $1::timestamptz - make_interval(mins => $2)
     ),
     devueltos as (
       update jobs
          set estado = 'pendiente',
              correr_en = $1,
              ultimo_error = coalesce(ultimo_error || ' | ', '') ||
                             'reclamado: el worker murió sosteniéndolo'
        where id in (select id from viejos where tipo = any($3::text[]))
        returning 1
     )
     select count(*) as rescatados from devueltos`,
    [ahora, minutosColgado, tipos],
  )

  const { rows: restantes } = await ejecutor.query<{ dejados: string }>(
    `select count(*) as dejados
       from jobs
      where estado = 'corriendo'
        and tomado_en < $1::timestamptz - make_interval(mins => $2)
        and not (tipo = any($3::text[]))`,
    [ahora, minutosColgado, tipos],
  )

  return {
    rescatados: Number(rows[0]!.rescatados),
    dejados: Number(restantes[0]!.dejados),
  }
}
