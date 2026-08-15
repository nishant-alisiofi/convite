import { Waves } from 'lucide-react'

/**
 * The Convite wordmark: the river glyph and the name, one lockup so every surface signs
 * itself the same way. It appeared, hand-set, on the public page, the landing and the
 * sign-in; a single lockup is the difference between a product and a set of pages.
 *
 * Two sizes. `sm` is the quiet top-bar mark; `lg` is the one the front door leads with.
 * The glyph carries the only colour — selva, the primary — and the name inherits its
 * surrounding text colour so the mark reads on paper and on a tinted panel alike.
 */
export function Marca({ tamano = 'sm' }: { tamano?: 'sm' | 'lg' }) {
  const grande = tamano === 'lg'
  return (
    <span className="inline-flex items-center gap-2 text-barro-900">
      <Waves
        className={grande ? 'h-7 w-7 text-selva-700' : 'h-6 w-6 text-selva-700'}
        aria-hidden
      />
      <span
        className={
          grande
            ? 'text-2xl font-semibold tracking-tight'
            : 'text-xl font-semibold tracking-tight'
        }
      >
        Convite
      </span>
    </span>
  )
}
