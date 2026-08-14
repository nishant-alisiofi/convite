import 'dotenv/config'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { closeDb, getPool } from '@/db/client'
import { cargarBandeja, itemsDelCatalogo } from '@/lib/verificacion/bandeja'
import Tarjeta from '@/app/(panel)/verificacion/tarjeta'

/**
 * Renders the verification inbox to a standalone page so somebody can look at it.
 *
 * `/verificacion` sits behind a Supabase session and a local clone has no Supabase project,
 * so without this nothing about this screen is ever seen — which is how a map ships with its
 * accuracy circles hidden behind the labels. It renders the real `Tarjeta` component with
 * real rows from `cargarBandeja`, so what appears here is the component the panel renders.
 *
 * The stylesheet is the one Next compiled, lifted out of `.next/static/css`, so Tailwind
 * classes resolve exactly as they do in the app. Run `pnpm build` first.
 *
 * `pnpm vista:bandeja`, then serve the folder over http and open it.
 */

const SALIDA = '.data/vista-bandeja'

function cssCompilado(): string {
  const dir = '.next/static/css'
  if (!existsSync(dir)) {
    throw new Error('No hay CSS compilado. Corra `pnpm build` antes que esto.')
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(`${dir}/${f}`, 'utf8'))
    .join('\n')
}

async function main() {
  const client = await getPool().connect()
  let bandeja
  let catalogo
  try {
    bandeja = await cargarBandeja(client)
    catalogo = await itemsDelCatalogo(client)
  } finally {
    client.release()
  }

  // A string rather than a server action: nothing on this page is meant to submit.
  const marcado = renderToStaticMarkup(
    <ul className="mt-6 space-y-4">
      {bandeja.pendientes.map((r) => (
        <Tarjeta
          key={r.id}
          reporte={r}
          puedeVerificar
          accion="#"
          filtro="todo"
          catalogo={catalogo}
          abriendoDuplicado={false}
          candidatos={[]}
        />
      ))}
    </ul>,
  )

  mkdirSync(SALIDA, { recursive: true })
  writeFileSync(
    `${SALIDA}/index.html`,
    `<!doctype html>
<html lang="es-CO">
<head>
<meta charset="utf-8" />
<title>Convite · bandeja de verificación</title>
<style>${cssCompilado()}</style>
</head>
<body>
  <div class="mx-auto max-w-6xl px-6 py-8">
    <div class="flex flex-wrap items-baseline justify-between gap-3">
      <h1 class="text-xl font-semibold text-stone-900">Verificación</h1>
      <p class="text-sm text-stone-600">${bandeja.pendientes.length} esperando revisión</p>
    </div>
    <p class="mt-2 max-w-3xl text-sm text-stone-700">
      Todo lo que entra queda registrado apenas llega, sin que nadie lo apruebe. Nada se
      convierte en pedido hasta que una persona lo lee, lo cree y lo firma.
    </p>
    ${marcado}
  </div>
</body>
</html>
`,
  )

  const conAudio = bandeja.pendientes.filter((r) =>
    r.adjuntos.some((a) => a.tipo === 'audio'),
  ).length
  console.log(`\n${SALIDA}/index.html`)
  console.log(
    `  ${bandeja.pendientes.length} en cola · ${conAudio} con nota de voz · ` +
      `${bandeja.derivaciones.length} derivaciones · ` +
      `${bandeja.pendientes.filter((r) => r.motivos.length > 0).length} con razonamiento\n`,
  )
}

main()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error)
    await closeDb()
    process.exit(1)
  })
