import { KeyRound, ShieldCheck, TriangleAlert } from 'lucide-react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAuth } from '@/lib/auth'
import { identidadVisible, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * Setting a password, from inside a session that already exists.
 *
 * This page is the entire reason a password is safe to offer at all. An account is only
 * usable if the address was invited **and** somebody proved they control it, and a password
 * is the one credential that could quietly break the second half — knowing an invited address
 * is not the same as receiving mail at it, and a list of invited addresses is exactly the sort
 * of thing that gets forwarded.
 *
 * So there is no «sign up with a password» anywhere. `disableSignUp` closes the HTTP route,
 * Better Auth's `setPassword` is `serverOnly` so it is not a route at all, and the only call
 * to it is the action below — which cannot run without a live session. A password can
 * therefore only ever land on an account whose owner already came in through the magic link
 * or the WhatsApp code.
 *
 * The panel-wide guard in ../layout.tsx already redirects an unsigned visitor, and the check
 * repeated here is not redundant: this is the one page in the panel where being wrong about
 * who is asking would hand over an account.
 */

/** A placeholder address. Somebody who signed in by WhatsApp has no mailbox to recover to. */
function esMarcador(correo: string): boolean {
  return correo.endsWith('@wa.convite.invalid')
}

async function ponerClave(formData: FormData) {
  'use server'

  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  if (esMarcador(sesion.correo)) {
    // Nothing to sign in *with*: a password is paired with an address, and this account's
    // address is a placeholder that receives nothing. Offering it would also mean offering a
    // recovery path that cannot deliver.
    redirect('/clave?error=sin_correo')
  }

  const clave = String(formData.get('clave') ?? '')
  const repetida = String(formData.get('repetida') ?? '')

  if (clave.length < 12) redirect('/clave?error=corta')
  if (clave !== repetida) redirect('/clave?error=distintas')

  try {
    await getAuth().api.setPassword({
      headers: await headers(),
      body: { newPassword: clave },
    })
  } catch {
    redirect('/clave?error=fallo')
  }

  redirect('/clave?listo=1')
}

export default async function Clave({
  searchParams,
}: {
  searchParams: Promise<{ listo?: string; error?: string }>
}) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { listo, error } = await searchParams
  const sinCorreo = esMarcador(sesion.correo)

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-xl font-semibold text-barro-900">Su contraseña</h1>
      <p className="mt-2 text-barro-600">
        Es opcional. El enlace por correo y el código por WhatsApp siguen funcionando igual, y
        para la mayoría son más cómodos: no hay nada que recordar. Una contraseña sirve si entra
        todos los días desde el mismo equipo.
      </p>

      <div className="mt-6 rounded-xl border border-barro-200 bg-white p-6 shadow-sm">
        {listo ? (
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-selva-700" aria-hidden />
            <div>
              <p className="font-medium text-barro-900">Contraseña guardada.</p>
              <p className="mt-1 text-sm text-barro-700">
                Desde ahora puede entrar con {identidadVisible(sesion)} y su contraseña, o
                seguir pidiendo el enlace. Las dos cosas valen.
              </p>
            </div>
          </div>
        ) : sinCorreo ? (
          <div className="flex gap-3">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-atrato-700" aria-hidden />
            <div>
              <p className="font-medium text-barro-900">
                Esta cuenta entra por WhatsApp, no por correo.
              </p>
              <p className="mt-1 text-sm text-barro-700">
                Una contraseña va con una dirección de correo, y esta cuenta no tiene una: entró
                con su número. Siga usando el código por WhatsApp. Si quiere entrar también por
                correo, pídale a quien administra Convite que lo invite con su dirección.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-barro-100">
              <KeyRound className="h-5 w-5 text-barro-700" aria-hidden />
            </div>
            <p className="mt-4 text-sm text-barro-600">
              Quedará ligada a <span className="font-medium text-barro-900">{sesion.correo}</span>.
            </p>

            <form action={ponerClave} className="mt-4 space-y-4">
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
                  autoComplete="new-password"
                  aria-describedby="ayuda-clave"
                  className="mt-1.5 w-full rounded-lg border border-barro-200 bg-white px-3 py-2.5
                             text-base text-barro-900 focus:border-selva-600 focus:outline-none
                             focus:ring-2 focus:ring-selva-600/20"
                />
                <p id="ayuda-clave" className="mt-1.5 text-sm text-barro-500">
                  Doce caracteres o más. Una frase que recuerde sirve mejor que una palabra
                  rara: «la lancha sale a las cinco» es más larga y más fácil.
                </p>
              </div>

              <div>
                <label htmlFor="repetida" className="block text-sm font-medium text-barro-800">
                  Otra vez, para estar seguros
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
                Guardar la contraseña
              </button>
            </form>
          </>
        )}
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
      {error === 'fallo' && (
        <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
          No se pudo guardar. Intente de nuevo; si sigue igual, avísele a quien opera Convite.
        </p>
      )}
      {error === 'sin_correo' && (
        <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
          Esta cuenta no tiene correo: entró por WhatsApp.
        </p>
      )}
    </div>
  )
}
