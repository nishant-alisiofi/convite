import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAuth } from '@/lib/auth'
import { panelBloqueado } from '@/lib/organizacion'
import { identidadVisible, sesionActual, type SesionStaff } from '@/lib/sesion'

/**
 * The coordinator shell. Section 10: light, calm, readable, works on a laptop over a weak
 * connection. Server-rendered — nothing here needs JavaScript to display.
 */

/**
 * The nav. `ver` decides who sees a section: most are for everyone with a panel, but the two
 * hierarchy screens are gated. «Equipo» is a centre admin managing their own workers (§2.4);
 * «Centros» is the platform tier approving centres (§2.5). RLS is the real boundary behind both
 * — a link merely spares somebody a screen they could not use anyway.
 */
const SECCIONES: {
  href: string
  etiqueta: string
  listo?: boolean
  ver?: (sesion: SesionStaff) => boolean
}[] = [
  { href: '/tablero', etiqueta: 'Tablero', listo: true },
  { href: '/verificacion', etiqueta: 'Verificación', listo: true },
  { href: '/mapa', etiqueta: 'Mapa', listo: true },
  { href: '/inventario', etiqueta: 'Inventario' },
  { href: '/rutas', etiqueta: 'Rutas', listo: true },
  { href: '/recogidas', etiqueta: 'Recogidas', listo: true },
  { href: '/conexion', etiqueta: 'Conexión', listo: true },
  { href: '/envios', etiqueta: 'Envíos', listo: true },
  { href: '/comunidades', etiqueta: 'Comunidades' },
  { href: '/catalogo', etiqueta: 'Catálogo' },
  {
    href: '/equipo',
    etiqueta: 'Equipo',
    listo: true,
    ver: (s) => s.rolStaff === 'admin' || s.esPlataforma,
  },
  {
    href: '/centros',
    etiqueta: 'Centros',
    listo: true,
    ver: (s) => s.esPlataforma,
  },
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

  // §2.4 / §4: a centre that is not yet approved does not operate. Its members can sign in, but
  // the panel is not theirs to use — so they meet a calm «awaiting approval» screen with a way
  // out, not a broken shell. A platform admin is never gated (they do the approving).
  if (panelBloqueado(sesion)) return <CentroPendiente sesion={sesion} />

  const secciones = SECCIONES.filter((s) => !s.ver || s.ver(sesion))

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
            {secciones.map((s) => (
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
              {identidadVisible(sesion)} · {sesion.rolStaff}
            </span>
            {/* Account-level, so it sits by the identity rather than in the section nav —
                nothing about the basin lives here. */}
            <Link
              href="/clave"
              className="shrink-0 text-barro-600 underline hover:text-barro-900"
            >
              Su contraseña
            </Link>
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

/**
 * What a member of a not-yet-approved centre sees instead of the panel (§4).
 *
 * They are signed in — this is not a sign-in problem, and saying «you are not allowed» would be
 * both wrong and alarming. It is a waiting state: the centre has been requested and the platform
 * has not decided yet. So it names that plainly, and leaves «Salir» in reach the way every
 * screen does.
 */
function CentroPendiente({ sesion }: { sesion: SesionStaff }) {
  const rechazada = sesion.estadoOrganizacion === 'rechazada'

  return (
    <div className="min-h-dvh bg-barro-50">
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-5 py-12 sm:px-6">
        <div className="rounded-xl border border-barro-200 bg-white p-6 shadow-sm">
          <span className="font-semibold text-barro-900">Convite</span>
          <h1 className="mt-4 text-lg font-semibold text-barro-900">
            {rechazada ? 'Su centro no fue habilitado' : 'Su centro está en revisión'}
          </h1>
          <p className="mt-2 text-barro-700">
            {rechazada
              ? 'La solicitud de este centro no fue aprobada. Si cree que es un error, escríbale a quien administra Convite en Alisio.'
              : 'Ya quedó registrado, pero todavía no está habilitado para operar. Cuando Alisio lo apruebe, su equipo podrá entrar al panel. No hace falta que haga nada más por ahora.'}
          </p>
          <p className="mt-4 text-sm text-barro-500">
            Entró como {identidadVisible(sesion)}.
          </p>
          <form action={salir} className="mt-4">
            <button
              type="submit"
              className="text-barro-600 underline hover:text-barro-900"
            >
              Salir
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}
