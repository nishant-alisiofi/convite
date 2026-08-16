/**
 * PRD-11 «Radio» — demo attestations and one relayed report for the /radio screen. STAGING ONLY.
 * Consumed only by scripts/seed.ts, on ASOREDIPARCHOCÓ (the demo org).
 *
 * Radio drifts closed: OFF for every community until someone with a name attests a licensed, safe
 * net, and the attestation expires after six months. The demo shows both halves of that state — one
 * VALID attestation (Docampadó, a tier-4 «solo radio» community) and one EXPIRED (Winandó), so the
 * screen has a habilitada row and a «vuelva a confirmar» row. On the valid one it also plants one
 * relayed report: second-hand by definition, so it sits in the verification queue as RECIBIDO,
 * naming the two people every relay carries (the speaker and the operator who keyed it in).
 *
 * The relay is inserted directly (the seed has no signed-in session for registrar_relevo_radio), so
 * it must land on a community that already has a live, safe, unexpired attestation — the 0050 gate
 * trigger enforces exactly that. Idempotent: attestations keyed on (org, comunidad); the relay's
 * report on its `payload_crudo.semilla`, and the relay row skipped if it already exists. Every
 * UI-visible string is marked [DATO DE PRUEBA] by scripts/seed.ts.
 */

export type AtestacionRadioSemilla = {
  comunidad: string
  redDescrita: string
  usoSeguro: boolean
  /** When it was attested, as days before today. */
  atestadoDiasAtras: number
  /** When it expires, as days from today: positive = still valid, negative = already lapsed. */
  expiraEnDias: number
  notas: string | null
}

export type RelevoRadioSemilla = {
  /** Stable seed key for the report the relay produces, for idempotency. */
  semilla: string
  comunidad: string
  hablante: string
  operador: string
  tipo: 'necesidad' | 'dano' | 'sin_clasificar'
  detalle: string
  /** How long ago the relay came in (days). */
  diasAtras: number
}

export const ATESTACIONES_RADIO_DEMO: AtestacionRadioSemilla[] = [
  {
    // Valid: a live, safe, unexpired attestation on a tier-4 «solo radio» community.
    comunidad: 'DOC',
    redDescrita: 'Red VHF de lancheros del Baudó',
    usoSeguro: true,
    atestadoDiasAtras: 30,
    expiraEnDias: 150,
    notas: 'Confirmada con la junta; la red opera a diario y su uso es seguro.',
  },
  {
    // Expired: attested and safe, but lapsed — it renders «vencida, vuelva a confirmar».
    comunidad: 'WIN',
    redDescrita: 'Radioteléfono comunitario del Atrato medio',
    usoSeguro: true,
    atestadoDiasAtras: 240,
    expiraEnDias: -60,
    notas: 'Venció; hay que volver a confirmar con el operador de turno.',
  },
]

export const RELEVOS_RADIO_DEMO: RelevoRadioSemilla[] = [
  {
    semilla: 'demo-relevo-doc-1',
    comunidad: 'DOC',
    hablante: 'Custodia Palacios (partera)',
    operador: 'Aristóbulo Mena (operador de radio)',
    tipo: 'necesidad',
    detalle:
      'Piden mercado y pastillas para la tensión; el río bajó y llevan días sin poder salir. ' +
      'Lo transmitió el operador por la mañana.',
    diasAtras: 1,
  },
]
