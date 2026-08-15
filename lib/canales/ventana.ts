/**
 * The 24-hour service window, which lives above the drivers.
 *
 * PRD §3: the rule sits over the port rather than inside the WhatsApp driver, so the
 * simulator cannot let through a message production would reject. A rule implemented in the
 * driver would be a rule the credential-free path never runs, and we would find out what it
 * does the first time we point the thing at a real number.
 *
 * Meta's rule: outside 24 hours from the person's last inbound message, only an approved
 * template may be sent. Inside it, free text is fine. Getting this wrong is not a validation
 * error somewhere in a log — it is a message that never arrives, to somebody who is waiting
 * on it, and who we have already asked to walk to a coverage point.
 *
 * Pure, like the matcher: no database, no clock, no network. The caller supplies both.
 */

export const VENTANA_SERVICIO_HORAS = 24

/**
 * The templates in docs/plantillas-whatsapp.md, and whether Meta has cleared each one.
 *
 * `aprobada` is the point of this table. Being written is not being approved: D4 is open,
 * approval takes days per template and templates get rejected, so a name existing here means
 * «we drafted it» and nothing more. Treating drafted as sendable is a specific failure —
 * the message is accepted by our own rule, queued, sent, and refused by Meta with a 132001,
 * which nobody sees except the person who never got their folio.
 *
 * So the flag, and it starts false for every one of them. The day a template is approved,
 * flipping it here is the whole change; `decidirSalida` reads the flag rather than a name
 * list, so there is one place to be wrong and it is this one.
 */
export const PLANTILLAS = {
  reporte_recibido: { aprobada: false },
  envio_programado: { aprobada: false },
  entrega_pendiente: { aprobada: false },
  chequeo_periodico: { aprobada: false },
  dano_verificado: { aprobada: false },
  /**
   * The sign-in code. The only one of these that is not `UTILITY`.
   *
   * Meta files it under `AUTHENTICATION`, which is a different category with its own approval
   * track, its own pricing, and a fixed body shape — the code is the whole message. It is on
   * this list because it must be, not because it is like the others: a sign-in is by
   * definition unsolicited, so the 24-hour window is always closed for it, and only an
   * approved name here is allowed through `decidirSalida` when that is true.
   */
  codigo_ingreso: { aprobada: false },
} as const satisfies Record<string, { aprobada: boolean }>

export type Plantilla = keyof typeof PLANTILLAS

/**
 * The approval state of every registered template.
 *
 * A parameter of `decidirSalida` so a test can ask what happens the day Meta approves one,
 * without anybody having to write `aprobada: true` above before it is true. It cannot invent
 * a template — only say whether a known one is cleared.
 */
export type EstadoPlantillas = Record<Plantilla, { aprobada: boolean }>

/** The names, for the places that only need to know a template is registered. */
export const NOMBRES_PLANTILLA = Object.keys(PLANTILLAS) as Plantilla[]

export type SalidaPropuesta = {
  cuerpo: string
  /** Set when the caller intends a template send; null for free text. */
  plantilla?: string | null
}

export type ContextoVentana = {
  /** Last inbound message from this person. Null when we have never heard from them. */
  ultimoEntranteEn: Date | null
  ahora: Date
}

export type DecisionVentana =
  | { permitido: true; modo: 'libre' }
  | { permitido: true; modo: 'plantilla'; plantilla: Plantilla }
  | { permitido: false; motivo: string }

/** True while free-form replies still reach this person. */
export function ventanaAbierta(contexto: ContextoVentana): boolean {
  const { ultimoEntranteEn, ahora } = contexto
  if (!ultimoEntranteEn) return false
  const horas = (ahora.getTime() - ultimoEntranteEn.getTime()) / 3_600_000
  return horas < VENTANA_SERVICIO_HORAS
}

function esPlantilla(nombre: string, registro: EstadoPlantillas): nombre is Plantilla {
  return Object.hasOwn(registro, nombre)
}

/**
 * What, if anything, may be sent right now.
 *
 * Never throws: a refusal is an answer the outbound queue acts on — that is what
 * `salidas_pendientes` is for (2.14) — not an exception somebody has to catch.
 */
export function decidirSalida(
  propuesta: SalidaPropuesta,
  contexto: ContextoVentana,
  registro: EstadoPlantillas = PLANTILLAS,
): DecisionVentana {
  if (propuesta.cuerpo.trim().length === 0) {
    return { permitido: false, motivo: 'No se envía un mensaje vacío.' }
  }

  if (ventanaAbierta(contexto)) return { permitido: true, modo: 'libre' }

  const nombre = propuesta.plantilla
  if (!nombre) {
    return {
      permitido: false,
      motivo:
        'La ventana de 24 h está cerrada: fuera de ella solo sale una plantilla aprobada. ' +
        'Encole la salida y péguela al próximo mensaje entrante (2.14).',
    }
  }
  if (!esPlantilla(nombre, registro)) {
    return { permitido: false, motivo: `'${nombre}' no es una de las plantillas de utilidad.` }
  }
  // Written is not approved. Until Meta clears it (D4) this template is exactly as sendable
  // as free text is — which outside the window is not at all. Saying otherwise here means the
  // folio is accepted by our own rule and then refused by Meta, and the only person who finds
  // out is the one who never received it.
  if (!registro[nombre].aprobada) {
    return {
      permitido: false,
      motivo:
        `La plantilla '${nombre}' está redactada pero Meta no la ha aprobado (D4), así que ` +
        'fuera de la ventana de 24 h no sale. Encole la salida y péguela al próximo mensaje ' +
        'entrante (2.14).',
    }
  }
  return { permitido: true, modo: 'plantilla', plantilla: nombre }
}
