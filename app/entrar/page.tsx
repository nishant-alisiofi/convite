import { redirect } from 'next/navigation'
import { env } from '@/lib/env'
import { sesionActual } from '@/lib/sesion'
import { clienteServidor } from '@/lib/supabase/servidor'

/**
 * Sign-in. Magic link only — Section 3 says no passwords, and one fewer credential is one
 * fewer thing a coordinator has to recover from a field office with bad signal.
 */

async function enviarEnlace(formData: FormData) {
  'use server'
  const correo = String(formData.get('correo') ?? '')
    .trim()
    .toLowerCase()
  if (!correo.includes('@')) redirect('/entrar?error=correo')

  const supabase = await clienteServidor()
  const { error } = await supabase.auth.signInWithOtp({
    email: correo,
    options: { emailRedirectTo: `${env().APP_BASE_URL}/auth/callback` },
  })

  // Deliberately the same outcome either way: whether an address is registered staff is not
  // something an unauthenticated form should reveal.
  redirect(error ? '/entrar?enviado=1' : '/entrar?enviado=1')
}

export default async function Entrar({
  searchParams,
}: {
  searchParams: Promise<{ enviado?: string; error?: string; motivo?: string }>
}) {
  if (await sesionActual()) redirect('/tablero')
  const { enviado, error, motivo } = await searchParams

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold text-stone-900">Convite</h1>
      <p className="mt-2 text-stone-600">Coordinación de ayuda en la cuenca del Atrato.</p>

      {enviado ? (
        <div className="mt-8 rounded-lg border border-stone-200 bg-white p-5">
          <p className="font-medium text-stone-900">Le mandamos un enlace al correo.</p>
          <p className="mt-2 text-stone-600">
            Ábralo desde este mismo equipo. Si no llega en unos minutos, revise el correo no
            deseado.
          </p>
        </div>
      ) : (
        <form action={enviarEnlace} className="mt-8 space-y-4">
          <div>
            <label htmlFor="correo" className="block text-sm font-medium text-stone-700">
              Su correo
            </label>
            <input
              id="correo"
              name="correo"
              type="email"
              required
              autoComplete="email"
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-base
                         focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-stone-900 px-4 py-2 font-medium text-white
                       hover:bg-stone-800"
          >
            Entrar
          </button>
          <p className="text-sm text-stone-500">
            No hay contraseña. Le llega un enlace y con eso entra.
          </p>
        </form>
      )}

      {error === 'correo' && (
        <p className="mt-4 text-sm text-stone-700">Escriba un correo válido para poder entrar.</p>
      )}
      {motivo === 'sin_invitacion' && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-5">
          <p className="font-medium text-stone-900">Su correo todavía no está habilitado.</p>
          <p className="mt-2 text-stone-700">
            Pídale a la persona que administra Convite en su organización que lo agregue. Solo
            el equipo coordinador entra por acá.
          </p>
        </div>
      )}
    </main>
  )
}
