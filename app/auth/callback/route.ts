import { type EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { vincularStaff } from '@/lib/sesion'
import { clienteServidor } from '@/lib/supabase/servidor'

/**
 * Where the magic link lands.
 *
 * Supabase can deliver a sign-in two ways and they are not interchangeable:
 *
 *   ?token_hash=…&type=magiclink   verified server-side with verifyOtp. This is what our
 *                                  email template sends, and the only form that works
 *                                  without JavaScript.
 *   ?code=…                        the PKCE exchange, used when the sign-in was started by
 *                                  a browser client that stored a verifier.
 *
 * There is a third form — `#access_token=…` in the URL fragment — which a browser never
 * sends to the server. Any route that only reads `?code=` silently bounces those links to
 * the sign-in page, which is exactly the bug this handler was written to fix.
 *
 * Verifying only proves the person owns that address. It does not make them staff:
 * `vincular_usuario_staff()` creates a `usuarios` row only if an admin put the address on
 * the allowlist first (2.10).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url)
  const tokenHash = url.searchParams.get('token_hash')
  const tipo = url.searchParams.get('type') as EmailOtpType | null
  const code = url.searchParams.get('code')
  const desde = url.searchParams.get('desde')

  const supabase = await clienteServidor()

  const { data, error } = tokenHash
    ? await supabase.auth.verifyOtp({ type: tipo ?? 'magiclink', token_hash: tokenHash })
    : code
      ? await supabase.auth.exchangeCodeForSession(code)
      : { data: { user: null }, error: new Error('enlace sin token') }

  if (error || !data.user) {
    return NextResponse.redirect(new URL('/entrar?error=enlace', request.url))
  }

  const resultado = await vincularStaff({
    authId: data.user.id,
    correo: data.user.email ?? '',
  })

  if (resultado === 'sin_invitacion') {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/entrar?motivo=sin_invitacion', request.url))
  }

  const destino = desde && desde.startsWith('/') ? desde : '/tablero'
  return NextResponse.redirect(new URL(destino, request.url))
}
