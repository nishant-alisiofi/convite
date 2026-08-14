import type { Pool, PoolClient } from 'pg'
import { esperaPara, type Job, type ManejadorJob } from './tipos'

/**
 * Claiming, running and retiring jobs.
 *
 * `for update skip locked` means two workers can run concurrently without ever handing the
 * same job to both — which matters because the cron route and a developer running the CLI
 * are exactly that situation.
 */

export async function encolar(
  ejecutor: Pool | PoolClient,
  tipo: string,
  payload: Record<string, unknown> = {},
  correrEn?: Date,
): Promise<string> {
  const { rows } = await ejecutor.query<{ id: string }>(
    `insert into jobs (tipo, payload, correr_en)
       values ($1, $2, coalesce($3, now()))
     returning id`,
    [tipo, JSON.stringify(payload), correrEn ?? null],
  )
  return rows[0]!.id
}

/**
 * Enqueues a full matcher sweep unless one is already waiting. Section 8 lists five very
 * different triggers — a new pedido, a stock count, a route being deactivated, a boat
 * offered or cancelled, a damage report verified. During a busy afternoon they all fire,
 * and there is no point queueing forty identical sweeps.
 */
export async function encolarEmparejamiento(
  ejecutor: Pool | PoolClient,
  motivo: string,
): Promise<string | null> {
  const { rows } = await ejecutor.query<{ id: string }>(
    `insert into jobs (tipo, payload)
     select 'emparejar_todo', $1::jsonb
      where not exists (
        select 1 from jobs where tipo = 'emparejar_todo' and estado = 'pendiente'
      )
     returning id`,
    [JSON.stringify({ motivo })],
  )
  return rows[0]?.id ?? null
}

async function tomarUno(client: PoolClient): Promise<Job | null> {
  const { rows } = await client.query<{
    id: string
    tipo: string
    payload: Record<string, unknown>
    intentos: number
    max_intentos: number
  }>(
    `update jobs set estado = 'corriendo', tomado_en = now(), intentos = intentos + 1
      where id = (
        select id from jobs
         where estado = 'pendiente' and correr_en <= now()
         order by correr_en
         limit 1
         for update skip locked
      )
     returning id, tipo, payload, intentos, max_intentos`,
  )
  const fila = rows[0]
  if (!fila) return null
  return {
    id: fila.id,
    tipo: fila.tipo,
    payload: fila.payload ?? {},
    intentos: fila.intentos,
    maxIntentos: fila.max_intentos,
  }
}

export type ResultadoCorrida = {
  corridos: number
  fallidos: number
  errores: { tipo: string; error: string }[]
}

/**
 * Runs up to `maximo` pending jobs. Each job gets its own connection and its own
 * transaction, so a handler that throws rolls back its own writes and nothing else.
 */
export async function correrJobs(
  pool: Pool,
  manejadores: Record<string, ManejadorJob>,
  maximo = 25,
): Promise<ResultadoCorrida> {
  const resultado: ResultadoCorrida = { corridos: 0, fallidos: 0, errores: [] }

  for (let i = 0; i < maximo; i++) {
    const client = await pool.connect()
    let job: Job | null = null
    try {
      job = await tomarUno(client)
      if (!job) break

      const manejador = manejadores[job.tipo]
      if (!manejador) throw new Error(`No hay manejador para el job '${job.tipo}'.`)

      await client.query('begin')
      await manejador(job, client)
      await client.query(`update jobs set estado = 'hecho', ultimo_error = null where id = $1`, [
        job.id,
      ])
      await client.query('commit')
      resultado.corridos += 1
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error)
      try {
        await client.query('rollback')
      } catch {
        // The connection may already be unusable; the retry below runs on a fresh one.
      }
      if (job) {
        const agotado = job.intentos >= job.maxIntentos
        await client.query(
          agotado
            ? `update jobs set estado = 'fallido', ultimo_error = $2 where id = $1`
            : `update jobs
                  set estado = 'pendiente',
                      ultimo_error = $2,
                      correr_en = now() + make_interval(mins => $3)
                where id = $1`,
          agotado ? [job.id, mensaje] : [job.id, mensaje, esperaPara(job.intentos)],
        )
        resultado.fallidos += 1
        resultado.errores.push({ tipo: job.tipo, error: mensaje })
      }
    } finally {
      client.release()
    }
  }

  return resultado
}
