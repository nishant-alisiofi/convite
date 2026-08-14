import type { Canal } from '@/db/schema/vocabulario'

/**
 * The two policy functions (PRD §4 M6). Pure, like the matcher.
 *
 * They exist because the product's assumptions about a phone are wrong for most of the
 * people using it. Inviting a voice note from someone whose uploads have never completed
 * asks them to spend battery and data on a message that will not arrive, and then reads
 * their silence as "no need here". The policy's job is to ask for what this person can
 * actually send, and to answer on whatever actually reaches them.
 *
 * Nothing here sends. `despachador.ts` is the only thing that writes to a queue, and it
 * consults these first — so the rules stay testable against plain data and there is no
 * second, quieter path that skips them.
 */

/** Below this, a data session is not something we should be relying on. */
export const CALIDAD_DEBIL = 0.4
/** At or above this, and with a media upload behind them, voice notes are a fair ask. */
export const CALIDAD_BUENA = 0.7

export type PerfilContacto = {
  contactoId: string
  /** 0..1, or null when we have never measured — which is not the same as bad. */
  calidadEnlace: number | null
  /** Has a media upload from this person EVER completed? Null = never attempted. */
  mediaExitosa: boolean | null
  canalPreferido: Canal
  /** `comunidades.tier_conectividad`: 1 reliable data … 4 radio relay only. */
  tierComunidad: number | null
}

export type Solicitud = 'nota_de_voz' | 'pocas_palabras' | 'sms_o_llamada'

export type PlanSolicitud = {
  pedir: Solicitud
  /** Plain Spanish, shown to whoever is looking at why we asked the way we did. */
  motivo: string
}

/**
 * What we may ask this person to send us.
 *
 * The order matters. A failed upload is the strongest signal we have and outranks a good
 * delivery score: messages reaching them says nothing about their files reaching us, and
 * those are different directions over very different amounts of data.
 */
export function queSolicitar(perfil: PerfilContacto): PlanSolicitud {
  if (perfil.canalPreferido === 'radio' || perfil.canalPreferido === 'papel') {
    return {
      pedir: 'sms_o_llamada',
      motivo: `su canal es ${perfil.canalPreferido}: no hay sesión de datos que usar`,
    }
  }

  if (perfil.mediaExitosa === false) {
    // Tried and failed. Asking again is asking them to spend battery on a message that will
    // not arrive, and then reading the silence as "no need here".
    return { pedir: 'pocas_palabras', motivo: 'sus envíos de media nunca han completado' }
  }

  if (perfil.calidadEnlace === null) {
    // Never measured. Fall back to what we know about the place, and ask for less rather
    // than more — the first message from someone is the worst time to be wrong.
    const tier = perfil.tierComunidad ?? 2
    return tier >= 3
      ? { pedir: 'sms_o_llamada', motivo: `sin medición y comunidad tier ${tier}` }
      : { pedir: 'pocas_palabras', motivo: 'sin medición todavía: se pide lo más barato' }
  }

  if (perfil.calidadEnlace < CALIDAD_DEBIL) {
    return {
      pedir: 'sms_o_llamada',
      motivo: `enlace ${perfil.calidadEnlace.toFixed(2)}: no se sostiene una sesión de datos`,
    }
  }

  if (perfil.calidadEnlace >= CALIDAD_BUENA && perfil.mediaExitosa === true) {
    return { pedir: 'nota_de_voz', motivo: 'enlace bueno y ya subió media antes' }
  }

  return {
    pedir: 'pocas_palabras',
    motivo:
      perfil.mediaExitosa === true
        ? `enlace ${perfil.calidadEnlace.toFixed(2)}: alcanza para texto, no para audio`
        : 'nunca ha subido media: se pide texto corto',
  }
}

export type PlanRespuesta = {
  canal: Canal
  /** True when the body has to survive being cut to a single SMS segment. */
  unSoloSegmento: boolean
  motivo: string
}

/**
 * How we answer — which is not necessarily how they wrote to us.
 *
 * PRD §4 M6: **the reply channel need not be the intake channel.** Someone who walked to a
 * coverage point, sent a voice note and walked home is not on WhatsApp by the time we
 * answer; the folio has to follow them to the channel that still reaches their phone sitting
 * in a house with one bar. Replying on the channel they arrived by is the intuitive rule and
 * the wrong one.
 */
export function comoConfirmar(perfil: PerfilContacto, canalEntrada: Canal): PlanRespuesta {
  if (perfil.canalPreferido === 'radio' || perfil.canalPreferido === 'papel') {
    // Nothing automated reaches them. A human relays it; the queue holds it meanwhile.
    return {
      canal: perfil.canalPreferido,
      unSoloSegmento: false,
      motivo: `se relega a ${perfil.canalPreferido}: lo entrega una persona`,
    }
  }

  const debil = perfil.calidadEnlace !== null && perfil.calidadEnlace < CALIDAD_DEBIL
  const nuncaMedido = perfil.calidadEnlace === null
  const tierBajo = (perfil.tierComunidad ?? 2) >= 3

  if (debil || (nuncaMedido && tierBajo)) {
    return {
      canal: 'sms',
      unSoloSegmento: true,
      motivo: debil
        ? `enlace ${perfil.calidadEnlace!.toFixed(2)}: se contesta por SMS, que es lo que llega`
        : `comunidad tier ${perfil.tierComunidad}: se contesta por SMS`,
    }
  }

  // `web` is a staff surface, never somewhere we answer a community member.
  const canal: Canal = canalEntrada === 'web' ? 'whatsapp' : canalEntrada
  return { canal, unSoloSegmento: canal === 'sms', motivo: 'el enlace aguanta el mismo canal' }
}
