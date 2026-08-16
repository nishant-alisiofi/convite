import { describe, expect, it } from 'vitest'
import { RUTAS_SEMILLA } from '@/db/seed/rutas'
import {
  coleccionPoligono,
  coleccionRecencia,
  coleccionRutaBorrador,
} from '@/lib/mapa/planificacion-capas'
import {
  agregarSeleccion,
  capaInicialPorFase,
  costearBorrador,
  puntoEnPoligono,
  recenciaEvaluacion,
  resolverPierna,
  rutasQueSirven,
  temporadaDeFecha,
  type AristaPlan,
  type Borrador,
  type ComunidadSeleccionable,
  type NecesidadComunidad,
} from '@/lib/mapa/planificacion'

/**
 * PRD-32 — the map as a planning surface. These assert the reasoning the surface rests on,
 * on plain data, without a database or a browser: the date picks the season and the season
 * picks the route (§23.3), a damage-closed leg stays closed rather than being routed around,
 * and a selection aggregates need + coverage-with-age honestly (§23.5).
 */

/** The real seed graph, keyed by community code, as the planner reasons about it. */
const ARISTAS: AristaPlan[] = RUTAS_SEMILLA.map((r) => ({
  origenId: r.origen,
  destinoId: r.destino,
  origen: r.origen,
  destino: r.destino,
  modo: r.modo,
  minutos: r.minutos,
  costoCop: r.costoEstimadoCop,
  temporada: r.temporada,
  activa: r.activa,
  motivoCierre: null,
}))

function conCerrada(par: [string, string], motivo: string): AristaPlan[] {
  return ARISTAS.map((a) =>
    (a.origenId === par[0] && a.destinoId === par[1]) ||
    (a.origenId === par[1] && a.destinoId === par[0])
      ? { ...a, activa: false, motivoCierre: motivo }
      : a,
  )
}

const borrador = (paradas: string[], fecha: string, cupoOfrecido: number | null = null): Borrador => ({
  id: 'b1',
  nombre: 'prueba',
  fecha,
  paradas,
  cupoOfrecido,
})

describe('la fecha del borrador escoge la temporada (§23.3)', () => {
  it('los meses de aguas bajas caen en seca; el resto en lluvias', () => {
    expect(temporadaDeFecha('2026-01-15')).toBe('seca')
    expect(temporadaDeFecha('2026-03-31')).toBe('seca')
    expect(temporadaDeFecha('2026-12-25')).toBe('seca')
    expect(temporadaDeFecha('2026-04-01')).toBe('lluvias')
    expect(temporadaDeFecha('2026-10-15')).toBe('lluvias')
  })

  it('no depende de la zona horaria: un 31 de marzo es seca lo mire quien lo mire', () => {
    // Se lee el mes del texto, sin `new Date()`, para que no se corra un día.
    expect(temporadaDeFecha('2026-03-31')).toBe('seca')
  })
})

describe('el tramo se resuelve con el costo de su propia temporada (§23.3)', () => {
  it('Beté→Bellavista cuesta lo de seca en seca y lo de lluvias en lluvias', () => {
    const seca = resolverPierna(ARISTAS, 'BET', 'BLL', 'seca')
    const lluvias = resolverPierna(ARISTAS, 'BET', 'BLL', 'lluvias')
    expect(seca).toMatchObject({ estado: 'ok', minutos: 145, costoCop: 480000 })
    expect(lluvias).toMatchObject({ estado: 'ok', minutos: 110, costoCop: 420000 })
  })

  it('un borrador en octubre cuesta lo de octubre, uno en febrero lo de febrero', () => {
    const octubre = costearBorrador(borrador(['BET', 'BLL'], '2026-10-01'), ARISTAS, new Map())
    const febrero = costearBorrador(borrador(['BET', 'BLL'], '2026-02-01'), ARISTAS, new Map())
    expect(octubre).toMatchObject({ temporada: 'lluvias', minutosTotal: 110, costoTotal: 420000 })
    expect(febrero).toMatchObject({ temporada: 'seca', minutosTotal: 145, costoTotal: 480000 })
  })
})

describe('una ruta cerrada por daño queda cerrada y señalada, nunca rodeada (§23.3)', () => {
  it('el tramo cerrado se reporta cerrado con su motivo', () => {
    const aristas = conCerrada(['MER', 'TAG'], 'Palizada bloquea el paso')
    const pierna = resolverPierna(aristas, 'MER', 'TAG', 'lluvias')
    expect(pierna.estado).toBe('cerrada')
    if (pierna.estado !== 'cerrada') throw new Error('cerrada')
    expect(pierna.cierres[0]?.motivo).toBe('Palizada bloquea el paso')
  })

  it('un destino que solo se alcanza por el tramo cerrado queda cerrado, no se inventa un rodeo', () => {
    const aristas = conCerrada(['MER', 'TAG'], 'Palizada')
    const costeo = costearBorrador(borrador(['QBD', 'BLL'], '2026-10-01'), aristas, new Map())
    expect(costeo.hayCerradas).toBe(true)
    expect(costeo.minutosTotal).toBeNull()
  })

  it('sin fila para la temporada no hay ruta: Winandó en seca', () => {
    const seca = resolverPierna(ARISTAS, 'MER', 'WIN', 'seca')
    const lluvias = resolverPierna(ARISTAS, 'MER', 'WIN', 'lluvias')
    expect(seca.estado).toBe('sin_ruta')
    expect(lluvias).toMatchObject({ estado: 'ok', minutos: 25, costoCop: 90000 })
  })
})

describe('capacidad requerida contra ofrecida, con el faltante nombrado (§23.5)', () => {
  it('nombra cuántas familias faltan de cupo', () => {
    const necesidades = new Map<string, NecesidadComunidad>([
      ['TAG', { id: 'TAG', nombre: 'Tagachí', familiasPendientes: 30 }],
      ['BET', { id: 'BET', nombre: 'Beté', familiasPendientes: 25 }],
    ])
    const costeo = costearBorrador(borrador(['MER', 'TAG', 'BET'], '2026-10-01', 40), ARISTAS, necesidades)
    expect(costeo.familiasRequeridas).toBe(55)
    expect(costeo.faltante).toBe(15)
  })

  it('sin cupo ofrecido no inventa un faltante', () => {
    const costeo = costearBorrador(borrador(['MER', 'TAG'], '2026-10-01', null), ARISTAS, new Map())
    expect(costeo.faltante).toBeNull()
  })
})

describe('el panel de selección resume el área con honestidad (§23.5)', () => {
  const base = (over: Partial<ComunidadSeleccionable>): ComunidadSeleccionable => ({
    id: 'x',
    codigo: 'X',
    nombre: 'X',
    municipio: 'Quibdó',
    agrupador: 'Atrato medio',
    regionId: 'r1',
    familiasEstimadas: 100,
    tierConectividad: 2,
    verificadoEn: null,
    ultimoContacto: null,
    pendientesPorCategoria: [],
    pendientesPorEstado: [],
    ...over,
  })

  it('la cobertura es evaluadas de total, nunca un conteo pelado, y con su edad', () => {
    const ahora = '2026-08-16T00:00:00Z'
    const resumen = agregarSeleccion(
      [
        base({ id: 'a', nombre: 'A', verificadoEn: '2026-08-01T00:00:00Z' }),
        base({ id: 'b', nombre: 'B', verificadoEn: '2025-01-01T00:00:00Z' }),
        base({ id: 'c', nombre: 'C', verificadoEn: null }),
      ],
      ahora,
    )
    expect(resumen.cobertura.evaluadas).toBe(2)
    expect(resumen.cobertura.total).toBe(3)
    expect(resumen.cobertura.edadMasRecienteDias).toBe(15)
    expect(resumen.cobertura.edadMasAntiguaDias).toBeGreaterThan(365)
    expect(resumen.nuncaEvaluadas).toEqual(['C'])
  })

  it('nombra quién nunca ha hablado y suma familias y pedidos', () => {
    const resumen = agregarSeleccion([
      base({
        id: 'a',
        nombre: 'A',
        familiasEstimadas: 100,
        ultimoContacto: '2026-08-01T00:00:00Z',
        pendientesPorCategoria: [{ codigo: '11', etiqueta: 'Mercado', pedidos: 2, familias: 18 }],
        pendientesPorEstado: [{ estado: 'SIN_RUTA', pedidos: 2, familias: 18 }],
      }),
      base({
        id: 'b',
        nombre: 'B',
        familiasEstimadas: 50,
        ultimoContacto: null,
        pendientesPorCategoria: [{ codigo: '11', etiqueta: 'Mercado', pedidos: 1, familias: 6 }],
        pendientesPorEstado: [{ estado: 'SIN_RUTA', pedidos: 1, familias: 6 }],
      }),
    ])
    expect(resumen.familiasEstimadas).toBe(150)
    expect(resumen.nuncaContactadas).toEqual(['B'])
    expect(resumen.pendientesPorCategoria).toEqual([
      { codigo: '11', etiqueta: 'Mercado', pedidos: 3, familias: 24 },
    ])
    expect(resumen.pendientesPorEstado).toEqual([{ estado: 'SIN_RUTA', pedidos: 3, familias: 24 }])
  })
})

describe('recencia de evaluación — la capa que nadie más tiene (§23.4)', () => {
  it('nunca evaluada es un estado propio, no un cero viejo', () => {
    expect(recenciaEvaluacion(null)).toBe('nunca')
  })

  it('bucketiza por antigüedad', () => {
    const ahora = '2026-08-16T00:00:00Z'
    expect(recenciaEvaluacion('2026-07-01T00:00:00Z', ahora)).toBe('reciente')
    expect(recenciaEvaluacion('2026-01-01T00:00:00Z', ahora)).toBe('media')
    expect(recenciaEvaluacion('2024-01-01T00:00:00Z', ahora)).toBe('vieja')
  })
})

describe('rutas que sirven una selección (§23.5)', () => {
  it('trae los tramos que tocan el área, colapsados por par, modo y temporada', () => {
    const rutas = rutasQueSirven(ARISTAS, new Set(['BET']))
    // TAG↔BET y BET↔BLL, cada uno en lluvias y en seca = 4 filas.
    expect(rutas).toHaveLength(4)
    expect(rutas.every((r) => r.origen === 'BET' || r.destino === 'BET')).toBe(true)
  })
})

describe('selección por polígono (§23.5)', () => {
  it('un punto dentro cuenta, uno fuera no', () => {
    const cuadro: [number, number][] = [
      [-77, 5],
      [-76, 5],
      [-76, 6],
      [-77, 6],
    ]
    expect(puntoEnPoligono(-76.5, 5.5, cuadro)).toBe(true)
    expect(puntoEnPoligono(-75, 5.5, cuadro)).toBe(false)
  })
})

describe('la fase decide qué capa abre primero, nunca la estructura (§18)', () => {
  it('cada fase abre sobre su capa', () => {
    expect(capaInicialPorFase('impacto')).toBe('contacto')
    expect(capaInicialPorFase('emergencia')).toBe('pedidos')
    expect(capaInicialPorFase('recuperacion')).toBe('recencia')
    expect(capaInicialPorFase('ordinario')).toBe('conexion')
  })
})

describe('el dibujo del borrador es punteado y honesto (§23.1, 2.2)', () => {
  it('un centroide sigue siendo un círculo en la capa de recencia, nunca un punto', () => {
    const col = coleccionRecencia(
      [{ lat: 5.95, lon: -76.72, fuente: 'centroide', precisionM: 1000, nombre: 'X', verificadoEn: null }],
      '2026-08-16T00:00:00Z',
    )
    expect(col.features[0]?.geometry.type).toBe('Polygon')
    expect(col.features[0]?.properties.recencia).toBe('nunca')
  })

  it('el polígono de selección se cierra al tener tres o más vértices', () => {
    expect(coleccionPoligono([[-77, 5]]).features[0]?.geometry.type).toBe('LineString')
    expect(
      coleccionPoligono([
        [-77, 5],
        [-76, 5],
        [-76, 6],
      ]).features[0]?.geometry.type,
    ).toBe('Polygon')
  })

  it('cada pierna del borrador lleva su estado, para no dibujar como abierta una cerrada', () => {
    const paradas = [
      { id: 'MER', nombre: 'MER', lat: 5.8, lon: -76.7 },
      { id: 'TAG', nombre: 'TAG', lat: 5.85, lon: -76.72 },
    ]
    const col = coleccionRutaBorrador(paradas, [{ estado: 'cerrada', origenId: 'MER', destinoId: 'TAG', cierres: [] }])
    expect(col.features[0]?.properties.estado).toBe('cerrada')
    expect(col.features[0]?.geometry.type).toBe('LineString')
  })
})
