import { ArrowRight, type LucideIcon, Sprout } from 'lucide-react'
import Link from 'next/link'

/**
 * The empty state that teaches (PRD-36 §29b.5).
 *
 * An empty screen shown to someone who has registered nothing is noise, not onboarding. So an
 * empty screen never says «sin datos» — it names what is missing and links to the step that
 * fixes it. «No hay comunidades registradas — empiece aquí», not a blank list.
 *
 * Server-rendered, no JavaScript: it has to show on the same weak connection every other screen
 * is built for. Quiet by design (barro, one accent) — an empty state is guidance, not an alarm.
 */
export function EstadoVacio({
  titulo,
  children,
  href,
  accion,
  Icono = Sprout,
}: {
  /** What is missing, in plain words: «No hay comunidades registradas todavía». */
  titulo: string
  /** Why it matters / what it blocks — one or two sentences. */
  children: React.ReactNode
  /** The step that fixes it. Omit when the fix lives on this same screen. */
  href?: string
  /** The link's words: «Registrar la primera comunidad». Defaults to «Empiece aquí». */
  accion?: string
  Icono?: LucideIcon
}) {
  return (
    <div className="rounded-lg border border-dashed border-barro-300 bg-barro-50 px-5 py-6 text-center">
      <Icono className="mx-auto size-6 text-barro-400" aria-hidden />
      <p className="mt-2 font-medium text-barro-900">{titulo}</p>
      <p className="mx-auto mt-1 max-w-prose text-sm text-barro-600">{children}</p>
      {href && (
        <Link
          href={href}
          className="mt-3 inline-flex items-center gap-1 rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
        >
          {accion ?? 'Empiece aquí'}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      )}
    </div>
  )
}
