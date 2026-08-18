import { z } from 'zod'

/**
 * The Calls webhook envelope, parsed defensively.
 *
 * The confirmed shape (Infobip's Calls Applications event-webhook reference) carries `type`,
 * `callId` and `timestamp`; per-event extra fields — `from`/`to` on `CALL_RECEIVED`, the
 * digits on a DTMF event, the file id on a recording-ready event — are not published in
 * enough detail to pin exact field names against, so this reads what the confirmed envelope
 * guarantees and passes the rest through untyped rather than asserting a shape nobody has
 * verified. `.passthrough()` keeps those extra fields reachable without validating them.
 */
const esquemaEvento = z
  .object({
    type: z.string().optional(),
    callId: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    direction: z.string().optional(),
    timestamp: z.string().optional(),
  })
  .passthrough()

export type EventoVoz = z.infer<typeof esquemaEvento>

/**
 * One webhook POST may carry a single event object, or (Infobip's convention on other
 * channels, e.g. SMS delivery reports) a `results` array of several. Both are accepted so a
 * batched delivery never silently drops every event but the first.
 */
export function interpretarWebhookVoz(payload: unknown): EventoVoz[] {
  const candidatos = Array.isArray((payload as { results?: unknown[] } | null)?.results)
    ? (payload as { results: unknown[] }).results
    : [payload]

  const eventos: EventoVoz[] = []
  for (const candidato of candidatos) {
    const parsed = esquemaEvento.safeParse(candidato)
    if (parsed.success) eventos.push(parsed.data)
  }
  return eventos
}

const TIPOS_LLAMADA_ENTRANTE = new Set(['CALL_RECEIVED'])

/**
 * Whether this event is a stranger ringing us, as opposed to a state change on a callback we
 * placed ourselves — both arrive on the same webhook, and only the first should ever reach
 * `recibirLlamadaPerdida`.
 */
export function esLlamadaEntrante(evento: EventoVoz): boolean {
  if (!evento.type || !TIPOS_LLAMADA_ENTRANTE.has(evento.type.toUpperCase())) return false
  // Absent a `direction` field, a CALL_RECEIVED-shaped event is inbound by construction — it
  // is the event Infobip sends to announce a call arriving at our number. `direction`, when
  // present, is checked so a future event shape that reuses this type name for something
  // else cannot be misread as a missed call.
  if (evento.direction && evento.direction.toUpperCase() !== 'INBOUND') return false
  return true
}
