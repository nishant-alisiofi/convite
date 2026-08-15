import {
  ArrowRight,
  CheckCircle2,
  Info,
  KeyRound,
  MailCheck,
  MessageCircle,
  Waves,
} from 'lucide-react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { aE164 } from '@/lib/canales'
import {
  autenticacionConfigurada,
  correoInvitado,
  getAuth,
  telefonoInvitado,
} from '@/lib/auth'
import { rutaInterna, sesionActual } from '@/lib/sesion'

/**
 * Sign-in. Two doors, no passwords: an emailed link, or a code over WhatsApp.
 *
 * Section 3 says no passwords, and one fewer credential is one fewer thing a coordinator has
 * to recover from a field office with bad signal. WhatsApp is the second door because in the
 * Atrato it is the channel that works first — it is what the whole intake side of this
 * product already runs on — and asking somebody to open a mailbox to reach the panel asks for
 * the one thing the field office may not have. Email stays, and is the fallback when a phone
 * is lost or a number changes.
 *
 * Section 10 sets the visual register: light, calm, readable at 14px+, works on a laptop
 * over a weak connection. Everything here is server-rendered and the page carries no
 * client JavaScript at all — it has to work when a page load is expensive. That is why the
 * code step is a second page rather than a panel that swaps in: a form post is the only
 * interaction available, and it is also the one that survives the page being reloaded.
 */

async function enviarEnlace(formData: FormData) {
  'use server'
  const correo = String(formData.get('correo') ?? '')
    .trim()
    .toLowerCase()
  if (!correo.includes('@')) redirect('/entrar?error=correo')

  // Should not happen: the middleware says so loudly on every protected route. But this
  // form is public, so without the guard a misconfigured deploy answers a coordinator's
  // sign-in with a stack trace.
  if (!autenticacionConfigurada()) redirect('/entrar?error=configuracion')

  const desde = rutaInterna(String(formData.get('desde') ?? ''))
  const destino = `/auth/callback${desde ? `?desde=${encodeURIComponent(desde)}` : ''}`

  // The allowlist (2.10), checked before anything is sent. `lib/auth.ts` asks the same
  // question again when the row would be written; see the note on `correoInvitado`.
  if (await correoInvitado(correo)) {
    await getAuth().api.signInMagicLink({
      headers: await headers(),
      body: { email: correo, callbackURL: destino, errorCallbackURL: '/entrar' },
    })
  }

  // The same outcome either way: whether an address belongs to staff is not something an
  // unauthenticated form gets to reveal.
  redirect('/entrar?enviado=1')
}

/** Step one of the WhatsApp door: a number goes in, a six-digit code goes out. */
async function enviarCodigoWhatsApp(formData: FormData) {
  'use server'
  const crudo = String(formData.get('telefono') ?? '').trim()
  if (crudo.length < 7) redirect('/entrar?error=telefono')

  if (!autenticacionConfigurada()) redirect('/entrar?error=configuracion')

  // `aE164` is the channel layer's own normaliser, the same one the SMS and voice drivers
  // use. A coordinator types «300 111 2233» and means +573001112233; making them type the
  // country code is a way to fail a sign-in over punctuation.
  const telefono = aE164(crudo)
  if (!/^\+[1-9][0-9]{7,14}$/.test(telefono)) redirect('/entrar?error=telefono')

  const desde = rutaInterna(String(formData.get('desde') ?? ''))

  // The allowlist (2.10), before anything is sent — same as the email door. `lib/auth.ts`
  // asks again when the row would be written.
  if (await telefonoInvitado(telefono)) {
    await getAuth().api.sendPhoneNumberOTP({
      headers: await headers(),
      body: { phoneNumber: telefono },
    })
  }

  // Same screen either way. Whether a number belongs to staff is not something an
  // unauthenticated form gets to reveal — and the code step below refuses anyway.
  const parametros = new URLSearchParams({ codigo: '1', tel: telefono })
  if (desde) parametros.set('desde', desde)
  redirect(`/entrar?${parametros}`)
}

/** Step two: the code they read off their phone. */
async function verificarCodigoWhatsApp(formData: FormData) {
  'use server'
  const telefono = String(formData.get('telefono') ?? '').trim()
  const codigo = String(formData.get('codigo') ?? '').replace(/\D/g, '')
  const desde = rutaInterna(String(formData.get('desde') ?? ''))

  const volver = (error: string) => {
    const p = new URLSearchParams({ codigo: '1', tel: telefono, error })
    if (desde) p.set('desde', desde)
    redirect(`/entrar?${p}`)
  }

  if (!/^\d{6}$/.test(codigo)) volver('codigo')
  if (!autenticacionConfigurada()) redirect('/entrar?error=configuracion')

  try {
    await getAuth().api.verifyPhoneNumber({
      headers: await headers(),
      body: { phoneNumber: telefono, code: codigo },
    })
  } catch {
    // Wrong code, expired code, too many tries, or a number nobody invited. Deliberately one
    // message: distinguishing them tells an attacker which numbers are staff.
    volver('codigo')
  }

  // Signed in. The callback links the session to its staff record, exactly as it does for
  // the emailed link — one place decides who is staff, whichever door they came through.
  redirect(`/auth/callback${desde ? `?desde=${encodeURIComponent(desde)}` : ''}`)
}

export default async function Entrar({
  searchParams,
}: {
  searchParams: Promise<{
    enviado?: string
    error?: string
    motivo?: string
    desde?: string
    codigo?: string
    tel?: string
  }>
}) {
  if (await sesionActual()) redirect('/tablero')
  const { enviado, error, motivo, desde, codigo, tel } = await searchParams
  const pidiendoCodigo = codigo === '1' && Boolean(tel)

  /**
   * Better Auth names its own failures. A coordinator cannot act on any of them and nearly
   * all of them mean the same thing, so they collapse into «that link is done, ask for
   * another» — except one.
   *
   * `failed_to_create_user` is what the allowlist check in lib/auth.ts produces, and
   * telling that person to request another link sends them round a loop that can never
   * end. It is the same situation `motivo=sin_invitacion` already covers on the other path,
   * so it gets the same answer: the address is fine, it is just not enabled yet.
   */
  const sinInvitacion = motivo === 'sin_invitacion' || error === 'failed_to_create_user'
  const errorEnlace =
    error !== undefined &&
    !['correo', 'telefono', 'codigo', 'configuracion', 'failed_to_create_user'].includes(error)

  return (
    <div className="min-h-dvh bg-barro-50">
      <main className="mx-auto grid min-h-dvh max-w-5xl items-center gap-12 px-6 py-12 md:grid-cols-2">
        {/* Left: what this is. A coordinator signing in at 6am should see the point. */}
        <section className="max-w-sm">
          <div className="flex items-center gap-2 text-barro-900">
            <Waves className="h-6 w-6 text-selva-700" aria-hidden />
            <span className="text-2xl font-semibold tracking-tight">Convite</span>
          </div>
          <p className="mt-3 text-lg leading-snug text-barro-700">
            Coordinación de ayuda en la cuenca del Atrato.
          </p>
          <p className="mt-4 text-barro-600">
            Para cada solicitud abierta, Convite dice qué es lo que falta: si falta cómo
            llegar, si falta qué mandar, o si falta quién lo lleve.
          </p>

          <ul className="mt-8 space-y-3 text-sm text-barro-700">
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
            {pidiendoCodigo ? (
              <>
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-selva-50">
                  <MessageCircle className="h-5 w-5 text-selva-700" aria-hidden />
                </div>
                <h1 className="mt-4 text-lg font-semibold text-barro-900">
                  Le mandamos un código por WhatsApp
                </h1>
                <p className="mt-1 text-barro-600">
                  Son seis números, al {tel}. Escríbalos aquí.
                </p>

                <form action={verificarCodigoWhatsApp} className="mt-6 space-y-4">
                  <input type="hidden" name="telefono" value={tel} />
                  <input type="hidden" name="desde" value={desde ?? ''} />
                  <div>
                    <label htmlFor="codigo" className="block text-sm font-medium text-barro-800">
                      Su código
                    </label>
                    <input
                      id="codigo"
                      name="codigo"
                      // `text` with a numeric mode: `number` gives a spinner, drops leading
                      // zeros, and on some Android keyboards is harder to type than this.
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      autoFocus
                      placeholder="000000"
                      className="mt-1.5 w-full rounded-lg border border-barro-200 bg-white px-3 py-2.5
                                 text-center font-mono text-2xl tracking-[0.3em] text-barro-900
                                 placeholder:text-barro-300 focus:border-selva-600 focus:outline-none
                                 focus:ring-2 focus:ring-selva-600/20"
                    />
                  </div>

                  <button
                    type="submit"
                    className="group flex w-full items-center justify-center gap-2 rounded-lg
                               bg-selva-700 px-4 py-2.5 font-medium text-white
                               hover:bg-selva-900 focus:outline-none focus:ring-2
                               focus:ring-selva-700/30 focus:ring-offset-2"
                  >
                    Entrar
                    <ArrowRight
                      className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </button>

                  <p className="text-sm text-barro-500">
                    El código vence en cinco minutos.{' '}
                    <a href="/entrar" className="underline hover:text-barro-800">
                      Empezar de nuevo
                    </a>
                    .
                  </p>
                </form>
              </>
            ) : enviado ? (
              <div>
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-selva-50">
                  <MailCheck className="h-5 w-5 text-selva-700" aria-hidden />
                </div>
                <h1 className="mt-4 text-lg font-semibold text-barro-900">
                  Le mandamos un enlace al correo
                </h1>
                <p className="mt-2 text-barro-600">
                  Ábralo desde este mismo equipo y entra directo. El enlace sirve una sola vez.
                </p>
                <p className="mt-4 text-sm text-barro-500">
                  ¿No llegó? Revise el correo no deseado, o vuelva a{' '}
                  <a href="/entrar" className="underline hover:text-barro-800">
                    pedir otro enlace
                  </a>
                  .
                </p>
              </div>
            ) : (
              <>
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-barro-100">
                  <KeyRound className="h-5 w-5 text-barro-700" aria-hidden />
                </div>
                <h1 className="mt-4 text-lg font-semibold text-barro-900">Entrar</h1>
                <p className="mt-1 text-barro-600">
                  Solo para el equipo que coordina. Escriba su correo y le mandamos el enlace.
                </p>

                <form action={enviarEnlace} className="mt-6 space-y-4">
                  {/* Where they were headed before the middleware sent them here. Validated
                      on the way out by `rutaInterna`, never trusted as given. */}
                  <input type="hidden" name="desde" value={desde ?? ''} />
                  <div>
                    <label
                      htmlFor="correo"
                      className="block text-sm font-medium text-barro-800"
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
                                 text-base text-barro-900 placeholder:text-barro-400
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

                  <p id="ayuda-correo" className="flex gap-2 text-sm text-barro-500">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>No hay contraseña que recordar ni que perder.</span>
                  </p>
                </form>

                {/* The second door. Separated by a rule rather than a tab strip: tabs need
                    JavaScript to switch, and both forms have to work on a page that has none. */}
                <div className="mt-6 flex items-center gap-3" aria-hidden>
                  <span className="h-px flex-1 bg-barro-200" />
                  <span className="text-xs font-medium uppercase tracking-wide text-barro-400">
                    o
                  </span>
                  <span className="h-px flex-1 bg-barro-200" />
                </div>

                <form action={enviarCodigoWhatsApp} className="mt-6 space-y-4">
                  <input type="hidden" name="desde" value={desde ?? ''} />
                  <div>
                    <label
                      htmlFor="telefono"
                      className="block text-sm font-medium text-barro-800"
                    >
                      Su número de WhatsApp
                    </label>
                    <input
                      id="telefono"
                      name="telefono"
                      type="tel"
                      required
                      autoComplete="tel"
                      inputMode="tel"
                      placeholder="300 111 2233"
                      aria-describedby="ayuda-telefono"
                      className="mt-1.5 w-full rounded-lg border border-barro-200 bg-white px-3 py-2.5
                                 text-base text-barro-900 placeholder:text-barro-400
                                 focus:border-selva-600 focus:outline-none focus:ring-2
                                 focus:ring-selva-600/20"
                    />
                  </div>

                  <button
                    type="submit"
                    className="group flex w-full items-center justify-center gap-2 rounded-lg
                               border border-selva-700 bg-white px-4 py-2.5 font-medium
                               text-selva-900 hover:bg-selva-50 focus:outline-none
                               focus:ring-2 focus:ring-selva-700/30 focus:ring-offset-2"
                  >
                    <MessageCircle className="h-4 w-4" aria-hidden />
                    Mandarme un código por WhatsApp
                  </button>

                  <p id="ayuda-telefono" className="flex gap-2 text-sm text-barro-500">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>
                      Si no escribe el indicativo, asumimos Colombia (+57).
                    </span>
                  </p>
                </form>
              </>
            )}
          </div>

          {errorEnlace && (
            <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
              Ese enlace ya no sirve. Pida uno nuevo y ábralo apenas llegue.
            </p>
          )}
          {error === 'correo' && (
            <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
              Escriba un correo válido para poder entrar.
            </p>
          )}
          {error === 'telefono' && (
            <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
              Ese número no se entiende. Escríbalo con indicativo, así: +57 300 111 2233.
            </p>
          )}
          {error === 'codigo' && (
            <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
              Ese código no sirve. Revise los seis números, o pida uno nuevo: vencen a los cinco
              minutos y solo se puede fallar tres veces.
            </p>
          )}
          {motivo === 'ya_vinculada' && (
            <div className="mt-4 rounded-lg border border-atrato-100 bg-atrato-50 px-4 py-3">
              <p className="font-medium text-barro-900">Ya entró por el otro camino.</p>
              <p className="mt-1 text-sm text-barro-700">
                Su cuenta quedó ligada al correo o al número con el que entró la primera vez. Siga
                usando ese; si necesita cambiarlo, pídaselo a quien administra Convite.
              </p>
            </div>
          )}
          {error === 'configuracion' && (
            <div className="mt-4 rounded-lg border border-atrato-100 bg-atrato-50 px-4 py-3">
              <p className="font-medium text-barro-900">El servidor no tiene configurada la identidad.</p>
              <p className="mt-1 text-sm text-barro-700">
                No es algo que usted pueda resolver desde aquí. Avísele a quien opera Convite:
                faltan <code>BETTER_AUTH_SECRET</code> o <code>DATABASE_URL</code>.
              </p>
            </div>
          )}
          {sinInvitacion && (
            <div className="mt-4 rounded-lg border border-atrato-100 bg-atrato-50 px-4 py-3">
              <p className="font-medium text-barro-900">Su correo todavía no está habilitado.</p>
              <p className="mt-1 text-sm text-barro-700">
                Pídale a quien administra Convite en su organización que lo agregue.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
