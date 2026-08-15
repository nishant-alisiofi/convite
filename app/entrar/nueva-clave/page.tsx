import { KeyRound } from 'lucide-react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { autenticacionConfigurada, getAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * Where a password-reset link lands.
 *
 * Public by necessity — somebody who cannot sign in has to be able to reach it — and safe for
 * the same reason the magic link is safe: the only way here with a usable token is to have
 * read mail sent to the address. The token is single-use and expires in an hour.
 *
 * It is deliberately NOT a way to set a first password on an account that has none. It can
 * do that, and that is fine: reaching it still required receiving mail at an invited address,
 * which is the same proof the magic link asks for. What it cannot do is create an account —
 * `disableSignUp` in lib/auth.ts closes that, and a token for an address with no account is
 * simply invalid.
 */

async function guardar(formData: FormData) {
  'use server'
  const token = String(formData.get('token') ?? '')
  const clave = String(formData.get('clave') ?? '')
  const repetida = String(formData.get('repetida') ?? '')

  const volver = (error: string) =>
    redirect(`/entrar/nueva-clave?token=${encodeURIComponent(token)}&error=${error}`)

  if (!token) redirect('/entrar?error=enlace')
  if (!autenticacionConfigurada()) redirect('/entrar?error=configuracion')
  if (clave.length < 12) volver('corta')
  if (clave !== repetida) volver('distintas')

  try {
    await getAuth().api.resetPassword({
      headers: await headers(),
      body: { newPassword: clave, token },
    })
  } catch {
    // Expired, already used, or never valid. One message: which of those it was is not
    // something an unauthenticated page should help somebody work out.
    redirect('/entrar?error=enlace')
  }

  redirect('/entrar?clave=1')
}

export default async function NuevaClave({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>
}) {
  const { token, error } = await searchParams
  if (!token) redirect('/entrar?error=enlace')

  return (
    <div className="min-h-dvh bg-barro-50">
      <main className="mx-auto flex min-h-dvh max-w-md items-center px-6 py-12">
        <div className="w-full">
          <div className="rounded-xl border border-barro-200 bg-white p-6 shadow-sm">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-barro-100">
              <KeyRound className="h-5 w-5 text-barro-700" aria-hidden />
            </div>
            <h1 className="mt-4 text-lg font-semibold text-barro-900">Una contraseña nueva</h1>
            <p className="mt-1 text-barro-600">
              Escríbala dos veces. Al guardarla se cierran las demás sesiones abiertas.
            </p>

            <form action={guardar} className="mt-6 space-y-4">
              <input type="hidden" name="token" value={token} />
              <div>
                <label htmlFor="clave" className="block text-sm font-medium text-barro-800">
                  Contraseña nueva
                </label>
                <input
                  id="clave"
                  name="clave"
                  type="password"
                  required
                  minLength={12}
                  autoFocus
                  autoComplete="new-password"
                  className="mt-1.5 w-full rounded-lg border border-barro-200 bg-white px-3 py-2.5
                             text-base text-barro-900 focus:border-selva-600 focus:outline-none
                             focus:ring-2 focus:ring-selva-600/20"
                />
                <p className="mt-1.5 text-sm text-barro-500">Doce caracteres o más.</p>
              </div>

              <div>
                <label htmlFor="repetida" className="block text-sm font-medium text-barro-800">
                  Otra vez
                </label>
                <input
                  id="repetida"
                  name="repetida"
                  type="password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                  className="mt-1.5 w-full rounded-lg border border-barro-200 bg-white px-3 py-2.5
                             text-base text-barro-900 focus:border-selva-600 focus:outline-none
                             focus:ring-2 focus:ring-selva-600/20"
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-lg bg-selva-700 px-4 py-2.5 font-medium text-white
                           hover:bg-selva-900 focus:outline-none focus:ring-2
                           focus:ring-selva-700/30 focus:ring-offset-2"
              >
                Guardar y entrar
              </button>
            </form>
          </div>

          {error === 'corta' && (
            <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
              Muy corta: tiene que llegar a doce caracteres.
            </p>
          )}
          {error === 'distintas' && (
            <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
              Las dos no coinciden. Escríbalas otra vez.
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
