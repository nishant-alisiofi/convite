import { describe, expect, it } from 'vitest'
import type {
  CapacidadGrafo,
  NodoGrafo,
  RutaGrafo,
} from '@/lib/matching/tipos'
import {
  type ContextoTraslado,
  emparejarTraslado,
  type SolicitudTraslado,
} from '@/lib/traslados/emparejador'
import { construirCuenca, enDias } from './fixtures/cuenca'

/**
 * PRD-8 acceptance for the matcher (§25). No database: like the goods resolver, matching a person
 * to a seat is a pure function over a snapshot. Two lenses here — the real seeded basin (to prove
 * the capacity path is genuinely reused, not a toy) and a controlled two-community graph (to pin
 * the RETURN leg down without depending on the seed's upstream topology).
 */

describe('emparejar un traslado sobre la cuenca real', () => {
  it('LISTO: hay una lancha con cupo que va para allá en la ventana', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.sinCapacidades()
    // Aníbal sale de Quibdó (nodo BOD-QBD) para Tagachí dentro de 3 días, con 40 cupos.
    cuenca.agregarCapacidad({ origenNodoId: 'BOD-QBD', hastaComunidadId: 'TAG', cupoFamilias: 40 })

    const solicitud: SolicitudTraslado = {
      id: 't1',
      origenComunidadId: 'QBD',
      destinoComunidadId: 'TAG',
      personas: 2,
      ventanaDesde: cuenca.ctx.ahora,
      ventanaHasta: enDias(10),
    }

    const veredicto = emparejarTraslado(solicitud, cuenca.ctx)
    expect(veredicto.estado).toBe('LISTO')
    expect(veredicto.capacidadId).toBeDefined()
    expect(veredicto.motivo).toContain('2 personas')
  })

  it('SIN_CAPACIDAD: hay camino, pero la única lancha no tiene cupo para todos', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.sinCapacidades()
    cuenca.agregarCapacidad({ origenNodoId: 'BOD-QBD', hastaComunidadId: 'TAG', cupoFamilias: 1 })

    const veredicto = emparejarTraslado(
      {
        id: 't2',
        origenComunidadId: 'QBD',
        destinoComunidadId: 'TAG',
        personas: 3,
        ventanaDesde: cuenca.ctx.ahora,
        ventanaHasta: enDias(10),
      },
      cuenca.ctx,
    )
    expect(veredicto.estado).toBe('SIN_CAPACIDAD')
    expect(veredicto.capacidadId).toBeUndefined()
  })

  it('SIN_CAPACIDAD: la lancha sale fuera de la ventana pedida', () => {
    const cuenca = construirCuenca('lluvias')
    cuenca.sinCapacidades()
    cuenca.agregarCapacidad({
      origenNodoId: 'BOD-QBD',
      hastaComunidadId: 'TAG',
      cupoFamilias: 40,
      saleEn: enDias(20),
    })

    const veredicto = emparejarTraslado(
      {
        id: 't3',
        origenComunidadId: 'QBD',
        destinoComunidadId: 'TAG',
        personas: 1,
        ventanaDesde: cuenca.ctx.ahora,
        ventanaHasta: enDias(5),
      },
      cuenca.ctx,
    )
    expect(veredicto.estado).toBe('SIN_CAPACIDAD')
  })

  it('SIN_RUTA: en verano no hay paso hacia Winandó', () => {
    const cuenca = construirCuenca('seca')
    const veredicto = emparejarTraslado(
      {
        id: 't4',
        origenComunidadId: 'QBD',
        destinoComunidadId: 'WIN',
        personas: 1,
        ventanaDesde: cuenca.ctx.ahora,
        ventanaHasta: enDias(30),
      },
      cuenca.ctx,
    )
    expect(veredicto.estado).toBe('SIN_RUTA')
  })
})

describe('un traslado con pierna de regreso (§25)', () => {
  // A minimal two-community basin, fully under our control: A ⇄ B, a node and a departing vehicle
  // on each side, so both the outbound leg (A→B) and the RETURN leg (B→A) can be matched.
  const AHORA = new Date('2026-08-13T12:00:00Z')
  const enDiasLocal = (n: number) => new Date(AHORA.getTime() + n * 86_400_000)

  const rutas: RutaGrafo[] = [
    { id: 'r-ab', origenId: 'A', destinoId: 'B', modo: 'lancha', minutos: 120, temporada: 'todo_el_ano', activa: true },
    { id: 'r-ba', origenId: 'B', destinoId: 'A', modo: 'lancha', minutos: 150, temporada: 'todo_el_ano', activa: true },
  ]
  const nodos: NodoGrafo[] = [
    { id: 'NA', nombre: 'Nodo A', comunidadId: 'A', activo: true, lat: null, lon: null },
    { id: 'NB', nombre: 'Nodo B', comunidadId: 'B', activo: true, lat: null, lon: null },
  ]
  const capacidades: CapacidadGrafo[] = [
    // Outbound: A → B, leaving in 3 days, 4 seats.
    { id: 'cap-ida', contactoNombre: 'Aníbal', modo: 'lancha', origenNodoId: 'NA', hastaComunidadId: 'B', saleEn: enDiasLocal(3), cupoFamilias: 4, estado: 'OFRECIDA' },
    // Return: B → A, leaving in 12 days, 4 seats.
    { id: 'cap-vuelta', contactoNombre: 'Rosa', modo: 'lancha', origenNodoId: 'NB', hastaComunidadId: 'A', saleEn: enDiasLocal(12), cupoFamilias: 4, estado: 'OFRECIDA' },
  ]
  const contexto: ContextoTraslado = {
    ahora: AHORA,
    temporada: 'lluvias',
    rutas,
    nodos,
    capacidades,
    nombresComunidad: new Map([
      ['A', 'Puerto Meluk'],
      ['B', 'Quibdó'],
    ]),
  }

  it('empareja la ida: la partera sale de A hacia la atención en B', () => {
    const ida: SolicitudTraslado = {
      id: 'ida',
      origenComunidadId: 'A',
      destinoComunidadId: 'B',
      personas: 2, // la partera y una acompañante
      ventanaDesde: AHORA,
      ventanaHasta: enDiasLocal(7),
    }
    const veredicto = emparejarTraslado(ida, contexto)
    expect(veredicto.estado).toBe('LISTO')
    expect(veredicto.capacidadId).toBe('cap-ida')
  })

  it('empareja el regreso: el mismo viaje, de vuelta de B hacia A', () => {
    const regreso: SolicitudTraslado = {
      id: 'regreso',
      origenComunidadId: 'B',
      destinoComunidadId: 'A',
      personas: 2,
      ventanaDesde: enDiasLocal(9),
      ventanaHasta: enDiasLocal(16),
    }
    const veredicto = emparejarTraslado(regreso, contexto)
    expect(veredicto.estado).toBe('LISTO')
    expect(veredicto.capacidadId).toBe('cap-vuelta')
  })

  it('el regreso no toma la lancha de la ida (dirección y ventana distintas)', () => {
    // La lancha de la ida (A→B, día 3) no sirve para el regreso (B→A, ventana día 9–16): ni la
    // dirección ni la ventana coinciden. Es un emparejamiento propio, no un reciclaje del de ida.
    const regreso: SolicitudTraslado = {
      id: 'regreso2',
      origenComunidadId: 'B',
      destinoComunidadId: 'A',
      personas: 2,
      ventanaDesde: enDiasLocal(9),
      ventanaHasta: enDiasLocal(16),
    }
    const veredicto = emparejarTraslado(regreso, contexto)
    expect(veredicto.capacidadId).not.toBe('cap-ida')
  })

  it('no muta el contexto que se le pasa', () => {
    const antes = JSON.stringify(contexto.capacidades)
    emparejarTraslado(
      { id: 'x', origenComunidadId: 'A', destinoComunidadId: 'B', personas: 1, ventanaDesde: AHORA, ventanaHasta: enDiasLocal(7) },
      contexto,
    )
    expect(JSON.stringify(contexto.capacidades)).toBe(antes)
  })
})
