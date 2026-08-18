import { describe, expect, it } from 'vitest'
import {
  clasificarCaducidad,
  DIAS_VENTANA_CADUCIDAD,
  ordenarPorCaducidad,
} from '@/lib/inventario/lotes'

/**
 * FR-43 acceptance for the pure expiry classification — pure so the "sin fecha never becomes a
 * guess" and "soonest first" rules are pinned down without Postgres.
 */

const HOY = new Date('2026-08-18T12:00:00Z')
const dias = (n: number) => new Date(HOY.getTime() + n * 86_400_000)

describe('clasificarCaducidad', () => {
  it('sin fecha es un estado propio, nunca una fecha inventada (2.3, BUG-23)', () => {
    expect(clasificarCaducidad(null, HOY)).toBe('sinFecha')
  })

  it('una fecha ya pasada es vencido', () => {
    expect(clasificarCaducidad(dias(-1), HOY)).toBe('vencido')
    expect(clasificarCaducidad(dias(-30), HOY)).toBe('vencido')
  })

  it('la fecha de hoy todavía no venció — cuenta como próximo, no vencido', () => {
    expect(clasificarCaducidad(dias(0), HOY)).toBe('proximo')
  })

  it('dentro de la ventana configurable es próximo, inclusive en el borde', () => {
    expect(clasificarCaducidad(dias(1), HOY)).toBe('proximo')
    expect(clasificarCaducidad(dias(DIAS_VENTANA_CADUCIDAD), HOY)).toBe('proximo')
  })

  it('más allá de la ventana es vigente', () => {
    expect(clasificarCaducidad(dias(DIAS_VENTANA_CADUCIDAD + 1), HOY)).toBe('vigente')
    expect(clasificarCaducidad(dias(90), HOY)).toBe('vigente')
  })

  it('respeta una ventana distinta cuando se pasa explícita', () => {
    expect(clasificarCaducidad(dias(10), HOY, 14)).toBe('proximo')
    expect(clasificarCaducidad(dias(10), HOY, 3)).toBe('vigente')
  })
})

describe('ordenarPorCaducidad', () => {
  it('ordena por la fecha más próxima primero', () => {
    const lotes = [
      { id: 'lejos', fechaCaducidad: dias(90) },
      { id: 'vencido', fechaCaducidad: dias(-3) },
      { id: 'pronto', fechaCaducidad: dias(2) },
    ]
    expect(ordenarPorCaducidad(lotes).map((l) => l.id)).toEqual(['vencido', 'pronto', 'lejos'])
  })

  it('manda al final los lotes sin fecha — no son "los más seguros"', () => {
    const lotes = [
      { id: 'sin-fecha', fechaCaducidad: null },
      { id: 'vencido', fechaCaducidad: dias(-1) },
    ]
    expect(ordenarPorCaducidad(lotes).map((l) => l.id)).toEqual(['vencido', 'sin-fecha'])
  })

  it('no muta el arreglo original', () => {
    const lotes = [{ id: 'a', fechaCaducidad: dias(5) }, { id: 'b', fechaCaducidad: dias(1) }]
    const copia = [...lotes]
    ordenarPorCaducidad(lotes)
    expect(lotes).toEqual(copia)
  })
})
