import { describe, expect, it } from 'vitest'
import {
  type PropuestaAnticipada,
  type SuministroAnticipado,
  proximoVencimiento,
  resolverAnticipado,
} from '@/lib/matching/anticipado'
import { resolver } from '@/lib/matching/resolver'
import {
  DIAS_PARA_CONTEO_VIEJO,
  HORIZONTE_DIAS_POR_DEFECTO,
  RADIO_RECOGIDA_M,
  type ContextoEmparejamiento,
  type PedidoAResolver,
  type RequisitoAlmacenamiento,
} from '@/lib/matching/tipos'
import { AHORA, enDias, haceDias } from './fixtures/cuenca'

/**
 * PRD-33 §24. No database anywhere — the resolver is a pure function over a snapshot, so cold
 * chain is as cheap to pin down as the five reactive states, and the anticipatory resolver the
 * same. Two communities, one node: enough to prove the matcher refuses a route that cannot keep
 * insulin cold and proposes a refill before it runs out.
 */

// Insulin: needs the cold chain, tolerates two hours out of refrigeration. The «six-hour open
// boat» of §24 is anything longer, or any leg not fit to carry it at all.
const INSULINA: RequisitoAlmacenamiento = {
  cadenaFrio: true,
  sensibleLuz: false,
  maxMinutosTransito: 120,
}

type Opciones = {
  rutaApta: boolean
  rutaMinutos: number
  nodoGuarda: boolean
}

/**
 * A→B by boat, a node at A holding 50 doses, and one boat leaving for B in three days. Whether
 * the boat can keep insulin cold, how long the leg is, and whether the node has cold storage are
 * the three things the tests vary.
 */
function escenario({ rutaApta, rutaMinutos, nodoGuarda }: Opciones): ContextoEmparejamiento {
  return {
    temporada: 'lluvias',
    ahora: AHORA,
    horizonteDias: HORIZONTE_DIAS_POR_DEFECTO,
    diasParaConteoViejo: DIAS_PARA_CONTEO_VIEJO,
    radioRecogidaM: RADIO_RECOGIDA_M,
    rutas: [
      {
        id: 'A-B',
        origenId: 'A',
        destinoId: 'B',
        modo: 'lancha',
        minutos: rutaMinutos,
        temporada: 'todo_el_ano',
        activa: true,
        aptaCadenaFrio: rutaApta,
      },
    ],
    nodos: [
      {
        id: 'N-A',
        nombre: 'Bodega A',
        comunidadId: 'A',
        activo: true,
        lat: null,
        lon: null,
        aptaCadenaFrio: nodoGuarda,
      },
    ],
    existencias: [{ nodoId: 'N-A', codigoItem: '29', cantidad: 50, contadoEn: haceDias(2) }],
    ofertas: [],
    capacidades: [
      {
        id: 'cap-1',
        contactoNombre: 'Aníbal Córdoba',
        modo: 'lancha',
        origenNodoId: 'N-A',
        hastaComunidadId: 'B',
        saleEn: enDias(3),
        cupoFamilias: 50,
        estado: 'OFRECIDA',
      },
    ],
    nombresComunidad: new Map([
      ['A', 'Aldea A'],
      ['B', 'Aldea B'],
    ]),
  }
}

function pedido(requisito: RequisitoAlmacenamiento | null): PedidoAResolver {
  return {
    id: 'p1',
    comunidadId: 'B',
    codigoItem: '29',
    itemLabel: 'insulina',
    unidadSingular: 'dosis',
    unidadPlural: 'dosis',
    entregable: true,
    familias: 5,
    urgencia: 3,
    requisitoAlmacenamiento: requisito,
  }
}

describe('la cadena de frío excluye rutas inválidas (PRD-33 §24)', () => {
  it('REQUISITO: la insulina no viaja por una lancha abierta no apta', () => {
    // La única ruta a B es apta para todo lo demás, pero no conserva la cadena de frío.
    const ctx = escenario({ rutaApta: false, rutaMinutos: 60, nodoGuarda: true })

    const veredicto = resolver(pedido(INSULINA), ctx)

    // Ni LISTO ni SIN_CAPACIDAD sobre una ruta inválida: un estado propio que lo dice.
    expect(veredicto.estado).toBe('SIN_RUTA')
    expect(veredicto.cadenaFrioBloqueada).toBe(true)
    expect(veredicto.capacidadId).toBeUndefined()
    expect(veredicto.motivo).toContain('cadena de frío')
  })

  it('REQUISITO: la insulina no viaja por una ruta demasiado larga', () => {
    // Ruta apta pero de seis horas: más de las dos que aguanta fuera de refrigeración.
    const ctx = escenario({ rutaApta: true, rutaMinutos: 360, nodoGuarda: true })

    const veredicto = resolver(pedido(INSULINA), ctx)

    expect(veredicto.estado).toBe('SIN_RUTA')
    expect(veredicto.cadenaFrioBloqueada).toBe(true)
    expect(veredicto.capacidadId).toBeUndefined()
  })

  it('no sale de un nodo que no puede guardar la cadena de frío', () => {
    // Ruta corta y apta, pero la bodega no tiene refrigeración: no es un origen válido.
    const ctx = escenario({ rutaApta: true, rutaMinutos: 60, nodoGuarda: false })

    const veredicto = resolver(pedido(INSULINA), ctx)

    expect(veredicto.estado).toBe('SIN_RUTA')
    expect(veredicto.cadenaFrioBloqueada).toBe(true)
  })

  it('cuando hay ruta apta, corta y un nodo que la guarda, sí llega a LISTO', () => {
    // Prueba que la restricción no sobre-bloquea: con todo en regla, la insulina se despacha.
    const ctx = escenario({ rutaApta: true, rutaMinutos: 60, nodoGuarda: true })

    const veredicto = resolver(pedido(INSULINA), ctx)

    expect(veredicto.estado).toBe('LISTO')
    expect(veredicto.cadenaFrioBloqueada).toBeFalsy()
    expect(veredicto.nodoId).toBe('N-A')
    expect(veredicto.capacidadId).toBe('cap-1')
  })

  it('un ítem ordinario no se ve afectado por la cadena de frío', () => {
    // La misma ruta no apta y el mismo nodo sin refrigeración: para algo que no exige frío,
    // nada de esto importa y el pedido llega a LISTO como siempre.
    const ctx = escenario({ rutaApta: false, rutaMinutos: 60, nodoGuarda: false })

    const veredicto = resolver(pedido(null), ctx)

    expect(veredicto.estado).toBe('LISTO')
    expect(veredicto.cadenaFrioBloqueada).toBeFalsy()
    expect(veredicto.capacidadId).toBe('cap-1')
  })

  it('no muta el contexto que se le pasa', () => {
    const ctx = escenario({ rutaApta: true, rutaMinutos: 360, nodoGuarda: true })
    const antes = JSON.stringify(ctx.rutas)
    resolver(pedido(INSULINA), ctx)
    expect(JSON.stringify(ctx.rutas)).toBe(antes)
  })
})

describe('el suministro anticipado propone antes de que se acabe (PRD-33 §24 / §30)', () => {
  function suministro(cambios: Partial<SuministroAnticipado>): SuministroAnticipado {
    return {
      id: 's1',
      codigoItem: '22',
      familias: 1,
      cadenciaDias: 30,
      diasAnticipacion: 7,
      ultimoSuministroEn: haceDias(28),
      vigenciaHasta: null,
      activo: true,
      creadoEn: haceDias(28),
      ...cambios,
    }
  }

  it('propone un refill que vence dentro de la ventana de anticipación', () => {
    // Última entrega hace 28 días, cadencia 30: vence en 2 días, dentro de los 7 de anticipación.
    const propuestas = resolverAnticipado([suministro({})], AHORA)

    expect(propuestas).toHaveLength(1)
    expect(propuestas[0]!.suministroId).toBe('s1')
    expect(propuestas[0]!.propuestoParaEn).toEqual(enDias(2))
  })

  it('AC4: no dispara para un ítem sin cadencia', () => {
    const propuestas = resolverAnticipado([suministro({ cadenciaDias: null })], AHORA)
    expect(propuestas).toHaveLength(0)
  })

  it('no dispara cuando el próximo refill aún está lejos', () => {
    // Entregado ayer: el próximo vence en 29 días, fuera de la ventana de 7.
    const propuestas = resolverAnticipado([suministro({ ultimoSuministroEn: haceDias(1) })], AHORA)
    expect(propuestas).toHaveLength(0)
  })

  it('no dispara para una suscripción inactiva ni una fuera de vigencia', () => {
    const inactiva = suministro({ activo: false })
    const vencida = suministro({ vigenciaHasta: haceDias(1) })
    expect(resolverAnticipado([inactiva, vencida], AHORA)).toHaveLength(0)
  })

  it('para una nunca suministrada, cuenta desde que se creó la suscripción', () => {
    const nueva = suministro({ ultimoSuministroEn: null, creadoEn: haceDias(25) })
    // 25 + 30 = vence en 5 días → dentro de la ventana.
    const propuestas = resolverAnticipado([nueva], AHORA)
    expect(propuestas).toHaveLength(1)
    expect(propuestas[0]!.propuestoParaEn).toEqual(enDias(5))
  })

  it('proximoVencimiento es null sin cadencia, y base + cadencia con ella', () => {
    expect(proximoVencimiento(suministro({ cadenciaDias: null }))).toBeNull()
    expect(proximoVencimiento(suministro({ ultimoSuministroEn: haceDias(10), cadenciaDias: 30 }))).toEqual(
      enDias(20),
    )
  })

  it('una propuesta es solo eso: no lleva confirmación hasta que una persona la confirme', () => {
    // El tipo de la propuesta no tiene confirmante — la confirmación vive en la fila de
    // propuestas_anticipadas y la pone una persona (2.1). Aquí solo se comprueba la forma.
    const propuestas: PropuestaAnticipada[] = resolverAnticipado([suministro({})], AHORA)
    expect(Object.keys(propuestas[0]!).sort()).toEqual(['propuestoParaEn', 'suministroId'])
  })
})
