import { describe, expect, it } from 'vitest'
import {
  type Apadrinamiento,
  resumenPool,
  saldoApadrinamiento,
} from '@/lib/apadrinamiento'

/**
 * PRD-12 — the money arithmetic the panel and PRD-9 (funded local purchase) both depend on,
 * proven without a database. The RLS floor and the consent invariant live in SQL and are proven
 * against the real database in tests/*.db.test.ts; these are the pure rules on top of it.
 */

function apadrinamiento(over: Partial<Apadrinamiento> = {}): Apadrinamiento {
  return {
    id: 'a',
    beneficiarioEtiqueta: 'Partera del Atrato medio',
    comunidadId: null,
    comunidadNombre: null,
    padrinoNombre: 'Una fundación',
    padrinoTipo: 'organizacion',
    proposito: 'insumos de partería',
    recurrencia: 'unico',
    estado: 'activo',
    consentimientoBeneficiario: false,
    montoCop: 0,
    aplicadoCop: 0,
    disponibleCop: 0,
    aplicaciones: 0,
    creadoEn: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }
}

describe('saldoApadrinamiento', () => {
  it('is committed minus applied', () => {
    expect(saldoApadrinamiento({ montoCop: 500_000, aplicadoCop: 120_000 })).toBe(380_000)
  })

  it('never goes negative, even if applied somehow exceeds committed', () => {
    expect(saldoApadrinamiento({ montoCop: 100_000, aplicadoCop: 150_000 })).toBe(0)
  })

  it('is the full amount when nothing has been applied', () => {
    expect(saldoApadrinamiento({ montoCop: 250_000, aplicadoCop: 0 })).toBe(250_000)
  })
})

describe('resumenPool', () => {
  it('is all zeros with no sponsorships', () => {
    expect(resumenPool([])).toEqual({
      comprometidoCop: 0,
      aplicadoCop: 0,
      disponibleCop: 0,
      activos: 0,
    })
  })

  it('sums committed, applied and available across active sponsorships', () => {
    const pool = resumenPool([
      apadrinamiento({ montoCop: 500_000, aplicadoCop: 200_000 }),
      apadrinamiento({ montoCop: 300_000, aplicadoCop: 100_000 }),
    ])
    expect(pool).toEqual({
      comprometidoCop: 800_000,
      aplicadoCop: 300_000,
      disponibleCop: 500_000,
      activos: 2,
    })
  })

  it('ignores sponsorships that are not active — their funds are not drawable', () => {
    const pool = resumenPool([
      apadrinamiento({ montoCop: 500_000, aplicadoCop: 200_000, estado: 'activo' }),
      apadrinamiento({ montoCop: 400_000, aplicadoCop: 0, estado: 'pausado' }),
      apadrinamiento({ montoCop: 999_000, aplicadoCop: 0, estado: 'cancelado' }),
    ])
    expect(pool).toEqual({
      comprometidoCop: 500_000,
      aplicadoCop: 200_000,
      disponibleCop: 300_000,
      activos: 1,
    })
  })

  it('clamps available to zero if applied outruns committed across the pool', () => {
    const pool = resumenPool([apadrinamiento({ montoCop: 100_000, aplicadoCop: 250_000 })])
    expect(pool.disponibleCop).toBe(0)
  })
})
