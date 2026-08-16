/**
 * iCalendar (RFC 5545) serialisation for the Agenda feed — PRD-34 §28.1, the first, no-OAuth
 * integration tier.
 *
 * §28.1 binds two rules harder here than anywhere else, because a feed syncs to a lock screen a
 * spouse or a colleague may see:
 *
 *   - **Titles carry the folio and the type, never the person or the condition.** This module never
 *     invents a title; the caller composes «folio · tipo» and passes it in. As a second line of
 *     defence, `limpiarSensible` strips anything shaped like a coordinate, a phone number or a
 *     point geometry from every text field before it reaches the wire — so a leak needs both a
 *     mistake upstream *and* a value that does not match a single one of the basin's own patterns.
 *
 *   - **Fixed UTC−5, never a floating time.** Colombia has no daylight saving, so a timed event is
 *     anchored to a `VTIMEZONE` for `America/Bogota` with a single, fixed `-0500` offset. A
 *     date-only event (a jornada is planned to a day, not an hour) is emitted as `VALUE=DATE`,
 *     which carries no time and therefore no timezone to get wrong.
 *
 * Nothing here touches the database. The serialiser is pure so the leak-safety property can be
 * proven by a unit test that feeds it hostile input, without standing up Postgres.
 */

/** The fixed timezone every timed event is anchored to. Colombia is UTC−5 with no DST. */
export const TZID = 'America/Bogota'

/**
 * An event, in the only two shapes the Agenda produces.
 *
 * `dia` is a whole-day occurrence (a jornada is planned to a date, §22) and carries its dates as
 * `YYYYMMDD` strings taken straight from the column with `to_char`, so no timezone ever shifts the
 * calendar day. `hora` is a moment (a shipment's scheduled departure) and carries a real instant,
 * rendered at the fixed Bogotá offset.
 */
export type EventoAgenda =
  | {
      clase: 'dia'
      uid: string
      /** The SUMMARY: «folio · tipo» only (§28.1). Never a name or a condition. */
      resumen: string
      /** Inclusive start, `YYYYMMDD`. */
      inicio: string
      /** Inclusive last day, `YYYYMMDD`; defaults to `inicio`. */
      fin?: string
      estado?: string
    }
  | {
      clase: 'hora'
      uid: string
      resumen: string
      inicio: Date
      /** Defaults to one hour after `inicio`. */
      fin?: Date
      estado?: string
    }

/**
 * Removes anything shaped like basin data from a text value.
 *
 * A belt-and-braces pass, not the primary control: the primary control is that the mappers only
 * ever put a folio and a controlled-vocabulary label into a title. But a title is a string, and a
 * folio scheme could one day carry a digit run that looks like a phone, so every field that
 * reaches the wire is scrubbed of the exact patterns the surface test forbids
 * (`tests/superficie.test.ts`): a Chocó coordinate, an E.164 number, a PostGIS point.
 */
export function limpiarSensible(texto: string): string {
  return texto
    .replace(/\b[4-8]\.\d{3,}\s*,?\s*-7[5-8]\.\d{3,}/g, '')
    .replace(/-7[5-8]\.\d{4,}/g, '')
    .replace(/\+57\d{10}/g, '')
    .replace(/0101000020E6100000/gi, '')
    .replace(/"type"\s*:\s*"Point"/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * RFC 5545 §3.3.11 text escaping. Backslash first, or it doubles the escapes that follow. A
 * newline becomes the literal two-character sequence `\n`; a carriage return is dropped so it
 * cannot smuggle a fold or a header into the value.
 */
export function escaparTexto(valor: string): string {
  return valor
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n')
}

/**
 * RFC 5545 §3.1 content-line folding. A line longer than 75 **octets** is split, and each
 * continuation begins with a single space. The count is bytes, not characters — «ó» is two
 * octets — so an accented title folds at the right place and no client rejects the line.
 */
export function plegarLinea(linea: string): string {
  const bytes = Buffer.from(linea, 'utf8')
  if (bytes.length <= 75) return linea

  const partes: string[] = []
  let inicio = 0
  // First line: 75 octets. Continuations: 74, because the leading space costs one.
  let limite = 75
  while (inicio < bytes.length) {
    let fin = Math.min(inicio + limite, bytes.length)
    // Do not split inside a multi-byte character: a UTF-8 continuation byte is 10xxxxxx.
    while (fin < bytes.length && ((bytes[fin] as number) & 0xc0) === 0x80) fin -= 1
    partes.push(bytes.subarray(inicio, fin).toString('utf8'))
    inicio = fin
    limite = 74
  }
  return partes.join('\r\n ')
}

/** `YYYYMMDDTHHMMSSZ` in UTC — for DTSTAMP, which RFC 5545 requires in UTC. */
export function selloUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  )
}

/**
 * `YYYYMMDDTHHMMSS` at the fixed Bogotá wall clock, for a value tagged `TZID=America/Bogota`.
 *
 * The stored instant is absolute (a `timestamptz`); Bogotá is a constant −5, so the wall clock is
 * the instant shifted back five hours and read in UTC fields. No DST table, because there is no
 * DST.
 */
export function horaBogota(d: Date): string {
  const b = new Date(d.getTime() - 5 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${b.getUTCFullYear()}${p(b.getUTCMonth() + 1)}${p(b.getUTCDate())}` +
    `T${p(b.getUTCHours())}${p(b.getUTCMinutes())}${p(b.getUTCSeconds())}`
  )
}

/** The day after a `YYYYMMDD` string — an all-day DTEND is exclusive (RFC 5545 §3.6.1). */
function diaSiguiente(yyyymmdd: string): string {
  const y = Number(yyyymmdd.slice(0, 4))
  const m = Number(yyyymmdd.slice(4, 6))
  const d = Number(yyyymmdd.slice(6, 8))
  const siguiente = new Date(Date.UTC(y, m - 1, d + 1))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${siguiente.getUTCFullYear()}${p(siguiente.getUTCMonth() + 1)}${p(siguiente.getUTCDate())}`
}

/**
 * The `VTIMEZONE` for the fixed Bogotá offset. One `STANDARD` block, no `DAYLIGHT`, because
 * Colombia never changes its clocks — which is the whole reason §28.1 asks for a fixed offset.
 */
function bloqueVTimezone(): string[] {
  return [
    'BEGIN:VTIMEZONE',
    `TZID:${TZID}`,
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0500',
    'TZNAME:-05',
    'END:STANDARD',
    'END:VTIMEZONE',
  ]
}

function lineasDeEvento(evento: EventoAgenda, sello: string): string[] {
  const lineas: string[] = ['BEGIN:VEVENT']
  lineas.push(`UID:${escaparTexto(limpiarSensible(evento.uid))}`)
  lineas.push(`DTSTAMP:${sello}`)

  if (evento.clase === 'dia') {
    lineas.push(`DTSTART;VALUE=DATE:${evento.inicio}`)
    lineas.push(`DTEND;VALUE=DATE:${diaSiguiente(evento.fin ?? evento.inicio)}`)
  } else {
    const fin = evento.fin ?? new Date(evento.inicio.getTime() + 60 * 60 * 1000)
    lineas.push(`DTSTART;TZID=${TZID}:${horaBogota(evento.inicio)}`)
    lineas.push(`DTEND;TZID=${TZID}:${horaBogota(fin)}`)
  }

  lineas.push(`SUMMARY:${escaparTexto(limpiarSensible(evento.resumen))}`)
  if (evento.estado) lineas.push(`STATUS:${evento.estado}`)
  lineas.push('END:VEVENT')
  return lineas
}

/**
 * Serialises a whole calendar. `ahora` is injectable so a test can assert an exact DTSTAMP; it
 * defaults to now. Output uses CRLF line endings and folded content lines, as RFC 5545 requires.
 */
export function serializarCalendario(
  eventos: EventoAgenda[],
  opciones: { nombre?: string; ahora?: Date } = {},
): string {
  const sello = selloUtc(opciones.ahora ?? new Date())
  const nombre = opciones.nombre ?? 'Convite · Agenda'

  const lineas: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Convite//Agenda ICS//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escaparTexto(limpiarSensible(nombre))}`,
    `X-WR-TIMEZONE:${TZID}`,
    ...bloqueVTimezone(),
  ]

  for (const evento of eventos) lineas.push(...lineasDeEvento(evento, sello))
  lineas.push('END:VCALENDAR')

  // Fold every line, then join with CRLF and terminate the last line the same way.
  return `${lineas.map(plegarLinea).join('\r\n')}\r\n`
}
