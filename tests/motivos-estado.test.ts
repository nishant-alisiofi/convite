import { describe, expect, it } from 'vitest'
import { motivoEnCamino } from '@/lib/matching/motivos'

/**
 * The EN_CAMINO sentence (PRD v3 D1). The bug was that a dispatched request kept the LISTO
 * motivo «Confirme para despachar»; the en-camino sentence has to be its own phone call.
 */
describe('motivoEnCamino (D1)', () => {
  it('describe el envío en camino y no arrastra el texto de LISTO', () => {
    const motivo = motivoEnCamino({
      comunidad: 'Paimadó',
      familias: 12,
      itemLabel: 'Agua potable',
      transportista: 'don Efraín',
      salida: new Date('2026-08-13T15:00:00Z'),
    })
    expect(motivo).toContain('Ya salió para Paimadó')
    expect(motivo).toContain('12 familias')
    expect(motivo).toContain('con don Efraín')
    expect(motivo).not.toContain('Confirme para despachar')
  })

  it('funciona para una sola familia y sin transportista ni fecha', () => {
    const motivo = motivoEnCamino({
      comunidad: 'Boca de Apartadó',
      familias: 1,
      itemLabel: 'Kit de aseo',
      transportista: null,
      salida: null,
    })
    expect(motivo).toContain('1 familia ')
    expect(motivo).not.toContain('familias')
    expect(motivo).not.toContain(' con ')
    expect(motivo).not.toContain('Salió el')
  })
})
