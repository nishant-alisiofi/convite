import { describe, expect, it } from 'vitest'
import { figurasDe, fuentesYCapas } from '@/lib/mapa/capas'
import type { DatosMapa } from '@/lib/mapa/datos'
import {
  estiloConPmtiles,
  estiloDeMapa,
  hayPaqueteOffline,
  URL_PMTILES,
} from '@/lib/mapa/pmtiles'

/**
 * PRD-13: the offline basemap must be composable UNDER the honest geometry without ever
 * touching it. These assert the same non-negotiable the online basemap lives under (2.2): the
 * pure, tile-free layer stays exactly as `fuentesYCapas` produced it, and the tile source is
 * added at presentation, above the background and below every data layer.
 */

/** A tiny basin: one centroid community and one schematic leg. Enough to build a real style. */
function datosMinimos(): DatosMapa {
  return {
    comunidades: [
      {
        id: 'c1',
        codigo: 'C1',
        nombre: 'Tagachí',
        municipio: 'Quibdó',
        lat: 5.9564,
        lon: -76.7264,
        fuente: 'centroide',
        precisionM: 1000,
        familiasEstimadas: 20,
        tierConectividad: 2,
        estado: null,
        abiertos: 0,
      },
    ],
    nodos: [],
    tramos: [
      {
        clave: 'a|b|lancha|lluvias',
        modo: 'lancha',
        origen: 'Quibdó',
        destino: 'Tagachí',
        origenLat: 5.6947,
        origenLon: -76.6611,
        destinoLat: 5.9564,
        destinoLon: -76.7264,
        minutosIda: 50,
        minutosVuelta: 70,
        temporada: 'lluvias',
        activa: true,
      },
    ],
    temporada: 'lluvias',
  }
}

function estiloDatos() {
  const datos = datosMinimos()
  return fuentesYCapas(figurasDe(datos), datos.tramos)
}

describe('el basemap PMTiles se compone sin tocar la geometría honesta', () => {
  it('añade una fuente vectorial pmtiles:// y conserva las fuentes geojson', () => {
    const base = estiloDatos()
    const geojsonAntes = Object.entries(base.sources).filter(([, f]) => f.type === 'geojson')

    const estilo = estiloConPmtiles(base, 'https://ejemplo.test/choco.pmtiles')

    const protomaps = estilo.sources.protomaps as { type: string; url: string }
    expect(protomaps.type).toBe('vector')
    expect(protomaps.url).toBe('pmtiles://https://ejemplo.test/choco.pmtiles')

    // Cada fuente de datos sigue siendo geojson y sigue estando: nada se promovió ni se perdió.
    for (const [id, fuente] of geojsonAntes) {
      expect((estilo.sources[id] as { type: string }).type).toBe('geojson')
      expect(estilo.sources[id]).toEqual(fuente)
    }
  })

  it('no introduce ninguna capa de símbolo (no necesita glifos)', () => {
    const estilo = estiloConPmtiles(estiloDatos(), 'https://ejemplo.test/choco.pmtiles')
    for (const capa of estilo.layers) {
      expect(capa.type).not.toBe('symbol')
    }
  })

  it('mete el basemap encima del fondo y debajo de todas las capas de datos', () => {
    const estilo = estiloConPmtiles(estiloDatos(), 'https://ejemplo.test/choco.pmtiles')
    const tipos = estilo.layers.map((c) => c.type)
    const idxFondo = tipos.indexOf('background')
    const idxPrimerBase = estilo.layers.findIndex((c) => c.source === 'protomaps')
    const idxPrimerDato = estilo.layers.findIndex(
      (c) => typeof c.id === 'string' && String(c.id).startsWith('circulos-'),
    )

    expect(idxFondo).toBe(0)
    expect(idxPrimerBase).toBe(1) // justo después del fondo
    // Toda capa de basemap va antes de la primera capa de datos: los círculos dibujan encima.
    const ultimaBase = estilo.layers.reduce(
      (max, c, i) => (c.source === 'protomaps' ? i : max),
      -1,
    )
    expect(idxPrimerDato).toBeGreaterThan(ultimaBase)
  })

  it('no muta el estilo de entrada', () => {
    const base = estiloDatos()
    const nCapas = base.layers.length
    const nFuentes = Object.keys(base.sources).length
    estiloConPmtiles(base, 'https://ejemplo.test/choco.pmtiles')
    expect(base.layers).toHaveLength(nCapas)
    expect(Object.keys(base.sources)).toHaveLength(nFuentes)
    expect(base.sources.protomaps).toBeUndefined()
  })
})

describe('sin paquete configurado, el mapa cae en las teselas OSM', () => {
  it('hayPaqueteOffline es falso y estiloDeMapa usa OSM', () => {
    // En pruebas NEXT_PUBLIC_PMTILES_URL no está fijada.
    expect(URL_PMTILES).toBe('')
    expect(hayPaqueteOffline()).toBe(false)

    const estilo = estiloDeMapa(estiloDatos())
    expect(estilo.sources.osm).toBeDefined()
    expect((estilo.sources as Record<string, unknown>).protomaps).toBeUndefined()
  })
})
