import type { PoolClient } from 'pg'
import { MODOS_FLUVIALES } from '@/db/schema/vocabulario'

/**
 * FR-46 — boat-leg cost + lanchero payment (record-keeping only).
 *
 * The river is the road and the lancha is the truck: boat is already a transport mode on a leg
 * (`envios` for goods, `traslados_persona` for people, 0048). What was missing was the money —
 * what the leg cost, and what is owed to the lanchero who ran it. `pagos_lanchero` (migration
 * 0056) is that record, attached to exactly one leg. No disbursement — the coordinator marks a
 * payment `pagado` once it actually happens off-system, the same posture PRD-9's local-purchase
 * flow uses for funding without moving money.
 *
 * Money is plain COP; pg returns `bigint` as a string, so the mappers convert with `Number()`.
 */

/**
 * True when `modo` is a river-boat mode — `lancha` or `chalupa` (Section 7.3's
 * `MODOS_FLUVIALES`). A leg by either counts as a boat leg for cost + lanchero-payment purposes;
 * gating on the single literal `'lancha'` left `chalupa` legs — which the transporter self-signup
 * form and the seed data both use — unable to record a cost or a payment.
 */
export function esModoFluvial(modo: string | null | undefined): boolean {
  return modo != null && (MODOS_FLUVIALES as readonly string[]).includes(modo)
}

export type PagoLanchero = {
  id: string
  envioId: string | null
  trasladoPersonaId: string | null
  lancheroContactoId: string
  lancheroNombre: string | null
  lancheroTelefono: string
  costoTotalCop: number | null
  montoLancheroCop: number
  estadoPago: 'pendiente' | 'pagado'
  pagadoEn: Date | null
  notas: string | null
  creadoEn: Date
}

type FilaPago = {
  id: string
  envio_id: string | null
  traslado_persona_id: string | null
  lanchero_contacto_id: string
  lanchero_nombre: string | null
  lanchero_telefono: string
  costo_total_cop: string | null
  monto_lanchero_cop: string
  estado_pago: 'pendiente' | 'pagado'
  pagado_en: Date | null
  notas: string | null
  creado_en: Date
}

function mapearPago(r: FilaPago): PagoLanchero {
  return {
    id: r.id,
    envioId: r.envio_id,
    trasladoPersonaId: r.traslado_persona_id,
    lancheroContactoId: r.lanchero_contacto_id,
    lancheroNombre: r.lanchero_nombre,
    lancheroTelefono: r.lanchero_telefono,
    costoTotalCop: r.costo_total_cop === null ? null : Number(r.costo_total_cop),
    montoLancheroCop: Number(r.monto_lanchero_cop),
    estadoPago: r.estado_pago,
    pagadoEn: r.pagado_en,
    notas: r.notas,
    creadoEn: r.creado_en,
  }
}

const SELECT_PAGO = `
  select p.id, p.envio_id, p.traslado_persona_id, p.lanchero_contacto_id,
         ct.nombre as lanchero_nombre, ct.telefono as lanchero_telefono,
         p.costo_total_cop, p.monto_lanchero_cop, p.estado_pago, p.pagado_en, p.notas, p.creado_en
    from pagos_lanchero p
    join contactos ct on ct.id = p.lanchero_contacto_id
`

/** Payment records for one shipment, newest first. */
export async function pagosDeEnvio(client: PoolClient, envioId: string): Promise<PagoLanchero[]> {
  const { rows } = await client.query<FilaPago>(
    `${SELECT_PAGO} where p.envio_id = $1 order by p.creado_en desc`,
    [envioId],
  )
  return rows.map(mapearPago)
}

/** Payment records for one person trip, newest first. */
export async function pagosDeTraslado(
  client: PoolClient,
  trasladoPersonaId: string,
): Promise<PagoLanchero[]> {
  const { rows } = await client.query<FilaPago>(
    `${SELECT_PAGO} where p.traslado_persona_id = $1 order by p.creado_en desc`,
    [trasladoPersonaId],
  )
  return rows.map(mapearPago)
}

export type LancheroOpcion = { id: string; nombre: string; telefono: string }

/** Contacts registered as lancheros (rol='lanchero') — the payee picker's default list. */
export async function lancherosDisponibles(client: PoolClient): Promise<LancheroOpcion[]> {
  const { rows } = await client.query<{ id: string; nombre: string | null; telefono: string }>(
    `select id, nombre, telefono from contactos where rol = 'lanchero' and activo order by nombre`,
  )
  return rows.map((r) => ({ id: r.id, nombre: r.nombre ?? r.telefono, telefono: r.telefono }))
}

export type NuevoPagoLanchero = {
  organizacionId: string
  envioId?: string | null
  trasladoPersonaId?: string | null
  lancheroContactoId: string
  costoTotalCop?: number | null
  montoLancheroCop: number
  notas?: string | null
}

/**
 * Record what a boat leg cost and what is owed to the lanchero. Exactly one of `envioId` /
 * `trasladoPersonaId` must be given — the table's `pagos_lanchero_leg_check` enforces the same.
 */
export async function registrarPagoLanchero(
  client: PoolClient,
  entrada: NuevoPagoLanchero,
  actorId: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!entrada.envioId && !entrada.trasladoPersonaId) {
    return { ok: false, error: 'Falta el envío o el traslado al que pertenece este pago.' }
  }
  if (entrada.envioId && entrada.trasladoPersonaId) {
    return { ok: false, error: 'Un pago pertenece a un solo tramo, no a los dos.' }
  }
  if (!entrada.lancheroContactoId) {
    return { ok: false, error: 'Elija el lanchero a pagar.' }
  }
  if (!(entrada.montoLancheroCop > 0)) {
    return { ok: false, error: 'El monto para el lanchero debe ser mayor que cero.' }
  }

  try {
    const { rows } = await client.query<{ id: string }>(
      `insert into pagos_lanchero
         (organizacion_id, envio_id, traslado_persona_id, lanchero_contacto_id,
          costo_total_cop, monto_lanchero_cop, notas, creado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id`,
      [
        entrada.organizacionId,
        entrada.envioId ?? null,
        entrada.trasladoPersonaId ?? null,
        entrada.lancheroContactoId,
        entrada.costoTotalCop ?? null,
        entrada.montoLancheroCop,
        entrada.notas ?? null,
        actorId,
      ],
    )
    const fila = rows[0]
    if (!fila) return { ok: false, error: 'No se pudo registrar el pago.' }
    return { ok: true, id: fila.id }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'No se pudo registrar el pago.' }
  }
}

/** Mark a payment paid (2.1: carries who and when). Only from `pendiente`. */
export async function marcarPagoLancheroPagado(
  client: PoolClient,
  id: string,
  actorId: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `update pagos_lanchero
        set estado_pago = 'pagado', pagado_por = $2, pagado_en = now()
      where id = $1 and estado_pago = 'pendiente'`,
    [id, actorId],
  )
  return (rowCount ?? 0) > 0
}
