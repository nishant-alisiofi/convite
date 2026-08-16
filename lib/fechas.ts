/**
 * Human date rendering, in Colombian order and register.
 *
 * The native `<input type="date">` and `Intl`'s locale default both decide date order from
 * the environment — the browser's UI locale, or the runtime's ICU build — neither of which we
 * control on whatever machine a coordinator happens to open the panel on. A `toLocaleDateString`
 * that lands on `mm/dd/yyyy` on a US-configured browser is exactly the locale defect PRD v3 D4
 * calls out, in a product for the Chocó. So every date the panel *renders* is assembled here
 * in a fixed `dd/mm/yyyy` order on the América/Bogotá wall clock, instead of trusting the
 * locale to resolve to es-CO.
 */

const ZONA = 'America/Bogota'

function partes(fecha: Date, opciones: Intl.DateTimeFormatOptions): Record<string, string> {
  const partes = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA, ...opciones }).formatToParts(
    fecha,
  )
  const mapa: Record<string, string> = {}
  for (const parte of partes) mapa[parte.type] = parte.value
  return mapa
}

/** «16/08/2026» — Colombian order, always two digits, whatever the runtime locale resolves to. */
export function fechaCorta(fecha: Date): string {
  const p = partes(fecha, { day: '2-digit', month: '2-digit', year: 'numeric' })
  return `${p.day}/${p.month}/${p.year}`
}

/** «16/08/2026, 14:30» — the same, on a 24-hour clock so «p. m.» never has to be read. */
export function fechaHoraCorta(fecha: Date): string {
  const p = partes(fecha, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${p.day}/${p.month}/${p.year}, ${p.hour}:${p.minute}`
}

/**
 * Which part of the day, coarsely. The minute inside a perishable's computed expiry is an
 * artefact of the arithmetic, not a deadline anyone promised (PRD v3 D5, principle 6).
 */
export function franjaDelDia(fecha: Date): 'mañana' | 'tarde' | 'noche' {
  const hora = Number(partes(fecha, { hour: '2-digit', hour12: false }).hour)
  if (hora >= 5 && hora < 12) return 'mañana'
  if (hora >= 12 && hora < 19) return 'tarde'
  return 'noche'
}

/** «sábado en la tarde» — day plus part of day, never a clock time (PRD v3 D5). */
export function vencimientoAproximado(fecha: Date): string {
  const dia = partes(fecha, { weekday: 'long' }).weekday
  return `${dia} en la ${franjaDelDia(fecha)}`
}
