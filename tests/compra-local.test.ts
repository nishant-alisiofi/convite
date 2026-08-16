import { describe, expect, it } from 'vitest'
import {
  CADENA_COMPRA_LOCAL,
  esTerminal,
  PASO_COMPRA_LOCAL,
  pasosCompletados,
  REQUISITO_COMPRA_LOCAL,
  siguienteEstado,
  transicionValida,
} from '@/lib/compra-local/estados'
import { ESTADOS_COMPRA_LOCAL } from '@/db/schema/compra-local'

/**
 * PRD-9 acceptance for the six-step traceability chain (§24/§30). Pure — the chain is a state
 * machine the panel and the database both mirror, and here it is pinned down without Postgres.
 */

describe('la cadena de trazabilidad de una compra local', () => {
  it('tiene los cinco estados en orden, más la cancelación aparte', () => {
    expect(CADENA_COMPRA_LOCAL).toEqual([
      'AUTORIZADA',
      'COMPRADA',
      'VERIFICADA',
      'DISTRIBUIDA',
      'CERRADA',
    ])
    // CANCELADA existe como estado, pero no es parte de la cadena hacia adelante.
    expect(ESTADOS_COMPRA_LOCAL).toContain('CANCELADA')
    expect(CADENA_COMPRA_LOCAL).not.toContain('CANCELADA')
  })

  it('nombra los seis pasos del §24 en español, sin jerga', () => {
    // autorización → responsable (dentro de AUTORIZADA) → recibo → verificación → distribución →
    // evidencia. Cada estado tiene su rótulo legible.
    for (const estado of ESTADOS_COMPRA_LOCAL) {
      expect(PASO_COMPRA_LOCAL[estado]).toBeTruthy()
      expect(PASO_COMPRA_LOCAL[estado]).not.toMatch(/AUTORIZADA|COMPRADA|null|undefined/)
    }
    expect(PASO_COMPRA_LOCAL.COMPRADA).toContain('Recibo')
    expect(PASO_COMPRA_LOCAL.VERIFICADA).toContain('Verificación')
    expect(PASO_COMPRA_LOCAL.DISTRIBUIDA).toContain('Distribución')
    expect(PASO_COMPRA_LOCAL.CERRADA).toContain('Evidencia')
  })

  it('avanza exactamente un paso a la vez', () => {
    expect(siguienteEstado('AUTORIZADA')).toBe('COMPRADA')
    expect(siguienteEstado('COMPRADA')).toBe('VERIFICADA')
    expect(siguienteEstado('VERIFICADA')).toBe('DISTRIBUIDA')
    expect(siguienteEstado('DISTRIBUIDA')).toBe('CERRADA')
    expect(siguienteEstado('CERRADA')).toBeNull()
    expect(siguienteEstado('CANCELADA')).toBeNull()
  })

  it('permite el paso siguiente y la cancelación, y nada más', () => {
    expect(transicionValida('AUTORIZADA', 'COMPRADA')).toBe(true)
    expect(transicionValida('COMPRADA', 'VERIFICADA')).toBe(true)
    expect(transicionValida('VERIFICADA', 'DISTRIBUIDA')).toBe(true)
    expect(transicionValida('DISTRIBUIDA', 'CERRADA')).toBe(true)
    // Cancelar es válido desde cualquier estado vivo.
    expect(transicionValida('AUTORIZADA', 'CANCELADA')).toBe(true)
    expect(transicionValida('DISTRIBUIDA', 'CANCELADA')).toBe(true)
  })

  it('no deja saltarse un paso: no se distribuye lo que no se compró ni verificó', () => {
    expect(transicionValida('AUTORIZADA', 'VERIFICADA')).toBe(false)
    expect(transicionValida('AUTORIZADA', 'DISTRIBUIDA')).toBe(false)
    expect(transicionValida('AUTORIZADA', 'CERRADA')).toBe(false)
    expect(transicionValida('COMPRADA', 'DISTRIBUIDA')).toBe(false)
    expect(transicionValida('COMPRADA', 'CERRADA')).toBe(false)
    expect(transicionValida('VERIFICADA', 'CERRADA')).toBe(false)
  })

  it('no retrocede ni revive un estado terminal', () => {
    expect(transicionValida('COMPRADA', 'AUTORIZADA')).toBe(false)
    expect(transicionValida('DISTRIBUIDA', 'COMPRADA')).toBe(false)
    expect(transicionValida('CERRADA', 'DISTRIBUIDA')).toBe(false)
    expect(transicionValida('CERRADA', 'CANCELADA')).toBe(false)
    expect(transicionValida('CANCELADA', 'AUTORIZADA')).toBe(false)
    // Una transición a sí mismo no es un avance.
    expect(transicionValida('COMPRADA', 'COMPRADA')).toBe(false)
  })

  it('reconoce los estados terminales', () => {
    expect(esTerminal('CERRADA')).toBe(true)
    expect(esTerminal('CANCELADA')).toBe(true)
    expect(esTerminal('AUTORIZADA')).toBe(false)
    expect(esTerminal('DISTRIBUIDA')).toBe(false)
  })

  it('lista los pasos completados para el rastro visible', () => {
    expect(pasosCompletados('AUTORIZADA')).toEqual(['AUTORIZADA'])
    expect(pasosCompletados('VERIFICADA')).toEqual(['AUTORIZADA', 'COMPRADA', 'VERIFICADA'])
    expect(pasosCompletados('CERRADA')).toEqual([
      'AUTORIZADA',
      'COMPRADA',
      'VERIFICADA',
      'DISTRIBUIDA',
      'CERRADA',
    ])
    // Una compra cancelada solo alcanzó a autorizarse.
    expect(pasosCompletados('CANCELADA')).toEqual(['AUTORIZADA'])
  })

  it('cada paso más allá de la autorización nombra la evidencia que pide', () => {
    expect(REQUISITO_COMPRA_LOCAL.AUTORIZADA).toBeNull()
    expect(REQUISITO_COMPRA_LOCAL.COMPRADA).toContain('recibo')
    expect(REQUISITO_COMPRA_LOCAL.VERIFICADA).toContain('verific')
    expect(REQUISITO_COMPRA_LOCAL.DISTRIBUIDA).toContain('distribu')
    expect(REQUISITO_COMPRA_LOCAL.CERRADA).toContain('evidencia')
  })
})
