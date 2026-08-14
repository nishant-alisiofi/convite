import { ArrowRight, CheckCircle2, Info, KeyRound, MailCheck, Waves } from 'lucide-react'
import { redirect } from 'next/navigation'
import { env } from '@/lib/env'
import { sesionActual } from '@/lib/sesion'
import { clienteServidor } from '@/lib/supabase/servidor'

/**
 * Sign-in. Magic link only — Section 3 says no passwords, and one fewer credential is one
 * fewer thing a coordinator has to recover from a field office with bad signal.
 *
 * Section 10 sets the visual register: light, calm, readable at 14px+, works on a laptop
 * over a weak connection. Everything here is server-rendered and the page carries no
 * client JavaScript at all — it has to work when a page load is expensive.
 */

async function enviarEnlace(formData: FormData) {
  'use server'
  const correo = String(formData.get('correo') ?? '')
    .trim()
    .toLowerCase()
  if (!correo.includes('@')) redirect('/entrar?error=correo')

  const supabase = await clienteServidor()
  await supabase.auth.signInWithOtp({
    email: correo,
    options: { emailRedirectTo: `${env().APP_BASE_URL}/auth/callback` },
  })

  // The same outcome either way: whether an address belongs to staff is not something an
  // unauthenticated form gets to reveal.
  redirect('/entrar?enviado=1')
}

export default async function Entrar({
  searchParams,
}: {
  searchParams: Promise<{ enviado?: string; error?: string; motivo?: string }>
}) {
  if (await sesionActual()) redirect('/tablero')
  const { enviado, error, motivo } = await searchParams

  return (
    <div className="min-h-dvh bg-barro-50">
      <main className="mx-auto grid min-h-dvh max-w-5xl items-center gap-12 px-6 py-12 md:grid-cols-2">
        {/* Left: what this is. A coordinator signing in at 6am should see the point. */}
        <section className="max-w-sm">
          <div className="flex items-center gap-2 text-stone-900">
            <Waves className="h-6 w-6 text-selva-700" aria-hidden />
            <span className="text-2xl font-semibold tracking-tight">Convite</span>
          </div>
          <p className="mt-3 text-lg leading-snug text-stone-700">
            Coordinación de ayuda en la cuenca del Atrato.
          </p>
          <p className="mt-4 text-stone-600">
            Para cada solicitud abierta, Convite dice qué es lo que falta: si falta cómo
            llegar, si falta qué mandar, o si falta quién lo lleve.
          </p>

          <ul className="mt-8 space-y-3 text-sm text-stone-700">
            {[
              'Las comunidades no necesitan instalar nada ni tener contraseña.',
              'El inventario siempre muestra cuándo fue la última vez que se contó.',
              'Lo que es público va agregado por municipio, nunca por comunidad.',
            ].map((linea) => (
              <li key={linea} className="flex gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-selva-700" aria-hidden />
                <span>{linea}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Right: the actual door. */}
        <section>
          <div className="rounded-xl border border-barro-200 bg-white p-6 shadow-sm">
            {enviado ? (
              <div>
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-selva-50">
                  <MailCheck className="h-5 w-5 text-selva-700" aria-hidden />
                </div>
                <h1 className="mt-4 text-lg font-semibold text-stone-900">
                  Le mandamos un enlace al correo
                </h1>
                <p className="mt-2 text-stone-600">
                  Ábralo desde este mismo equipo y entra directo. El enlace sirve una sola vez.
                </p>
                <p className="mt-4 text-sm text-stone-500">
                  ¿No llegó? Revise el correo no deseado, o vuelva a{' '}
                  <a href="/entrar" className="underline hover:text-stone-800">
                    pedir otro enlace
                  </a>
                  .
                </p>
              </div>
            ) : (
              <>
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-stone-100">
                  <KeyRound className="h-5 w-5 text-stone-700" aria-hidden />
                </div>
                <h1 className="mt-4 text-lg font-semibold text-stone-900">Entrar</h1>
                <p className="mt-1 text-stone-600">
                  Solo para el equipo que coordina. Escriba su correo y le mandamos el enlace.
                </p>

                <form action={enviarEnlace} className="mt-6 space-y-4">
                  <div>
                    <label
                      htmlFor="correo"
                      className="block text-sm font-medium text-stone-800"
                    >
                      Su correo
                    </label>
                    <input
                      id="correo"
                      name="correo"
                      type="email"
                      required
                      autoFocus
                      autoComplete="email"
                      placeholder="nombre@organizacion.org"
                      aria-describedby="ayuda-correo"
                      className="mt-1.5 w-full rounded-lg border border-barro-200 bg-white px-3 py-2.5
                                 text-base text-stone-900 placeholder:text-stone-400
                                 focus:border-selva-600 focus:outline-none focus:ring-2
                                 focus:ring-selva-600/20"
                    />
                  </div>

                  <button
                    type="submit"
                    className="group flex w-full items-center justify-center gap-2 rounded-lg
                               bg-selva-700 px-4 py-2.5 font-medium text-white
                               hover:bg-selva-900 focus:outline-none focus:ring-2
                               focus:ring-selva-700/30 focus:ring-offset-2"
                  >
                    Mandarme el enlace
                    <ArrowRight
                      className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </button>

                  <p id="ayuda-correo" className="flex gap-2 text-sm text-stone-500">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>No hay contraseña que recordar ni que perder.</span>
                  </p>
                </form>
              </>
            )}
          </div>

          {error === 'enlace' && (
            <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-stone-700">
              Ese enlace ya no sirve. Pida uno nuevo y ábralo apenas llegue.
            </p>
          )}
          {error === 'correo' && (
            <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-stone-700">
              Escriba un correo válido para poder entrar.
            </p>
          )}
          {motivo === 'sin_invitacion' && (
            <div className="mt-4 rounded-lg border border-atrato-100 bg-atrato-50 px-4 py-3">
              <p className="font-medium text-stone-900">Su correo todavía no está habilitado.</p>
              <p className="mt-1 text-sm text-stone-700">
                Pídale a quien administra Convite en su organización que lo agregue.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
