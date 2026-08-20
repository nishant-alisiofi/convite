import { describe, expect, it } from 'vitest'
import { csvDeFilas, type FilaExporteAgenda } from '@/lib/exportes'

/**
 * PRD-34 §28's Informes-exports item — the CSV renderer, proven without a database because it
 * is pure: `filasExporteAgenda` (the DB-reading half) reuses `lib/jornadas.ts`'s already-tested
 * queries verbatim, so what is left to prove here is only that the *rendering* is valid CSV and
 * loses nothing on the way — RFC 4180 quoting, the accent-safe BOM, and one row per stop.
 */

function fila(parcial: Partial<FilaExporteAgenda> = {}): FilaExporteAgenda {
  return {
    codigo: 'J-260101-1',
    tipo: 'Distribución',
    titulo: 'Brigada de salud',
    estado: 'Planificada',
    region: 'Atrato',
    programa: '',
    fechaInicio: '15/03/2026',
    fechaFin: '',
    familiasAtendidas: '',
    paradaOrden: '1',
    paradaComunidad: 'Winandó',
    paradaNotas: '',
    ...parcial,
  }
}

describe('el CSV de la Agenda', () => {
  it('empieza con la marca de orden de bytes UTF-8', () => {
    const csv = csvDeFilas([])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })

  it('la cabecera trae las doce columnas en orden', () => {
    const csv = csvDeFilas([])
    const primeraLinea = csv.slice(1).split('\r\n')[0]
    expect(primeraLinea).toBe(
      [
        'Código',
        'Tipo',
        'Título',
        'Estado',
        'Región',
        'Programa',
        'Fecha inicio',
        'Fecha fin',
        'Familias atendidas',
        'Parada #',
        'Parada — comunidad',
        'Parada — notas',
      ].join(','),
    )
  })

  it('usa terminadores de línea CRLF, como pide RFC 4180', () => {
    const csv = csvDeFilas([fila()])
    expect(csv.includes('\r\n')).toBe(true)
    expect(csv.includes('\n\n')).toBe(false)
  })

  it('una fila ordinaria sale sin comillas', () => {
    const csv = csvDeFilas([fila()])
    const lineas = csv.slice(1).split('\r\n')
    expect(lineas[1]).toBe(
      'J-260101-1,Distribución,Brigada de salud,Planificada,Atrato,,15/03/2026,,,1,Winandó,',
    )
  })

  it('entrecomilla un campo con coma, y dobla las comillas internas', () => {
    const csv = csvDeFilas([
      fila({ titulo: 'Brigada, ronda 2', paradaNotas: 'trae "botas" de agua' }),
    ])
    const lineas = csv.slice(1).split('\r\n')
    expect(lineas[1]).toContain('"Brigada, ronda 2"')
    expect(lineas[1]).toContain('"trae ""botas"" de agua"')
  })

  it('entrecomilla un campo con salto de línea, sin partir la fila en dos', () => {
    const csv = csvDeFilas([fila({ paradaNotas: 'primera línea\nsegunda línea' })])
    const lineas = csv.slice(1).split('\r\n')
    // Cabecera + exactamente una fila de datos: el salto de línea interno no cuenta como fin de
    // fila porque el campo entero quedó entre comillas.
    expect(lineas.length).toBe(3) // cabecera, fila (con salto interno preservado), línea vacía final
    expect(lineas[1]).toContain('"primera línea\nsegunda línea"')
  })

  it('una jornada con varias paradas es una fila por parada, columnas de jornada repetidas', () => {
    const csv = csvDeFilas([
      fila({ paradaOrden: '1', paradaComunidad: 'Winandó' }),
      fila({ paradaOrden: '2', paradaComunidad: 'Bellavista' }),
    ])
    const lineas = csv.slice(1).split('\r\n').filter(Boolean)
    expect(lineas.length).toBe(3) // cabecera + 2 filas
    expect(lineas[1]).toContain('J-260101-1')
    expect(lineas[1]).toContain('Winandó')
    expect(lineas[2]).toContain('J-260101-1')
    expect(lineas[2]).toContain('Bellavista')
  })

  it('una jornada sin paradas deja esas tres columnas vacías, no una fila menos', () => {
    const csv = csvDeFilas([fila({ paradaOrden: '', paradaComunidad: '', paradaNotas: '' })])
    const lineas = csv.slice(1).split('\r\n')
    expect(lineas[1]).toBe(
      'J-260101-1,Distribución,Brigada de salud,Planificada,Atrato,,15/03/2026,,,,,',
    )
  })

  it('termina en una línea vacía tras el último CRLF, sin fila fantasma con datos', () => {
    const csv = csvDeFilas([fila()])
    expect(csv.endsWith('\r\n')).toBe(true)
  })
})
