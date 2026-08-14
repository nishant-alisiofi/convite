import { describe, expect, it } from 'vitest'
import { COMUNIDADES_SEMILLA } from '@/db/seed/comunidades'
import { NODOS_SEMILLA } from '@/db/seed/operacion'
import { figurasDe, fuentesYCapas, limitesDe } from '@/lib/mapa/capas'
import type { ComunidadMapa, DatosMapa, NodoMapa, TramoMapa } from '@/lib/mapa/datos'
import { anilloCircular, distanciaM } from '@/lib/mapa/geometria'
import { radioDe, representacionDe } from '@/lib/mapa/precision'

/** The seeded basin as the map receives it: every community a centroid, one node unlocated. */
function cuencaDeMapa(): DatosMapa {
  const comunidades: ComunidadMapa[] = COMUNIDADES_SEMILLA.map((c, i) => ({
    id: `com-${i}`,
    codigo: c.codigo,
    nombre: c.nombre,
    municipio: c.municipio,
    lat: c.lat,
    lon: c.lon,
    fuente: 'centroide',
    precisionM: 1000,
    familiasEstimadas: c.familiasEstimadas,
    tierConectividad: c.tierConectividad,
    estado: null,
    abiertos: 0,
  }))

  const nodos: NodoMapa[] = NODOS_SEMILLA.map((n, i) => ({
    id: `nodo-${i}`,
    nombre: n.nombre,
    tipo: n.tipo,
    comunidad: n.comunidad,
    lat: n.lat,
    lon: n.lon,
    fuente: n.ubicacionFuente,
    precisionM: n.ubicacionPrecisionM,
  }))

  const tramos: TramoMapa[] = [
    {
      clave: 'a|b|lancha|lluvias',
      modo: 'lancha',
      origen: 'Quibdó',
      destino: 'Boca de Tanandó',
      origenLat: 5.6947,
      origenLon: -76.6611,
      destinoLat: 5.7594,
      destinoLon: -76.7106,
      minutosIda: 50,
      minutosVuelta: 70,
      temporada: 'lluvias',
      activa: true,
    },
  ]

  return { comunidades, nodos, tramos, temporada: 'lluvias' }
}

/**
 * M8 acceptance: «non-GPS reports render as circles».
 *
 * Asserted on the shape the map is told to draw, not on pixels — what matters is that the
 * precision the database holds survives all the way to the instruction, and that no code
 * path can turn a 1000 m centroid into a dot (non-negotiable 2.2).
 */

describe('cómo se dibuja una ubicación según su precisión', () => {
  it('un pin solo cuando la precisión es exacta', () => {
    expect(representacionDe({ lat: 5.69, lon: -76.66, fuente: 'gps', precisionM: 0 })).toEqual({
      forma: 'pin',
      lat: 5.69,
      lon: -76.66,
    })
  })

  it('un centroide es un círculo de ~1000 m, nunca un punto', () => {
    const r = representacionDe({
      lat: 5.9564,
      lon: -76.7264,
      fuente: 'centroide',
      precisionM: null,
    })
    expect(r).toEqual({
      forma: 'circulo',
      lat: 5.9564,
      lon: -76.7264,
      radioM: 1000,
      trazo: 'discontinuo',
    })
  })

  it('una ubicación referida es un círculo de ~2000 m y se distingue del centroide', () => {
    const referida = representacionDe({
      lat: 5.88,
      lon: -76.73,
      fuente: 'referida',
      precisionM: null,
    })
    const centroide = representacionDe({
      lat: 5.88,
      lon: -76.73,
      fuente: 'centroide',
      precisionM: null,
    })

    expect(referida).toMatchObject({ forma: 'circulo', radioM: 2000, trazo: 'punteado' })
    // Distinta por radio Y por trazo: dos círculos del mismo tamaño no pueden significar
    // cosas distintas sin que se note.
    expect(referida).not.toEqual(centroide)
    if (referida.forma !== 'circulo' || centroide.forma !== 'circulo') throw new Error('círculos')
    expect(referida.trazo).not.toBe(centroide.trazo)
    expect(referida.radioM).toBeGreaterThan(centroide.radioM)
  })

  it('la precisión declarada manda sobre el valor por defecto de la fuente', () => {
    // La bodega la ubicó el equipo a mano con 250 m: no se le impone el 1000 del centroide.
    expect(radioDe('manual', 250)).toBe(250)
    expect(representacionDe({ lat: 5.68, lon: -76.65, fuente: 'manual', precisionM: 250 })).toEqual(
      { forma: 'circulo', lat: 5.68, lon: -76.65, radioM: 250, trazo: 'solido' },
    )
  })

  it('un gps con radio declarado se dibuja como área, no como pin', () => {
    // La forma la decide el número que guardamos, no el nombre de la fuente. Una fila que
    // dice `gps` con 1000 m de error es un dato malo o un ascenso silencioso de precisión,
    // y en los dos casos el círculo es lo honesto.
    expect(
      representacionDe({ lat: 5.69, lon: -76.66, fuente: 'gps', precisionM: 1000 }),
    ).toMatchObject({ forma: 'circulo', radioM: 1000 })
  })

  it('sin coordenada no se dibuja nada, y sin radio tampoco', () => {
    expect(
      representacionDe({ lat: null, lon: null, fuente: 'centroide', precisionM: 1000 }),
    ).toEqual({ forma: 'ausente' })
    // `manual` no tiene radio por defecto a propósito: lo escribe quien ubica el punto.
    expect(representacionDe({ lat: 5.5, lon: -76.6, fuente: 'manual', precisionM: null })).toEqual({
      forma: 'ausente',
    })
    expect(representacionDe({ lat: 5.5, lon: -76.6, fuente: null, precisionM: null })).toEqual({
      forma: 'ausente',
    })
  })
})

describe('la cuenca sembrada, tal como se dibuja hoy', () => {
  it('las trece comunidades salen como círculos y ninguna como pin', () => {
    const formas = COMUNIDADES_SEMILLA.map(
      (c) =>
        representacionDe({ lat: c.lat, lon: c.lon, fuente: 'centroide', precisionM: 1000 }).forma,
    )
    expect(formas).toHaveLength(13)
    expect(formas.every((f) => f === 'circulo')).toBe(true)
    expect(formas).not.toContain('pin')
  })

  it('el acopio sin ubicar no se dibuja en ninguna parte', () => {
    // Acopio Yuto está sembrado sin coordenadas a propósito. La pantalla lo lista aparte;
    // lo que no puede hacer es inventarle un punto en el centro de la cuenca.
    const yuto = NODOS_SEMILLA.find((n) => n.clave === 'ACO-YUT')!
    expect(
      representacionDe({
        lat: yuto.lat,
        lon: yuto.lon,
        fuente: yuto.ubicacionFuente,
        precisionM: yuto.ubicacionPrecisionM,
      }),
    ).toEqual({ forma: 'ausente' })
  })
})

describe('el círculo que se dibuja mide lo que dice medir', () => {
  it('cada vértice queda a la distancia pedida del centro', () => {
    const anillo = anilloCircular(5.9564, -76.7264, 1000)
    for (const [lon, lat] of anillo) {
      const metros = distanciaM({ lat: 5.9564, lon: -76.7264 }, { lat, lon })
      // Un metro de tolerancia sobre mil: el error es de la esfera, no del dibujo.
      expect(Math.abs(metros - 1000)).toBeLessThan(1)
    }
  })

  it('el anillo cierra, como exige GeoJSON', () => {
    const anillo = anilloCircular(5.69, -76.66, 2000)
    expect(anillo[0]).toEqual(anillo[anillo.length - 1])
  })

  it('un radio mayor dibuja un círculo mayor', () => {
    const norte = (radio: number) => anilloCircular(5.69, -76.66, radio)[0]![1]
    expect(norte(2000)).toBeGreaterThan(norte(1000))
  })
})

describe('las capas que se le entregan a MapLibre', () => {
  it('no declara ninguna fuente de teselas', () => {
    // El mapa no llama a nadie. Si algún día aparece una fuente 'raster' o 'vector' acá,
    // es que se coló un basemap externo — y con él una llave, una factura y una petición
    // saliente por cada pantalla que abre un coordinador.
    const { sources } = fuentesYCapas(figurasDe(cuencaDeMapa()), cuencaDeMapa().tramos)
    for (const fuente of Object.values(sources)) {
      expect(fuente.type).toBe('geojson')
    }
  })

  it('dibuja las trece comunidades como círculos de raya y ningún punto', () => {
    const datos = cuencaDeMapa()
    const figuras = figurasDe(datos)

    expect(figuras.circulos.discontinuo).toHaveLength(13)
    expect(figuras.pines).toHaveLength(0)
    // Los dos nodos ubicados a mano llevan su propio radio y su propio trazo.
    expect(figuras.circulos.solido).toHaveLength(2)
    // Y el que nadie ha ubicado se nombra en vez de dibujarse.
    expect(figuras.sinUbicar).toEqual(['Acopio Yuto'])
  })

  it('cada trazo lleva su patrón de raya, y el sólido ninguno', () => {
    const datos = cuencaDeMapa()
    const { layers } = fuentesYCapas(figurasDe(datos), datos.tramos)
    const borde = (trazo: string) =>
      layers.find((c) => c.id === `circulos-${trazo}-borde`) as
        | { paint: Record<string, unknown> }
        | undefined

    expect(borde('discontinuo')!.paint['line-dasharray']).toEqual([2, 2])
    expect(borde('solido')!.paint['line-dasharray']).toBeUndefined()
  })

  it('los tramos se dibujan con raya: son esquemáticos, no el camino real', () => {
    const datos = cuencaDeMapa()
    const { layers } = fuentesYCapas(figurasDe(datos), datos.tramos)
    const linea = layers.find((c) => c.id === 'tramos-linea') as { paint: Record<string, unknown> }
    expect(linea.paint['line-dasharray']).toEqual([3, 2])
  })

  it('el encuadre cubre el radio completo, no solo los centros', () => {
    const datos = cuencaDeMapa()
    const figuras = figurasDe(datos)
    const limites = limitesDe(figuras, datos.tramos)!

    const norte = Math.max(...datos.comunidades.map((c) => c.lat!))
    // El borde del encuadre queda por fuera del centro más al norte: si encuadrara los
    // centros, el círculo de la comunidad del extremo saldría cortado.
    expect(limites[1][1]).toBeGreaterThan(norte)
  })
})
