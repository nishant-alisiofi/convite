/**
 * How many SMS segments a message actually costs.
 *
 * This exists because of one specific, expensive, invisible failure: a single character
 * outside the GSM-7 alphabet forces the whole message into UCS-2, and the limit drops from
 * 160 characters to 70. A confirmation that comfortably fit becomes three segments, and the
 * bill for a basin-wide check-in run triples with nothing in any log to explain it.
 *
 * For Colombian Spanish this is not a corner case, it is the default. GSM-7 includes
 * `é`, `ñ`, `ü` and `ç` — but **not** `á`, `í`, `ó` or `ú`. So «está», «María», «atención»
 * and «más» are all UCS-2. Roughly every other sentence in this product hits it.
 *
 * We do not strip accents to dodge it. «Quedo con el numero 472» is worse Spanish sent to
 * someone who is already having a bad week, and 70 characters is enough for what we send.
 * The rule is one segment, whichever alphabet that takes — so this module measures, and the
 * despatcher refuses anything that does not fit.
 */

/** GSM 03.38 basic set. Everything here costs one septet. */
const GSM7_BASICO =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'

/** The extension table: still GSM-7, but each one costs two septets. */
const GSM7_EXTENDIDO = '^{}\\[~]|€'

const BASICO = new Set(GSM7_BASICO)
const EXTENDIDO = new Set(GSM7_EXTENDIDO)

export type Alfabeto = 'gsm7' | 'ucs2'

export type Segmentacion = {
  alfabeto: Alfabeto
  /** Billable units: septets for GSM-7, UTF-16 code units for UCS-2. */
  unidades: number
  segmentos: number
  cabeEnUno: boolean
  /** Characters that forced UCS-2, so an error message can name them. */
  culpables: string[]
}

const LIMITES = {
  gsm7: { uno: 160, concatenado: 153 },
  ucs2: { uno: 70, concatenado: 67 },
} as const

/**
 * Measures a message the way an aggregator bills it.
 *
 * Surrogate pairs (emoji) count as two UTF-16 units, which is what the wire format counts —
 * an emoji in an SMS is two of the seventy.
 */
export function segmentar(texto: string): Segmentacion {
  const culpables: string[] = []
  let septetos = 0

  for (const caracter of texto) {
    if (BASICO.has(caracter)) {
      septetos += 1
    } else if (EXTENDIDO.has(caracter)) {
      septetos += 2
    } else if (!culpables.includes(caracter)) {
      culpables.push(caracter)
    }
  }

  const alfabeto: Alfabeto = culpables.length > 0 ? 'ucs2' : 'gsm7'
  const unidades = alfabeto === 'gsm7' ? septetos : [...texto].reduce((n, c) => n + (c.codePointAt(0)! > 0xffff ? 2 : 1), 0)
  const limite = LIMITES[alfabeto]
  const segmentos = unidades === 0 ? 0 : unidades <= limite.uno ? 1 : Math.ceil(unidades / limite.concatenado)

  return { alfabeto, unidades, segmentos, cabeEnUno: segmentos <= 1, culpables }
}

/** The most a single segment can hold in the alphabet this text needs. */
export function limiteDeUnSegmento(texto: string): number {
  return LIMITES[segmentar(texto).alfabeto].uno
}

/**
 * Cuts a body down to one segment, on a word boundary, with a marker for what was left.
 *
 * Only ever used on a digest, where the alternative is dropping messages entirely. A single
 * message that does not fit is a copy bug and gets refused rather than silently trimmed.
 */
export function recortarAUnSegmento(texto: string, cola = '…'): string {
  if (segmentar(texto).cabeEnUno) return texto

  let recorte = texto
  while (recorte.length > 0 && !segmentar(recorte + cola).cabeEnUno) {
    const corte = recorte.lastIndexOf(' ')
    recorte = corte > 0 ? recorte.slice(0, corte) : recorte.slice(0, -1)
  }
  return recorte + cola
}
