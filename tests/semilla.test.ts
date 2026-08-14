import { describe, expect, it } from 'vitest'
import { CATALOGO_SEMILLA, UNIDADES_SEMILLA } from '@/db/seed/catalogo'
import { BBOX_CHOCO, COMUNIDADES_SEMILLA } from '@/db/seed/comunidades'
import {
  CAPACIDADES_SEMILLA,
  CONTACTOS_SEMILLA,
  EXISTENCIAS_SEMILLA,
  NECESIDADES_VERIFICADAS,
  NODOS_SEMILLA,
  REPORTES_SIN_VERIFICAR,
  USUARIOS_SEMILLA,
} from '@/db/seed/operacion'
import { RUTAS_SEMILLA } from '@/db/seed/rutas'
import {
  CANALES_PREFERIDOS,
  MODOS,
  MODOS_FLUVIALES,
  ROLES_CONTACTO,
  ROLES_STAFF,
  TEMPORADAS,
  TIPOS_COMUNIDAD,
} from '@/db/schema/vocabulario'

/**
 * These run without a database. They guard the properties of the seed that the SQL check
 * constraints cannot express, and the ones that would be quietly lost in a future edit —
 * above all, that no fluvial route ever claims a Google origin or a fabricated distance.
 */

const CODIGOS = new Set(COMUNIDADES_SEMILLA.map((c) => c.codigo))
const ITEMS = new Set(CATALOGO_SEMILLA.map((i) => i.codigo))

describe('catálogo', () => {
  it('cubre los 26 códigos de la Sección 5.1', () => {
    expect(CATALOGO_SEMILLA).toHaveLength(26)
  })

  it('no repite códigos', () => {
    expect(ITEMS.size).toBe(CATALOGO_SEMILLA.length)
  })

  it('usa códigos de dos dígitos cuya familia es el primer dígito', () => {
    for (const item of CATALOGO_SEMILLA) {
      expect(item.codigo).toMatch(/^[0-9]{2}$/)
      expect(item.itemLabel.length).toBeGreaterThan(0)
      expect(item.ayudaTexto.length).toBeGreaterThan(0)
    }
  })

  it('agrupa cada familia bajo una sola etiqueta', () => {
    const porFamilia = new Map<string, Set<string>>()
    for (const item of CATALOGO_SEMILLA) {
      const familia = item.codigo[0]!
      if (!porFamilia.has(familia)) porFamilia.set(familia, new Set())
      porFamilia.get(familia)!.add(item.familiaLabel)
    }
    for (const [familia, etiquetas] of porFamilia) {
      expect(etiquetas.size, `familia ${familia}`).toBe(1)
    }
  })

  it('cabe en un list message de WhatsApp: máximo 10 filas por sección', () => {
    // Section 6.4: lists allow up to 10 rows per section. A catalogue edit that overflows a
    // family breaks the intake flow silently, so it fails here instead.
    const porFamilia = new Map<string, number>()
    for (const item of CATALOGO_SEMILLA.filter((i) => i.tipo === 'necesidad')) {
      const familia = item.codigo[0]!
      porFamilia.set(familia, (porFamilia.get(familia) ?? 0) + 1)
    }
    for (const [familia, n] of porFamilia) {
      expect(n, `familia ${familia}`).toBeLessThanOrEqual(10)
    }
  })

  it('sabe cómo se cuenta cada necesidad en voz alta', () => {
    // `pedidos.motivo` dice «18 mercados», no «18 Mercado y alimentos». Sin estas palabras
    // la frase que lee el coordinador se vuelve un identificador con número al lado.
    for (const item of CATALOGO_SEMILLA.filter((i) => i.tipo === 'necesidad')) {
      const unidades = UNIDADES_SEMILLA[item.codigo]
      expect(unidades, item.codigo).toBeDefined()
      expect(unidades![0].length, item.codigo).toBeGreaterThan(2)
      expect(unidades![1].length, item.codigo).toBeGreaterThan(2)
      expect(unidades![0], item.codigo).not.toBe(unidades![1])
    }
  })

  it('no le pone unidades a los daños: nada de eso se carga en una lancha', () => {
    for (const item of CATALOGO_SEMILLA.filter((i) => i.tipo === 'dano')) {
      expect(UNIDADES_SEMILLA[item.codigo], item.codigo).toBeUndefined()
    }
  })

  it('marca traslado médico con urgencia mínima 3', () => {
    expect(CATALOGO_SEMILLA.find((i) => i.codigo === '23')?.urgenciaMin).toBe(3)
  })

  it('pide detalle donde el detalle importa', () => {
    const pidenDetalle = CATALOGO_SEMILLA.filter((i) => i.pideDetalle).map((i) => i.codigo)
    expect(pidenDetalle.sort()).toEqual(['22', '42'])
  })

  it('no considera entregable lo que no es carga', () => {
    // Psychosocial support is met by a person travelling, not a box; damage is not cargo at
    // all. Neither may ever become a `pedido` the matcher tries to stock.
    expect(CATALOGO_SEMILLA.find((i) => i.codigo === '53')?.entregable).toBe(false)
    for (const dano of CATALOGO_SEMILLA.filter((i) => i.tipo === 'dano')) {
      expect(dano.entregable, dano.codigo).toBe(false)
    }
  })
})

describe('comunidades', () => {
  it('siembra las 13 comunidades de la cuenca', () => {
    expect(COMUNIDADES_SEMILLA).toHaveLength(13)
    expect(CODIGOS.size).toBe(13)
  })

  it('mantiene las coordenadas dentro del Chocó', () => {
    for (const c of COMUNIDADES_SEMILLA) {
      expect(c.lat, c.codigo).toBeGreaterThan(BBOX_CHOCO.minLat)
      expect(c.lat, c.codigo).toBeLessThan(BBOX_CHOCO.maxLat)
      expect(c.lon, c.codigo).toBeGreaterThan(BBOX_CHOCO.minLon)
      expect(c.lon, c.codigo).toBeLessThan(BBOX_CHOCO.maxLon)
    }
  })

  it('usa tipos y tiers válidos', () => {
    for (const c of COMUNIDADES_SEMILLA) {
      expect(TIPOS_COMUNIDAD).toContain(c.tipo)
      expect(c.tierConectividad).toBeGreaterThanOrEqual(1)
      expect(c.tierConectividad).toBeLessThanOrEqual(4)
      expect(c.intervaloChequeoDias).toBeGreaterThan(0)
    }
  })

  it('revisa más seguido donde menos señal hay', () => {
    // Silence is a signal (Section 9.8). A tier-4 community that we only check monthly is a
    // community we will not notice going quiet.
    for (const c of COMUNIDADES_SEMILLA.filter((x) => x.tierConectividad >= 3)) {
      expect(c.intervaloChequeoDias, c.codigo).toBeLessThanOrEqual(10)
    }
  })
})

describe('rutas', () => {
  it('apunta solo a comunidades sembradas y nunca a sí misma', () => {
    for (const r of RUTAS_SEMILLA) {
      expect(CODIGOS.has(r.origen), r.origen).toBe(true)
      expect(CODIGOS.has(r.destino), r.destino).toBe(true)
      expect(r.origen).not.toBe(r.destino)
      expect(MODOS).toContain(r.modo)
      expect(TEMPORADAS).toContain(r.temporada)
      expect(r.minutos).toBeGreaterThan(0)
    }
  })

  it('no duplica el mismo tramo, modo y temporada', () => {
    const claves = RUTAS_SEMILLA.map((r) => `${r.origen}>${r.destino}|${r.modo}|${r.temporada}`)
    expect(new Set(claves).size).toBe(claves.length)
  })

  it('nunca deriva un tramo fluvial de Google', () => {
    // Section 7.3. Google has no river data at all; a `google` fluvial row means someone
    // fell back to something invented.
    for (const r of RUTAS_SEMILLA.filter((x) => (MODOS_FLUVIALES as readonly string[]).includes(x.modo))) {
      expect(r.fuente, `${r.origen}→${r.destino}`).toBe('manual')
    }
  })

  it('no inventa distancias de río', () => {
    // A straight line is meaningless when the real path is ninety minutes upriver, so the
    // column stays null rather than holding a number nobody measured.
    for (const r of RUTAS_SEMILLA.filter((x) => (MODOS_FLUVIALES as readonly string[]).includes(x.modo))) {
      expect(r.distanciaM, `${r.origen}→${r.destino}`).toBeNull()
    }
  })

  it('trata subir y bajar el río como viajes distintos', () => {
    const rio = RUTAS_SEMILLA.filter(
      (r) => r.modo === 'lancha' && r.temporada === 'lluvias',
    )
    const asimetricos = rio.filter((r) => {
      const vuelta = rio.find((o) => o.origen === r.destino && o.destino === r.origen)
      return vuelta && vuelta.minutos !== r.minutos
    })
    expect(asimetricos.length).toBeGreaterThan(0)
  })

  it('modela el estiaje: Winandó solo tiene paso en lluvias', () => {
    const haciaWinando = RUTAS_SEMILLA.filter((r) => r.destino === 'WIN')
    expect(haciaWinando.length).toBeGreaterThan(0)
    for (const r of haciaWinando) expect(r.temporada).toBe('lluvias')
    expect(haciaWinando.some((r) => r.temporada === 'seca')).toBe(false)
  })

  it('deja un cuello de botella real en MER→TAG', () => {
    // M2 depends on this: closing that single leg must cut off Tagachí, Beté y Bellavista.
    const conElTramoCerrado = alcanzablesDesde(
      'QBD',
      'lluvias',
      (r) => !(r.origen === 'MER' && r.destino === 'TAG'),
    )
    expect(conElTramoCerrado.has('TAG')).toBe(false)
    expect(conElTramoCerrado.has('BET')).toBe(false)
    expect(conElTramoCerrado.has('BLL')).toBe(false)
    // …and nothing else. Winandó hangs off Las Mercedes, so it stays reachable.
    expect(conElTramoCerrado.has('WIN')).toBe(true)
    expect(conElTramoCerrado.has('MER')).toBe(true)
  })

  it('conecta toda la cuenca desde Quibdó en lluvias', () => {
    const alcanzables = alcanzablesDesde('QBD', 'lluvias')
    for (const c of COMUNIDADES_SEMILLA) {
      expect(alcanzables.has(c.codigo), c.codigo).toBe(true)
    }
  })

  it('deja Winandó sin paso en seca', () => {
    expect(alcanzablesDesde('QBD', 'seca').has('WIN')).toBe(false)
  })
})

describe('operación', () => {
  it('usa teléfonos E.164', () => {
    const telefonos = [
      ...CONTACTOS_SEMILLA.map((c) => c.telefono),
      ...USUARIOS_SEMILLA.map((u) => u.telefono),
    ]
    for (const t of telefonos) expect(t, t).toMatch(/^\+[1-9][0-9]{7,14}$/)
    expect(new Set(telefonos).size).toBe(telefonos.length)
  })

  it('usa roles válidos en ambos lados', () => {
    for (const c of CONTACTOS_SEMILLA) {
      expect(ROLES_CONTACTO).toContain(c.rol)
      expect(CANALES_PREFERIDOS).toContain(c.canalPreferido)
      expect(CODIGOS.has(c.comunidad), c.comunidad).toBe(true)
    }
    for (const u of USUARIOS_SEMILLA) {
      expect(ROLES_STAFF).toContain(u.rolStaff)
      expect(ROLES_CONTACTO).toContain(u.rolContacto)
    }
  })

  it('no le da canal de datos a quien no tiene señal', () => {
    // Élver is in a tier-4 community: WhatsApp is not a channel that reaches him.
    const winando = COMUNIDADES_SEMILLA.find((c) => c.codigo === 'WIN')!
    expect(winando.tierConectividad).toBe(4)
    for (const c of CONTACTOS_SEMILLA.filter((x) => x.comunidad === 'WIN')) {
      expect(c.canalPreferido).not.toBe('whatsapp')
    }
  })

  it('declara la fuente de ubicación de cada nodo, o la deja explícitamente vacía', () => {
    for (const n of NODOS_SEMILLA) {
      expect(CODIGOS.has(n.comunidad), n.comunidad).toBe(true)
      const tieneCoordenada = n.lat !== null && n.lon !== null
      expect(tieneCoordenada).toBe(n.ubicacionFuente !== null)
      expect(tieneCoordenada).toBe(n.ubicacionPrecisionM !== null)
      // Nothing here was pinned by GPS, so nothing may claim zero radius.
      expect(n.ubicacionFuente).not.toBe('gps')
    }
  })

  it('cuenta existencias solo de ítems del catálogo', () => {
    const claves = NODOS_SEMILLA.map((n) => n.clave)
    for (const bloque of EXISTENCIAS_SEMILLA) {
      expect(claves).toContain(bloque.nodo)
      expect(bloque.diasDesdeConteo).toBeGreaterThanOrEqual(0)
      for (const [codigo, cantidad] of Object.entries(bloque.items)) {
        expect(ITEMS.has(codigo), codigo).toBe(true)
        expect(cantidad).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('deja un conteo viejo a propósito, para que el inventario tenga qué advertir', () => {
    expect(Math.max(...EXISTENCIAS_SEMILLA.map((b) => b.diasDesdeConteo))).toBeGreaterThan(14)
  })

  it('nunca crea una necesidad verificada sin verificador', () => {
    // Non-negotiable 2.1, in the seed as much as anywhere else.
    for (const n of NECESIDADES_VERIFICADAS) {
      expect(n.verificadoPor).toBeTruthy()
      expect(USUARIOS_SEMILLA.map((u) => u.id)).toContain(n.verificadoPor)
      expect(ITEMS.has(n.codigoItem), n.codigoItem).toBe(true)
      expect(CODIGOS.has(n.comunidad), n.comunidad).toBe(true)
      expect(n.familias).toBeGreaterThan(0)
    }
  })

  it('deja reportes sin verificar para la cola de M5', () => {
    expect(REPORTES_SIN_VERIFICAR.length).toBeGreaterThan(0)
    for (const r of REPORTES_SIN_VERIFICAR) {
      expect(ITEMS.has(r.codigoItem), r.codigoItem).toBe(true)
      const item = CATALOGO_SEMILLA.find((i) => i.codigo === r.codigoItem)!
      expect(item.tipo).toBe(r.tipo)
    }
  })

  it('siembra la capacidad flaca que hace visible SIN_CAPACIDAD', () => {
    expect(CAPACIDADES_SEMILLA.length).toBeGreaterThan(0)
    const familiasQueEsperan = NECESIDADES_VERIFICADAS.reduce((n, x) => n + x.familias, 0)
    const cupo = CAPACIDADES_SEMILLA.reduce((n, c) => n + c.cupoFamilias, 0)
    expect(cupo).toBeLessThan(familiasQueEsperan)
  })
})

/** Reachability over the seeded directed graph, honouring season. Mirrors M2's traversal. */
function alcanzablesDesde(
  origen: string,
  temporada: 'lluvias' | 'seca',
  filtro: (r: (typeof RUTAS_SEMILLA)[number]) => boolean = () => true,
): Set<string> {
  const aristas = RUTAS_SEMILLA.filter(
    (r) => r.activa && (r.temporada === 'todo_el_ano' || r.temporada === temporada) && filtro(r),
  )
  const vistos = new Set([origen])
  const pila = [origen]
  while (pila.length) {
    const actual = pila.pop()!
    for (const r of aristas.filter((x) => x.origen === actual)) {
      if (!vistos.has(r.destino)) {
        vistos.add(r.destino)
        pila.push(r.destino)
      }
    }
  }
  return vistos
}
