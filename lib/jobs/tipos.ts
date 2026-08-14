import type { PoolClient } from 'pg'

/**
 * The job queue is a table plus a worker invoked by cron (Section 3). No Redis, no BullMQ
 * in v1 — the basin has hundreds of requests, not millions, and one fewer moving part is
 * worth more here than throughput nobody needs.
 */

export type Job = {
  id: string
  tipo: string
  payload: Record<string, unknown>
  intentos: number
  maxIntentos: number
}

export type ManejadorJob = (job: Job, client: PoolClient) => Promise<void>

/** Backoff between retries, in minutes, indexed by attempt number. */
export const ESPERA_REINTENTO_MIN = [1, 5, 15, 60, 240]

export function esperaPara(intentos: number): number {
  return ESPERA_REINTENTO_MIN[Math.min(intentos, ESPERA_REINTENTO_MIN.length - 1)]!
}
