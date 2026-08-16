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
 * The navigation — PRD v3 §18, PRD-28.
 *
 * Fourteen flat items became **seven sections**, so the panel survives jornadas and
 * evaluaciones without the top bar growing a fifteenth peer. Every URL is unchanged: this is a
 * regrouping, not a route move. `Centros` is relabelled **Organizaciones** and moved under
 * Ajustes (it is the organisation approval queue, not collection centres); Rutas and Puntos de
 * conexión nest under Mapa (you edit them by looking at them); Envíos and Recogidas nest under
 * Agenda (the goods legs of a jornada); Catálogo and Inventario sit under Existencias.
 *
 * **Bandeja** is §18/§19's answer to «two inboxes». A full single-queue merge is a page with
 * its own business logic (PRD-28 scope note), so this shell keeps Tablero and Verificación as
 * the two Bandeja entries and adds **Silencio** as a first-class Bandeja item — the signal that
 * fires when *nobody* reports (§19), which until now lived only in Comunidades where a
 * coordinator working the board never saw it. Silencio points at the existing «Comunidades
 * calladas» list on /estado.
 *
 * **Not-yet-built** sub-items (Evaluaciones §21 → PRD-29, Programas §21b → PRD-31, Jornadas §22
 * → PRD-30, Citas §27b.2 → FR-17, Cobertura, Entregas y evidencia, Exportes, Centros de acopio,
 * Ofertas, Capacidad ofrecida) are shown greyed as «en construcción» so the target structure is
 * legible — the shell teaches what is coming — but they never link to a route that does not
 * exist.
 *
 * **Role-scoped** per §18/§29.3. `ver` on a section decides who sees the section at all;
 * `ver` on an item mirrors the page's own role gate so a link never lands on a «sin permiso»
 * screen — a link merely spares somebody a screen they could not use anyway. RLS is the real
 * boundary behind every one of these; the nav is only courtesy. `href` on a section makes its
 * title a link to the section's own overview page (Mapa → /mapa, Ajustes → /ajustes); the other
 * five are pure group labels whose destinations are their items.
 *
 * **Phase** (§18) changes only what Bandeja leads with and what Mapa opens on — never this
 * structure, which is identical across impacto/emergencia/recuperación/ordinario. Phase-based
 * ordering is deferred to the pages themselves; the seven-section shell is phase-invariant. TODO
 * (PRD-28 follow-up): lead-item reordering by phase once the Bandeja becomes one real queue.
 */
type ItemNav = {
  href: string
  etiqueta: string
  /** `false`/absent ⇒ shown greyed «en construcción», never a link (route does not exist yet). */
  listo?: boolean
  /** Item-level visibility, mirroring the destination page's own role gate. Default: visible. */
  ver?: (sesion: SesionStaff) => boolean
}
type SeccionNav = {
  clave: string
  etiqueta: string
  /** When set, the section title itself links to the section's overview page. */
  href?: string
  /** Section-level visibility per §18's role → section map. */
  ver: (sesion: SesionStaff) => boolean
  items: ItemNav[]
}

/** True when the session's staff role is one of `roles`. */
const rol = (roles: string[]) => (s: SesionStaff) => roles.includes(s.rolStaff)

// Page-level role gates, copied from the pages so the nav and the page agree on who gets in.
const VE_VERIFICACION = rol(['verificador', 'coordinador', 'admin']) // verificacion PUEDEN_VERIFICAR
const VE_SILENCIO = rol(['verificador', 'despachador', 'coordinador', 'admin']) // estado PUEDEN_VER
const VE_REGISTRO = rol(['verificador', 'despachador', 'coordinador', 'admin']) // comunidades/inventario/catalogo PUEDEN_VER
const VE_RECOGIDAS = rol(['coordinador', 'admin']) // recogidas PUEDEN_PLANEAR
const VE_APADRINAR = rol(['coordinador', 'admin']) // apadrinar PUEDEN_APADRINAR

const SECCIONES: SeccionNav[] = [
  {
    // §19: everything awaiting a person. Two entries + silence until the single queue exists.
    clave: 'bandeja',
    etiqueta: 'Bandeja',
    ver: rol(['verificador', 'despachador', 'coordinador', 'admin']),
    items: [
      { href: '/tablero', etiqueta: 'Tablero', listo: true },
      { href: '/verificacion', etiqueta: 'Verificación', listo: true, ver: VE_VERIFICACION },
      { href: '/estado#silencio', etiqueta: 'Silencio', listo: true, ver: VE_SILENCIO },
    ],
  },
  {
    clave: 'mapa',
    etiqueta: 'Mapa',
    href: '/mapa',
    ver: rol(['despachador', 'coordinador', 'admin', 'lectura']),
    items: [
      { href: '', etiqueta: 'Evaluaciones' }, // PRD-29
      { href: '/rutas', etiqueta: 'Rutas', listo: true },
      { href: '/conexion', etiqueta: 'Puntos de conexión', listo: true },
    ],
  },
  {
    clave: 'comunidades',
    etiqueta: 'Comunidades',
    ver: rol(['verificador', 'coordinador', 'admin']),
    items: [
      { href: '/comunidades', etiqueta: 'Red', listo: true, ver: VE_REGISTRO },
      { href: '/estado#silencio', etiqueta: 'Silencio', listo: true, ver: VE_SILENCIO },
    ],
  },
  {
    clave: 'agenda',
    etiqueta: 'Agenda',
    ver: rol(['despachador', 'coordinador', 'admin']),
    items: [
      { href: '', etiqueta: 'Programas' }, // PRD-31
      { href: '', etiqueta: 'Jornadas' }, // PRD-30
      { href: '', etiqueta: 'Citas' }, // FR-17
      { href: '/envios', etiqueta: 'Envíos', listo: true },
      { href: '/recogidas', etiqueta: 'Recogidas', listo: true, ver: VE_RECOGIDAS },
      { href: '', etiqueta: 'Capacidad ofrecida' }, // §18
    ],
  },
  {
    clave: 'existencias',
    etiqueta: 'Existencias',
    ver: rol(['despachador', 'coordinador', 'admin']),
    items: [
      { href: '', etiqueta: 'Centros de acopio' }, // §18
      { href: '/inventario', etiqueta: 'Inventario', listo: true, ver: VE_REGISTRO },
      { href: '', etiqueta: 'Ofertas' }, // §18
      { href: '/catalogo', etiqueta: 'Catálogo', listo: true, ver: VE_REGISTRO },
    ],
  },
  {
    clave: 'informes',
    etiqueta: 'Informes',
    ver: rol(['coordinador', 'admin', 'lectura']),
    items: [
      { href: '', etiqueta: 'Cobertura' }, // §18
      { href: '', etiqueta: 'Entregas y evidencia' }, // §18
      { href: '/apadrinar', etiqueta: 'Apadrinamientos', listo: true, ver: VE_APADRINAR },
      { href: '', etiqueta: 'Exportes' }, // §18
    ],
  },
  {
    // §18: Equipo (centre admin, §2.4), Organizaciones (platform approval queue, §2.5), Estado.
    clave: 'ajustes',
    etiqueta: 'Ajustes',
    href: '/ajustes',
    ver: (s) => rol(['coordinador', 'admin'])(s) || s.esPlataforma,
    items: [
      { href: '/equipo', etiqueta: 'Equipo', listo: true, ver: (s) => s.rolStaff === 'admin' || s.esPlataforma },
      { href: '/centros', etiqueta: 'Organizaciones', listo: true, ver: (s) => s.esPlataforma },
      { href: '/estado', etiqueta: 'Estado', listo: true, ver: VE_SILENCIO },
    ],
  },
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

  // A section shows when the role may see it and it has something to show — a title link or at
  // least one visible item. Items keep «en construcción» placeholders (no `ver`), so an allowed
  // section is never empty; role-gated built items drop out for whoever cannot reach them.
  const secciones = SECCIONES.filter((s) => s.ver(sesion))
    .map((s) => ({ ...s, items: s.items.filter((it) => !it.ver || it.ver(sesion)) }))
    .filter((s) => s.href || s.items.length > 0)

  return (
    <div className="min-h-dvh">
      <header className="border-b border-barro-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
          {/* Top row: wordmark and the account-level identity/actions. Nothing about the basin
              lives here — «Su contraseña» and «Salir» are about the person, not the sections. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link href="/tablero" className="font-semibold text-barro-900">
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

          {/* The seven sections (§18). Server-rendered — nothing here needs JavaScript to
              display. Sections stack on a phone (each a title over its items) and sit side by
              side, wrapping, from sm up. */}
          <nav
            aria-label="Secciones"
            className="mt-3 flex flex-col gap-x-8 gap-y-4 border-t border-barro-100 pt-3 sm:flex-row sm:flex-wrap"
          >
            {secciones.map((s) => (
              <div key={s.clave} className="min-w-0">
                {s.href ? (
                  <Link
                    href={s.href}
                    className="text-xs font-medium uppercase tracking-wide text-barro-500 hover:text-barro-800"
                  >
                    {s.etiqueta}
                  </Link>
                ) : (
                  <span className="text-xs font-medium uppercase tracking-wide text-barro-500">
                    {s.etiqueta}
                  </span>
                )}
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                  {s.items.map((it) =>
                    it.listo ? (
                      <Link
                        key={it.etiqueta}
                        href={it.href}
                        className="text-barro-700 hover:text-barro-950"
                      >
                        {it.etiqueta}
                      </Link>
                    ) : (
                      <span key={it.etiqueta} className="text-barro-400" title="En construcción">
                        {it.etiqueta}
                      </span>
                    ),
                  )}
                </div>
              </div>
            ))}
          </nav>
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
