import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The privacy rules that live in the shape of the codebase rather than in a policy document.
 *
 * PRD §6 states the one that cannot be enforced anywhere else: **no analytics on
 * authenticated routes.** A URL like `/reportes/472` handed to an analytics vendor leaks an
 * identifier for a household that reported a need, and RLS cannot stop it — RLS governs what
 * the database returns, not what the browser sends to a third party afterwards.
 *
 * So it is asserted structurally, before there is anything to remove. The cheapest moment to
 * refuse a tracking snippet is the one where nobody has added it yet, and «we'll keep it off
 * the private pages» is a rule that survives exactly until someone drops a script tag in the
 * root layout at eleven at night.
 *
 * The privacy POLICY itself is not code and is not here. PRD §6 flags it for a lawyer under
 * Ley 1581 de 2012, and notes the draft reviewed on 13 August says inventories and needs are
 * public — the opposite of 2.4 — so it cannot be used as written.
 */

function archivosDe(...directorios: string[]): string[] {
  const encontrados: string[] = []
  const recorrer = (dir: string) => {
    for (const entrada of readdirSync(dir)) {
      const ruta = join(dir, entrada)
      if (statSync(ruta).isDirectory()) recorrer(ruta)
      else if (/\.(ts|tsx|js|jsx|css)$/.test(ruta)) encontrados.push(ruta)
    }
  }
  for (const dir of directorios) recorrer(dir)
  return encontrados
}

/**
 * Vendors, not words. `segment` on its own matches the SMS code, and a test that cries wolf
 * over a variable name gets deleted by the third person who trips on it.
 */
const RASTREADORES = [
  /posthog/i,
  /\bgtag\s*\(/,
  /google-analytics\.com/i,
  /googletagmanager/i,
  /plausible\.io/i,
  /mixpanel/i,
  /@vercel\/analytics/i,
  /@segment\//i,
  /analytics\.segment\.com/i,
  /hotjar/i,
  /fullstory/i,
  /clarity\.ms/i,
  /amplitude/i,
  /datadoghq|dd-trace/i,
  /sentry/i,
]

describe('2.4 y PRD §6 — nada de analítica en rutas autenticadas', () => {
  it('no hay ningún rastreador en `app/`', () => {
    // Every route under app/ either serves a signed-in coordinator or is the webhook surface.
    // There is no page here where a third-party script is acceptable.
    const culpables: string[] = []

    for (const ruta of archivosDe('app')) {
      const contenido = readFileSync(ruta, 'utf8')
      for (const rastreador of RASTREADORES) {
        if (rastreador.test(contenido)) culpables.push(`${ruta} → ${rastreador}`)
      }
    }

    expect(culpables).toEqual([])
  })

  it('tampoco en `lib/`', () => {
    const culpables: string[] = []
    for (const ruta of archivosDe('lib')) {
      const contenido = readFileSync(ruta, 'utf8')
      for (const rastreador of RASTREADORES) {
        if (rastreador.test(contenido)) culpables.push(`${ruta} → ${rastreador}`)
      }
    }
    expect(culpables).toEqual([])
  })

  it('ninguna dependencia de analítica entró por la puerta de atrás', () => {
    // A tracker usually arrives as a dependency someone added for a dashboard, long before
    // anyone writes the script tag.
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const paquetes = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })

    const sospechosos = paquetes.filter((p) =>
      /posthog|mixpanel|amplitude|segment|hotjar|fullstory|@vercel\/analytics|google-analytics|datadog|@sentry/i.test(
        p,
      ),
    )
    expect(sospechosos).toEqual([])
  })

  it('no hay scripts de terceros en los layouts', () => {
    // The root layout is the one file where a snippet reaches every authenticated page at
    // once, which is exactly why it is the file someone adds it to.
    for (const ruta of archivosDe('app').filter((r) => r.endsWith('layout.tsx'))) {
      const contenido = readFileSync(ruta, 'utf8')
      expect(contenido, ruta).not.toMatch(/<script\b/i)
      expect(contenido, ruta).not.toMatch(/https?:\/\/(?!fonts\.googleapis|fonts\.gstatic)/i)
    }
  })
})

describe('la ruta de salud no dice nada que no deba', () => {
  it('no consulta ninguna columna identificable', () => {
    // It is the one route that answers without a session, so 2.4 applies to it hardest.
    // Counts are safe to publish; a phone number, a name or a coordinate is not.
    const salud = readFileSync('lib/observabilidad/salud.ts', 'utf8')

    for (const columna of [
      'telefono',
      'nombre',
      'ubicacion',
      'lat',
      'lon',
      'folio',
      'detalle_libre',
      'correo',
      'direccion',
    ]) {
      expect(salud, `salud.ts menciona ${columna}`).not.toMatch(
        new RegExp(`select[^;]*\\b${columna}\\b`, 'is'),
      )
    }
  })
})
