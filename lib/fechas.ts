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

/**
 * Normalizes a Postgres `date` column's value to `YYYY-MM-DD`.
 *
 * `pg` has no custom type parser registered (see `db/client.ts`), so a `date` column — no time,
 * no timezone — comes back from a raw `client.query()` as a JS `Date` at local midnight, not the
 * ISO string every `fecha_inicio`/`fecha_fin` mapper in this codebase types it as (BUG-22). The
 * mismatch only surfaces once the value is used: a re-parse like `` `${fecha}T00:00:00Z` `` gets
 * fed `Date.prototype.toString()` instead of `2026-08-25`, and produces `Invalid Date` — and, in
 * `lib/programas.ts`'s `ventana()`, an `Invalid Date` that propagates to `NaN`, which empties the
 * whole twelve-month feasibility calendar (PRD-31) rather than merely mis-rendering one field.
 *
 * Call this once, at the row-mapping boundary (`mapear()` / `mapearPrograma()`), so the
 * `string | null` type the rest of the app already declares is actually true rather than a lie.
 * Local `Date` getters, not UTC ones: `postgres-date` builds the object with
 * `new Date(year, month, day)` in whatever timezone the Node process runs in, so reading it back
 * with the matching local getters round-trips the calendar day exactly, on any server timezone.
 */
export function fechaSqlADia(v: Date | string | null): string | null {
  if (v === null) return null
  if (!(v instanceof Date)) return v
  const anio = v.getFullYear()
  const mes = String(v.getMonth() + 1).padStart(2, '0')
  const dia = String(v.getDate()).padStart(2, '0')
  return `${anio}-${mes}-${dia}`
}

/**
 * «16/08/2026» from a date-ONLY value — a Postgres `date` column (already normalized to
 * `YYYY-MM-DD` by `fechaSqlADia`) or the same string a `<input type="date">` submits.
 *
 * Deliberately does not reuse `fechaCorta`'s own timezone conversion on a midnight-UTC instant:
 * América/Bogotá is UTC-5, so a `Date` built from `${fecha}T00:00:00Z` would format as the
 * PREVIOUS calendar day once shown in that timezone. Anchoring at noon UTC instead keeps the
 * whole day inside the same América/Bogotá date no matter the zone, which is what a value with no
 * time component — and so no real instant — should mean.
 */
export function fechaSoloDia(fecha: string): string {
  return fechaCorta(new Date(`${fecha}T12:00:00Z`))
}
