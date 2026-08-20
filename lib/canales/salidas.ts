/**
 * The words we send back.
 *
 * Kept in one place because they are the product surface. 2.11 is «free-form in, structured
 * out» and it cuts both ways — PRD §2 explicitly kills «No entendí. Escriba así: 22 12 3»,
 * the coded syntax, and replaces it with a question a person can just answer. No menus, no
 * codes, no numbered options: someone meeting this system once a month cannot be asked to
 * learn a grammar, and the printed card exists so that nobody has to.
 *
 * There is no `encolar` function here any more. Everything outbound goes through
 * `despachador.despachar`, which is the only writer to `salidas_pendientes` — see PRD §4 M6,
 * «no code path sends unconditionally».
 *
 * ── On the SMS variants ──────────────────────────────────────────────────────────────────
 * They are shorter, and they also say something slightly different: the SMS clarification
 * does not offer a voice note. A person routed to SMS is there because their link will not
 * carry audio, so inviting one would be asking for a message that cannot arrive.
 *
 * Both fit a single segment. Note that they are UCS-2, not GSM-7 — Spanish `á í ó ú` are
 * outside the GSM-7 alphabet, so «Quedó», «número» and «Escríbalo» each force the whole
 * message into the 70-character encoding. We keep the accents and stay inside 70 rather than
 * mangling the Spanish to buy characters nobody needs. tests/sms.test.ts pins this.
 */
export const COPIA = {
  /** PRD §2, verbatim. The one targeted question a low-confidence intake earns. */
  aclaracion: '¿Me cuenta qué necesita? Escríbalo con sus palabras o mándeme una nota de voz.',

  /** Same question, one segment, and without asking for audio a weak link cannot carry. */
  aclaracionSms: '¿Me cuenta qué necesita? Escríbalo con sus palabras.',

  /** The folio, read back so the person can quote it later (2.13: useful on its own). */
  folio: (folio: number) =>
    `Recibimos su reporte. Quedó con el número ${folio}. ` +
    'Guárdelo para consultar o para confirmar la entrega.',

  /** One segment. Drops the second sentence, keeps the number, which is the whole point. */
  folioSms: (folio: number) => `Recibimos su reporte. Quedó con el número ${folio}.`,

  /**
   * §6.1 (v4 supplement, Adaptive Retry Protocol): the one SMS retry a failed callback earns,
   * sent 5 minutes after the callback is given up on. One segment, and it does not repeat
   * the menu — someone who could not take a call is asked for the plainest possible reply.
   */
  reintentoLlamada: 'No pudimos llamarlo. Cuéntenos aquí qué necesita.',
} as const
