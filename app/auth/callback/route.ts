import { headers } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { autenticacionConfigurada, getAuth } from '@/lib/auth'
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!autenticacionConfigurada()) {
    return NextResponse.redirect(new URL('/entrar?error=configuracion', request.url))
  }

  const sesion = await getAuth().api.getSession({ headers: await headers() })

  // No session at this point means the link was expired, already used, or tampered with.
  // Better Auth normally redirects those to its own errorCallbackURL and they never arrive
  // here; this covers somebody opening the bare URL.
  if (!sesion?.user) {
    return NextResponse.redirect(new URL('/entrar?error=enlace', request.url))
  }

  const resultado = await vincularStaff({
    authId: sesion.user.id,
    correo: sesion.user.email,
  })

  if (resultado === 'sin_invitacion') {
    await getAuth().api.signOut({ headers: await headers() })
    return NextResponse.redirect(new URL('/entrar?motivo=sin_invitacion', request.url))
  }

  const desde = rutaInterna(request.nextUrl.searchParams.get('desde') ?? '')
  return NextResponse.redirect(new URL(desde ?? '/tablero', request.url))
}
