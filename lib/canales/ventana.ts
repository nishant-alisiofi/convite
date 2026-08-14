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
 * The five utility templates in docs/plantillas-whatsapp.md.
 *
 * Drafted, not approved: decision D4 is still open and approval takes days per template. So
 * a name being on this list means "we wrote it", never "Meta cleared it" — which is why the
 * outbound path has to keep failing closed until D3/D4 land.
 */
export const PLANTILLAS = [
  'reporte_recibido',
  'envio_programado',
  'entrega_pendiente',
  'chequeo_periodico',
  'dano_verificado',
] as const

export type Plantilla = (typeof PLANTILLAS)[number]

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

/**
 * What, if anything, may be sent right now.
 *
 * Never throws: a refusal is an answer the outbound queue acts on — that is what
 * `salidas_pendientes` is for (2.14) — not an exception somebody has to catch.
 */
export function decidirSalida(
  propuesta: SalidaPropuesta,
  contexto: ContextoVentana,
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
  if (!(PLANTILLAS as readonly string[]).includes(nombre)) {
    return { permitido: false, motivo: `'${nombre}' no es una de las plantillas de utilidad.` }
  }
  return { permitido: true, modo: 'plantilla', plantilla: nombre as Plantilla }
}
