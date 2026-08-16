/**
 * Vocabulary tooltips, and only on vocabulary (PRD-36 §29b.6).
 *
 * Not a guided tour, not tooltips on everything — one sentence on the words a coordinator meets
 * without being told what they mean: `tier 3`, `centroide`, `segunda mano`, `desactualizado`,
 * `transcrito`, `pide detalle`. And the one real gap the vision names: nothing on the
 * verification screen explains when to pick `Solo verificar` over `Verificar y crear pedido`.
 *
 * A term is drawn with a dotted underline so it reads as «there is more here», and the sentence
 * is a native `title` — it works with no JavaScript, on a weak connection, the same discipline
 * as the channel badges in components/insignias.tsx.
 */

/** The glossary. One sentence each; plain language, no jargon explaining jargon. */
export const GLOSARIO = {
  tier3:
    'Nivel de enlace 3: la comunidad solo alcanza voz o SMS, no datos. Su silencio dice más de la señal que de la necesidad.',
  centroide:
    'El centro del poblado según el gazetteer, con ~1000 m de margen: no es un punto que alguien haya visitado con GPS.',
  segunda_mano:
    'Relevo de radio: lo dijo una persona y lo escribió un operador. Siempre requiere verificación.',
  desactualizado:
    'La cuenta de existencias es vieja: puede haberse movido desde entonces. Se confirma al llegar, nunca antes.',
  transcrito:
    'Una máquina convirtió la nota de voz en texto. El audio original se conserva aparte; el porcentaje dice qué tan segura estaba.',
  pide_detalle:
    'Este ítem necesita una pregunta más (cuál medicina, qué talla) antes de entrar a la cola.',
  solo_verificar:
    'Da por cierto lo que se reportó, pero no crea un pedido. Úselo cuando el reporte es real pero todavía no hay que mover nada — un aviso, algo ya resuelto, o algo que no se entrega.',
  verificar_y_crear_pedido:
    'Da por cierto el reporte y además abre un pedido para que el emparejador lo cruce con una donación y un transporte. Úselo cuando hay que entregar algo.',
} as const

export type ClaveGlosario = keyof typeof GLOSARIO

/**
 * A term with its one-sentence definition on hover/focus. Pass a `clave` to pull from the shared
 * glossary, or an explicit `definicion` for a one-off.
 */
export function Termino({
  clave,
  definicion,
  children,
}: {
  clave?: ClaveGlosario
  definicion?: string
  children: React.ReactNode
}) {
  const texto = definicion ?? (clave ? GLOSARIO[clave] : '')
  return (
    <span
      title={texto}
      tabIndex={0}
      className="cursor-help border-b border-dotted border-barro-400 text-barro-800 decoration-barro-400"
    >
      {children}
    </span>
  )
}
