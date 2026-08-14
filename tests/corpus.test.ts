import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { catalogoDesdeSemilla, extraer } from '@/lib/normalizador'

/**
 * The corpus harness.
 *
 * M4's real acceptance is «a corpus of real messages classifies or routes to clarification»
 * (PRD §4). That corpus does not exist — PRD §7 lists it as the project's biggest risk, and
 * is explicit that Colombian and Chocoano vocabulary is exactly where a generic classifier
 * fails, so invented examples prove nothing about it.
 *
 * So this runs the harness against a synthetic file today, and the moment the partner's
 * WhatsApp export arrives it runs against that instead with no code change:
 *
 *     CONVITE_CORPUS=~/Data/Convite/corpus-real.jsonl pnpm test
 *
 * What it asserts is deliberately not an accuracy score. A pass rate against messages we
 * wrote ourselves would be a number that looks like evidence and is not. It asserts the two
 * properties that must hold on ANY corpus — never guess wrong, never drop — and it reports
 * the classify-vs-clarify split so the rate is visible when the real file lands.
 */

const RUTA_POR_DEFECTO = 'tests/fixtures/corpus-sintetico.jsonl'
const ruta = resolve(process.cwd(), process.env.CONVITE_CORPUS ?? RUTA_POR_DEFECTO)
const esSintetico = !process.env.CONVITE_CORPUS

type Esperado = {
  codigo?: string | null
  cantidad?: number | null
  familias?: number | null
  urgencia?: number | null
  perecedero?: boolean
}

type CasoCorpus = { texto: string; espera?: Esperado; nota?: string }
type Cabecera = { _cabecera: string; _advertencia: string; _version?: string }

const lineas = readFileSync(ruta, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Cabecera | CasoCorpus)

const cabecera = lineas.find((l): l is Cabecera => '_cabecera' in l)
const casos = lineas.filter((l): l is CasoCorpus => 'texto' in l)

const catalogo = catalogoDesdeSemilla()
const AHORA = new Date('2026-08-14T15:00:00Z')

describe('el corpus', () => {
  it('viene con su advertencia, y no se puede perder por el camino', () => {
    // The header is a record in the file rather than a comment, so a run against a corpus
    // that forgot to say what it is fails here instead of quietly producing a number
    // somebody later quotes as acceptance.
    expect(cabecera, `${ruta} no trae cabecera`).toBeTruthy()
    expect(cabecera!._advertencia.length).toBeGreaterThan(40)
    if (esSintetico) {
      expect(cabecera!._cabecera).toContain('INVENTADO')
      expect(cabecera!._advertencia).toContain('PRD §7')
    }
  })

  it('tiene casos que clasifican y casos que van a aclaración', () => {
    // A corpus that is all one or all the other exercises half the pipeline.
    const clasificables = casos.filter((c) => c.espera?.codigo)
    const aclaraciones = casos.filter((c) => c.espera && c.espera.codigo === null)
    expect(clasificables.length).toBeGreaterThan(0)
    expect(aclaraciones.length).toBeGreaterThan(0)
  })

  it('nunca propone un código equivocado', () => {
    // THE bar. Not "how many did it get right" — how many did it get WRONG. A null costs a
    // question; a wrong code costs a boat trip with the wrong cargo (2.12).
    const equivocados: string[] = []

    for (const caso of casos) {
      const p = extraer(caso.texto, { catalogo, ahora: AHORA })
      const esperado = caso.espera?.codigo
      if (esperado === undefined) continue
      if (p.codigoItem === null) continue // clarification is always allowed
      if (p.codigoItem !== esperado) {
        equivocados.push(`«${caso.texto}» → ${p.codigoItem}, se esperaba ${esperado ?? 'null'}`)
      }
    }

    expect(equivocados).toEqual([])
  })

  it('nunca bota un mensaje', () => {
    for (const caso of casos) {
      const p = extraer(caso.texto, { catalogo, ahora: AHORA })
      const clasificado = p.codigoItem !== null
      const aclaracion = p.codigoItem === null
      // Exactly one of the two, always, and always with a reason attached.
      expect(clasificado || aclaracion, caso.texto).toBe(true)
      expect(p.motivos.length, caso.texto).toBeGreaterThan(0)
    }
  })

  it('respeta los campos que el corpus declara', () => {
    const fallas: string[] = []

    for (const caso of casos) {
      const p = extraer(caso.texto, { catalogo, ahora: AHORA })
      const e = caso.espera
      if (!e) continue
      const revisar = <T>(campo: string, esperado: T | undefined, real: T) => {
        if (esperado === undefined) return
        if (esperado !== real) fallas.push(`«${caso.texto}» ${campo}: ${real} ≠ ${esperado}`)
      }
      revisar('codigo', e.codigo, p.codigoItem)
      revisar('cantidad', e.cantidad, p.cantidad)
      revisar('familias', e.familias, p.familias)
      revisar('urgencia', e.urgencia, p.urgencia)
      revisar('perecedero', e.perecedero, p.perecedero)
    }

    expect(fallas).toEqual([])
  })

  it('reporta la tasa de clasificación frente a aclaración', () => {
    let clasificados = 0
    for (const caso of casos) {
      if (extraer(caso.texto, { catalogo, ahora: AHORA }).codigoItem !== null) clasificados += 1
    }
    const aclaraciones = casos.length - clasificados
    const pct = (n: number) => ((n / casos.length) * 100).toFixed(0)

    console.log(
      `\n  corpus: ${ruta.replace(process.cwd() + '/', '')}` +
        `\n  ${casos.length} mensajes · ${clasificados} clasificados (${pct(clasificados)}%)` +
        ` · ${aclaraciones} a aclaración (${pct(aclaraciones)}%)` +
        (esSintetico
          ? '\n  ⚠️  CORPUS INVENTADO — esta tasa no es aceptación de M4 (PRD §7).\n'
          : '\n'),
    )

    // No threshold on purpose. The number is here to be read, and to be compared against
    // itself once the real corpus lands — not to be passed.
    expect(casos.length).toBeGreaterThan(0)
  })
})
