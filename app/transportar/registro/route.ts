import { headers } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { autenticacionConfigurada, getAuth, urlBase } from '@/lib/auth'
import { vincularAportante } from '@/lib/aportante'

/**
 * Where a transporter lands after proving possession from /transportar.
 *
 * The mirror of /auth/callback, but for the SUPPLY side. Better Auth has already consumed the
 * one-time token, created the session and set the cookie by the time this runs — so being here
 * proves the person owns that address or number. `convite_autoregistrar_aportante()` then writes
 * them their own aportante organisation (empty ceiling — no addresses, no community reach) and a
 * `lectura` staff row. It deliberately does NOT go through `vincular_usuario_staff()`, because
 * that path would land an uninvited person as a home-org admin — exactly what a self-signed
 * transporter must not become.
 */

export const dynamic = 'force-dynamic'

/** A redirect somewhere on this site, from the configured public origin (see /auth/callback). */
function aRuta(ruta: string, parametros?: Record<string, string>): URL {
  const destino = new URL(ruta, urlBase())
  for (const [clave, valor] of Object.entries(parametros ?? {})) {
    destino.searchParams.set(clave, valor)
  }
  return destino
}

export async function GET(_request: NextRequest): Promise<NextResponse> {
  if (!autenticacionConfigurada()) {
    return NextResponse.redirect(aRuta('/transportar', { error: 'configuracion' }))
  }

  const sesion = await getAuth().api.getSession({ headers: await headers() })

  // No session here means the link was expired, already used, or tampered with — Better Auth
  // normally routes those to its own errorCallbackURL, so this covers a bare URL.
  if (!sesion?.user) {
    return NextResponse.redirect(aRuta('/transportar', { error: 'enlace' }))
  }

  await vincularAportante({
    authId: sesion.user.id,
    correo: sesion.user.email,
    telefono: (sesion.user as { phoneNumber?: string | null }).phoneNumber ?? null,
  })

  return NextResponse.redirect(aRuta('/transportar', { registrado: '1' }))
}
