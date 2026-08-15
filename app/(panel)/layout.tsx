import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAuth } from '@/lib/auth'
import { sesionActual } from '@/lib/sesion'

/**
 * The coordinator shell. Section 10: light, calm, readable, works on a laptop over a weak
 * connection. Server-rendered — nothing here needs JavaScript to display.
 */

const SECCIONES = [
  { href: '/tablero', etiqueta: 'Tablero', listo: true },
  { href: '/verificacion', etiqueta: 'Verificación', listo: true },
  { href: '/mapa', etiqueta: 'Mapa', listo: true },
  { href: '/inventario', etiqueta: 'Inventario' },
  { href: '/rutas', etiqueta: 'Rutas', listo: true },
  { href: '/recogidas', etiqueta: 'Recogidas', listo: true },
  { href: '/envios', etiqueta: 'Envíos', listo: true },
  { href: '/comunidades', etiqueta: 'Comunidades' },
  { href: '/catalogo', etiqueta: 'Catálogo' },
  { href: '/estado', etiqueta: 'Estado', listo: true },
  { href: '/ajustes', etiqueta: 'Ajustes', listo: true },
]

async function salir() {
  'use server'
  // Deletes the session row and clears the cookie. The cookie half only reaches the browser
  // because of the `nextCookies()` plugin in lib/auth.ts — without it this would look like
  // it worked and the next request would still be signed in.
  await getAuth().api.signOut({ headers: await headers() })
  redirect('/entrar')
}

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  return (
    <div className="min-h-dvh">
      <header className="border-b border-barro-200 bg-white">
        {/* Wraps at a phone's width: on a narrow screen the nav drops to its own full row
            below the wordmark and the identity, and the (long) email truncates rather than
            forcing the whole bar wider than the viewport. One row on sm and up. */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/tablero" className="font-semibold text-barro-900">
            Convite
          </Link>
          <nav className="order-last flex w-full flex-wrap gap-x-4 gap-y-1 text-sm sm:order-none sm:w-auto">
            {SECCIONES.map((s) => (
              <span key={s.href}>
                {s.listo ? (
                  <Link href={s.href} className="text-barro-700 hover:text-barro-950">
                    {s.etiqueta}
                  </Link>
                ) : (
                  <span className="text-barro-400" title="En construcción">
                    {s.etiqueta}
                  </span>
                )}
              </span>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-3 text-sm">
            <span className="truncate text-barro-500">
              {sesion.correo} · {sesion.rolStaff}
            </span>
            <form action={salir}>
              <button
                type="submit"
                className="shrink-0 text-barro-600 underline hover:text-barro-900"
              >
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</div>
    </div>
  )
}
