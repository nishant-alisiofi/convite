/**
 * Pulls a Copernicus EMS Rapid Mapping activation's Areas of Interest into `public/cems/`.
 *
 *   pnpm traer:cems EMSR916
 *
 * Why a build-time script and not a fetch from the browser: this map has to work from a lancha
 * with no signal (PRD-13). A layer that calls Copernicus on render is a layer that is blank
 * exactly when somebody is standing in the affected area, which is the opposite of useful. So
 * the geometry is vendored, versioned in git, and served from our own origin — same reasoning
 * as `scripts/construir-pmtiles.sh`.
 *
 * The AOIs are the *footprints* of the damage assessment — where Copernicus looked. They are not
 * the damage itself: the per-building grading lives in the products archive named by
 * `productsPath` and is a much larger, richer dataset (EMSR916 assessed 622 buildings). Drawing
 * the footprint says «somebody has assessed this area and there is a report», which is a true and
 * useful thing to say on a coordinator's map, and it is honest about being no more than that.
 *
 * Copernicus EMS data is free and open; use requires attribution, which the map renders as a
 * source credit next to OpenStreetMap's.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const BASE = 'https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations'

type Aoi = { name?: string | null }
type Activacion = {
  code: string
  name: string
  category: string
  eventTime: string
  activationTime: string
  reportLink?: string | null
  aois?: Aoi[]
}

async function traerJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`)
  return (await r.json()) as T
}

async function main() {
  const codigo = (process.argv[2] ?? 'EMSR916').toUpperCase()
  if (!/^EMSR\d{3,4}$/.test(codigo)) {
    throw new Error(`Código de activación inesperado: ${codigo}. Se espera algo como EMSR916.`)
  }

  const meta = await traerJson<{ count: number; results: Activacion[] }>(`${BASE}/?code=${codigo}`)
  const act = meta.results[0]
  if (!act) throw new Error(`Copernicus no conoce la activación ${codigo}.`)

  const aois = await traerJson<{ type: string; features: unknown[] }>(
    `${BASE}/download-aois/?code=${codigo}`,
  )
  if (aois.type !== 'FeatureCollection' || !Array.isArray(aois.features)) {
    throw new Error('La respuesta de AOIs no es una FeatureCollection.')
  }

  // The activation's own metadata travels with the geometry. A polygon on a map with no date and
  // no source is exactly the kind of unattributed shape non-negotiable 2.2 exists to prevent —
  // a coordinator has to be able to see how old the assessment is before trusting it.
  const salida = {
    codigo: act.code,
    nombre: act.name,
    categoria: act.category,
    eventoEn: act.eventTime,
    activadaEn: act.activationTime,
    informe: act.reportLink ?? null,
    traidoEn: new Date().toISOString(),
    fuente: 'Copernicus Emergency Management Service (© 2026 European Union)',
    aois,
  }

  const dir = join(process.cwd(), 'public', 'cems')
  await mkdir(dir, { recursive: true })
  const ruta = join(dir, `${codigo}.json`)
  await writeFile(ruta, `${JSON.stringify(salida, null, 1)}\n`, 'utf8')

  console.log(`${codigo} — ${act.name}`)
  console.log(`  evento:     ${act.eventTime}`)
  console.log(`  activada:   ${act.activationTime}`)
  console.log(`  AOIs:       ${aois.features.length}`)
  for (const a of act.aois ?? []) console.log(`    · ${a.name}`)
  console.log(`  escrito en: ${ruta}`)
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
