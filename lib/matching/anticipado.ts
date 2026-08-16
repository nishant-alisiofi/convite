import type { PoolClient } from 'pg'

/**
 * Anticipatory supply (PRD-33 §24 / §30).
 *
 * In `ordinario`, demand is largely predictable — a partera on losartán needs a refill monthly,
 * diabetes supplies deplete at a known rate, a pregnancy has a due date — so the order is
 * proposed BEFORE she asks, instead of waiting for a stockout to be reported. This is a
 * different resolver from the reactive matcher (lib/matching/resolver): it fires on a cadence,
 * never on a report, and only for a subscription that carries one.
 *
 * Like the reactive matcher it only ever *proposes*. A person confirms before a proposal becomes
 * a pedido (non-negotiable 2.1, principle 7). And, per §27b.1/§2, Convite consumes a cadence set
 * clinically or by the coordinator — it does not prescribe one. The same resolver serves FR-17
 * telemedicine fulfilment, so there is one anticipation engine, not two.
 */

const DIA = 86_400_000

export type SuministroAnticipado = {
  id: string
  codigoItem: string
  familias: number
  /** Refill interval in days. Null = no cadence: the resolver never fires for it (AC4). */
  cadenciaDias: number | null
  /** Propose this many days before the next refill is due. */
  diasAnticipacion: number
  /** When it was last supplied. Null = never; the base for the first proposal is `creadoEn`. */
  ultimoSuministroEn: Date | null
  /** The order is only valid until here (from the telemedicine order, §27b.1). Null = open. */
  vigenciaHasta: Date | null
  activo: boolean
  /** Fallback base date when never supplied — the subscription's own start. */
  creadoEn: Date
}

export type PropuestaAnticipada = {
  suministroId: string
  /** The refill due date this proposal is for. */
  propuestoParaEn: Date
}

/**
 * The next refill due date: last supply (or the subscription's start) plus the cadence. Null
 * when there is no cadence — a need tracked, but not on a clock.
 */
export function proximoVencimiento(suministro: SuministroAnticipado): Date | null {
  if (suministro.cadenciaDias === null) return null
  const base = suministro.ultimoSuministroEn ?? suministro.creadoEn
  return new Date(base.getTime() + suministro.cadenciaDias * DIA)
}

/**
 * Which subscriptions are due for an anticipatory proposal now — those whose next refill falls
 * within the lead-time window from `ahora`. Pure: no database, so the cadence logic is as cheap
 * to pin down as the five matcher states.
 *
 * Never fires for a subscription with no cadence, one that is inactive, or one past its validity
 * (AC4). The result is a proposal per due date, nothing more — a person still confirms it.
 */
export function resolverAnticipado(
  suministros: readonly SuministroAnticipado[],
  ahora: Date,
): PropuestaAnticipada[] {
  const propuestas: PropuestaAnticipada[] = []

  for (const suministro of suministros) {
    if (!suministro.activo) continue
    // AC4: no cadence, no anticipation. This is the line that keeps it distinct from the
    // reactive matcher — a need without a clock is somebody else's trigger, not this one's.
    if (suministro.cadenciaDias === null) continue
    if (suministro.vigenciaHasta && suministro.vigenciaHasta <= ahora) continue

    const vence = proximoVencimiento(suministro)
    if (!vence) continue

    const limite = new Date(ahora.getTime() + suministro.diasAnticipacion * DIA)
    if (vence <= limite) {
      propuestas.push({ suministroId: suministro.id, propuestoParaEn: vence })
    }
  }

  return propuestas
}

export type ResumenAnticipado = {
  evaluados: number
  propuestos: number
}

/**
 * The thin impure shell around the pure resolver, mirroring `emparejar`: read the active
 * subscriptions, decide which are due, write a proposal for each. It writes nothing else — no
 * pedido, no stock move — because the proposal is a human decision (2.1).
 *
 * Idempotent: a proposal is unique per (subscription, due date), so re-running never duplicates
 * and never touches one a person already confirmed. Ready for FR-17 / a scheduled job to call;
 * it is not wired to a cron here.
 */
export async function proponerAnticipados(
  client: PoolClient,
  ahora: Date = new Date(),
): Promise<ResumenAnticipado> {
  const { rows } = await client.query(
    `select id, codigo_item, familias, cadencia_dias, dias_anticipacion,
            ultimo_suministro_en, vigencia_hasta, activo, creado_en
       from suministros_anticipados
      where activo`,
  )

  const suministros: SuministroAnticipado[] = rows.map((r) => ({
    id: r.id,
    codigoItem: r.codigo_item,
    familias: r.familias,
    cadenciaDias: r.cadencia_dias,
    diasAnticipacion: r.dias_anticipacion,
    ultimoSuministroEn: r.ultimo_suministro_en,
    vigenciaHasta: r.vigencia_hasta,
    activo: r.activo,
    creadoEn: r.creado_en,
  }))

  const propuestas = resolverAnticipado(suministros, ahora)

  for (const propuesta of propuestas) {
    await client.query(
      `insert into propuestas_anticipadas (suministro_id, propuesto_para_en)
         values ($1, $2)
       on conflict (suministro_id, propuesto_para_en) do nothing`,
      [propuesta.suministroId, propuesta.propuestoParaEn],
    )
  }

  return { evaluados: suministros.length, propuestos: propuestas.length }
}
