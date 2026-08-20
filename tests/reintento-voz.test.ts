import { describe, expect, it } from 'vitest'
import {
  COPIA,
  dentroDeTtl,
  ESPERA_CONFIRMAR_CALLBACK_SEG,
  ESPERA_REINTENTO_SMS_MIN,
  segmentar,
  TTL_CALLBACK_HORAS,
} from '@/lib/canales'

/**
 * The Adaptive Retry Protocol (PRD-15, Supplement v4 §6.1) — the pure decisions, with no
 * database and no provider. `dentroDeTtl` is the whole gate between "retry once via SMS"
 * and "abandon, wait for the next inbound signal" (§6.1's own words), so it is pinned at its
 * boundary rather than trusted to read correctly from the constant.
 */

describe('el TTL de la devolución (§6.1)', () => {
  const ORIGEN = new Date('2026-08-14T15:00:00Z')

  it('son 2 horas, verbatim', () => {
    expect(TTL_CALLBACK_HORAS).toBe(2)
  })

  it('permite el reintento un instante antes de las 2 horas', () => {
    const ahora = new Date(ORIGEN.getTime() + TTL_CALLBACK_HORAS * 3_600_000 - 1)
    expect(dentroDeTtl(ORIGEN, ahora)).toBe(true)
  })

  it('permite el reintento justo a las 2 horas', () => {
    const ahora = new Date(ORIGEN.getTime() + TTL_CALLBACK_HORAS * 3_600_000)
    expect(dentroDeTtl(ORIGEN, ahora)).toBe(true)
  })

  it('abandona un instante después de las 2 horas', () => {
    const ahora = new Date(ORIGEN.getTime() + TTL_CALLBACK_HORAS * 3_600_000 + 1)
    expect(dentroDeTtl(ORIGEN, ahora)).toBe(false)
  })

  it('abandona claramente una devolución de horas después', () => {
    // §6.1's own example: a delayed callback ringing hours after the person moved out of
    // coverage. Three hours out is not a boundary case, it should read as obviously stale.
    const ahora = new Date(ORIGEN.getTime() + 3 * 3_600_000)
    expect(dentroDeTtl(ORIGEN, ahora)).toBe(false)
  })
})

describe('los tiempos del protocolo, verbatim §6.1', () => {
  it('espera 5 minutos antes del SMS, nunca una segunda llamada inmediata', () => {
    expect(ESPERA_REINTENTO_SMS_MIN).toBe(5)
  })

  it('el aviso de "no contestó" corre antes que el reintento de SMS', () => {
    // The timeout that decides a callback never connected has to fire, and its own 5-minute
    // wait has to elapse, before the SMS could possibly go out at minute 5 as promised.
    expect(ESPERA_CONFIRMAR_CALLBACK_SEG).toBeLessThan(ESPERA_REINTENTO_SMS_MIN * 60)
  })
})

describe('la copia del reintento cabe en un segmento', () => {
  it('el mensaje de reintento por SMS no se parte en dos', () => {
    const medida = segmentar(COPIA.reintentoLlamada)
    expect(medida.cabeEnUno, `${COPIA.reintentoLlamada} → ${medida.unidades} ${medida.alfabeto}`).toBe(
      true,
    )
  })

  it('no repite el menú: pide lo más simple posible', () => {
    expect(COPIA.reintentoLlamada).not.toMatch(/marque/)
  })
})
