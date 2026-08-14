import 'dotenv/config'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { closeDb, getPool } from '@/db/client'
import HojaManifiesto from '@/app/(panel)/envios/[id]/manifiesto/hoja'
import { cargarManifiesto, croquisDe } from '@/lib/despacho/manifiesto'
import {
  candidatosParaEnvio,
  crearEnvio,
  despachar,
  ordenarPorRecorrido,
  ponerParada,
  registrarDecision,
} from '@/lib/despacho/plan'
import { emparejar } from '@/lib/matching/persistencia'
import { temporadaVigente } from '@/lib/temporada'

/**
 * Renders a real manifest to a standalone page so the printed sheet can be looked at.
 *
 * A manifest is paper: whether the codes are big enough to read by torchlight and whether
 * the table survives a fold are the only questions that matter, and neither is answerable
 * from a test. So this plans and dispatches a shipment against the seeded basin **inside a
 * transaction it always rolls back**, renders the same `HojaManifiesto` the panel renders,
 * and leaves the database exactly as it found it.
 *
 * `pnpm build` first (for the stylesheet), then `pnpm vista:manifiesto`.
 */

const SALIDA = '.data/vista-manifiesto'

function cssCompilado(): string {
  const dir = '.next/static/css'
  if (!existsSync(dir)) throw new Error('No hay CSS compilado. Corra `pnpm build` antes.')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(`${dir}/${f}`, 'utf8'))
    .join('\n')
}

const DESPACHADOR = '00000000-0000-4000-8000-000000000003'

async function main() {
  const client = await getPool().connect()

  try {
    // Everything below is thrown away; the point is to see the sheet, not to change the day.
    await client.query('begin')
    await emparejar(client, { temporada: await temporadaVigente(client) })

    const { rows: caps } = await client.query<{ id: string }>(
      `select id from capacidades where estado = 'OFRECIDA' order by sale_en limit 1`,
    )
    if (!caps[0]) throw new Error('No hay capacidad ofrecida en la semilla.')

    const envio = await crearEnvio(client, caps[0].id, DESPACHADOR)
    if (!envio.ok || !envio.id) throw new Error('No se pudo abrir el envío.')

    // Only what this trip can actually serve, and only as much as the boat holds. The last
    // stop is deliberately shorted so the sheet shows a rationed row and the rule that
    // justified it — the case a manifest most needs to carry honestly.
    const candidatos = await candidatosParaEnvio(
      client,
      caps[0].id,
      await temporadaVigente(client),
    )
    const { rows: cupos } = await client.query<{ cupo_familias: number }>(
      `select cupo_familias from envios where id = $1`,
      [envio.id],
    )
    let libre = cupos[0]!.cupo_familias
    for (const [i, c] of candidatos.entries()) {
      if (libre <= 0) break
      const esUltimo = i === candidatos.length - 1 || libre <= c.familias
      const familias = esUltimo ? Math.max(1, Math.min(c.familias - 5, libre)) : c.familias
      await ponerParada(client, envio.id, c.pedidoId, familias)
      libre -= familias
    }
    await ordenarPorRecorrido(client, envio.id, await temporadaVigente(client))
    await registrarDecision(
      client,
      envio.id,
      {
        regla: 'Urgencia primero, y a igual urgencia los que llevan más días esperando.',
        nota: 'Las Mercedes recibe parcial; entra completo en el viaje del jueves.',
      },
      DESPACHADOR,
    )
    const salida = await despachar(client, envio.id, DESPACHADOR)
    if (!salida.ok) throw new Error(`No se pudo despachar: ${salida.error}`)

    const manifiesto = await cargarManifiesto(client, envio.id)
    if (!manifiesto) throw new Error('No se pudo cargar el manifiesto.')

    const marcado = renderToStaticMarkup(
      <HojaManifiesto manifiesto={manifiesto} croquis={croquisDe(manifiesto)} />,
    )

    mkdirSync(SALIDA, { recursive: true })
    writeFileSync(
      `${SALIDA}/index.html`,
      `<!doctype html>
<html lang="es-CO">
<head><meta charset="utf-8" /><title>Convite · manifiesto</title>
<style>${cssCompilado()}</style></head>
<body><div class="mx-auto max-w-4xl px-6 py-8">${marcado}</div></body>
</html>
`,
    )

    console.log(`\n${SALIDA}/index.html`)
    console.log(
      `  ${manifiesto.codigo} · ${manifiesto.paradas.length} paradas · ` +
        `códigos ${manifiesto.paradas.map((p) => p.codigoConfirmacion).join(' ')} · ` +
        `decisión: ${manifiesto.decision ? 'sí' : 'no'}\n`,
    )
  } finally {
    // Always. The seeded basin is left exactly as it was.
    await client.query('rollback')
    client.release()
  }
}

main()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error)
    await closeDb()
    process.exit(1)
  })
