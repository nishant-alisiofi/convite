import { NextResponse, type NextRequest } from 'next/server'
import { vincularStaff } from '@/lib/sesion'
import { clienteServidor } from '@/lib/supabase/servidor'

/**
 * Where the magic link lands.
 *
 * Exchanging the code proves the person owns that address. It does not make them staff:
 * `vincular_usuario_staff()` only creates a `usuarios` row if an admin put the address on
 * the allowlist first (2.10). Anyone else ends up back at sign-in with an explanation
 * rather than an empty dashboard.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const desde = url.searchParams.get('desde')

  if (!code) {
    return NextResponse.redirect(new URL('/entrar?error=enlace', request.url))
  }

  const supabase = await clienteServidor()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

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
