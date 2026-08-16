'use client'

import { ChevronDown, Info } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * Progressive disclosure for a screen's intro paragraph (PRD-36 §29b.6).
 *
 * The explanatory text at the top of a screen is good teaching *and* a permanent tax on
 * vertical space. So it is expanded for the first few visits, then collapses to one line with an
 * info icon — still one tap away, never gone.
 *
 * Server-rendered expanded, always: someone with no JavaScript, or on the first paint, reads the
 * full intro. Only after it has been seen a few times (counted per-screen in `localStorage`)
 * does it fold itself away. That order matters — the teaching is never hidden from the person who
 * has not learned it yet, only from the one who has.
 */

const VISITAS_ANTES_DE_COLAPSAR = 3

export function IntroColapsable({
  id,
  unaLinea,
  children,
}: {
  /** Stable per-screen key, e.g. «mapa» — the visit count is stored under it. */
  id: string
  /** The single line shown once collapsed, beside the info icon. */
  unaLinea: string
  /** The full intro. Shown expanded until this screen has been visited a few times. */
  children: React.ReactNode
}) {
  // Starts expanded so SSR and the first client render agree (no hydration mismatch); an effect
  // decides afterwards whether this returning visitor has earned the collapsed view.
  const [abierto, setAbierto] = useState(true)
  const [decidido, setDecidido] = useState(false)

  useEffect(() => {
    const clave = `convite:intro:${id}`
    let vistas = 0
    try {
      vistas = Number(window.localStorage.getItem(clave) ?? '0')
      window.localStorage.setItem(clave, String(vistas + 1))
    } catch {
      // Private mode / storage disabled: fall through with vistas = 0, i.e. stay expanded.
    }
    if (vistas >= VISITAS_ANTES_DE_COLAPSAR) setAbierto(false)
    setDecidido(true)
  }, [id])

  if (decidido && !abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mt-2 flex max-w-3xl items-center gap-2 text-left text-sm text-barro-600 hover:text-barro-900"
      >
        <Info className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{unaLinea}</span>
        <ChevronDown className="size-4 shrink-0" aria-hidden />
      </button>
    )
  }

  return <div className="mt-2 max-w-3xl text-sm text-barro-700">{children}</div>
}
