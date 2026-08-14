import 'dotenv/config'
import { closeDb, getPool } from '@/db/client'
import { MANEJADORES_CANALES } from '@/lib/canales/trabajos'
import { correrJobs, type ResultadoCorrida } from '@/lib/jobs/cola'
import { rescatarJobsColgados } from '@/lib/jobs/reaper'
import { MANEJADORES } from '@/lib/jobs/manejadores'

/**
 * The worker process.
 *
 * PRD §6: «the matcher must react when a boat is offered, not once a day». A cron that fires
 * hourly is a boat that leaves without the cargo, because the person offering it is standing
 * on the dock now. So this runs continuously and picks work up within seconds.
 *
 * The route at /api/jobs/correr stays exactly as it was — it is what the tests drive, and it
 * is the fallback if the worker service is down. Both share the same handlers and the same
 * `for update skip locked` claim, so running both at once is safe rather than merely
 * tolerated: two workers never get the same job.
 *
 * Deployed as a second Railway service off the same image (see docs/despliegue.md). It is
 * the process the health endpoint's stall detection exists to catch when it dies.
 */

/** Nothing to do: wait this long before asking again. */
const ESPERA_VACIO_MS = 3_000
/** After a batch, come straight back — a busy queue should drain, not sleep between items. */
const ESPERA_TRABAJO_MS = 250
/** Backs off to here when the database is unreachable, so a dead DB is not a hot loop. */
const ESPERA_ERROR_MS = 15_000
/** A claim older than this belonged to a worker that is not coming back. */
const MINUTOS_COLGADO = 15

let corriendo = true
let cicloActual: Promise<ResultadoCorrida | void> = Promise.resolve()

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function registrar(mensaje: string): void {
  console.log(`[worker] ${new Date().toISOString()} ${mensaje}`)
}

/**
 * Graceful shutdown.
 *
 * Railway sends SIGTERM and waits before pulling the floor out. Finishing the batch in
 * flight matters more here than anywhere else in the codebase: a job killed mid-flight stays
 * at 'corriendo' forever, because `tomarUno` only ever claims 'pendiente'. Nothing reclaims
 * it, so the work is not delayed — it is gone. Draining is what keeps a routine redeploy
 * from quietly dropping somebody's voice note.
 */
async function apagar(senal: string): Promise<void> {
  if (!corriendo) return
  corriendo = false
  registrar(`${senal}: terminando el lote en curso antes de salir`)
  try {
    await cicloActual
    await closeDb()
    registrar('salida limpia')
    process.exit(0)
  } catch (error) {
    console.error('[worker] error al apagar', error)
    process.exit(1)
  }
}

process.on('SIGTERM', () => void apagar('SIGTERM'))
process.on('SIGINT', () => void apagar('SIGINT'))

async function main(): Promise<void> {
  const manejadores = { ...MANEJADORES, ...MANEJADORES_CANALES }
  registrar(`arriba, ${Object.keys(manejadores).length} tipos de job registrados`)

  while (corriendo) {
    let espera = ESPERA_VACIO_MS
    try {
      // Held so the shutdown handler can await the batch in flight, and awaited directly so
      // the result keeps its type.
      // Before claiming anything new, take back what a dead worker was holding. Runs here
      // rather than as a job because a queue cannot recover itself — the job that would do
      // the recovering waits behind the same stall.
      const rescate = await rescatarJobsColgados(getPool(), MINUTOS_COLGADO)
      if (rescate.rescatados > 0) {
        registrar(`${rescate.rescatados} job(s) reclamados de un worker muerto`)
      }
      if (rescate.dejados > 0) {
        registrar(
          `${rescate.dejados} job(s) colgados NO se reclaman: su tipo no se declaró idempotente`,
        )
      }

      const ciclo = correrJobs(getPool(), manejadores)
      cicloActual = ciclo
      const resultado = await ciclo

      if (resultado.corridos > 0 || resultado.fallidos > 0) {
        registrar(`${resultado.corridos} hecho(s), ${resultado.fallidos} fallido(s)`)
        for (const error of resultado.errores) {
          console.error(`[worker] ${error.tipo}: ${error.error}`)
        }
        espera = ESPERA_TRABAJO_MS
      }
    } catch (error) {
      // Almost always the database being unreachable. Keep breathing and retry: the
      // alternative is a crash loop that Railway restarts faster than Postgres recovers.
      console.error('[worker] ciclo fallido', error)
      espera = ESPERA_ERROR_MS
    }

    if (corriendo) await dormir(espera)
  }
}

main().catch(async (error) => {
  console.error('[worker] error fatal', error)
  await closeDb()
  process.exit(1)
})
