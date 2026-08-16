import { describe, expect, it } from 'vitest'
import { fechaCorta, fechaHoraCorta, franjaDelDia, vencimientoAproximado } from '@/lib/fechas'

/**
 * Date rendering, in Colombian order and coarse where honesty requires it (PRD v3 D4, D5).
 * Pure and offline — the whole point is that the output does not depend on the machine's
 * locale or timezone, so it is pinned here on the América/Bogotá clock (UTC-5, no DST).
 */

describe('fechaCorta — orden colombiano dd/mm/yyyy (D4)', () => {
  it('rinde el día antes del mes, con dos dígitos', () => {
    // 2026-03-04 13:00 en Bogotá. En orden gringo esto sería «03/04».
    expect(fechaCorta(new Date('2026-03-04T18:00:00Z'))).toBe('04/03/2026')
  })

  it('no depende de la hora UTC que cruce el día', () => {
    // 2026-03-04 20:00 Bogotá — sigue siendo el 4, no el 5.
    expect(fechaCorta(new Date('2026-03-05T01:00:00Z'))).toBe('04/03/2026')
  })
})

describe('fechaHoraCorta — dd/mm/yyyy y reloj de 24 horas (D4)', () => {
  it('agrega la hora sin «p. m.»', () => {
    expect(fechaHoraCorta(new Date('2026-03-04T18:30:00Z'))).toBe('04/03/2026, 13:30')
  })
})

describe('franjaDelDia (D5)', () => {
  it('mañana, tarde y noche por la hora de Bogotá', () => {
    expect(franjaDelDia(new Date('2026-08-15T15:00:00Z'))).toBe('mañana') // 10:00
    expect(franjaDelDia(new Date('2026-08-15T21:23:00Z'))).toBe('tarde') // 16:23
    expect(franjaDelDia(new Date('2026-08-16T01:00:00Z'))).toBe('noche') // 20:00 del 15
    expect(franjaDelDia(new Date('2026-08-15T09:00:00Z'))).toBe('noche') // 04:00, antes de las 5
  })
})

describe('vencimientoAproximado — día + franja, nunca reloj (D5)', () => {
  it('«… en la tarde» para un vencimiento a las 4:23 p. m., sin minutos', () => {
    const texto = vencimientoAproximado(new Date('2026-08-15T21:23:00Z'))
    expect(texto).toMatch(/ en la tarde$/)
    // La falsa precisión que rechaza D5: ni «04:23», ni «p. m.», ni ningún reloj.
    expect(texto).not.toMatch(/\d/)
    expect(texto).not.toContain(':')
    expect(texto).not.toContain('m.')
  })
})
