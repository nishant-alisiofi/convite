import { describe, expect, it } from 'vitest'
import { ordenarBandeja, rangoDe, type Rankeable } from '@/lib/bandeja/rango'

/**
 * The ordering decisions the unified Bandeja rests on. Pure, so they can be argued with here
 * rather than discovered by a coordinator working the wrong thing first.
 */

const base: Rankeable = { tipo: 'verificar', sensible: false, urgencia: 1, dias: 0 }

describe('lo sensible va primero, siempre', () => {
  it('un reporte sensible gana a cualquier urgencia ordinaria', () => {
    const sensible = { ...base, sensible: true, urgencia: 1, dias: 0 }
    const urgentisimo = { ...base, urgencia: 3, dias: 50 }
    expect(rangoDe(sensible, 'emergencia')).toBeGreaterThan(rangoDe(urgentisimo, 'emergencia'))
  })

  it('gana incluso a lo que la fase decidió liderar', () => {
    const sensible = { ...base, tipo: 'verificar' as const, sensible: true }
    const lidera = { ...base, tipo: 'atascado' as const, urgencia: 3, dias: 50 }
    expect(rangoDe(sensible, 'emergencia')).toBeGreaterThan(rangoDe(lidera, 'emergencia'))
  })
})

describe('la fase cambia qué encabeza (§18)', () => {
  const silencio: Rankeable = { tipo: 'silencio', sensible: false, urgencia: null, dias: 10, tier: 3, intervaloDias: 10 }
  const atascado: Rankeable = { tipo: 'atascado', sensible: false, urgencia: 2, dias: 3 }

  it('en impacto encabeza el silencio', () => {
    const [primero] = ordenarBandeja([atascado, silencio], 'impacto')
    expect(primero!.tipo).toBe('silencio')
  })

  it('en emergencia encabeza lo atascado', () => {
    const [primero] = ordenarBandeja([silencio, atascado], 'emergencia')
    expect(primero!.tipo).toBe('atascado')
  })
})

describe('BUG-24 no se vuelve a colapsar en la bandeja', () => {
  const nunca = (tier: number): Rankeable => ({
    tipo: 'silencio', sensible: false, urgencia: null, dias: 0, tier, nuncaVista: true,
  })

  it('una comunidad tier-1 nunca vista es contacto roto y pesa mucho más que una tier-4', () => {
    expect(rangoDe(nunca(1), 'emergencia')).toBeGreaterThan(rangoDe(nunca(4), 'emergencia'))
    expect(rangoDe(nunca(2), 'emergencia')).toBeGreaterThan(rangoDe(nunca(3), 'emergencia'))
  })
})

describe('el silencio se mide contra el intervalo propio, no en días absolutos', () => {
  it('30 días de una comunidad que se revisa cada 30 pesa menos que 5 de una que se revisa cada 3', () => {
    const mensual: Rankeable = { tipo: 'silencio', sensible: false, urgencia: null, dias: 30, tier: 4, intervaloDias: 30 }
    const frecuente: Rankeable = { tipo: 'silencio', sensible: false, urgencia: null, dias: 5, tier: 2, intervaloDias: 3 }
    expect(rangoDe(frecuente, 'emergencia')).toBeGreaterThan(rangoDe(mensual, 'emergencia'))
  })
})

describe('la edad desempata pero nunca salta de banda', () => {
  it('algo viejo y trivial no gana a algo nuevo y urgente', () => {
    const viejoTrivial = { ...base, urgencia: 1, dias: 400 }
    const nuevoUrgente = { ...base, urgencia: 3, dias: 0 }
    expect(rangoDe(nuevoUrgente, 'emergencia')).toBeGreaterThan(rangoDe(viejoTrivial, 'emergencia'))
  })

  it('a igual peso, primero lo que lleva más tiempo esperando', () => {
    expect(rangoDe({ ...base, dias: 9 }, 'emergencia')).toBeGreaterThan(rangoDe({ ...base, dias: 2 }, 'emergencia'))
  })
})
