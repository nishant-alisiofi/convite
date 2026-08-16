import type { PoolClient } from 'pg'
import {
  ESTADOS_APADRINAMIENTO,
  RECURRENCIAS_APADRINAMIENTO,
  TIPOS_PADRINO,
} from '@/db/schema/apadrinamiento'

/**
 * PRD-12 «Apadrina una partera» — reading and recording sponsorships.
 *
 * Every function here runs against the client `conSesion()` hands it, so RLS (0041) is the real
 * boundary: a `verificador`/`despachador` session sees nothing and cannot write, and reads are
 * scoped to the caller's organisation. The panel gates the UI on top of that, but the data
 * boundary does not depend on the UI being right (Section 11).
 *
 * The money is plain COP. Postgres returns `bigint` as a string over pg, so the row mappers
 * below convert with `Number()`; COP amounts are far inside the safe-integer range.
 */

export const APADRINAMIENTO_ROLES = ['coordinador', 'admin'] as const

/** A sponsorship with its committed/applied/available balance rolled up. */
export type Apadrinamiento = {
  id: string
  beneficiarioEtiqueta: string
  comunidadId: string | null
  comunidadNombre: string | null
  padrinoNombre: string
  padrinoTipo: string
  proposito: string
  recurrencia: string
  estado: string
  consentimientoBeneficiario: boolean
  /** Committed COP. */
  montoCop: number
  /** COP already applied to pedidos/entregas. */
  aplicadoCop: number
  /** Committed minus applied — what is still free to fund a purchase. */
  disponibleCop: number
  aplicaciones: number
  creadoEn: Date
}

/** One line of the trace: a slice of an earmark applied to a real demand or delivery. */
export type AsignacionApadrinamiento = {
  id: string
  montoAplicadoCop: number
  concepto: string | null
  pedidoId: string | null
  entregaId: string | null
  codigoItem: string | null
  familias: number | null
  comunidadPedido: string | null
  entregaConfirmada: boolean | null
  creadoEn: Date
}

/** The pool figure PRD-9 draws on, and the sponsor-facing aggregate impact number. */
export type ResumenPool = {
  comprometidoCop: number
  aplicadoCop: number
  disponibleCop: number
  activos: number
}

/**
 * Available balance of one earmark. Pure so it can be unit-tested and reused by PRD-9 (funded
 * local purchase) without a database. Never negative: an application can never be recorded for
 * more than is committed, but clamping keeps a display honest if data is ever repaired by hand.
 */
export function saldoApadrinamiento(a: Pick<Apadrinamiento, 'montoCop' | 'aplicadoCop'>): number {
  return Math.max(0, a.montoCop - a.aplicadoCop)
}

/**
 * The funding pool: committed, applied and available across the *active* sponsorships. This is
 * what PRD-9 consumes and what a sponsor is shown as aggregate impact — never a per-beneficiary
 * breakdown that could re-identify a partera. Pure, for the same reasons as above.
 */
export function resumenPool(sponsorships: readonly Apadrinamiento[]): ResumenPool {
  const activos = sponsorships.filter((a) => a.estado === 'activo')
  const comprometidoCop = activos.reduce((s, a) => s + a.montoCop, 0)
  const aplicadoCop = activos.reduce((s, a) => s + a.aplicadoCop, 0)
  return {
    comprometidoCop,
    aplicadoCop,
    disponibleCop: Math.max(0, comprometidoCop - aplicadoCop),
    activos: activos.length,
  }
}

/** Every sponsorship the caller may see, newest first, each with its rolled-up balance. */
export async function listarApadrinamientos(client: PoolClient): Promise<Apadrinamiento[]> {
  const { rows } = await client.query<{
    id: string
    beneficiario_etiqueta: string
    comunidad_id: string | null
    comunidad_nombre: string | null
    padrino_nombre: string
    padrino_tipo: string
    proposito: string
    recurrencia: string
    estado: string
    consentimiento_beneficiario: boolean
    monto_cop: string
    aplicado_cop: string
    aplicaciones: string
    creado_en: Date
  }>(
    `select a.id,
            a.beneficiario_etiqueta,
            a.comunidad_id,
            c.nombre as comunidad_nombre,
            a.padrino_nombre,
            a.padrino_tipo,
            a.proposito,
            a.recurrencia,
            a.estado,
            a.consentimiento_beneficiario,
            a.monto_cop,
            coalesce(sum(asig.monto_aplicado_cop), 0) as aplicado_cop,
            count(asig.id) as aplicaciones,
            a.creado_en
       from apadrinamientos a
       left join comunidades c on c.id = a.comunidad_id
       left join apadrinamiento_asignaciones asig on asig.apadrinamiento_id = a.id
      group by a.id, c.nombre
      order by a.creado_en desc`,
  )

  return rows.map((r) => {
    const montoCop = Number(r.monto_cop)
    const aplicadoCop = Number(r.aplicado_cop)
    return {
      id: r.id,
      beneficiarioEtiqueta: r.beneficiario_etiqueta,
      comunidadId: r.comunidad_id,
      comunidadNombre: r.comunidad_nombre,
      padrinoNombre: r.padrino_nombre,
      padrinoTipo: r.padrino_tipo,
      proposito: r.proposito,
      recurrencia: r.recurrencia,
      estado: r.estado,
      consentimientoBeneficiario: r.consentimiento_beneficiario,
      montoCop,
      aplicadoCop,
      disponibleCop: saldoApadrinamiento({ montoCop, aplicadoCop }),
      aplicaciones: Number(r.aplicaciones),
      creadoEn: r.creado_en,
    }
  })
}

/** The trace for one sponsorship: what its funds actually paid for, newest first. */
export async function asignacionesDe(
  client: PoolClient,
  apadrinamientoId: string,
): Promise<AsignacionApadrinamiento[]> {
  const { rows } = await client.query<{
    id: string
    monto_aplicado_cop: string
    concepto: string | null
    pedido_id: string | null
    entrega_id: string | null
    codigo_item: string | null
    familias: number | null
    comunidad_pedido: string | null
    entrega_confirmada: boolean | null
    creado_en: Date
  }>(
    `select asig.id,
            asig.monto_aplicado_cop,
            asig.concepto,
            asig.pedido_id,
            asig.entrega_id,
            p.codigo_item,
            p.familias,
            pc.nombre as comunidad_pedido,
            e.confirmado as entrega_confirmada,
            asig.creado_en
       from apadrinamiento_asignaciones asig
       left join pedidos p on p.id = asig.pedido_id
       left join comunidades pc on pc.id = p.comunidad_id
       left join entregas e on e.id = asig.entrega_id
      where asig.apadrinamiento_id = $1
      order by asig.creado_en desc`,
    [apadrinamientoId],
  )

  return rows.map((r) => ({
    id: r.id,
    montoAplicadoCop: Number(r.monto_aplicado_cop),
    concepto: r.concepto,
    pedidoId: r.pedido_id,
    entregaId: r.entrega_id,
    codigoItem: r.codigo_item,
    familias: r.familias,
    comunidadPedido: r.comunidad_pedido,
    entregaConfirmada: r.entrega_confirmada,
    creadoEn: r.creado_en,
  }))
}

export type NuevoApadrinamiento = {
  organizacionId: string
  comunidadId?: string | null
  beneficiarioEtiqueta: string
  padrinoNombre: string
  padrinoContacto?: string | null
  padrinoTipo: (typeof TIPOS_PADRINO)[number]
  proposito: string
  montoCop: number
  recurrencia: (typeof RECURRENCIAS_APADRINAMIENTO)[number]
  consentimientoBeneficiario: boolean
  notas?: string | null
}

/**
 * Record a sponsorship. `actorId` becomes `creado_por`, which the RLS insert policy checks
 * against `auth.uid()` — you may record your own decision and nobody else's. The audit row is
 * written by the trigger in 0041, not here, so a write from anywhere is logged the same way.
 *
 * The consent invariant (a named community cannot be `activo` without consent) is enforced by
 * `apadrinamientos_consentida_check`; the row is inserted with the default `activo` state, so an
 * un-consented named community is refused at the database, not merely discouraged in the form.
 */
export async function crearApadrinamiento(
  client: PoolClient,
  entrada: NuevoApadrinamiento,
  actorId: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into apadrinamientos
       (organizacion_id, comunidad_id, beneficiario_etiqueta, padrino_nombre, padrino_contacto,
        padrino_tipo, proposito, monto_cop, recurrencia, consentimiento_beneficiario,
        consentimiento_en, creado_por, notas)
     values
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        case when $10 then now() else null end, $11, $12)
     returning id`,
    [
      entrada.organizacionId,
      entrada.comunidadId ?? null,
      entrada.beneficiarioEtiqueta,
      entrada.padrinoNombre,
      entrada.padrinoContacto ?? null,
      entrada.padrinoTipo,
      entrada.proposito,
      entrada.montoCop,
      entrada.recurrencia,
      entrada.consentimientoBeneficiario,
      actorId,
      entrada.notas ?? null,
    ],
  )
  return rows[0]!.id
}

export type NuevaAsignacion = {
  apadrinamientoId: string
  pedidoId?: string | null
  entregaId?: string | null
  montoAplicadoCop: number
  concepto?: string | null
}

/**
 * Apply part of an earmark to a real pedido/entrega — the traceability write. `actorId` becomes
 * `aplicado_por`, checked against `auth.uid()` by the RLS insert policy. Immutable once written
 * (no update/delete grant on the table).
 */
export async function aplicarFondos(
  client: PoolClient,
  entrada: NuevaAsignacion,
  actorId: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into apadrinamiento_asignaciones
       (apadrinamiento_id, pedido_id, entrega_id, monto_aplicado_cop, concepto, aplicado_por)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [
      entrada.apadrinamientoId,
      entrada.pedidoId ?? null,
      entrada.entregaId ?? null,
      entrada.montoAplicadoCop,
      entrada.concepto ?? null,
      actorId,
    ],
  )
  return rows[0]!.id
}

export { ESTADOS_APADRINAMIENTO, RECURRENCIAS_APADRINAMIENTO, TIPOS_PADRINO }
