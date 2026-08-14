import type { Pool, PoolClient } from 'pg'
import type { Canal } from '@/db/schema/vocabulario'
import { type ContextoVentana, decidirSalida, type DecisionVentana, type Plantilla } from './ventana'

/**
 * Everything we say back, and the queue it waits in.
 *
 * Non-negotiable 2.14: outbound for a poor link is queued and piggybacked on the person's
 * next inbound message. So nothing here sends — `salidas_pendientes` is the destination, and
 * the sender is M6. Queueing rather than sending is also what makes this correct today:
 * there is no WABA yet (D3), and a code path that "just sends" would be the one path the
 * simulator never exercises.
 *
 * A refusal from the 24-hour rule is **not** a discard. It means not now: the row stays in
 * the queue and goes out attached to the next thing the person sends us. Dropping it would
 * lose the folio somebody is waiting for.
 */

/**
 * The words.
 *
 * Kept together because they are the product surface. 2.11 is «free-form in, structured
 * out» and it cuts both ways — PRD §2 explicitly kills «No entendí. Escriba así: 22 12 3»,
 * the coded syntax, and replaces it with a question a person can just answer. No menus, no
 * codes, no numbered options: someone meeting this system once a month cannot be asked to
 * learn a grammar.
 */
export const COPIA = {
  /** PRD §2, verbatim. The one targeted question a low-confidence intake earns. */
  aclaracion: '¿Me cuenta qué necesita? Escríbalo con sus palabras o mándeme una nota de voz.',

  /** The folio, read back so the person can quote it later (2.13: useful on its own). */
  folio: (folio: number) =>
    `Recibimos su reporte. Quedó con el número ${folio}. ` +
    'Guárdelo para consultar o para confirmar la entrega.',
} as const

export type SalidaAEncolar = {
  contactoId: string
  cuerpo: string
  /** Named only when the send may have to happen outside the 24-hour window. */
  plantilla?: Plantilla | null
  /** 1 is most urgent, 9 least. `salidas_prioridad_check` enforces the range. */
  prioridad?: number
  canalSugerido?: Canal | null
}

export type ResultadoSalida = {
  id: string
  /** What the window rule said at queue time. The sender re-evaluates at send time. */
  decision: DecisionVentana
}

export async function encolarSalida(
  ejecutor: Pool | PoolClient,
  salida: SalidaAEncolar,
  contexto: ContextoVentana,
): Promise<ResultadoSalida> {
  if (salida.cuerpo.trim().length === 0) {
    throw new Error('No se encola un mensaje vacío.')
  }

  // Consulted here, above the driver, so the queue never holds something that could only
  // ever have been sent by a driver ignoring the rule.
  const decision = decidirSalida(
    { cuerpo: salida.cuerpo, plantilla: salida.plantilla ?? null },
    contexto,
  )

  const { rows } = await ejecutor.query<{ id: string }>(
    `insert into salidas_pendientes (contacto_id, cuerpo, prioridad, canal_sugerido)
     values ($1, $2, $3, $4)
     returning id`,
    [salida.contactoId, salida.cuerpo, salida.prioridad ?? 5, salida.canalSugerido ?? null],
  )

  return { id: rows[0]!.id, decision }
}
