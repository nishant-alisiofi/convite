import { headers } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { autenticacionConfigurada, getAuth, urlBase } from '@/lib/auth'
import { rutaInterna, vincularStaff } from '@/lib/sesion'

/**
 * Where a coordinator lands after clicking the link.
 *
 * The verification itself is no longer done here. Better Auth owns
 * `/api/auth/magic-link/verify`: it consumes the one-time token, creates the session and
 * sets the cookie, then sends the browser here. By the time this runs the person is signed
 * in — so all that is left is the question this route existed to answer in the first place.
 *
 * Being signed in only proves you own that address. It does not make you staff.
 * `vincular_usuario_staff()` creates the `usuarios` row only if an admin put the address on
 * the allowlist first (2.10), and without that row every policy in 0017 returns nothing.
 * Somebody who reaches this point uninvited is signed out again rather than left staring at
 * a panel with no data in it, which would look like a bug instead of an answer.
 */

export const dynamic = 'force-dynamic'

/**
 * Builds a redirect to somewhere else on this site, from the configured public origin.
 *
 * Not from the request. Behind Railway's proxy nothing on the incoming request knows the
 * public origin: `request.url` is the address the *container* was reached on, so redirects
 * came out as `https://localhost:8080/tablero`, which resolves to nothing and left sign-in
 * dead one step short of the panel.
 *
 * `request.nextUrl` was the obvious fix and it is wrong here — that was the second attempt,
 * and it shipped and failed in exactly the same way. Next rebuilds `nextUrl` from the
 * forwarded host in **middleware**, which is why the middleware's own redirect always looked
 * right; a Node route handler gets neither. Reading `x-forwarded-host` by hand would work
 * and would mean trusting a header a client can set.
 *
 * So it comes from `APP_BASE_URL`, which is configuration we already have, is already correct
 * on every environment, and cannot be influenced by the caller. It is also what Better Auth
 * itself uses — its `baseURL` is this same value, and its half of the redirect chain was
 * correct throughout while ours was not. That is the whole argument.
 *
 * The shape of bug worth remembering: a local walk cannot find it (on a laptop every origin
 * agrees), the suite cannot find it (`NextRequest` never diverges in-process), and the first
 * fix looked right and was not. It took clicking a real emailed link on deployed staging,
 * twice.
 */
function aRuta(ruta: string, parametros?: Record<string, string>): URL {
  const destino = new URL(ruta, urlBase())
  for (const [clave, valor] of Object.entries(parametros ?? {})) {
    destino.searchParams.set(clave, valor)
  }
  return destino
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!autenticacionConfigurada()) {
    return NextResponse.redirect(aRuta('/entrar', { error: 'configuracion' }))
  }

  const sesion = await getAuth().api.getSession({ headers: await headers() })

  // No session at this point means the link was expired, already used, or tampered with.
  // Better Auth normally redirects those to its own errorCallbackURL and they never arrive
  // here; this covers somebody opening the bare URL.
  if (!sesion?.user) {
    return NextResponse.redirect(aRuta('/entrar', { error: 'enlace' }))
  }

  const resultado = await vincularStaff({
    authId: sesion.user.id,
    correo: sesion.user.email,
  })

  if (resultado === 'sin_invitacion') {
    await getAuth().api.signOut({ headers: await headers() })
    return NextResponse.redirect(aRuta('/entrar', { motivo: 'sin_invitacion' }))
  }

  const desde = rutaInterna(request.nextUrl.searchParams.get('desde') ?? '')
  return NextResponse.redirect(aRuta(desde ?? '/tablero'))
}
