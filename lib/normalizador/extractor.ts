import type { Catalogo } from './catalogo'
import {
  FECHAS_RELATIVAS,
  LEXICO,
  MARCADORES_PETICION,
  MARCADORES_URGENCIA,
  MARCADORES_VAGOS,
  NUMEROS_ESCRITOS,
  SUSTANTIVOS_FAMILIAS,
  VERSION_LEXICO,
} from './lexico'

/**
 * Free text in, structured proposal out (2.11) — deterministic, no model, no network.
 *
 * The governing rule is 2.12: **returning null must be cheaper than guessing.** Every
 * tiebreak in this file resolves toward null. A null costs a coordinator one question; a
 * wrong `codigo_item` costs a boat trip up a river with the wrong cargo, and the person who
 * asked gets nothing for another week.
 *
 * It never drops, either. Every input produces a proposal — possibly one that proposes
 * nothing at all — and the caller routes an empty one to clarification. There is no path
 * where a message is silently discarded.
 *
 * Pure, like the matcher: text and a clock in, plain data out. The catalogue is passed in
 * rather than read, so nothing here knows what a code means (2.8).
 */

export const UMBRAL = 0.7

/** How close the runner-up may get before the answer is «I cannot tell» rather than a pick. */
const MARGEN_AMBIGUEDAD = 0.8

export type PropuestaExtractor = {
  tipo: 'necesidad' | 'dano' | null
  codigoItem: string | null
  cantidad: number | null
  unidad: string | null
  familias: number | null
  /** Only from explicit words. The catalogue's `urgencia_min` is the core's to apply. */
  urgencia: number | null
  perecedero: boolean
  venceEn: Date | null
  /** Confidence in the category, 0..1. Below UMBRAL nothing is assigned. */
  confianza: number
  confianzaPorCampo: Record<string, number>
  /** Fields a human still has to supply before this can be acted on. */
  requiereDetalle: string[]
  /** Why it landed here. Shown in the audio inbox so a verifier can see the reasoning. */
  motivos: string[]
  versionLexico: string
}

export type ContextoExtractor = {
  catalogo: Catalogo
  ahora: Date
}

export const PROPUESTA_NULA: Omit<PropuestaExtractor, 'motivos' | 'versionLexico'> = {
  tipo: null,
  codigoItem: null,
  cantidad: null,
  unidad: null,
  familias: null,
  urgencia: null,
  perecedero: false,
  venceEn: null,
  confianza: 0,
  confianzaPorCampo: {},
  requiereDetalle: [],
}

/** Lowercase, strip accents, collapse whitespace. Emoji survive; they carry meaning. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapar(termino: string): string {
  return termino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Word-boundary match, except for emoji, which have no word boundary to speak of.
 * `\b` against a non-word character never fires, so those are matched as substrings.
 */
function contiene(texto: string, termino: string): boolean {
  if (!/^[\p{L}\p{N}]/u.test(termino)) return texto.includes(termino)
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapar(termino)}(?![\\p{L}\\p{N}])`, 'u').test(texto)
}

/** Noisy-OR: two independent hints are worth more than either, and never more than certainty. */
function acumular(actual: number, peso: number): number {
  return 1 - (1 - actual) * (1 - peso)
}

function aNumero(palabra: string): number | null {
  if (/^\d{1,5}$/.test(palabra)) return Number(palabra)
  return NUMEROS_ESCRITOS[palabra] ?? null
}

/** End of the day `dias` ahead, in Bogotá (UTC-5 year round, no DST). */
function finDelDia(ahora: Date, dias: number): Date {
  const bogota = new Date(ahora.getTime() - 5 * 3_600_000)
  const y = bogota.getUTCFullYear()
  const m = bogota.getUTCMonth()
  const d = bogota.getUTCDate() + dias
  // 23:59:59 Bogotá is 04:59:59 UTC the next day.
  return new Date(Date.UTC(y, m, d + 1, 4, 59, 59))
}

/**
 * The printed card's syntax: `CÓDIGO FAMILIAS URGENCIA`, e.g. «22 12 3».
 *
 * Section 4.2 — the laminated card is part of the product, and people who carry one learn
 * the codes by use. The whole message has to be the code, so a number inside a sentence
 * cannot hijack it, and separators are loose because people write «22-12-3» and «22,12,3».
 *
 * A first digit of 9 means damage, and then the second number is SEVERITY, not families —
 * getting that backwards files «vía bloqueada, severidad 2» as two households needing help.
 *
 * Read here rather than in the SMS driver on purpose: adapters do not classify (contract
 * §4), and someone who learned the codes uses them on WhatsApp too.
 */
const SINTAXIS_TARJETA = /^(\d{2})(?:[\s,.\-–]+(\d{1,4}))?(?:[\s,.\-–]+([1-3]))?$/

function leerTarjeta(
  t: string,
  contexto: ContextoExtractor,
): Pick<PropuestaExtractor, 'tipo' | 'codigoItem' | 'familias' | 'urgencia' | 'confianza'> | null {
  const m = SINTAXIS_TARJETA.exec(t.trim())
  if (!m) return null

  const codigo = m[1]!
  const item = contexto.catalogo.get(codigo)
  // An unknown code is somebody misremembering, or a number that happens to have two
  // digits. Neither is a request for anything, so it falls through to the lexicon.
  if (!item) return null

  const segundo = m[2] ? Number(m[2]) : null
  const tercero = m[3] ? Number(m[3]) : null

  if (item.tipo === 'dano') {
    // Severity is not something `reportes.familias` can hold, and the extractor has no
    // severidad field of its own yet — so it is deliberately not smuggled into families.
    return { tipo: 'dano', codigoItem: codigo, familias: null, urgencia: null, confianza: 0.95 }
  }

  return {
    tipo: 'necesidad',
    codigoItem: codigo,
    familias: segundo !== null && segundo > 0 ? segundo : null,
    urgencia: tercero,
    confianza: 0.95,
  }
}

export function extraer(texto: string | null, contexto: ContextoExtractor): PropuestaExtractor {
  const motivos: string[] = []
  const base = { ...PROPUESTA_NULA, motivos, versionLexico: VERSION_LEXICO }

  if (!texto || texto.trim().length === 0) {
    motivos.push('sin texto que analizar')
    return base
  }

  const t = normalizar(texto)

  const tarjeta = leerTarjeta(t, contexto)
  if (tarjeta) {
    const item = contexto.catalogo.get(tarjeta.codigoItem!)!
    motivos.push(`sintaxis de la tarjeta: ${tarjeta.codigoItem} (${item.itemLabel})`)
    if (item.tipo === 'dano') motivos.push('daño: el segundo número es severidad, no familias')
    return {
      ...PROPUESTA_NULA,
      ...tarjeta,
      requiereDetalle: item.pideDetalle ? ['detalle'] : [],
      confianzaPorCampo: {
        codigoItem: tarjeta.confianza,
        familias: tarjeta.familias === null ? 0 : 0.95,
        urgencia: tarjeta.urgencia === null ? 0 : 0.95,
      },
      motivos,
      versionLexico: VERSION_LEXICO,
    }
  }
  const palabras = t.split(/[^\p{L}\p{N}]+/u).filter(Boolean)

  // ── Vagueness wins over everything ─────────────────────────────────────────────────────
  // «Muchas cosas!! De todo!!!» is a person telling us it is all bad. Assigning a category
  // to that is inventing a request they did not make (2.12, Section 9.4).
  const vago = MARCADORES_VAGOS.find((m) => contiene(t, m))

  // ── Category ───────────────────────────────────────────────────────────────────────────
  const puntajes = new Map<string, number>()
  let perecederoDetectado = false
  for (const entrada of LEXICO) {
    if (!contiene(t, entrada.termino)) continue
    if (!contexto.catalogo.has(entrada.codigo)) continue
    puntajes.set(entrada.codigo, acumular(puntajes.get(entrada.codigo) ?? 0, entrada.peso))
    if (entrada.perecedero) perecederoDetectado = true
  }

  const ordenados = [...puntajes.entries()].sort((a, b) => b[1] - a[1])
  const mejor = ordenados[0]
  const segundo = ordenados[1]

  let codigoItem: string | null = null
  let confianza = mejor?.[1] ?? 0

  if (vago) {
    motivos.push(`marcador vago: «${vago}» — no se asigna categoría`)
    confianza = 0
  } else if (!mejor) {
    motivos.push('ninguna palabra del léxico coincidió')
  } else if (segundo && segundo[1] >= mejor[1] * MARGEN_AMBIGUEDAD) {
    // Two candidates too close to separate. Asking is cheaper than picking — and the two
    // cases read very differently to the coordinator who has to act on it, so they are
    // worded differently: one message naming two real items (a reporte holds one
    // `codigo_item`, so a human splits it) versus one message we simply cannot read.
    const ambosClaros = mejor[1] >= UMBRAL && segundo[1] >= UMBRAL
    motivos.push(
      ambosClaros
        ? `varios ítems nombrados: ${mejor[0]} (${mejor[1].toFixed(2)}) y ${segundo[0]} (${segundo[1].toFixed(2)}) — hay que separarlos`
        : `ambiguo entre ${mejor[0]} (${mejor[1].toFixed(2)}) y ${segundo[0]} (${segundo[1].toFixed(2)})`,
    )
    confianza = 0
  } else if (mejor[1] < UMBRAL) {
    motivos.push(`indicio débil para ${mejor[0]} (${mejor[1].toFixed(2)} < ${UMBRAL})`)
  } else {
    codigoItem = mejor[0]
    motivos.push(`${mejor[0]} con ${mejor[1].toFixed(2)}`)
    if (segundo) motivos.push(`segunda opción descartada: ${segundo[0]} (${segundo[1].toFixed(2)})`)
  }

  const item = codigoItem ? contexto.catalogo.get(codigoItem) : undefined
  const tipo = item?.tipo ?? null

  // ── Quantities ─────────────────────────────────────────────────────────────────────────
  // A bare number is never a quantity. «🍲 90» must yield none: 90 could be a house number,
  // a code someone half-remembered, or a year. A number counts only when the word beside it
  // says what is being counted.
  let cantidad: number | null = null
  let unidad: string | null = null
  let familias: number | null = null

  const unidadesDelItem = [item?.unidadSingular, item?.unidadPlural]
    .filter((u): u is string => Boolean(u))
    .map(normalizar)

  for (let i = 0; i < palabras.length - 1; i++) {
    const n = aNumero(palabras[i]!)
    if (n === null) continue
    const siguiente = palabras[i + 1]!
    const siguienteDos = palabras[i + 2] ? `${siguiente} ${palabras[i + 2]}` : siguiente

    if (SUSTANTIVOS_FAMILIAS.includes(siguiente)) {
      familias ??= n
      continue
    }
    const nombraLaUnidad = unidadesDelItem.some(
      (u) => u === siguiente || u === siguienteDos || u.startsWith(siguiente),
    )
    const nombraElItem =
      codigoItem !== null &&
      LEXICO.some(
        (e) => e.codigo === codigoItem && (e.termino === siguiente || e.termino === siguienteDos),
      )
    if (nombraLaUnidad || nombraElItem) {
      cantidad ??= n
      unidad ??= item?.unidadPlural ?? item?.unidadSingular ?? siguiente
    }
  }

  if (cantidad === null && /\d/.test(t)) {
    motivos.push('había un número pero nada que dijera qué contaba: no se asigna cantidad')
  }

  // ── Urgency, only when the words say so ────────────────────────────────────────────────
  let urgencia: number | null = null
  for (const marca of MARCADORES_URGENCIA) {
    if (!contiene(t, marca.termino)) continue
    urgencia = Math.max(urgencia ?? 0, marca.urgencia)
  }
  if (urgencia !== null) motivos.push(`urgencia ${urgencia} declarada en el texto`)

  // ── Perishables ────────────────────────────────────────────────────────────────────────
  let venceEn: Date | null = null
  if (perecederoDetectado) {
    const fecha = FECHAS_RELATIVAS.find((f) => contiene(t, f.termino))
    if (fecha) {
      venceEn = finDelDia(contexto.ahora, fecha.dias)
      motivos.push(`perecedero, vence «${fecha.termino}»`)
    } else {
      motivos.push('perecedero sin fecha: hay que preguntar hasta cuándo sirve')
    }
  }

  // ── What a human still has to supply ───────────────────────────────────────────────────
  const requiereDetalle: string[] = []
  if (item?.pideDetalle) requiereDetalle.push('detalle')
  // ofertas_perecedero_check refuses a perishable with no expiry, so this is not optional.
  if (perecederoDetectado && !venceEn) requiereDetalle.push('vence_en')

  const confianzaPorCampo: Record<string, number> = {
    codigoItem: codigoItem ? confianza : 0,
    cantidad: cantidad === null ? 0 : 0.9,
    familias: familias === null ? 0 : 0.9,
    urgencia: urgencia === null ? 0 : 0.9,
    perecedero: perecederoDetectado ? 0.85 : 0,
    venceEn: venceEn ? 0.8 : 0,
  }

  const marcaPeticion = MARCADORES_PETICION.find((m) => contiene(t, m))
  if (marcaPeticion) motivos.push(`redactado como petición («${marcaPeticion}»)`)

  return {
    tipo,
    codigoItem,
    cantidad,
    unidad,
    familias,
    urgencia,
    perecedero: perecederoDetectado,
    venceEn,
    confianza: codigoItem ? confianza : 0,
    confianzaPorCampo,
    requiereDetalle,
    motivos,
    versionLexico: VERSION_LEXICO,
  }
}
