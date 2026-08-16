import { describe, expect, it } from 'vitest'
import {
  alcancesDeComunidades,
  type ApadrinamientoPrograma,
  calcularFeasibilidad,
  ocurreEnMes,
  resumenPadrinazgo,
  resumenPresupuesto,
  temporadaDeMes,
  ventana,
} from '@/lib/programas'

/**
 * PRD-31 — the arithmetic and the seasonal-feasibility logic the programas panel depends on,
 * proven without a database. The RLS floor, the audit trigger and the consent invariant live in
 * SQL and are proven against the real database in tests/*.db.test.ts; these are the pure rules on
 * top: budget/sponsorship rollups (AC2/AC5) and the twelve-month calendar (AC3).
 */

describe('presupuesto del programa (AC2)', () => {
  it('restante es comprometido menos aplicado', () => {
    expect(resumenPresupuesto(1_000_000, 300_000)).toEqual({
      comprometidoCop: 1_000_000,
      aplicadoCop: 300_000,
      restanteCop: 700_000,
    })
  })

  it('nunca reporta un restante negativo', () => {
    expect(resumenPresupuesto(500_000, 800_000).restanteCop).toBe(0)
  })
})

function padrinazgo(over: Partial<ApadrinamientoPrograma> = {}): ApadrinamientoPrograma {
  return {
    id: 'a',
    etiqueta: 'el banco de medicamentos',
    padrinoNombre: 'Una fundación',
    padrinoTipo: 'organizacion',
    montoCop: 0,
    recurrencia: 'unico',
    estado: 'activo',
    consentimiento: false,
    aplicadoCop: 0,
    disponibleCop: 0,
    creadoEn: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }
}

describe('financiación del programa (AC5)', () => {
  it('suma solo los apadrinamientos activos', () => {
    const r = resumenPadrinazgo([
      padrinazgo({ id: '1', montoCop: 600_000, aplicadoCop: 200_000 }),
      padrinazgo({ id: '2', montoCop: 400_000, aplicadoCop: 0, estado: 'pausado' }),
      padrinazgo({ id: '3', montoCop: 500_000, aplicadoCop: 100_000 }),
    ])
    expect(r.comprometidoCop).toBe(1_100_000)
    expect(r.aplicadoCop).toBe(300_000)
    expect(r.disponibleCop).toBe(800_000)
    expect(r.activos).toBe(2)
  })

  it('disponible nunca es negativo', () => {
    expect(resumenPadrinazgo([padrinazgo({ montoCop: 100, aplicadoCop: 500 })]).disponibleCop).toBe(0)
  })
})

describe('temporada por mes (Chocó)', () => {
  it('la seca corre de diciembre a marzo', () => {
    expect(temporadaDeMes(11)).toBe('seca') // diciembre
    expect(temporadaDeMes(0)).toBe('seca') // enero
    expect(temporadaDeMes(2)).toBe('seca') // marzo
  })
  it('el resto del año son lluvias', () => {
    expect(temporadaDeMes(3)).toBe('lluvias') // abril
    expect(temporadaDeMes(7)).toBe('lluvias') // agosto
    expect(temporadaDeMes(10)).toBe('lluvias') // noviembre
  })
})

describe('cadencia → qué meses ocurre', () => {
  it('una sola vez ocurre solo el primer mes', () => {
    expect(ocurreEnMes('unico', 0)).toBe(true)
    expect(ocurreEnMes('unico', 1)).toBe(false)
  })
  it('trimestral ocurre cada tres meses', () => {
    expect([0, 1, 2, 3, 6].map((i) => ocurreEnMes('trimestral', i))).toEqual([
      true,
      false,
      false,
      true,
      true,
    ])
  })
  it('mensual y semanal ocurren todos los meses', () => {
    expect(ocurreEnMes('mensual', 5)).toBe(true)
    expect(ocurreEnMes('semanal', 9)).toBe(true)
  })
})

describe('ventana del calendario', () => {
  it('sin fechas proyecta 12 meses desde hoy', () => {
    const v = ventana(null, null, new Date('2026-06-15T00:00:00Z'))
    expect(v).toEqual({ mesInicio: 5, anioInicio: 2026, meses: 12 })
  })
  it('con fechas usa la duración', () => {
    expect(ventana('2026-01-01', '2026-12-31')).toEqual({
      mesInicio: 0,
      anioInicio: 2026,
      meses: 12,
    })
    expect(ventana('2026-01-01', '2026-03-31').meses).toBe(3)
  })
})

/** A hub, plus three target communities exercising the three cases the calendar must name. */
const HUB = 'hub'
const A = 'com-a' // reachable all year
const B = 'com-b' // reachable in lluvias; the seca leg is closed by a verified report
const C = 'com-c' // never reachable — no route at all

const RUTAS = [
  // HUB → A, open all year, $100.000
  {
    id: 'r1',
    origen_id: HUB,
    destino_id: A,
    modo: 'lancha',
    minutos: 60,
    costo_estimado_cop: 100_000,
    temporada: 'todo_el_ano',
    activa: true,
    cerrada_por_reporte: false,
  },
  // HUB → B, open in lluvias, $200.000
  {
    id: 'r2',
    origen_id: HUB,
    destino_id: B,
    modo: 'lancha',
    minutos: 120,
    costo_estimado_cop: 200_000,
    temporada: 'lluvias',
    activa: true,
    cerrada_por_reporte: false,
  },
  // HUB → B in seca exists but is closed by a verified damage report
  {
    id: 'r3',
    origen_id: HUB,
    destino_id: B,
    modo: 'lancha',
    minutos: 150,
    costo_estimado_cop: 240_000,
    temporada: 'seca',
    activa: false,
    cerrada_por_reporte: true,
  },
]

describe('alcancesDeComunidades — reachability + cost by season (AC3)', () => {
  const alcances = alcancesDeComunidades(
    [
      { comunidad_id: A, nombre: 'Aguadita' },
      { comunidad_id: B, nombre: 'Bellavista' },
      { comunidad_id: C, nombre: 'Docampadó' },
    ],
    RUTAS,
    [HUB],
  )
  const de = (id: string) => alcances.find((a) => a.comunidadId === id)!

  it('una comunidad con ruta todo el año es alcanzable en ambas temporadas', () => {
    expect(de(A).porTemporada.lluvias.alcanzable).toBe(true)
    expect(de(A).porTemporada.seca.alcanzable).toBe(true)
    expect(de(A).porTemporada.seca.costoCop).toBe(100_000)
  })

  it('una comunidad cuya única ruta de seca está cerrada queda incomunicada y se marca', () => {
    expect(de(B).porTemporada.lluvias.alcanzable).toBe(true)
    expect(de(B).porTemporada.lluvias.costoCop).toBe(200_000)
    expect(de(B).porTemporada.seca.alcanzable).toBe(false)
    expect(de(B).porTemporada.seca.rutaCerrada).toBe(true)
  })

  it('una comunidad sin ruta nunca es alcanzable, sin inventar un cierre', () => {
    expect(de(C).porTemporada.lluvias.alcanzable).toBe(false)
    expect(de(C).porTemporada.seca.alcanzable).toBe(false)
    expect(de(C).porTemporada.seca.rutaCerrada).toBe(false)
  })

  it('sin nodos de origen, nada es alcanzable', () => {
    const sin = alcancesDeComunidades([{ comunidad_id: A, nombre: 'Aguadita' }], RUTAS, [])
    expect(sin[0]!.porTemporada.lluvias.alcanzable).toBe(false)
  })
})

describe('calcularFeasibilidad — el calendario de doce meses (AC3)', () => {
  const alcances = alcancesDeComunidades(
    [
      { comunidad_id: A, nombre: 'Aguadita' },
      { comunidad_id: B, nombre: 'Bellavista' },
      { comunidad_id: C, nombre: 'Docampadó' },
    ],
    RUTAS,
    [HUB],
  )
  const f = calcularFeasibilidad(alcances, 'mensual', 0, 2026, 12)

  it('proyecta los doce meses del periodo', () => {
    expect(f.meses).toHaveLength(12)
    expect(f.meses[0]!.temporada).toBe('seca') // enero
    expect(f.meses[3]!.temporada).toBe('lluvias') // abril
  })

  it('nombra las brechas por comunidad, con rangos contiguos', () => {
    expect(f.brechas).toContain('Bellavista queda incomunicada de enero a marzo — ruta cerrada por un reporte')
    expect(f.brechas).toContain('Bellavista queda incomunicada en diciembre — ruta cerrada por un reporte')
    expect(f.brechas).toContain('Docampadó queda incomunicada todo el periodo')
    // Aguadita nunca aparece: es alcanzable todo el año.
    expect(f.brechas.some((b) => b.startsWith('Aguadita'))).toBe(false)
  })

  it('suma el costo por mes según la temporada, y el del año', () => {
    // seca: solo Aguadita ($100.000). lluvias: Aguadita + Bellavista ($300.000).
    expect(f.meses[0]!.costoMesCop).toBe(100_000)
    expect(f.meses[3]!.costoMesCop).toBe(300_000)
    // 4 meses de seca × 100.000 + 8 de lluvias × 300.000
    expect(f.costoAnioCop).toBe(2_800_000)
  })

  it('reporta el cambio de costo del segundo semestre', () => {
    // primer semestre (ene–jun) 1.200.000 → segundo (jul–dic) 1.600.000 = +33 %
    expect(f.costoSegundoSemestrePct).toBe(33)
  })

  it('lista qué comunidades no se alcanzan en un mes de jornada', () => {
    expect(f.meses[0]!.inalcanzables.sort()).toEqual(['Bellavista', 'Docampadó'])
    expect(f.meses[3]!.inalcanzables).toEqual(['Docampadó'])
  })

  it('con cadencia trimestral, los meses sin jornada no acumulan costo', () => {
    const t = calcularFeasibilidad(alcances, 'trimestral', 0, 2026, 12)
    expect(t.meses[1]!.ocurre).toBe(false)
    expect(t.meses[1]!.costoMesCop).toBe(0)
    expect(t.meses[0]!.ocurre).toBe(true)
    expect(t.meses[3]!.ocurre).toBe(true)
  })
})
