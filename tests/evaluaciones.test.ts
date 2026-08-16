import { describe, expect, it } from 'vitest'
import {
  type Bom,
  cobertura,
  costoFundableCop,
  estadoReparacion,
  estaVencida,
  factorSeveridad,
  type FilaCobertura,
  fondosAplicadosCop,
  generarBom,
  saldoFundableCop,
} from '@/lib/evaluaciones'

/**
 * PRD-29 — the Level 2 costing and Level 4 coverage arithmetic the panel depends on, proven
 * without a database. The RLS floor, the audit trigger and the derivación invariant live in SQL
 * and are proven against the real database in tests/*.db.test.ts; these are the pure rules on top.
 */

const BASELINE = {
  materialesCop: 1_000_000,
  transporteCop: 300_000,
  asistenciaTecnicaCop: 200_000,
  manoDeObraDias: 10,
}

describe('factorSeveridad', () => {
  it('is the severity-2 baseline at severity 2, lighter at 1, heavier at 3', () => {
    expect(factorSeveridad(1)).toBe(0.5)
    expect(factorSeveridad(2)).toBe(1)
    expect(factorSeveridad(3)).toBe(1.5)
  })

  it('treats an unknown or missing severity as the reference (factor 1)', () => {
    expect(factorSeveridad(null)).toBe(1)
    expect(factorSeveridad(7)).toBe(1)
  })
})

describe('generarBom', () => {
  it('proposes the template baseline unchanged at severity 2', () => {
    expect(generarBom(BASELINE, 2)).toEqual({
      materialesCop: 1_000_000,
      transporteCop: 300_000,
      asistenciaTecnicaCop: 200_000,
      manoDeObraDias: 10,
    })
  })

  it('scales down at severity 1 and up at severity 3', () => {
    expect(generarBom(BASELINE, 1)).toEqual({
      materialesCop: 500_000,
      transporteCop: 150_000,
      asistenciaTecnicaCop: 100_000,
      manoDeObraDias: 5,
    })
    expect(generarBom(BASELINE, 3)).toEqual({
      materialesCop: 1_500_000,
      transporteCop: 450_000,
      asistenciaTecnicaCop: 300_000,
      manoDeObraDias: 15,
    })
  })

  it('rounds COP to the nearest thousand pesos and days to a whole day', () => {
    const bom = generarBom({ materialesCop: 333, transporteCop: 0, asistenciaTecnicaCop: 0, manoDeObraDias: 3 }, 1)
    expect(bom.materialesCop % 1000).toBe(0)
    expect(Number.isInteger(bom.manoDeObraDias)).toBe(true)
  })

  it('never proposes a negative amount', () => {
    const bom = generarBom({ materialesCop: 0, transporteCop: 0, asistenciaTecnicaCop: 0, manoDeObraDias: 0 }, 3)
    expect(bom.materialesCop).toBe(0)
    expect(bom.manoDeObraDias).toBe(0)
  })
})

function bom(over: Partial<Bom> = {}): Bom {
  return {
    id: 'b',
    hallazgoId: 'h',
    origen: 'manual',
    plantillaId: null,
    materialesCop: 1_000_000,
    transporteCop: 300_000,
    asistenciaTecnicaCop: 200_000,
    manoDeObraDias: 10,
    materialesCubiertoCop: 0,
    transporteCubiertoCop: 0,
    asistenciaTecnicaCubiertoCop: 0,
    manoDeObraCubiertaDias: 0,
    actualizadoEn: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }
}

describe('costoFundableCop', () => {
  it('is the sum of the three COP components, never the labour days', () => {
    // AC #7: mano de obra local is a supply side, not a cost line, so it is not in the fundable sum.
    expect(costoFundableCop(bom())).toBe(1_500_000)
  })
})

describe('saldoFundableCop', () => {
  it('is the fundable cost minus what is already covered', () => {
    expect(
      saldoFundableCop(bom({ materialesCubiertoCop: 400_000, transporteCubiertoCop: 100_000 })),
    ).toBe(1_000_000)
  })

  it('never goes negative even if covered exceeds required', () => {
    expect(
      saldoFundableCop(
        bom({ materialesCubiertoCop: 9_000_000, transporteCubiertoCop: 9_000_000, asistenciaTecnicaCubiertoCop: 9_000_000 }),
      ),
    ).toBe(0)
  })

  it('fondosAplicadosCop counts only the three COP components', () => {
    expect(
      fondosAplicadosCop(bom({ materialesCubiertoCop: 10_000, transporteCubiertoCop: 20_000, asistenciaTecnicaCubiertoCop: 30_000 })),
    ).toBe(60_000)
  })
})

describe('estadoReparacion (four-component match, AC #4)', () => {
  it('marks a repair complete only when all four components are covered', () => {
    const completo = estadoReparacion(
      bom({
        materialesCubiertoCop: 1_000_000,
        transporteCubiertoCop: 300_000,
        asistenciaTecnicaCubiertoCop: 200_000,
        manoDeObraCubiertaDias: 10,
      }),
    )
    expect(completo.completo).toBe(true)
    expect(completo.faltantes).toEqual([])
  })

  it('names every unmet component — the labels that feed the Bandeja stuck-states', () => {
    const parcial = estadoReparacion(
      bom({ materialesCubiertoCop: 1_000_000, transporteCubiertoCop: 300_000, asistenciaTecnicaCubiertoCop: 200_000 }),
    )
    expect(parcial.completo).toBe(false)
    expect(parcial.faltantes).toEqual(['mano de obra'])
    expect(parcial.manoDeObra.faltante).toBe(10)
  })

  it('models mano de obra as a supply match in days', () => {
    const e = estadoReparacion(bom({ manoDeObraCubiertaDias: 4 }))
    expect(e.manoDeObra.requerido).toBe(10)
    expect(e.manoDeObra.cubierto).toBe(4)
    expect(e.manoDeObra.faltante).toBe(6)
  })
})

describe('estaVencida (Level 3 expiry, AC #2)', () => {
  const ahora = new Date('2026-08-16T12:00:00Z')
  it('is not expired without an expiry date', () => {
    expect(estaVencida(null, ahora)).toBe(false)
  })
  it('is expired when the expiry is before today', () => {
    expect(estaVencida('2026-08-15', ahora)).toBe(true)
  })
  it('is not yet expired when the expiry is in the future', () => {
    expect(estaVencida('2026-12-01', ahora)).toBe(false)
  })
})

describe('cobertura (Level 4, AC #3)', () => {
  const ahora = new Date('2026-08-16T12:00:00Z')

  function fila(over: Partial<FilaCobertura> = {}): FilaCobertura {
    return {
      comunidadId: 'c1',
      comunidadNombre: 'Guayabal',
      municipio: 'Timbiquí',
      dominio: 'vivienda',
      fechaVisita: '2026-08-01',
      totalEstimado: 100,
      evaluados: 40,
      venceEn: null,
      ...over,
    }
  }

  it('reports assessed out of estimated total with its date, per vereda and domain', () => {
    const cob = cobertura([fila()], ahora)
    expect(cob.veredas).toHaveLength(1)
    expect(cob.veredas[0]).toMatchObject({
      comunidadNombre: 'Guayabal',
      dominio: 'vivienda',
      evaluados: 40,
      totalEstimado: 100,
      porcentaje: 40,
      fecha: '2026-08-01',
    })
  })

  it('uses the latest sweep for a (community, domain), not the sum across visits', () => {
    const cob = cobertura(
      [
        fila({ fechaVisita: '2026-06-01', evaluados: 20, totalEstimado: 100 }),
        fila({ fechaVisita: '2026-08-01', evaluados: 55, totalEstimado: 100 }),
      ],
      ahora,
    )
    expect(cob.veredas).toHaveLength(1)
    expect(cob.veredas[0]!.evaluados).toBe(55)
    expect(cob.veredas[0]!.fecha).toBe('2026-08-01')
  })

  it('keeps housing and water coverage as separate claims for the same vereda', () => {
    const cob = cobertura(
      [
        fila({ dominio: 'vivienda', evaluados: 40, totalEstimado: 100 }),
        fila({ dominio: 'agua', evaluados: 10, totalEstimado: 20 }),
      ],
      ahora,
    )
    expect(cob.veredas).toHaveLength(2)
  })

  it('rolls up to the municipality across its assessed communities', () => {
    const cob = cobertura(
      [
        fila({ comunidadId: 'c1', comunidadNombre: 'Guayabal', evaluados: 40, totalEstimado: 100 }),
        fila({ comunidadId: 'c2', comunidadNombre: 'Cheté', evaluados: 20, totalEstimado: 50 }),
      ],
      ahora,
    )
    expect(cob.municipios).toHaveLength(1)
    expect(cob.municipios[0]).toMatchObject({
      municipio: 'Timbiquí',
      evaluados: 60,
      totalEstimado: 150,
      porcentaje: 40,
    })
  })

  it('flags an expired sweep in the coverage row', () => {
    const cob = cobertura([fila({ venceEn: '2026-08-10' })], ahora)
    expect(cob.veredas[0]!.vencida).toBe(true)
  })
})
