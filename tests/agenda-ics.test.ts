import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { COMUNIDADES_SEMILLA } from '@/db/seed/comunidades'
import { envioAEvento, jornadaAEvento } from '@/lib/agenda-ics/feed'
import { type EventoAgenda, escaparTexto, plegarLinea, serializarCalendario } from '@/lib/agenda-ics/ics'
import { membresiaDeToken, tokenDeAgenda, urlDeSuscripcion } from '@/lib/agenda-ics/token'

/**
 * PRD-34 §28.1 — the .ics Agenda feed. Two properties are load-bearing and both are proven here
 * without a database, because the serialiser and the token are pure:
 *
 *   1. It produces valid iCalendar — a well-formed VCALENDAR with one VEVENT per event, CRLF
 *      endings, folded lines, escaped text, and a fixed UTC−5 offset (Colombia has no DST).
 *   2. It leaks nothing a lock screen must not show — no coordinate, no phone, no community name —
 *      even when handed hostile input, because the titles are «folio · tipo» and every field is
 *      scrubbed on the way out.
 *
 * The token is «a secret tied to a membership, revoked on offboarding» (§28.1 / §29.6): its
 * mint/verify contract is checked here; the offboarding half (only an `activa` membership serves)
 * lives in the route + `membresiaActivaParaFeed`, which the surface test exercises over HTTP.
 */

const SECRETO = 'x'.repeat(48)
const MEMBRESIA = '11111111-2222-4333-8444-555555555555'

// Community names are the one thing a feed must never carry; a municipality is published on purpose.
const COMUNIDADES = COMUNIDADES_SEMILLA.map((c) => c.nombre).filter(
  (n) => !['Quibdó', 'Yuto', 'Bellavista', 'Beté', 'Paimadó'].includes(n),
)

const PROHIBIDOS: { nombre: string; patron: RegExp }[] = [
  { nombre: 'coordenada', patron: /\b[4-8]\.\d{3,}\s*,?\s*-7[5-8]\.\d{3,}/ },
  { nombre: 'longitud del Chocó', patron: /-7[5-8]\.\d{4,}/ },
  { nombre: 'teléfono E.164', patron: /\+57\d{10}/ },
  { nombre: 'punto PostGIS', patron: /"type"\s*:\s*"Point"|0101000020E6100000/i },
]

/** Physical lines, minus the trailing empty one from the final CRLF. */
function lineasFisicas(ics: string): string[] {
  const partes = ics.split('\r\n')
  return partes[partes.length - 1] === '' ? partes.slice(0, -1) : partes
}

/** Unfolds RFC 5545 continuation lines (`\r\n ` → nothing) so a value can be read whole. */
function desplegar(ics: string): string {
  return ics.replace(/\r\n /g, '')
}

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = SECRETO
})

describe('el token del feed de agenda', () => {
  const original = process.env.BETTER_AUTH_SECRET
  afterEach(() => {
    process.env.BETTER_AUTH_SECRET = original ?? SECRETO
  })

  it('va y vuelve a la misma membresía', () => {
    const token = tokenDeAgenda(MEMBRESIA)
    expect(membresiaDeToken(token)).toBe(MEMBRESIA)
  })

  it('tolera el sufijo .ics de la URL', () => {
    const token = `${tokenDeAgenda(MEMBRESIA)}.ics`
    expect(membresiaDeToken(token)).toBe(MEMBRESIA)
  })

  it('rechaza una firma alterada', () => {
    const token = tokenDeAgenda(MEMBRESIA)
    const [cuerpo, firma] = token.split('.') as [string, string]
    const alterada = `${firma.slice(0, -1)}${firma.slice(-1) === 'A' ? 'B' : 'A'}`
    expect(membresiaDeToken(`${cuerpo}.${alterada}`)).toBeNull()
  })

  it('rechaza un cuerpo alterado (firmado para otra membresía)', () => {
    const token = tokenDeAgenda(MEMBRESIA)
    const otro = tokenDeAgenda('99999999-8888-4777-8666-555555555555')
    // Swap the body of one onto the signature of the other: neither verifies.
    expect(membresiaDeToken(`${token.split('.')[0]}.${otro.split('.')[1]}`)).toBeNull()
  })

  it('rechaza basura y tokens mal formados', () => {
    expect(membresiaDeToken('')).toBeNull()
    expect(membresiaDeToken('sin-punto')).toBeNull()
    expect(membresiaDeToken('a.b.c')).toBeNull()
  })

  it('no verifica nada sin secreto configurado (falla cerrado)', () => {
    const token = tokenDeAgenda(MEMBRESIA)
    delete process.env.BETTER_AUTH_SECRET
    expect(membresiaDeToken(token)).toBeNull()
  })

  it('construye una URL de suscripción con sufijo .ics', () => {
    const url = urlDeSuscripcion(MEMBRESIA, 'https://convite.example')
    expect(url).toMatch(/^https:\/\/convite\.example\/api\/agenda\/.+\.ics$/)
    // The token inside the URL round-trips back to the membership.
    const token = url.split('/api/agenda/')[1] as string
    expect(membresiaDeToken(token)).toBe(MEMBRESIA)
  })
})

describe('la serialización iCalendar', () => {
  const eventos: EventoAgenda[] = [
    jornadaAEvento({
      id: '00000000-0000-4000-8000-000000000001',
      codigo: 'J-0001',
      tipo: 'distribucion',
      estado: 'planificada',
      inicio: '20260315',
      fin: null,
    }),
    envioAEvento({
      id: '00000000-0000-4000-8000-000000000002',
      codigo: 'E-0002',
      modo: 'lancha',
      estado: 'PLANEADO',
      salida_programada: new Date('2026-03-15T14:30:00Z'),
    }),
  ]
  const ics = serializarCalendario(eventos, { ahora: new Date('2026-01-01T00:00:00Z') })

  it('es un VCALENDAR bien formado con un VEVENT por evento', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
    expect(ics).toContain('VERSION:2.0')
    expect(ics).toContain('PRODID:-//Convite//Agenda ICS//ES')
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2)
    expect((ics.match(/END:VEVENT/g) ?? []).length).toBe(2)
    // BEGIN/END pairs are balanced.
    expect((ics.match(/BEGIN:/g) ?? []).length).toBe((ics.match(/END:/g) ?? []).length)
  })

  it('cada VEVENT tiene UID, DTSTAMP, DTSTART y SUMMARY', () => {
    const desplegado = desplegar(ics)
    expect(desplegado).toContain('UID:jornada-00000000-0000-4000-8000-000000000001@convite')
    expect(desplegado).toContain('UID:envio-00000000-0000-4000-8000-000000000002@convite')
    expect((desplegado.match(/DTSTAMP:20260101T000000Z/g) ?? []).length).toBe(2)
    expect(desplegado).toContain('SUMMARY:J-0001 · Distribución')
    expect(desplegado).toContain('SUMMARY:E-0002 · Envío (Lancha)')
  })

  it('emite la jornada como un evento de día entero', () => {
    const desplegado = desplegar(ics)
    expect(desplegado).toContain('DTSTART;VALUE=DATE:20260315')
    // All-day DTEND is exclusive: the day after.
    expect(desplegado).toContain('DTEND;VALUE=DATE:20260316')
  })

  it('ancla el envío a un desfase fijo UTC−5, sin hora flotante', () => {
    const desplegado = desplegar(ics)
    // A VTIMEZONE fixed at −0500, with no DAYLIGHT block (Colombia never changes clocks).
    expect(desplegado).toContain('BEGIN:VTIMEZONE')
    expect(desplegado).toContain('TZID:America/Bogota')
    expect(desplegado).toContain('TZOFFSETTO:-0500')
    expect(desplegado).not.toContain('BEGIN:DAYLIGHT')
    // 14:30Z at −5 is 09:30 local, tagged with the zone, never a bare/floating time.
    expect(desplegado).toContain('DTSTART;TZID=America/Bogota:20260315T093000')
  })

  it('usa CRLF y no deja ninguna línea física por encima de 75 octetos', () => {
    expect(ics.includes('\r\n')).toBe(true)
    for (const linea of lineasFisicas(ics)) {
      expect(Buffer.byteLength(linea, 'utf8'), `línea larga: ${linea}`).toBeLessThanOrEqual(75)
    }
  })

  it('pliega una línea larga con una continuación que empieza por espacio', () => {
    const largo = serializarCalendario(
      [
        {
          clase: 'dia',
          uid: 'x@convite',
          resumen: `L-1 · ${'palabra '.repeat(20)}`,
          inicio: '20260101',
        },
      ],
      { ahora: new Date('2026-01-01T00:00:00Z') },
    )
    expect(largo).toMatch(/\r\n /)
    for (const linea of lineasFisicas(largo)) {
      expect(Buffer.byteLength(linea, 'utf8')).toBeLessThanOrEqual(75)
    }
  })

  it('escapa los caracteres especiales de RFC 5545', () => {
    expect(escaparTexto('A; B, C\\D\nE')).toBe('A\\; B\\, C\\\\D\\nE')
  })
})

describe('la discreción de §28.1: el feed nunca filtra la cuenca', () => {
  it('los títulos son «folio · tipo» y nada más', () => {
    const jornada = jornadaAEvento({
      id: '00000000-0000-4000-8000-000000000009',
      codigo: 'J-0042',
      tipo: 'brigada',
      estado: 'planificada',
      inicio: '20260401',
      fin: null,
    })
    expect(jornada.resumen).toBe('J-0042 · Brigada')
  })

  it('depura coordenadas, teléfonos y geometrías aunque lleguen en un campo', () => {
    // Hostile input: someone puts basin data where only a code belongs. It must not survive.
    const eventos: EventoAgenda[] = [
      jornadaAEvento({
        id: '00000000-0000-4000-8000-00000000000a',
        codigo: 'J-9 5.6919,-76.6583 +573001234567',
        tipo: 'distribucion',
        estado: 'planificada',
        inicio: '20260501',
        fin: null,
      }),
      {
        clase: 'hora',
        uid: 'raro@convite',
        resumen: 'E-9 {"type":"Point"} 0101000020E6100000',
        inicio: new Date('2026-05-01T12:00:00Z'),
      },
    ]
    const ics = serializarCalendario(eventos)
    for (const { nombre, patron } of PROHIBIDOS) {
      expect(patron.test(ics), `el feed filtró ${nombre}`).toBe(false)
    }
  })

  it('no nombra ninguna comunidad sembrada', () => {
    // A realistic feed, built from the fields the mappers actually read (a code, a type, a date),
    // can never contain a community name — the mappers do not touch community data.
    const ics = serializarCalendario([
      jornadaAEvento({
        id: '00000000-0000-4000-8000-00000000000b',
        codigo: 'J-7',
        tipo: 'taller',
        estado: 'en_curso',
        inicio: '20260601',
        fin: '20260603',
      }),
    ])
    for (const comunidad of COMUNIDADES) {
      expect(ics.includes(comunidad), `el feed nombró a ${comunidad}`).toBe(false)
    }
  })

  it('plegarLinea no rompe un carácter multibyte', () => {
    // A line of accented characters must fold on a character boundary, so it still decodes.
    const linea = `SUMMARY:${'ó'.repeat(60)}`
    const plegada = plegarLinea(linea)
    // Re-joining the continuations reproduces the original exactly (no mojibake, no lost bytes).
    expect(plegada.replace(/\r\n /g, '')).toBe(linea)
  })
})
