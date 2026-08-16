import {
  ArrowRight,
  CheckCircle2,
  Info,
  MapPin,
  MessageCircle,
  PackageCheck,
  Truck,
  Waves,
} from 'lucide-react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { MODOS, type Modo } from '@/db/schema/vocabulario'
import { crearOfertaTransporte, misOfertasTransporte } from '@/lib/aportante'
import { autenticacionConfigurada, getAuth } from '@/lib/auth'
import { aE164 } from '@/lib/canales'
import { agregarPublico, cargarMapaPublico } from '@/lib/publico'
import { sesionActual } from '@/lib/sesion'

/**
 * FR-18 (§29.2–29.3b) — a transporter self-registers to OFFER capacity.
 *
 * Offering is the frictionless side (§29.1): a driver proves they own a number or an address and
 * lands as an aportante — supply-side only, no household addresses, ever. The vetted side of
 * transport (seeing exact stops on a run, `transportista_avalado` + convite_conduce_hacia) is a
 * different tier and is not reachable from here.
 *
 * The whole page is server-rendered and carries no client JavaScript — it has to work over a weak
 * connection, the same constraint /entrar carries. Two states: signed out shows the two doors
 * (emailed link, WhatsApp code, both pointing at /transportar/registro so linking lands an
 * aportante, not the admin default); signed in shows the offer surface and the public coordination
 * layer, which is all a supply-side participant ever sees.
 */

const CALLBACK = '/transportar/registro'

async function enviarEnlace(formData: FormData) {
  'use server'
  const correo = String(formData.get('correo') ?? '')
    .trim()
    .toLowerCase()
  if (!correo.includes('@')) redirect('/transportar?error=correo')
  if (!autenticacionConfigurada()) redirect('/transportar?error=configuracion')

  await getAuth().api.signInMagicLink({
    headers: await headers(),
    body: { email: correo, callbackURL: CALLBACK, errorCallbackURL: '/transportar' },
  })

  redirect('/transportar?enviado=1')
}

async function enviarCodigoWhatsApp(formData: FormData) {
  'use server'
  const crudo = String(formData.get('telefono') ?? '').trim()
  if (crudo.length < 7) redirect('/transportar?error=telefono')
  if (!autenticacionConfigurada()) redirect('/transportar?error=configuracion')

  const telefono = aE164(crudo)
  if (!/^\+[1-9][0-9]{7,14}$/.test(telefono)) redirect('/transportar?error=telefono')

  await getAuth().api.sendPhoneNumberOTP({
    headers: await headers(),
    body: { phoneNumber: telefono },
  })

  redirect(`/transportar?${new URLSearchParams({ codigo: '1', tel: telefono })}`)
}

async function verificarCodigoWhatsApp(formData: FormData) {
  'use server'
  const telefono = String(formData.get('telefono') ?? '').trim()
  const codigo = String(formData.get('codigo') ?? '').replace(/\D/g, '')

  const volver = (error: string) =>
    redirect(`/transportar?${new URLSearchParams({ codigo: '1', tel: telefono, error })}`)

  if (!/^\d{6}$/.test(codigo)) volver('codigo')
  if (!autenticacionConfigurada()) redirect('/transportar?error=configuracion')

  try {
    await getAuth().api.verifyPhoneNumber({
      headers: await headers(),
      body: { phoneNumber: telefono, code: codigo },
    })
  } catch {
    volver('codigo')
  }

  // Signed in. The callback links the session to an aportante staff record.
  redirect(CALLBACK)
}

async function crearOferta(formData: FormData) {
  'use server'
  const sesion = await sesionActual()
  if (!sesion) redirect('/transportar')

  const modo = String(formData.get('modo') ?? '') as Modo
  const areaCobertura = String(formData.get('area') ?? '').trim()
  const cupo = Number.parseInt(String(formData.get('cupo') ?? ''), 10)
  const notas = String(formData.get('notas') ?? '').trim()

  if (!MODOS.includes(modo)) redirect('/transportar?error=modo')
  if (areaCobertura.length === 0) redirect('/transportar?error=area')
  if (!Number.isInteger(cupo) || cupo <= 0) redirect('/transportar?error=cupo')

  await crearOfertaTransporte(sesion!, {
    modo,
    areaCobertura,
    cupoFamilias: cupo,
    notas: notas.length > 0 ? notas : null,
  })

  redirect('/transportar?ofrecido=1')
}

/** The public coordination layer — municipality-level need, the same counts /respuesta publishes. */
async function coordinacionPublica(): Promise<{ municipio: string; pendientes: number }[]> {
  const { zonas } = agregarPublico(await cargarMapaPublico())
  return zonas
    .filter((z) => z.pendientes > 0)
    .map((z) => ({ municipio: z.municipio, pendientes: z.pendientes }))
    .sort((a, b) => b.pendientes - a.pendientes)
}

export default async function Transportar({
  searchParams,
}: {
  searchParams: Promise<{
    enviado?: string
    error?: string
    codigo?: string
    tel?: string
    registrado?: string
    ofrecido?: string
  }>
}) {
  const { enviado, error, codigo, tel, registrado, ofrecido } = await searchParams
  const sesion = await sesionActual()
  const pidiendoCodigo = codigo === '1' && Boolean(tel)

  const errorEnlace =
    error !== undefined &&
    !['correo', 'telefono', 'codigo', 'configuracion', 'modo', 'area', 'cupo'].includes(error)

  // ── Signed in: the aportante's own surface — offer capacity, see the public layer only ────────
  if (sesion) {
    const [ofertas, coordinacion] = await Promise.all([
      misOfertasTransporte(sesion),
      coordinacionPublica(),
    ])

    return (
      <div className="min-h-dvh bg-barro-50">
        <main className="mx-auto max-w-3xl px-5 py-12 sm:px-6">
          <div className="flex items-center gap-2 text-barro-900">
            <Truck className="h-6 w-6 text-selva-700" aria-hidden />
            <span className="text-2xl font-semibold tracking-tight">Ofrecer transporte</span>
          </div>
          <p className="mt-3 text-barro-700">
            Usted ofrece capacidad de transporte. No verá direcciones de hogares ni datos de las
            comunidades: eso es de las rutas avaladas. Aquí solo registra qué puede mover y por
            dónde.
          </p>

          {registrado === '1' && (
            <p className="mt-6 flex items-start gap-2 rounded-lg border border-selva-200 bg-selva-50 px-4 py-3 text-sm text-barro-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-selva-700" aria-hidden />
              <span>Quedó registrado como aportante de transporte. Ya puede ofrecer capacidad.</span>
            </p>
          )}
          {ofrecido === '1' && (
            <p className="mt-6 flex items-start gap-2 rounded-lg border border-selva-200 bg-selva-50 px-4 py-3 text-sm text-barro-800">
              <PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-selva-700" aria-hidden />
              <span>Guardamos su ofrecimiento de capacidad. Gracias.</span>
            </p>
          )}
          {error === 'modo' && (
            <p className="mt-6 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
              Escoja un medio de transporte de la lista.
            </p>
          )}
          {error === 'area' && (
            <p className="mt-6 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
              Diga por dónde puede mover ayuda (por ejemplo: «Quibdó – Bojayá por el Atrato»).
            </p>
          )}
          {error === 'cupo' && (
            <p className="mt-6 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
              El cupo de familias debe ser un número mayor que cero.
            </p>
          )}

          {/* The offer form */}
          <section className="mt-8 rounded-xl border border-barro-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-barro-900">Ofrecer capacidad</h2>
            <form action={crearOferta} className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="modo" className="block text-sm font-medium text-barro-800">
                    Medio
                  </label>
                  <select
                    id="modo"
                    name="modo"
                    required
                    defaultValue=""
                    className="mt-1.5 w-full rounded-lg border border-barro-200 bg-white px-3 py-2.5
                               text-base text-barro-900 focus:border-selva-600 focus:outline-none
                               focus:ring-2 focus:ring-selva-600/20"
                  >
                    <option value="" disabled>
                      Escoja…
                    </option>
                    {MODOS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="cupo" className="block text-sm font-medium text-barro-800">
                    Cupo (familias)
                  </label>
                  <input
                    id="cupo"
                    name="cupo"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]+"
                    required
                    placeholder="12"
                    className="mt-1.5 w-full rounded-lg border border-barro-200 bg-white px-3 py-2.5
                               text-base text-barro-900 placeholder:text-barro-400
                               focus:border-selva-600 focus:outline-none focus:ring-2
                               focus:ring-selva-600/20"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="area" className="block text-sm font-medium text-barro-800">
                  Por dónde puede mover ayuda
                </label>
                <input
                  id="area"
                  name="area"
                  type="text"
                  required
                  placeholder="Quibdó – Bojayá por el Atrato"
                  aria-describedby="ayuda-area"
                  className="mt-1.5 w-full rounded-lg border border-barro-200 bg-white px-3 py-2.5
                             text-base text-barro-900 placeholder:text-barro-400
                             focus:border-selva-600 focus:outline-none focus:ring-2
                             focus:ring-selva-600/20"
                />
                <p id="ayuda-area" className="mt-1.5 flex gap-2 text-sm text-barro-500">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>Un municipio o un corredor de río, no una dirección exacta.</span>
                </p>
              </div>
              <div>
                <label htmlFor="notas" className="block text-sm font-medium text-barro-800">
                  Notas (opcional)
                </label>
                <input
                  id="notas"
                  name="notas"
                  type="text"
                  placeholder="Disponible los fines de semana"
                  className="mt-1.5 w-full rounded-lg border border-barro-200 bg-white px-3 py-2.5
                             text-base text-barro-900 placeholder:text-barro-400
                             focus:border-selva-600 focus:outline-none focus:ring-2
                             focus:ring-selva-600/20"
                />
              </div>
              <button
                type="submit"
                className="group flex items-center justify-center gap-2 rounded-lg bg-selva-700 px-4
                           py-2.5 font-medium text-white hover:bg-selva-900 focus:outline-none
                           focus:ring-2 focus:ring-selva-700/30 focus:ring-offset-2"
              >
                Guardar ofrecimiento
                <ArrowRight
                  className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </button>
            </form>
          </section>

          {/* The aportante's own standing offers */}
          {ofertas.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-barro-900">Sus ofrecimientos</h2>
              <ul className="mt-4 space-y-3">
                {ofertas.map((o) => (
                  <li
                    key={o.id}
                    className="rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-800"
                  >
                    <span className="font-medium">{o.modo}</span> · {o.cupoFamilias} familias ·{' '}
                    {o.areaCobertura}
                    {o.estado === 'RETIRADA' && (
                      <span className="ml-2 text-barro-500">(retirado)</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* The public coordination layer — municipality-level need, zero privacy cost (§29.3b) */}
          <section className="mt-10 border-t border-barro-200 pt-8">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-barro-900">
              <MapPin className="h-5 w-5 text-selva-700" aria-hidden />
              Dónde hace falta
            </h2>
            <p className="mt-1 text-sm text-barro-600">
              Conteos por municipio, agregados. No hay direcciones ni nombres de comunidades: es la
              misma capa pública que ve cualquiera.
            </p>
            {coordinacion.length === 0 ? (
              <p className="mt-4 text-sm text-barro-500">Sin solicitudes abiertas por ahora.</p>
            ) : (
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {coordinacion.map((z) => (
                  <li
                    key={z.municipio}
                    className="flex items-center justify-between rounded-lg border border-barro-200
                               bg-white px-4 py-2.5 text-sm"
                  >
                    <span className="text-barro-800">{z.municipio}</span>
                    <span className="font-medium text-barro-900">{z.pendientes} en espera</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      </div>
    )
  }

  // ── Signed out: the two doors, both landing on the aportante callback ─────────────────────────
  return (
    <div className="min-h-dvh bg-barro-50">
      <main className="mx-auto grid min-h-dvh max-w-5xl items-center gap-12 px-5 py-12 sm:px-6 md:grid-cols-2">
        <section className="order-2 max-w-sm md:order-1">
          <div className="flex items-center gap-2 text-barro-900">
            <Waves className="h-6 w-6 text-selva-700" aria-hidden />
            <span className="text-2xl font-semibold tracking-tight">Convite</span>
          </div>
          <p className="mt-3 text-lg leading-snug text-barro-700">
            ¿Puede transportar ayuda en el Chocó o el Pacífico?
          </p>
          <p className="mt-4 text-barro-600">
            Regístrese con su número o su correo y díganos qué puede mover. Ofrecer capacidad es
            gratis y no necesita que nadie lo invite.
          </p>

          <ul className="mt-8 space-y-3 text-sm text-barro-700">
            {[
              'Ofrecer transporte no le da acceso a direcciones de hogares.',
              'Solo verá la capa pública: cuánta ayuda hace falta por municipio.',
              'Ver paradas exactas de una ruta es otra cosa, y va avalada por una organización.',
            ].map((linea) => (
              <li key={linea} className="flex gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-selva-700" aria-hidden />
                <span>{linea}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="order-1 md:order-2">
          <div className="rounded-xl border border-barro-200 bg-white p-6 shadow-sm">
            {pidiendoCodigo ? (
              <>
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-selva-50">
                  <MessageCircle className="h-5 w-5 text-selva-700" aria-hidden />
                </div>
                <h1 className="mt-4 text-lg font-semibold text-barro-900">
                  Le mandamos un código por WhatsApp
                </h1>
                <p className="mt-1 text-barro-600">Son seis números, al {tel}. Escríbalos aquí.</p>

                <form action={verificarCodigoWhatsApp} className="mt-6 space-y-4">
                  <input type="hidden" name="telefono" value={tel} />
                  <div>
                    <label htmlFor="codigo" className="block text-sm font-medium text-barro-800">
                      Su código
                    </label>
                    <input
                      id="codigo"
                      name="codigo"
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
                               bg-selva-700 px-4 py-2.5 font-medium text-white hover:bg-selva-900
                               focus:outline-none focus:ring-2 focus:ring-selva-700/30
                               focus:ring-offset-2"
                  >
                    Entrar
                    <ArrowRight
                      className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </button>

                  <p className="text-sm text-barro-500">
                    El código vence en cinco minutos.{' '}
                    <a href="/transportar" className="underline hover:text-barro-800">
                      Empezar de nuevo
                    </a>
                    .
                  </p>
                </form>
              </>
            ) : enviado ? (
              <div>
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-selva-50">
                  <Truck className="h-5 w-5 text-selva-700" aria-hidden />
                </div>
                <h1 className="mt-4 text-lg font-semibold text-barro-900">
                  Le mandamos un enlace al correo
                </h1>
                <p className="mt-2 text-barro-600">
                  Ábralo desde este mismo equipo y entra directo. El enlace sirve una sola vez.
                </p>
                <p className="mt-4 text-sm text-barro-500">
                  ¿No llegó? Revise el correo no deseado, o vuelva a{' '}
                  <a href="/transportar" className="underline hover:text-barro-800">
                    pedir otro enlace
                  </a>
                  .
                </p>
              </div>
            ) : (
              <>
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-barro-100">
                  <Truck className="h-5 w-5 text-barro-700" aria-hidden />
                </div>
                <h1 className="mt-4 text-lg font-semibold text-barro-900">Ofrecer transporte</h1>
                <p className="mt-1 text-barro-600">
                  Escriba su correo y le mandamos un enlace para registrarse.
                </p>

                <form action={enviarEnlace} className="mt-6 space-y-4">
                  <div>
                    <label htmlFor="correo" className="block text-sm font-medium text-barro-800">
                      Su correo
                    </label>
                    <input
                      id="correo"
                      name="correo"
                      type="email"
                      required
                      autoFocus
                      autoComplete="email"
                      placeholder="nombre@correo.com"
                      className="mt-1.5 w-full rounded-lg border border-barro-200 bg-white px-3 py-2.5
                                 text-base text-barro-900 placeholder:text-barro-400
                                 focus:border-selva-600 focus:outline-none focus:ring-2
                                 focus:ring-selva-600/20"
                    />
                  </div>

                  <button
                    type="submit"
                    className="group flex w-full items-center justify-center gap-2 rounded-lg
                               bg-selva-700 px-4 py-2.5 font-medium text-white hover:bg-selva-900
                               focus:outline-none focus:ring-2 focus:ring-selva-700/30
                               focus:ring-offset-2"
                  >
                    Mandarme el enlace
                    <ArrowRight
                      className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </button>
                </form>

                <div className="mt-6 flex items-center gap-3" aria-hidden>
                  <span className="h-px flex-1 bg-barro-200" />
                  <span className="text-xs font-medium uppercase tracking-wide text-barro-400">o</span>
                  <span className="h-px flex-1 bg-barro-200" />
                </div>

                <form action={enviarCodigoWhatsApp} className="mt-6 space-y-4">
                  <div>
                    <label htmlFor="telefono" className="block text-sm font-medium text-barro-800">
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
                               text-selva-900 hover:bg-selva-50 focus:outline-none focus:ring-2
                               focus:ring-selva-700/30 focus:ring-offset-2"
                  >
                    <MessageCircle className="h-4 w-4" aria-hidden />
                    Mandarme un código por WhatsApp
                  </button>

                  <p id="ayuda-telefono" className="flex gap-2 text-sm text-barro-500">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>Si no escribe el indicativo, asumimos Colombia (+57).</span>
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
              Escriba un correo válido para poder registrarse.
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
          {error === 'configuracion' && (
            <div className="mt-4 rounded-lg border border-atrato-100 bg-atrato-50 px-4 py-3">
              <p className="font-medium text-barro-900">
                El servidor no tiene configurada la identidad.
              </p>
              <p className="mt-1 text-sm text-barro-700">
                No es algo que usted pueda resolver desde aquí. Avísele a quien opera Convite:
                faltan <code>BETTER_AUTH_SECRET</code> o <code>DATABASE_URL</code>.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
