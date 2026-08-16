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
 * Being signed in proves you own that address or number, and open sign-in (0035) makes that
 * enough: `vincular_usuario_staff()` writes the `usuarios` row for everyone who reaches here —
 * from a matching invitation if one exists, otherwise as a default admin in the earliest active
 * organisation. The one refusal left is `ya_vinculada`: one person invited by both an address
 * and a number must not end up with two staff records (0029), so the second door is bounced.
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
    // Null on the emailed-link path; the number they proved on the WhatsApp one. The
    // allowlist is matched by whichever they actually used — a phone sign-in's address is a
    // placeholder that is in nobody's list by design.
    telefono: (sesion.user as { phoneNumber?: string | null }).phoneNumber ?? null,
  })

  if (resultado === 'ya_vinculada') {
    // Invited with both an address and a number, and the other door was used first. Letting
    // this through would write a second staff record for one person (0029).
    await getAuth().api.signOut({ headers: await headers() })
    return NextResponse.redirect(aRuta('/entrar', { motivo: 'ya_vinculada' }))
  }

  const desde = rutaInterna(request.nextUrl.searchParams.get('desde') ?? '')
  return NextResponse.redirect(aRuta(desde ?? '/tablero'))
}
