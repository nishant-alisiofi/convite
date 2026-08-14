import { describe, expect, it } from 'vitest'
import { Grafo } from '@/lib/matching/grafo'
import { resolver } from '@/lib/matching/resolver'
import { ESTADOS_QUE_EL_EMPAREJADOR_RESUELVE } from '@/lib/matching/tipos'
import { AHORA, construirCuenca, enDias, haceDias } from './fixtures/cuenca'

/**
 * M2 acceptance. No database anywhere in this file — the resolver is a pure function over a
 * snapshot, which is the whole reason the five states are cheap to pin down.
 */

describe('los cuatro veredictos del emparejador', () => {
  it('LISTO cuando hay ruta, existencia y alguien viajando', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.sinOfertas() // esta prueba es sobre la bodega; el perecedero tiene la suya
    // Tagachí pide 30 mercados. Quibdó tiene 180 y Aníbal sale para allá en tres días.
    const veredicto = resolver(cuenca.pedido('TAG', '11', 30), cuenca.ctx)

    expect(veredicto.estado).toBe('LISTO')
    expect(veredicto.nodoId).toBe('BOD-QBD')
    expect(veredicto.capacidadId).toBeDefined()
    expect(veredicto.motivo).toContain('30 mercados')
    expect(veredicto.motivo).toContain('Bodega Central Quibdó')
    expect(veredicto.motivo).toContain('Aníbal Córdoba')
  })

  it('SIN_CAPACIDAD cuando hay de todo menos quién lo lleve', () => {
    const cuenca = construirCuenca('lluvias')
    // Bellavista pide 60 mercados. Hay 180 en Quibdó; la única lancha va a Tagachí.
    const veredicto = resolver(cuenca.pedido('BLL', '11', 60), cuenca.ctx)

    expect(veredicto.estado).toBe('SIN_CAPACIDAD')
    expect(veredicto.nodoId).toBe('BOD-QBD')
    expect(veredicto.capacidadId).toBeUndefined()
    // La frase del §8, casi palabra por palabra.
    expect(veredicto.motivo).toMatch(/Hay 180 mercados en Bodega Central Quibdó/)
    expect(veredicto.motivo).toMatch(/nadie va para Bellavista/)
  })

  it('SIN_EXISTENCIA cuando nadie tiene el ítem', () => {
    const cuenca = construirCuenca('lluvias')
    // Ni bodega ni ofrecimiento: el único caso en que SIN_EXISTENCIA es la verdad.
    cuenca.sinOfertas()
    // Medicamento crónico: ninguna bodega lo tiene.
    const veredicto = resolver(cuenca.pedido('BET', '22', 8), cuenca.ctx)

    expect(veredicto.estado).toBe('SIN_EXISTENCIA')
    expect(veredicto.motivo).toContain('No hay medicamento crónico')
    expect(veredicto.motivo).toContain('Hay que conseguir donación')
  })

  it('SIN_EXISTENCIA nombra el faltante cuando alcanza para algunos', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.sinOfertas()
    cuenca.ponerExistencia('BOD-QBD', '11', 18, 2)
    cuenca.ponerExistencia('ACO-TAG', '11', 0, 2)
    cuenca.ponerExistencia('ACO-YUT', '11', 0, 2)

    const veredicto = resolver(cuenca.pedido('BLL', '11', 60), cuenca.ctx)

    expect(veredicto.estado).toBe('SIN_EXISTENCIA')
    expect(veredicto.motivo).toContain('Se necesitan 60 mercados')
    expect(veredicto.motivo).toContain('solo hay 18')
    // Señala dónde debería aterrizar la donación.
    expect(veredicto.nodoId).toBe('BOD-QBD')
  })

  it('SIN_RUTA cuando la temporada cierra el único paso', () => {
    // En verano el caño hacia Winandó no da paso: no hay fila `seca` en el grafo.
    const veredicto = resolver(
      construirCuenca('seca').pedido('WIN', '12', 20),
      construirCuenca('seca').ctx,
    )

    expect(veredicto.estado).toBe('SIN_RUTA')
    expect(veredicto.motivo).toContain('Winandó está incomunicada')
    expect(veredicto.motivo).toContain('en verano')
  })

  it('en lluvias esa misma comunidad sí tiene paso', () => {
    const cuenca = construirCuenca('lluvias')
    const veredicto = resolver(cuenca.pedido('WIN', '12', 20), cuenca.ctx)
    expect(veredicto.estado).not.toBe('SIN_RUTA')
  })
})

describe('las ofertas de particulares cuentan como existencia (Sección 8)', () => {
  it('REGRESIÓN: bodega vacía pero alguien lo está ofreciendo — nunca SIN_EXISTENCIA', () => {
    // El bug más costoso observado en un sistema en vivo: tres ítems marcados urgentes y
    // «nadie tiene» en una página que, más abajo, listaba ocho personas ofreciendo justo
    // eso. El inventario de nodo se desactualiza en días; en la primera semana la
    // mercancía está en las casas.
    const cuenca = construirCuenca('lluvias')
    cuenca.vaciarBodegas('11')
    cuenca.sinOfertas()
    cuenca.agregarOferta({ codigoItem: '11', cantidad: 40, ofrecidoPor: 'Emperatriz Mosquera' })

    const veredicto = resolver(cuenca.pedido('TAG', '11', 30), cuenca.ctx)

    expect(veredicto.estado).not.toBe('SIN_EXISTENCIA')
    expect(veredicto.ofertaId).toBeDefined()
    expect(veredicto.motivo).toContain('Emperatriz Mosquera')
  })

  it('la oferta llega hasta LISTO, con su tramo de recogida', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.vaciarBodegas('11')
    cuenca.sinOfertas()
    cuenca.agregarOferta({ codigoItem: '11', cantidad: 40 })

    const veredicto = resolver(cuenca.pedido('TAG', '11', 30), cuenca.ctx)
    expect(veredicto.estado).toBe('LISTO')
    expect(veredicto.nodoId).toBe('BOD-QBD')
    expect(veredicto.motivo).toContain('Hay que recogerlo')
  })

  it('una oferta sin cantidad sigue siendo existencia, y lo dice', () => {
    // 2.12: nunca inventar una cantidad que nadie dijo. Pero «sin cantidad» no es «no hay».
    const cuenca = construirCuenca('lluvias')
    const veredicto = resolver(cuenca.pedido('BET', '22', 8), cuenca.ctx)

    expect(veredicto.estado).not.toBe('SIN_EXISTENCIA')
    expect(veredicto.motivo).toContain('sin cantidad confirmada')
    expect(veredicto.motivo).toMatch(/Llame para confirmar|nadie va/)
  })

  it('ignora ofertas sin clasificar', () => {
    // «Muchas cosas!! De todo!!!» es una llamada por hacer, no una categoría que adivinar.
    const cuenca = construirCuenca('lluvias')
    cuenca.vaciarBodegas('34')
    cuenca.sinOfertas()
    cuenca.agregarOferta({ codigoItem: '34', estado: 'SIN_CLASIFICAR', cantidad: 10 })

    expect(resolver(cuenca.pedido('TAG', '34', 5), cuenca.ctx).estado).toBe('SIN_EXISTENCIA')
  })

  it('ignora una oferta que ya se venció', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.vaciarBodegas('11')
    cuenca.sinOfertas()
    cuenca.agregarOferta({
      codigoItem: '11',
      cantidad: 40,
      perecedero: true,
      venceEn: haceDias(1),
    })

    expect(resolver(cuenca.pedido('TAG', '11', 30), cuenca.ctx).estado).toBe('SIN_EXISTENCIA')
  })

  it('no recoge una oferta que está al otro lado de la cuenca', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.vaciarBodegas('11')
    cuenca.sinOfertas()
    // Bellavista queda a más de 90 km de cualquier bodega: no es una recogida urbana.
    cuenca.agregarOferta({ codigoItem: '11', cantidad: 40, lat: 6.5561, lon: -76.8917, comunidadId: 'BLL' })

    expect(resolver(cuenca.pedido('TAG', '11', 30), cuenca.ctx).estado).toBe('SIN_EXISTENCIA')
  })

  it('dice explícitamente que también miró los ofrecimientos', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.vaciarBodegas('11')
    cuenca.sinOfertas()

    const veredicto = resolver(cuenca.pedido('TAG', '11', 30), cuenca.ctx)
    expect(veredicto.estado).toBe('SIN_EXISTENCIA')
    expect(veredicto.motivo).toContain('nadie lo está ofreciendo')
  })
})

describe('los perecederos se van primero (2.15)', () => {
  it('un almuerzo que se vence mañana gana sobre una bodega llena', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.sinOfertas()
    cuenca.agregarOferta({
      codigoItem: '11',
      cantidad: 40,
      perecedero: true,
      // Después de que sale la lancha (3 días), o no sería un plan válido.
      venceEn: enDias(5),
      ofrecidoPor: 'Restaurante El Sabor Chocoano',
    })

    // Quibdó tiene 180 mercados contados hace dos días, y aun así no gana.
    const veredicto = resolver(cuenca.pedido('TAG', '11', 30), cuenca.ctx)
    expect(veredicto.ofertaId).toBeDefined()
    expect(veredicto.motivo).toContain('Restaurante El Sabor Chocoano')
    expect(veredicto.motivo).toContain('Se vence el')
  })

  it('entre dos perecederos sale primero el que se vence antes', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.sinOfertas()
    cuenca.agregarOferta({
      codigoItem: '11',
      cantidad: 40,
      perecedero: true,
      venceEn: enDias(10),
      ofrecidoPor: 'El que aguanta',
    })
    cuenca.agregarOferta({
      codigoItem: '11',
      cantidad: 40,
      perecedero: true,
      venceEn: enDias(4),
      ofrecidoPor: 'El que se vence ya',
    })

    expect(resolver(cuenca.pedido('TAG', '11', 30), cuenca.ctx).motivo).toContain(
      'El que se vence ya',
    )
  })

  it('REGRESIÓN: no manda en la lancha del domingo comida que se vence el sábado', () => {
    // Encontrado corriendo el emparejador contra la base real: el filtro descartaba lo ya
    // vencido «hoy», pero nunca comprobaba que siguiera bueno el día que sale la lancha.
    const cuenca = construirCuenca('lluvias')
    cuenca.sinOfertas()
    cuenca.agregarOferta({
      codigoItem: '11',
      cantidad: 40,
      perecedero: true,
      // La única lancha sale en 3 días.
      venceEn: enDias(2),
      ofrecidoPor: 'Restaurante El Sabor Chocoano',
    })

    const veredicto = resolver(cuenca.pedido('TAG', '11', 30), cuenca.ctx)

    // Cae a la bodega, que no se echa a perder.
    expect(veredicto.estado).toBe('LISTO')
    expect(veredicto.ofertaId).toBeUndefined()
    expect(veredicto.motivo).toContain('Bodega Central Quibdó')
  })

  it('si nada sale a tiempo, lo dice con la fecha de vencimiento', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.sinOfertas()
    cuenca.vaciarBodegas('11')
    cuenca.agregarOferta({
      codigoItem: '11',
      cantidad: 40,
      perecedero: true,
      venceEn: enDias(2),
      ofrecidoPor: 'Restaurante El Sabor Chocoano',
    })

    const veredicto = resolver(cuenca.pedido('TAG', '11', 30), cuenca.ctx)
    expect(veredicto.estado).toBe('SIN_CAPACIDAD')
    expect(veredicto.motivo).toContain('Se vence el')
  })

  it('la urgencia del pedido no altera ese orden', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.sinOfertas()
    cuenca.agregarOferta({
      codigoItem: '11',
      cantidad: 40,
      perecedero: true,
      venceEn: enDias(5),
      ofrecidoPor: 'Restaurante El Sabor Chocoano',
    })

    // Urgencia 1, la más baja: el perecedero igual va primero.
    const veredicto = resolver(cuenca.pedido('TAG', '11', 30, 1), cuenca.ctx)
    expect(veredicto.motivo).toContain('Restaurante El Sabor Chocoano')
  })
})

describe('cerrar un solo tramo incomunica tres comunidades', () => {
  it('MER→TAG es el cuello de botella del Atrato medio', () => {
    const cuenca = construirCuenca('lluvias')
    const aguasAbajo = ['TAG', 'BET', 'BLL'] as const

    // Antes: las tres tienen paso, y su problema es transporte, no aislamiento.
    for (const comunidad of aguasAbajo) {
      const antes = resolver(cuenca.pedido(comunidad, '11', 20), cuenca.ctx)
      expect(antes.estado, comunidad).not.toBe('SIN_RUTA')
    }

    // Una palizada tapa el paso justo antes de Tagachí. Un coordinador cierra el tramo.
    cuenca.cerrarTramo('MER', 'TAG')

    for (const comunidad of aguasAbajo) {
      const despues = resolver(cuenca.pedido(comunidad, '11', 20), cuenca.ctx)
      expect(despues.estado, comunidad).toBe('SIN_RUTA')
    }

    // El corte deja un bolsón aguas abajo que solo alcanza el acopio de Tagachí, y ese
    // acopio tiene 18 mercados. Los 180 de Quibdó quedaron del otro lado. Las tres frases
    // tienen que mandar a abrir el paso, no a buscar donación — que es exactamente la
    // llamada equivocada cuando la mercancía ya existe.
    for (const comunidad of aguasAbajo) {
      const motivo = resolver(cuenca.pedido(comunidad, '11', 20), cuenca.ctx).motivo
      expect(motivo, comunidad).toContain('180 mercados en Bodega Central Quibdó')
      expect(motivo, comunidad).toContain('no hay cómo llegar')
      expect(motivo, comunidad).toContain('abrir un paso')
    }

    // Y solo esas tres: Las Mercedes y Winandó cuelgan antes del corte.
    for (const comunidad of ['MER', 'WIN'] as const) {
      const intacta = resolver(cuenca.pedido(comunidad, '11', 20), cuenca.ctx)
      expect(intacta.estado, comunidad).not.toBe('SIN_RUTA')
    }
  })
})

describe('la capacidad se evalúa como la evaluaría una persona', () => {
  it('no sirve una lancha que ya salió', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.sinCapacidades()
    cuenca.agregarCapacidad({
      origenNodoId: 'BOD-QBD',
      hastaComunidadId: 'TAG',
      saleEn: haceDias(1),
    })
    expect(resolver(cuenca.pedido('TAG', '11', 30), cuenca.ctx).estado).toBe('SIN_CAPACIDAD')
  })

  it('no sirve una lancha que sale dentro de dos meses', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.sinCapacidades()
    cuenca.agregarCapacidad({
      origenNodoId: 'BOD-QBD',
      hastaComunidadId: 'TAG',
      saleEn: enDias(60),
    })
    expect(resolver(cuenca.pedido('TAG', '11', 30), cuenca.ctx).estado).toBe('SIN_CAPACIDAD')
  })

  it('no sirve una lancha sin cupo para todas las familias', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.sinCapacidades()
    cuenca.agregarCapacidad({
      origenNodoId: 'BOD-QBD',
      hastaComunidadId: 'TAG',
      cupoFamilias: 10,
    })
    expect(resolver(cuenca.pedido('TAG', '11', 30), cuenca.ctx).estado).toBe('SIN_CAPACIDAD')
  })

  it('no sirve una lancha que sale de una bodega sin la mercancía', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.sinCapacidades()
    // Yuto no tiene kits de aseo, así que su lancha no resuelve un pedido de aseo.
    cuenca.agregarCapacidad({ origenNodoId: 'ACO-YUT', hastaComunidadId: 'MER' })
    expect(resolver(cuenca.pedido('MER', '41', 15), cuenca.ctx).estado).toBe('SIN_CAPACIDAD')
  })

  it('sirve una lancha que pasa por ahí camino a otro lado', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.sinCapacidades()
    // Bajando a Bellavista se pasa por Tagachí.
    cuenca.agregarCapacidad({ origenNodoId: 'BOD-QBD', hastaComunidadId: 'BLL' })

    const veredicto = resolver(cuenca.pedido('TAG', '11', 30), cuenca.ctx)
    expect(veredicto.estado).toBe('LISTO')
    expect(veredicto.motivo).toContain('pasa por Tagachí')
  })

  it('no inventa una escala río abajo y de vuelta', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.sinCapacidades()
    // La lancha va a Tagachí. Bellavista queda hora y media más abajo: no es "de paso".
    cuenca.agregarCapacidad({ origenNodoId: 'BOD-QBD', hastaComunidadId: 'TAG', cupoFamilias: 80 })

    expect(resolver(cuenca.pedido('BLL', '11', 60), cuenca.ctx).estado).toBe('SIN_CAPACIDAD')
  })

  it('ignora capacidades que no están OFRECIDAs', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.sinCapacidades()
    cuenca.agregarCapacidad({
      origenNodoId: 'BOD-QBD',
      hastaComunidadId: 'TAG',
      estado: 'CANCELADA',
    })
    expect(resolver(cuenca.pedido('TAG', '11', 30), cuenca.ctx).estado).toBe('SIN_CAPACIDAD')
  })
})

describe('honestidad de las frases', () => {
  it('advierte cuando la cifra que cita es vieja (2.3)', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.sinCapacidades()
    // El acopio de Tagachí se contó hace 19 días. Aguas abajo, es la bodega que llega.
    cuenca.ponerExistencia('BOD-QBD', '12', 0, 2)
    cuenca.ponerExistencia('ACO-YUT', '12', 0, 2)

    const veredicto = resolver(cuenca.pedido('BET', '12', 20), cuenca.ctx)
    expect(veredicto.estado).toBe('SIN_CAPACIDAD')
    expect(veredicto.motivo).toContain('contado hace 19 días')
  })

  it('no pone caveat cuando el conteo es de anteayer', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.sinCapacidades()
    const veredicto = resolver(cuenca.pedido('BLL', '11', 60), cuenca.ctx)
    expect(veredicto.motivo).not.toContain('contado hace')
  })

  it('usa singular cuando es uno solo', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.sinOfertas()
    const veredicto = resolver(cuenca.pedido('TAG', '11', 1), cuenca.ctx)
    expect(veredicto.motivo).toContain('1 mercado')
    expect(veredicto.motivo).not.toContain('1 mercados')
  })

  it('escribe en usted y sin jerga', () => {
    const cuenca = construirCuenca('lluvias')
    const frases = [
      resolver(cuenca.pedido('TAG', '11', 30), cuenca.ctx).motivo,
      resolver(cuenca.pedido('BLL', '11', 60), cuenca.ctx).motivo,
      resolver(cuenca.pedido('BET', '22', 8), cuenca.ctx).motivo,
      resolver(construirCuenca('seca').pedido('WIN', '12', 20), construirCuenca('seca').ctx).motivo,
    ]
    for (const frase of frases) {
      expect(frase.length).toBeGreaterThan(20)
      expect(frase).not.toMatch(/SIN_|LISTO|null|undefined|NaN|\bid\b/)
      expect(frase[0]).toBe(frase[0]!.toLocaleUpperCase('es-CO'))
    }
  })
})

describe('lo que el emparejador no hace', () => {
  it('no toca lo que se le pasó', () => {
    const cuenca = construirCuenca('lluvias')
    const antes = JSON.stringify({
      rutas: cuenca.ctx.rutas,
      existencias: cuenca.ctx.existencias,
      capacidades: cuenca.ctx.capacidades,
      nodos: cuenca.ctx.nodos,
    })

    resolver(cuenca.pedido('TAG', '11', 30), cuenca.ctx)
    resolver(cuenca.pedido('BLL', '11', 60), cuenca.ctx)

    expect(
      JSON.stringify({
        rutas: cuenca.ctx.rutas,
        existencias: cuenca.ctx.existencias,
        capacidades: cuenca.ctx.capacidades,
        nodos: cuenca.ctx.nodos,
      }),
    ).toBe(antes)
  })

  it('propone dos veces contra la misma existencia sin descontarla', () => {
    // Bajo escasez, decidir quién espera es una decisión humana que se registra en
    // decisiones_asignacion (2.9), no algo que el emparejador resuelva callado.
    const cuenca = construirCuenca('lluvias')
    cuenca.ponerExistencia('BOD-QBD', '11', 40, 1)
    cuenca.sinCapacidades()
    cuenca.agregarCapacidad({
      origenNodoId: 'BOD-QBD',
      hastaComunidadId: 'BLL',
      cupoFamilias: 40,
    })

    expect(resolver(cuenca.pedido('TAG', '11', 30), cuenca.ctx).estado).toBe('LISTO')
    expect(resolver(cuenca.pedido('BLL', '11', 30), cuenca.ctx).estado).toBe('LISTO')
    expect(cuenca.ctx.existencias.find((e) => e.nodoId === 'BOD-QBD' && e.codigoItem === '11')!.cantidad).toBe(40)
  })

  it('no clasifica lo que no es carga', () => {
    const cuenca = construirCuenca('lluvias')
    const veredicto = resolver(cuenca.pedido('TAG', '53', 5), cuenca.ctx)

    expect(veredicto.estado).toBe('ABIERTO')
    expect(veredicto.motivo).toContain('no se resuelve mandando carga')
    expect(veredicto.motivo).toContain('Coordine una visita')
  })

  it('no se mete con pedidos ya despachados o cerrados', () => {
    for (const estado of ['EN_CAMINO', 'ENTREGADO', 'CANCELADO'] as const) {
      expect(ESTADOS_QUE_EL_EMPAREJADOR_RESUELVE).not.toContain(estado)
    }
  })
})

describe('el grafo', () => {
  it('respeta la dirección: subir no es lo mismo que bajar', () => {
    const { ctx } = construirCuenca('lluvias')
    const grafo = new Grafo(ctx.rutas, 'lluvias')
    expect(grafo.minutosEntre('QBD', 'BTA')).toBe(50)
    expect(grafo.minutosEntre('BTA', 'QBD')).toBe(70)
  })

  it('suma los tramos hasta el destino', () => {
    const { ctx } = construirCuenca('lluvias')
    const grafo = new Grafo(ctx.rutas, 'lluvias')
    // QBD→BTA 50 + BTA→MER 45 + MER→TAG 40
    expect(grafo.minutosEntre('QBD', 'TAG')).toBe(135)
  })

  it('memoiza por origen', () => {
    const { ctx } = construirCuenca('lluvias')
    const grafo = new Grafo(ctx.rutas, 'lluvias')
    expect(grafo.desde('QBD')).toBe(grafo.desde('QBD'))
  })

  it('excluye tramos inactivos y de otra temporada', () => {
    const { ctx } = construirCuenca('seca')
    const grafo = new Grafo(ctx.rutas, 'seca')
    expect(grafo.llega('QBD', 'WIN')).toBe(false)
    expect(grafo.llega('QBD', 'BLL')).toBe(true)
  })

  it('reconoce una escala de paso y rechaza un desvío', () => {
    const { ctx } = construirCuenca('lluvias')
    const grafo = new Grafo(ctx.rutas, 'lluvias')
    expect(grafo.sirveDePaso('QBD', 'TAG', 'BLL')).toBe(true)
    expect(grafo.sirveDePaso('QBD', 'BLL', 'TAG')).toBe(false)
  })
})

describe('el contexto viene de la cuenca sembrada', () => {
  it('usa la fecha fija del fixture', () => {
    expect(construirCuenca().ctx.ahora).toEqual(AHORA)
  })
})
