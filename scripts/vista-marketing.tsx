import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import Acerca from '@/app/acerca/vista'
import VistaPublica from '@/app/vista-publica'
import type { FilaPublica } from '@/lib/publico'

/**
 * Throwaway render harness for the two public marketing surfaces (landing + response), so they
 * can be screenshotted without standing up Postgres. Run `pnpm build:limpio` first to compile
 * the Tailwind, then this lifts it into a full HTML doc. Not part of the app or the test suite.
 */
const SALIDA = '.data/design-review/html'

function css(): string {
  const dir = '.next/static/css'
  if (!existsSync(dir)) throw new Error('run `pnpm build:limpio` first')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(`${dir}/${f}`, 'utf8'))
    .join('\n')
}

function page(body: string): string {
  return `<!doctype html><html lang="es-CO"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Convite</title><style>${css()}</style></head><body>${body}</body></html>`
}

// Mock rows shaped like `mapa_publico` after the k-anon fold: real municipality names plus the
// basin-wide bucket for single-village municipalities.
const FILAS: FilaPublica[] = [
  { municipio: 'Quibdó', familiaLabel: 'Mercado y alimentos', pendientes: 3, atendidos: 2 },
  { municipio: 'Quibdó', familiaLabel: 'Agua potable', pendientes: 2, atendidos: 0 },
  { municipio: 'Quibdó', familiaLabel: 'Salud y medicamentos', pendientes: 1, atendidos: 1 },
  { municipio: 'Medio Atrato', familiaLabel: 'Plásticos y tejas', pendientes: 2, atendidos: 0 },
  { municipio: 'Medio Atrato', familiaLabel: 'Mercado y alimentos', pendientes: 1, atendidos: 3 },
  { municipio: 'Otras zonas de la cuenca', familiaLabel: 'Agua potable', pendientes: 4, atendidos: 1 },
  { municipio: 'Otras zonas de la cuenca', familiaLabel: 'Albergue y abrigo', pendientes: 1, atendidos: 0 },
]

mkdirSync(SALIDA, { recursive: true })
writeFileSync(`${SALIDA}/acerca.html`, page(renderToStaticMarkup(<Acerca />)))
writeFileSync(`${SALIDA}/publica.html`, page(renderToStaticMarkup(<VistaPublica filas={FILAS} />)))
console.log(`${SALIDA}/{acerca,publica}.html`)
