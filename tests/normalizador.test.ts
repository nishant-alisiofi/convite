import { describe, expect, it } from 'vitest'
import {
  catalogoDesdeSemilla,
  extraer,
  LEXICO,
  type PropuestaExtractor,
  UMBRAL,
} from '@/lib/normalizador'

/**
 * M4, the highest-risk milestone in the project.
 *
 * Everything downstream assumes this works, and 2.12 makes the failure mode explicit:
 * **returning null must be cheaper than guessing.** So most of what is asserted here is what
 * the extractor refuses to do. The named cases come from PRD §4 M4 verbatim.
 *
 * These examples are invented. They prove the rules, not the vocabulary — real acceptance
 * needs the corpus that does not exist yet (PRD §7, and tests/corpus.test.ts).
 */

const catalogo = catalogoDesdeSemilla()
const AHORA = new Date('2026-08-14T15:00:00Z') // 10:00 in Bogotá

const leer = (texto: string | null): PropuestaExtractor => extraer(texto, { catalogo, ahora: AHORA })

describe('los casos nombrados del PRD', () => {
  it('«🍲 90» no arroja cantidad', () => {
    // 90 could be a house number, a half-remembered code, a year. Nothing beside it says
    // what is being counted, so nothing is counted.
    const p = leer('🍲 90')

    expect(p.cantidad).toBeNull()
    expect(p.unidad).toBeNull()
    expect(p.motivos.join(' ')).toContain('número')
    // The emoji is a hint and stays below threshold on its own.
    expect(p.codigoItem).toBeNull()
  })

  it('«Muchas cosas!! De todo!!!» no arroja categoría', () => {
    const p = leer('Muchas cosas!! De todo!!!')

    expect(p.codigoItem).toBeNull()
    expect(p.tipo).toBeNull()
    expect(p.confianza).toBe(0)
    expect(p.motivos.join(' ')).toContain('vago')
  })

  it('«comidas preparadas para mañana» marca perecedero y deriva vence_en', () => {
    const p = leer('comidas preparadas para mañana')

    expect(p.perecedero).toBe(true)
    expect(p.venceEn).not.toBeNull()
    // End of tomorrow in Bogotá: 2026-08-15 23:59:59 −05:00.
    expect(p.venceEn?.toISOString()).toBe('2026-08-16T04:59:59.000Z')
    // 2.15: the matcher has to know this cannot wait for next week's boat.
    expect(p.codigoItem).toBe('11')
  })

  it('un perecedero sin fecha pide la fecha en vez de inventarla', () => {
    // ofertas_perecedero_check refuses a perishable with no expiry, so this is not optional.
    const p = leer('tengo unos almuerzos listos para donar')

    expect(p.perecedero).toBe(true)
    expect(p.venceEn).toBeNull()
    expect(p.requiereDetalle).toContain('vence_en')
  })
})

describe('el catálogo manda, no el extractor', () => {
  it('propone medicamento crónico y avisa que falta el detalle', () => {
    const p = leer('necesito el remedio para la tensión')

    expect(p.codigoItem).toBe('22')
    expect(p.tipo).toBe('necesidad')
    // catalogo_items.pide_detalle: «díganos cuál». Without it a pharmacy order is a guess.
    expect(p.requiereDetalle).toContain('detalle')
  })

  it('no se aplica urgencia_min a sí mismo', () => {
    // Traslado médico is urgency 3 because the catalogue says so, and the core applies it.
    // If the extractor did it too, changing the catalogue would stop changing the answer.
    const p = leer('necesitamos un traslado para el puesto de salud')

    expect(p.codigoItem).toBe('23')
    expect(p.urgencia).toBeNull()
    expect(catalogo.get('23')?.urgenciaMin).toBe(3)
  })

  it('sí lee la urgencia que está escrita', () => {
    expect(leer('necesitamos agua potable urgente').urgencia).toBe(3)
    expect(leer('manden mercados pronto').urgencia).toBe(2)
    expect(leer('manden mercados').urgencia).toBeNull()
  })

  it('solo propone códigos que el catálogo conoce', () => {
    for (const entrada of LEXICO) {
      expect(catalogo.has(entrada.codigo), `${entrada.termino} → ${entrada.codigo}`).toBe(true)
    }
  })
})

describe('el vocabulario del Chocó', () => {
  it('«mercado» es un paquete de comida, no una plaza de mercado', () => {
    // The word a generic classifier reads as a place. PRD §4 M4 names it first.
    const p = leer('Manden mercados por favor, quedamos sin nada que cocinar')

    expect(p.codigoItem).toBe('11')
    expect(p.confianza).toBeGreaterThanOrEqual(UMBRAL)
  })

  it('«colada de plátano» y «bienestarina» son alimentación infantil', () => {
    expect(leer('mandaron colada de plátano para los pelaos').codigoItem).toBe('13')
    expect(leer('se acabó la bienestarina').codigoItem).toBe('13')
  })

  it('«pañitos» son pañales', () => {
    expect(leer('necesitamos pañitos para dos niños').codigoItem).toBe('42')
  })

  it('«toldillo» es control de vectores', () => {
    // The difference between malaria and not, and the one a bedding classifier flattens.
    expect(leer('hacen falta toldillos, hay mucho zancudo').codigoItem).toBe('31')
  })

  it('no confunde el azúcar de la comida con la diabetes', () => {
    // Bare «azúcar» is groceries; only the phrasings that mean the illness reach 22.
    expect(leer('manden arroz, panela y azúcar').codigoItem).toBe('11')
    expect(leer('las pastillas para el azúcar').codigoItem).toBe('22')
  })

  it('lee igual con o sin tildes y en mayúsculas', () => {
    const conTildes = leer('NECESITAMOS ATENCIÓN MÉDICA')
    const sinTildes = leer('necesitamos atencion medica')
    expect(conTildes.codigoItem).toBe(sinTildes.codigoItem)
    expect(conTildes.codigoItem).toBe('23')
  })

  it('cuenta familias sin confundirlas con ítems', () => {
    const p = leer('somos 12 familias sin mercado')
    expect(p.familias).toBe(12)
    expect(p.cantidad).toBeNull()
  })

  it('cuenta unidades cuando la palabra al lado dice qué se cuenta', () => {
    const p = leer('manden 20 mercados')
    expect(p.cantidad).toBe(20)
    expect(p.unidad).toBe('mercados')
  })
})

describe('nunca adivina', () => {
  const basura = [
    'qwerty zxcvb 12345',
    '...',
    '👍👍👍',
    'ok',
    'aaaa bbbb cccc',
    '99999',
    'Hola',
    '¿?',
    'xyzzy plugh frotz',
  ]

  it('con texto sin sentido no propone ninguna categoría', () => {
    for (const texto of basura) {
      const p = leer(texto)
      expect(p.codigoItem, texto).toBeNull()
      expect(p.tipo, texto).toBeNull()
      expect(p.confianza, texto).toBe(0)
    }
  })

  it('un número suelto nunca es una cantidad', () => {
    for (const texto of ['90', '12', '3 4 5', 'mande 40', '🍲 90']) {
      expect(leer(texto).cantidad, texto).toBeNull()
    }
  })

  it('cuando dos candidatos empatan, no elige', () => {
    const p = leer('manden 20 mercados y 5 toldillos')
    expect(p.codigoItem).toBeNull()
    // Both are real requests; a reporte holds one codigo_item, so a human splits them.
    expect(p.motivos.join(' ')).toContain('varios ítems')
  })

  it('lo vago le gana a una palabra fuerte', () => {
    // «mercado» alone would classify. Said together with «de todo» it is no longer a request
    // for mercados — it is somebody telling us everything is short.
    expect(leer('manden mercados').codigoItem).toBe('11')
    expect(leer('necesitamos de todo, mercados, lo que sea').codigoItem).toBeNull()
  })

  it('nunca propone una cantidad sin unidad ni una unidad sin cantidad', () => {
    for (const texto of [...basura, 'manden 20 mercados', 'somos 12 familias', '🍲 90']) {
      const p = leer(texto)
      expect(Boolean(p.cantidad) === Boolean(p.unidad), texto).toBe(true)
    }
  })
})

describe('nunca bota nada', () => {
  it('siempre devuelve una propuesta, aunque esté vacía', () => {
    for (const texto of ['', '   ', null, 'lo que sea', '🍲 90']) {
      const p = leer(texto)
      expect(p).toBeTruthy()
      expect(p.motivos.length, String(texto)).toBeGreaterThan(0)
      expect(p.versionLexico).toBeTruthy()
    }
  })

  it('explica siempre por qué quedó donde quedó', () => {
    // The audio inbox (M7) shows this to the verifier: a proposal with no reasoning is a
    // black box a human cannot check.
    expect(leer('Muchas cosas!! De todo!!!').motivos.join(' ')).toContain('vago')
    expect(leer('manden mercados').motivos.join(' ')).toContain('11')
    expect(leer('qwerty').motivos.join(' ')).toContain('ninguna palabra')
  })

  it('es determinista: el mismo texto da el mismo resultado', () => {
    const texto = 'manden 20 mercados, somos 12 familias, urgente'
    expect(JSON.stringify(leer(texto))).toBe(JSON.stringify(leer(texto)))
  })

  it('no depende del canal ni del reloj para clasificar', () => {
    // Only vence_en depends on the clock. A voice note transcript must classify exactly as
    // the same words typed by hand.
    const otro = extraer('manden 20 mercados', {
      catalogo,
      ahora: new Date('2027-01-01T00:00:00Z'),
    })
    expect(otro.codigoItem).toBe(leer('manden 20 mercados').codigoItem)
    expect(otro.cantidad).toBe(leer('manden 20 mercados').cantidad)
  })
})
