import { describe, expect, it } from 'vitest'
import { escogerCodigo } from '@/lib/despacho/plan'

/**
 * The four digits a community reads back.
 *
 * `entregas_envio_codigo_key` makes them unique within a shipment, but `confirmarConCodigo`
 * resolves a code against the deliveries the caller's COMMUNITY is waiting for — four digits
 * dictated at a riverbank do not identify a boat. So two shipments to Tagachí in one week
 * could each draw 4139, and the second time somebody read it back the system would answer
 * `ambigua` and change nothing: the delivery stays open and looks exactly like a community
 * that never confirmed.
 *
 * Sampling cannot test the fix. With one code taken out of ten thousand, an implementation
 * that ignores the occupied set passes a random draw 99.99% of the time — so the randomness
 * is injected and the assertion is exact.
 */

describe('escoger un código de confirmación', () => {
  it('devuelve el primer código libre que sale', () => {
    expect(escogerCodigo(new Set(), () => 0.4139)).toBe('4139')
  })

  it('rellena a cuatro dígitos', () => {
    expect(escogerCodigo(new Set(), () => 0.0007)).toBe('0007')
  })

  it('descarta un código que la comunidad ya tiene abierto', () => {
    const salidas = [0.4139, 0.4139, 0.7926]
    let i = 0
    // Las dos primeras tiradas dan un código ocupado. Sin la exclusión, se repartiría igual.
    expect(escogerCodigo(new Set(['4139']), () => salidas[i++]!)).toBe('7926')
  })

  it('no se queda dando vueltas cuando queda un solo hueco', () => {
    const ocupados = new Set(
      Array.from({ length: 10_000 }, (_, n) => String(n).padStart(4, '0')),
    )
    ocupados.delete('5555')

    // Siempre saca el mismo código ocupado: el sorteo nunca acertaría.
    expect(escogerCodigo(ocupados, () => 0.4139)).toBe('5555')
  })

  it('se rinde con un error en vez de colgar un despacho', () => {
    const todos = new Set(Array.from({ length: 10_000 }, (_, n) => String(n).padStart(4, '0')))
    expect(() => escogerCodigo(todos, () => 0.1)).toThrow(/libres/)
  })
})
