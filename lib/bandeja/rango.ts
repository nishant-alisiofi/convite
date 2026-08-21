import type { FaseRespuesta } from '@/db/schema/vocabulario'

/**
 * One comparable rank across three kinds of thing that were never comparable before.
 *
 * §18's complaint is that «Tablero and Verificación are two inboxes. A coordinator checks two
 * places to know what needs them, and jornada tasks and allocation decisions will make it four.»
 * Merging them is not a layout problem: a report awaiting verification, a pedido stuck for want
 * of a boat, and a community that has gone quiet have no shared unit. `urgencia` exists on
 * reportes and pedidos, and silence has none at all — only a connectivity tier and a count of
 * days past its own check-in interval.
 *
 * So this module invents the missing comparison, and keeps it pure and small enough to argue
 * with. The numbers are deliberately coarse: bands, not a score anyone should read as precision.
 * A coordinator is choosing what to do next, not sorting a leaderboard.
 */

export type TipoItem = 'verificar' | 'atascado' | 'silencio'

export type Rankeable = {
  tipo: TipoItem
  /** PRD-49: a flagged disclosure. Outranks everything, and never by competing on urgencia. */
  sensible: boolean
  /** 1–3 where the item has one. Reports and pedidos do; silence does not. */
  urgencia: number | null
  /** Days this has been waiting — since the report arrived, the pedido stuck, or the last signal. */
  dias: number
  /** Silence only: 1 (reliable data) … 4 (radio relay only). */
  tier?: number | null
  /** Silence only: nothing has EVER arrived from this community — §14's «nunca vista». */
  nuncaVista?: boolean
  /** Silence only: the community's own check-in interval, which is what «late» is measured against. */
  intervaloDias?: number | null
}

/** Sensitive disclosures sit in their own band, above every ordinary rank. */
const BANDA_SENSIBLE = 10_000
/** What the phase decides to lead with (§18) gets one band, never a free pass past `sensible`. */
const BANDA_FASE = 1_000

/** §18: phase changes what the Bandeja leads with, never the structure. */
const LIDERA_POR_FASE: Record<FaseRespuesta, TipoItem> = {
  impacto: 'silencio', // «Silence, unreachable communities»
  emergencia: 'atascado', // «Stuck states, matches to confirm»
  recuperacion: 'verificar', // «Assessments to review, projects to cost»
  ordinario: 'verificar', // «Anticipatory proposals, scheduling»
}

/**
 * How loud a silence is.
 *
 * BUG-24's distinction is the whole point and it is easy to lose: a tier-1 or tier-2 community
 * that has NEVER been heard from is a broken contact — somebody wrote the number down wrong, or
 * the phone is gone — and that is an operational fault to fix. A tier-3 or tier-4 community that
 * has never been heard from is a community that communicates by radio relay and boat, and its
 * quiet is «alta, no alarma». Ranking those the same is exactly the collapse BUG-24 fixed on
 * Comunidades, and it must not come back through the inbox.
 */
function rangoDeSilencio(r: Rankeable): number {
  const tier = r.tier ?? 4
  if (r.nuncaVista) return tier <= 2 ? 700 : 150

  // Otherwise: how far past its own interval, not how many days absolute. Thirty days of quiet
  // from a community we check monthly is on time; five days from one we check every three is not.
  const intervalo = Math.max(r.intervaloDias ?? 30, 1)
  const vencimientos = r.dias / intervalo
  return Math.min(600, Math.round(vencimientos * 120))
}

/**
 * The rank of one item under one phase. Higher sorts first.
 *
 * Ordering, outermost first: sensitive, then whatever the phase leads with, then the item's own
 * weight, then age. Age is last and small — it breaks ties without ever letting a stale trivial
 * item climb over a fresh serious one, which is the failure mode of a pure FIFO queue.
 */
export function rangoDe(r: Rankeable, fase: FaseRespuesta): number {
  let n = 0
  if (r.sensible) n += BANDA_SENSIBLE
  if (LIDERA_POR_FASE[fase] === r.tipo) n += BANDA_FASE

  if (r.tipo === 'silencio') n += rangoDeSilencio(r)
  else n += (r.urgencia ?? 1) * 200

  // Caps at ~50 so age can order a band but never jump one.
  n += Math.min(50, r.dias)
  return n
}

/** Sort a mixed list into the order a coordinator should work it. */
export function ordenarBandeja<T extends Rankeable>(items: T[], fase: FaseRespuesta): T[] {
  return [...items].sort((a, b) => rangoDe(b, fase) - rangoDe(a, fase))
}
