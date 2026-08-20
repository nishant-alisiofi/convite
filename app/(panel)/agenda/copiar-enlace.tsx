'use client'

import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

/**
 * A copy-to-clipboard button for a subscribe URL.
 *
 * The only reason this file exists separately from `agenda/page.tsx`: an `onClick` needs a
 * client component, and the page around it is server-rendered like every other panel screen.
 * The URL itself is plain server-rendered text right next to this button, so a denied clipboard
 * permission (or a very old browser) loses nothing — the person can still select and copy it by
 * hand.
 */
export default function CopiarEnlace({ valor }: { valor: string }) {
  const [copiado, setCopiado] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // Clipboard API denied or unavailable — nothing to recover, the URL is still visible.
    }
  }

  return (
    <button
      type="button"
      onClick={copiar}
      className="flex shrink-0 items-center gap-1.5 rounded border border-barro-200 bg-white px-3 py-1.5 text-sm font-medium text-barro-800 hover:bg-barro-50"
    >
      {copiado ? (
        <>
          <Check className="size-4 text-selva-700" aria-hidden />
          Copiado
        </>
      ) : (
        <>
          <Copy className="size-4" aria-hidden />
          Copiar
        </>
      )}
    </button>
  )
}
