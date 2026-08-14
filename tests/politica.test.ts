import { describe, expect, it } from 'vitest'
import { comoConfirmar, type PerfilContacto, queSolicitar } from '@/lib/canales'

/**
 * The two policy functions (PRD §4 M6), with no database in sight.
 *
 * They encode a single idea: ask for what this person can actually send, and answer on
 * whatever actually reaches them. Getting it wrong is not a degraded experience — inviting a
 * voice note from someone whose uploads never complete asks them to spend battery and data
 * on a message that will not arrive, and then reads their silence as «no need here».
 */

const base: PerfilContacto = {
  contactoId: '00000000-0000-4000-9000-000000000001',
  calidadEnlace: null,
  mediaExitosa: null,
  canalPreferido: 'whatsapp',
  tierComunidad: 2,
}

const perfil = (cambios: Partial<PerfilContacto>): PerfilContacto => ({ ...base, ...cambios })

describe('queSolicitar', () => {
  it('ofrece nota de voz solo con enlace bueno y una subida ya lograda', () => {
    expect(queSolicitar(perfil({ calidadEnlace: 0.9, mediaExitosa: true })).pedir).toBe(
      'nota_de_voz',
    )
  })

  it('nunca ofrece nota de voz a quien nunca ha logrado subir media', () => {
    // The strongest signal we have, and it outranks a good delivery score: their file
    // reaching us is a different direction and far more data than our text reaching them.
    expect(queSolicitar(perfil({ calidadEnlace: 0.95, mediaExitosa: false })).pedir).toBe(
      'pocas_palabras',
    )
  })

  it('con enlace bueno pero sin historial de media, pide texto corto', () => {
    expect(queSolicitar(perfil({ calidadEnlace: 0.9, mediaExitosa: null })).pedir).toBe(
      'pocas_palabras',
    )
  })

  it('con enlace débil manda a SMS o llamada', () => {
    expect(queSolicitar(perfil({ calidadEnlace: 0.2, mediaExitosa: true })).pedir).toBe(
      'sms_o_llamada',
    )
  })

  it('sin medición usa el tier de la comunidad como punto de partida', () => {
    // Never measured is not the same as bad (0010). The community tier is a guess about a
    // place, so it decides only until we know something about the person.
    expect(queSolicitar(perfil({ tierComunidad: 2 })).pedir).toBe('pocas_palabras')
    expect(queSolicitar(perfil({ tierComunidad: 4 })).pedir).toBe('sms_o_llamada')
  })

  it('a quien está en radio no le pide nada por datos', () => {
    // Élver is relayed by radio: WhatsApp is not a channel that reaches him at all.
    expect(queSolicitar(perfil({ canalPreferido: 'radio', calidadEnlace: 0.9 })).pedir).toBe(
      'sms_o_llamada',
    )
  })

  it('siempre explica por qué', () => {
    for (const p of [perfil({}), perfil({ calidadEnlace: 0.1 }), perfil({ mediaExitosa: false })]) {
      expect(queSolicitar(p).motivo.length).toBeGreaterThan(10)
    }
  })
})

describe('comoConfirmar', () => {
  it('el canal de respuesta no tiene que ser el de entrada', () => {
    // PRD §4 M6, the whole point. Someone who walked to a coverage point, sent a voice note
    // and walked home is not on WhatsApp by the time we answer.
    const plan = comoConfirmar(perfil({ calidadEnlace: 0.1 }), 'whatsapp')
    expect(plan.canal).toBe('sms')
    expect(plan.unSoloSegmento).toBe(true)
  })

  it('con enlace bueno contesta por donde escribieron', () => {
    const plan = comoConfirmar(perfil({ calidadEnlace: 0.9 }), 'whatsapp')
    expect(plan.canal).toBe('whatsapp')
    expect(plan.unSoloSegmento).toBe(false)
  })

  it('sin medición y comunidad de tier bajo, contesta por SMS', () => {
    expect(comoConfirmar(perfil({ tierComunidad: 4 }), 'whatsapp').canal).toBe('sms')
    expect(comoConfirmar(perfil({ tierComunidad: 2 }), 'whatsapp').canal).toBe('whatsapp')
  })

  it('un SMS de entrada se contesta por SMS, y con un solo segmento', () => {
    const plan = comoConfirmar(perfil({ calidadEnlace: 0.9 }), 'sms')
    expect(plan.canal).toBe('sms')
    expect(plan.unSoloSegmento).toBe(true)
  })

  it('nunca contesta por `web`, que es superficie de staff', () => {
    expect(comoConfirmar(perfil({ calidadEnlace: 0.9 }), 'web').canal).toBe('whatsapp')
  })

  it('a quien está en radio le deja el aviso para que lo relaye una persona', () => {
    const plan = comoConfirmar(perfil({ canalPreferido: 'radio' }), 'whatsapp')
    expect(plan.canal).toBe('radio')
    expect(plan.motivo).toContain('persona')
  })
})
