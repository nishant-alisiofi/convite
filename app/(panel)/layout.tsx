import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAuth } from '@/lib/auth'
import { debeDeclarar, faltaDeclaracionAjena } from '@/lib/declaracion'
import { panelBloqueado } from '@/lib/organizacion'
import { identidadVisible, sesionActual, type SesionStaff } from '@/lib/sesion'
import { NavSecciones } from './nav-secciones'
import { seccionesVisibles } from './secciones'

/**
 * The coordinator shell. Section 10: light, calm, readable, works on a laptop over a weak
 * connection. Server-rendered — the shell needs no JavaScript to display; the section
 * disclosures are a native `<details>` element that a small client island (nav-secciones.tsx)
 * only enhances. The navigation model and its role gate live in secciones.ts.
 */

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

  // Before the panel, once: what is this organisation here to do? Ordered after the approval
  // gate on purpose — an organisation nobody has agreed to yet should not be asked to invest
  // in an answer, and two gates racing for the same redirect is how loops start. Only the
  // people who can actually answer are sent; everyone else gets a note further down, because
  // `debeDeclarar` refuses non-admins and the SQL function would refuse them too.
  if (debeDeclarar(sesion)) redirect('/comenzar')

  // The sections this role may see, already filtered to plain data (see secciones.ts). The role
  // gate stays on the server; the client island receives the answer, never the predicates.
  const secciones = seccionesVisibles(sesion)

  return (
    <div className="min-h-dvh">
      <header className="border-b border-barro-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
          {/* Top row: wordmark and the account-level identity/actions. Nothing about the basin
              lives here — «Su contraseña» and «Salir» are about the person, not the sections. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link href="/bandeja" className="font-semibold text-barro-900">
              Convite
            </Link>
            <div className="ml-auto flex min-w-0 items-center gap-3 text-sm">
              <span className="truncate text-barro-500">
                {identidadVisible(sesion)} · {sesion.rolStaff}
              </span>
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

          {/* The seven sections (§18, PRD-28). Each is a disclosure, so the top bar shows only the
              section labels and each section's sub-items reveal on interaction — see
              nav-secciones.tsx. */}
          <NavSecciones secciones={secciones} />
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* The other side of the onboarding gate. An admin is redirected to /comenzar; everybody
            else works on, because only an admin can answer and trapping a verificador behind a
            form that rejects them helps nobody. But silence would be worse than a note — without
            it the panel just behaves generically and nobody knows why, or who to ask. */}
        {faltaDeclaracionAjena(sesion) && (
          <p className="mb-6 rounded-lg border border-atrato-100 bg-atrato-50 px-4 py-3 text-sm text-barro-800">
            Su organización todavía no ha dicho a qué vino ni en qué momento de la respuesta
            está, así que el panel abre igual para todos. Lo responde un admin, una sola vez.
          </p>
        )}
        {children}
      </div>
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
