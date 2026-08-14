/**
 * What the caller hears, and what the keys mean.
 *
 * One level, four options, and nothing nested. PRD §4 M10 is explicit about the depth: a
 * person on a borrowed phone with one bar, standing somewhere with signal, is not going to
 * walk a tree. Everything they can do is on the first screen or it does not exist.
 *
 * `0` reaches a person from anywhere, including from silence — someone who does not press
 * anything is not lost, they are someone the menu failed, and the call routes to a human
 * rather than hanging up on them.
 *
 * The prompts live here as text and are recorded later with a local voice (N8, field work).
 * Written to be read aloud: short sentences, usted, no jargon, and the option before the
 * key — «pedir ayuda, marque 1» is easier to follow than «marque 1 para pedir ayuda» when
 * you are only half listening.
 */

export type OpcionMenu = {
  tecla: string
  /** What choosing this key means downstream. */
  intencion: 'necesidad' | 'confirmacion_entrega' | 'dano' | 'persona'
  etiqueta: string
}

export const MENU: OpcionMenu[] = [
  { tecla: '1', intencion: 'necesidad', etiqueta: 'pedir ayuda' },
  { tecla: '2', intencion: 'confirmacion_entrega', etiqueta: 'confirmar una entrega' },
  { tecla: '3', intencion: 'dano', etiqueta: 'reportar un daño' },
  { tecla: '0', intencion: 'persona', etiqueta: 'hablar con una persona' },
]

export const PROMPTS = {
  bienvenida:
    'Le habla la Red de Ayuda. Le devolvemos la llamada para que a usted no le cueste nada.',

  menu:
    'Para pedir ayuda, marque 1. Para confirmar una entrega, marque 2. ' +
    'Para reportar un daño, marque 3. Para hablar con una persona, marque 0.',

  grabar:
    'Cuéntenos qué necesita después del tono. Hable con sus palabras, con calma, ' +
    'y cuelgue cuando termine.',

  persona:
    'Ya mismo lo comunicamos con una persona de la Red de Ayuda. No cuelgue.',

  sinRespuesta:
    'No alcanzamos a escuchar su selección, así que lo pasamos con una persona. No cuelgue.',
} as const

/**
 * The folio, dictated.
 *
 * «472» spoken as one number is heard once and lost. Digit by digit, with a pause between
 * each, is what someone writes on the back of their hand while standing in the rain — and
 * it is the number they will read back to us when the delivery arrives.
 */
export function dictarFolio(folio: number): string {
  const digitos = String(folio).split('').join('. ')
  return `Su reporte quedó con el número ${digitos}. Repito: ${digitos}. Anótelo, por favor.`
}

export function opcionDe(tecla: string | null | undefined): OpcionMenu | null {
  if (!tecla) return null
  return MENU.find((o) => o.tecla === tecla) ?? null
}

/**
 * How an option maps onto the envelope's `tipo`.
 *
 * A keypress is structural channel knowledge — the same kind the printed card carries — so
 * unlike free text it is allowed to set the type. It still does not choose a `codigo_item`:
 * that is the normalizer's call once there is a transcript, and today there is not (D8).
 */
export function tipoDeIntencion(
  intencion: OpcionMenu['intencion'],
): 'necesidad' | 'dano' | 'confirmacion_entrega' | 'texto_libre' {
  switch (intencion) {
    case 'necesidad':
      return 'necesidad'
    case 'dano':
      return 'dano'
    case 'confirmacion_entrega':
      return 'confirmacion_entrega'
    case 'persona':
      return 'texto_libre'
  }
}
