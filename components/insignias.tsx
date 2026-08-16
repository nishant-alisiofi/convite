import {
  AudioLines,
  FileText,
  Globe,
  MessageCircle,
  MessageSquare,
  PhoneMissed,
  Radio,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import type { Canal } from '@/db/schema/vocabulario'

/**
 * The small badges that make AI ingestion visible on a report.
 *
 * Jam B's demo goal is that an organisation can tell, at a glance, *how* a report reached them
 * — WhatsApp, SMS, a missed call, or a radio relay — and that a voice note was transcribed
 * rather than typed. `canal` and the transcript already live on the record (PRD §5.1, §5.2);
 * these badges are the only place that turns them into something a coordinator reads.
 *
 * Kept in one component, and used by every card (verificación, tablero), so the icon and the
 * word for a channel are decided once. A second copy would drift, and the copy that drifted
 * would be the one on the screen a partner is shown in the demo.
 *
 * Every badge is icon + text, never an icon alone (PRD §5 design system): the icon is a hint,
 * the word is the meaning, and a radio icon means nothing to somebody seeing it for the first
 * time.
 */

/** The single source of truth for how a channel is drawn. `web` is staff-only intake. */
export const CANAL_META: Record<Canal, { etiqueta: string; Icono: LucideIcon }> = {
  whatsapp: { etiqueta: 'WhatsApp', Icono: MessageCircle },
  sms: { etiqueta: 'SMS', Icono: MessageSquare },
  ivr: { etiqueta: 'llamada perdida', Icono: PhoneMissed },
  radio: { etiqueta: 'radio', Icono: Radio },
  papel: { etiqueta: 'papel', Icono: FileText },
  web: { etiqueta: 'web', Icono: Globe },
}

/**
 * How a report arrived. Neutral by design — the channel is context, not a state to act on, so
 * it sits quietly in the meta line and never competes with urgency.
 */
export function InsigniaCanal({ canal }: { canal: string | null | undefined }) {
  if (!canal) return null
  const meta = CANAL_META[canal as Canal] ?? { etiqueta: canal, Icono: MessageSquare }
  const { etiqueta, Icono } = meta
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-barro-100 px-1.5 py-0.5 text-xs font-medium text-barro-700"
      title={`Llegó por ${etiqueta}`}
    >
      <Icono className="size-3" aria-hidden />
      <span>{etiqueta}</span>
    </span>
  )
}

/**
 * A voice note that a machine turned into text. The whole point of the badge is that the value
 * of AI ingestion is visible: this did not arrive as text, somebody spoke it and Convite read
 * it. The optional confidence says how sure the transcriber was, so a low number reads as «go
 * listen» rather than as fact.
 */
export function InsigniaTranscrito({ confianza }: { confianza?: number | null }) {
  const pct = confianza === null || confianza === undefined ? null : Math.round(confianza * 100)
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-selva-50 px-1.5 py-0.5 text-xs font-medium text-selva-700"
      title="Nota de voz transcrita automáticamente; el audio original se conserva"
    >
      <AudioLines className="size-3" aria-hidden />
      <span>transcrito{pct !== null ? ` ${pct}%` : ''}</span>
    </span>
  )
}

/**
 * «Nadie pudo decir qué es al entrar.» A first-class state, not an error (0021): the record
 * still landed and it is waiting on a person, which is exactly the raw → triage step Jam B
 * wants visible next to the classified pile on the Tablero.
 */
export function InsigniaSinClasificar() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-atrato-100 px-1.5 py-0.5 text-xs font-medium text-atrato-700"
      title="Entró sin poder clasificarse; espera que una persona lo aclare"
    >
      <TriangleAlert className="size-3" aria-hidden />
      <span>sin clasificar</span>
    </span>
  )
}

/**
 * A radio report is second-hand by construction (PRD §5.8): someone spoke and an operator
 * typed. We do not yet store the operator as a distinct person, so the badge states the fact
 * that matters for trust — this was relayed, and second-hand records always require
 * verification — without inventing a name the record does not carry.
 */
export function InsigniaSegundaMano() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-barro-100 px-1.5 py-0.5 text-xs font-medium text-barro-700"
      title="Relevo de radio: lo dijo una persona y lo escribió un operador. Requiere verificación."
    >
      <Radio className="size-3" aria-hidden />
      <span>segunda mano</span>
    </span>
  )
}
