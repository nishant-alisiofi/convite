'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { SeccionVisible } from './secciones'

/**
 * The seven sections (§18, PRD-28), nested.
 *
 * The top bar shows only the seven section labels; each section's sub-items reveal on
 * interaction instead of all sitting expanded at once (the crowding this refinement fixes).
 * Role gating already ran on the server — this island receives plain data and only decides how
 * it looks and reveals.
 *
 * **Why `<details>`.** The disclosure is a native `<details>`/`<summary>`, so it works before —
 * and without — JavaScript: a tap opens a section, and the keyboard opens it too (the summary is
 * focusable and toggles on Enter/Space). A hover-only menu would be dead on a phone, which is the
 * surface a coordinator in the field actually has. State only *enhances* the native element: it
 * makes the sections behave as an accordion (opening one closes the others, so desktop dropdowns
 * never overlap) and it opens the section you are currently in.
 *
 * **Where the items go.** On a phone the revealed items stack in flow under their label. From
 * `sm` up they float as a dropdown (`sm:absolute`) so opening a section never reflows the bar —
 * the seven labels stay put and uncluttered.
 *
 * **Reachability.** Sections that have their own overview page (Mapa → /mapa, Ajustes →
 * /ajustes) keep it: the `<summary>` is the toggle, and the overview is the first item inside, so
 * the page is one tap away and nothing that used to be reachable stops being reachable.
 *
 * **Here / active.** The section containing the current route is highlighted, and the exact item
 * is marked `aria-current`, so a coordinator always knows where they are.
 *
 * **It does not open that section by itself, and that is the fix for a real complaint.** It used
 * to: every page load left one dropdown already open, and from `sm` up a dropdown is an absolutely
 * positioned panel with a shadow sitting over the page — so the first thing a coordinator saw was
 * their own content behind a menu, with no obvious way to dismiss it. Nothing closed it either: a
 * native `<details>` ignores clicks elsewhere, ignores Escape, and survives navigation. Menus do
 * not behave that way anywhere else, and «open» is a thing a person does, not a thing a page
 * decides for them. Highlighting says where you are; opening says what you are doing, and only
 * the person knows that.
 */
export function NavSecciones({ secciones }: { secciones: SeccionVisible[] }) {
  const pathname = usePathname() ?? ''

  // A route matches an href when it is that page or lives under it (`/rutas`, `/rutas/x`). The
  // hash on «Silencio» (`/estado#silencio`) never reaches the server, so compare on path only.
  const rutaActiva = (href: string) => {
    const ruta = href.split('#')[0]
    if (!ruta) return false
    return pathname === ruta || pathname.startsWith(`${ruta}/`)
  }
  const seccionActiva = (s: SeccionVisible) =>
    (s.href ? rutaActiva(s.href) : false) || s.items.some((it) => it.listo && rutaActiva(it.href))

  // Single-open accordion, closed to begin with. Server and first client render agree trivially,
  // because the answer does not depend on the path.
  const [abierta, setAbierta] = useState<string | null>(null)
  const navRef = useRef<HTMLElement>(null)

  // Close when the route changes. Following a link inside a dropdown used to leave it hanging
  // over the page it had just navigated to.
  useEffect(() => {
    setAbierta(null)
  }, [pathname])

  // Close on a click anywhere else, and on Escape — the two things every other menu does and a
  // bare `<details>` does not. `pointerdown` rather than `click` so the panel is gone before the
  // press completes, which is what makes it feel like a menu rather than a stuck panel.
  useEffect(() => {
    if (abierta === null) return
    const alApuntar = (ev: PointerEvent) => {
      if (navRef.current?.contains(ev.target as Node)) return
      setAbierta(null)
    }
    const alTeclear = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setAbierta(null)
    }
    document.addEventListener('pointerdown', alApuntar)
    document.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('pointerdown', alApuntar)
      document.removeEventListener('keydown', alTeclear)
    }
  }, [abierta])

  // Keep React in step with the native toggle. When the browser force-closes a sibling to honour
  // the accordion, `cur` has already moved on, so the guard leaves it be.
  const alConmutar = (clave: string, abierto: boolean) =>
    setAbierta((cur) => (abierto ? clave : cur === clave ? null : cur))

  return (
    <nav
      ref={navRef}
      aria-label="Secciones"
      className="mt-3 flex flex-col gap-x-6 gap-y-1 border-t border-barro-100 pt-3 sm:flex-row sm:flex-wrap sm:items-start"
    >
      {secciones.map((s) => {
        const activa = seccionActiva(s)
        const abierto = abierta === s.clave
        return (
          <details
            key={s.clave}
            open={abierto}
            onToggle={(e) => alConmutar(s.clave, e.currentTarget.open)}
            className="group relative min-w-0"
          >
            <summary
              aria-expanded={abierto}
              className={`flex cursor-pointer select-none list-none items-center gap-1 py-1 text-xs font-medium uppercase tracking-wide outline-none [&::-webkit-details-marker]:hidden focus-visible:ring-2 focus-visible:ring-selva-600 focus-visible:ring-offset-2 ${
                activa ? 'text-selva-700' : 'text-barro-500 hover:text-barro-800'
              }`}
            >
              {s.etiqueta}
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                className={`h-3 w-3 transition-transform duration-150 ${abierto ? 'rotate-90' : ''}`}
              >
                <path
                  d="M7.5 4.5 12.5 10 7.5 15.5"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </summary>

            <div className="mt-1 flex flex-col gap-y-0.5 pl-3 text-sm sm:absolute sm:left-0 sm:z-20 sm:mt-2 sm:min-w-[13rem] sm:rounded-lg sm:border sm:border-barro-200 sm:bg-white sm:p-2 sm:pl-2 sm:shadow-lg">
              {s.href ? <ItemEnlace href={s.href} etiqueta={s.etiqueta} activo={rutaActiva(s.href)} /> : null}
              {s.items.map((it) =>
                it.listo ? (
                  <ItemEnlace
                    key={it.etiqueta}
                    href={it.href}
                    etiqueta={it.etiqueta}
                    activo={rutaActiva(it.href)}
                  />
                ) : (
                  <span
                    key={it.etiqueta}
                    className="rounded px-2 py-1 text-barro-400"
                    title="En construcción"
                  >
                    {it.etiqueta}
                  </span>
                ),
              )}
            </div>
          </details>
        )
      })}
    </nav>
  )
}

/** One live link inside a section's disclosure. Marks itself when it is the current page. */
function ItemEnlace({ href, etiqueta, activo }: { href: string; etiqueta: string; activo: boolean }) {
  return (
    <Link
      href={href}
      aria-current={activo ? 'page' : undefined}
      className={`rounded px-2 py-1 ${
        activo
          ? 'bg-selva-50 font-medium text-selva-800'
          : 'text-barro-700 hover:bg-barro-50 hover:text-barro-950'
      }`}
    >
      {etiqueta}
    </Link>
  )
}
