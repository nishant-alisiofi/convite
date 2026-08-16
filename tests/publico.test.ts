import { describe, expect, it } from 'vitest'
import { agregarPublico, K_MINIMO_PUBLICO, type FilaPublica } from '@/lib/publico'

/**
 * Small-cell disclosure on the public page (PRD v3 D7). `agregarPublico` is pure, so the
 * suppression is pinned here rather than only walked on staging: no zone×category «en espera»
 * count below the threshold may ever appear as an exact number, single or in combination.
 */

const k = K_MINIMO_PUBLICO // 4

describe('agregarPublico — suprime celdas pequeñas (D7)', () => {
  const filas: FilaPublica[] = [
    { municipio: 'Bajo Baudó', familiaLabel: 'Salud', pendientes: 1, atendidos: 0 }, // « · 1 en espera»
    { municipio: 'Bajo Baudó', familiaLabel: 'Agua', pendientes: 10, atendidos: 2 },
    { municipio: 'Bajo Baudó', familiaLabel: 'Alimentos', pendientes: 2, atendidos: 0 },
    { municipio: 'Quibdó', familiaLabel: 'Salud', pendientes: 8, atendidos: 6 },
    { municipio: 'Quibdó', familiaLabel: 'Vacío', pendientes: 0, atendidos: 0 }, // se cae
  ]

  const { zonas, totalPendientes, totalAtendidos } = agregarPublico(filas)

  it('ninguna celda muestra un conteo exacto por debajo del umbral', () => {
    for (const zona of zonas) {
      for (const celda of zona.items) {
        // Un texto de conteo o es 0, o es «menos de k», o es un número ≥ k. Nunca 1..k-1.
        for (const texto of [celda.pendientesTexto, celda.atendidosTexto]) {
          const n = Number(texto)
          if (!Number.isNaN(n)) expect(n === 0 || n >= k).toBe(true)
        }
      }
    }
  })

  it('las celdas pequeñas se van a una fila «Otras» y se ocultan por categoría', () => {
    const bajoBaudo = zonas.find((z) => z.municipio === 'Bajo Baudó')!
    // Salud(1) y Alimentos(2) desaparecen como categorías propias.
    expect(bajoBaudo.items.some((c) => c.familiaLabel === 'Salud')).toBe(false)
    expect(bajoBaudo.items.some((c) => c.familiaLabel === 'Alimentos')).toBe(false)
    // Agua(10) sí se muestra; su atendidos=2 se rinde grueso, no como «2».
    const agua = bajoBaudo.items.find((c) => c.familiaLabel === 'Agua')!
    expect(agua.pendientesTexto).toBe('10')
    expect(agua.atendidosTexto).toBe(`menos de ${k}`)
    // Otras junta 1+2 = 3 pendientes, que sigue < k, así que se rinde grueso.
    const otras = bajoBaudo.items.find((c) => c.esOtras)!
    expect(otras.pendientes).toBe(3)
    expect(otras.pendientesTexto).toBe(`menos de ${k}`)
  })

  it('una celda sana (≥ k) se muestra tal cual', () => {
    const quibdo = zonas.find((z) => z.municipio === 'Quibdó')!
    const salud = quibdo.items.find((c) => c.familiaLabel === 'Salud')!
    expect(salud.pendientesTexto).toBe('8')
    expect(salud.atendidosTexto).toBe('6')
    expect(quibdo.items.some((c) => c.esOtras)).toBe(false)
  })

  it('los totales son las sumas reales (un agregado del territorio no identifica a nadie)', () => {
    expect(totalPendientes).toBe(21)
    expect(totalAtendidos).toBe(8)
  })

  it('una única categoría pequeña también se oculta y se rinde gruesa', () => {
    const solo = agregarPublico([
      { municipio: 'Nóvita', familiaLabel: 'Salud', pendientes: 1, atendidos: 0 },
    ])
    const zona = solo.zonas[0]!
    expect(zona.items).toHaveLength(1)
    expect(zona.items[0]!.esOtras).toBe(true)
    expect(zona.items[0]!.pendientesTexto).toBe(`menos de ${k}`)
  })
})
