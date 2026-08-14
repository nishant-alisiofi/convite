import 'dotenv/config'
import { closeDb, getPool } from '@/db/client'
import { temporadaActual } from '@/lib/jobs/manejadores'
import { emparejar } from '@/lib/matching/persistencia'

/**
 * Runs one matcher sweep and prints the board. `pnpm emparejar` — for development and for
 * showing somebody what the five buckets actually look like.
 */
async function main() {
  const pool = getPool()
  const client = await pool.connect()
  const temporada = temporadaActual()

  try {
    await client.query('begin')
    const resumen = await emparejar(client, { temporada })
    await client.query('commit')
    console.log(
      `\nTemporada: ${temporada} · ${resumen.evaluados} pedidos evaluados · ` +
        `${resumen.cambiados} cambiaron\n`,
    )
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }

  const { rows } = await pool.query<{ estado: string; motivo: string; comunidad: string }>(
    `select p.estado, coalesce(p.motivo, '') as motivo, c.nombre as comunidad
       from pedidos p join comunidades c on c.id = p.comunidad_id
      order by array_position(
        array['LISTO','SIN_CAPACIDAD','SIN_EXISTENCIA','SIN_RUTA','ABIERTO','EN_CAMINO','ENTREGADO','CANCELADO'],
        p.estado), c.nombre`,
  )

  let estadoActual = ''
  for (const fila of rows) {
    if (fila.estado !== estadoActual) {
      estadoActual = fila.estado
      console.log(`\n${estadoActual}`)
    }
    console.log(`  · ${fila.motivo}`)
  }
  console.log()
}

main()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error)
    await closeDb()
    process.exit(1)
  })
