import { describe, expect, it } from 'vitest'
import { esModoFluvial } from '@/lib/lanchero-pagos'

/**
 * FR-46 regression: the boat-leg cost/pay UI was gated on the literal `'lancha'`, but seed
 * shipments and the transporter self-signup form (FR-18) both use `'chalupa'` — a river-boat
 * mode too (`MODOS_FLUVIALES`, db/schema/vocabulario.ts) — so a chalupa leg could never surface
 * a cost or a lanchero payment. `esModoFluvial` is the single guard every gate now shares.
 */
describe('esModoFluvial — FR-46 el costo y pago del lanchero aplica a lancha y a chalupa', () => {
  it('reconoce ambos modos fluviales', () => {
    expect(esModoFluvial('lancha')).toBe(true)
    expect(esModoFluvial('chalupa')).toBe(true)
  })

  it('rechaza los modos terrestres y el aéreo', () => {
    expect(esModoFluvial('carretera')).toBe(false)
    expect(esModoFluvial('trocha')).toBe(false)
    expect(esModoFluvial('avioneta')).toBe(false)
  })

  it('es honesto ante null/undefined — sin capacidad asignada no hay modo que leer', () => {
    expect(esModoFluvial(null)).toBe(false)
    expect(esModoFluvial(undefined)).toBe(false)
  })
})
