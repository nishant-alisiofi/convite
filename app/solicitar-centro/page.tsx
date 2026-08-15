import { ArrowRight, Building2, CheckCircle2, Info, Waves } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPool } from '@/db/client'
import { aE164 } from '@/lib/canales'

/**
 * «Puedo operar un centro» — the vetted door (§4).
 *
 * Reporting and donating are self-service, but running a centre is not: a centre handles aid and
 * sees where families live, so it is approved, never self-registered. This is the front of that
 * path. It is deliberately low-friction — anyone can ask — and it creates nothing that works: a
 * `pendiente` organisation and a pending admin invitation, and nothing behind either until a
 * platform admin approves the centre (§2.5).
 *
 * The auth invariant (§4, last bullet) is preserved by construction. This does not sign anybody
 * in and does not set a password; it only records that an address or a number asked. The
 * requester still has to prove they own it — the ordinary /entrar magic-link or WhatsApp-code
 * flow, gated by the allowlist this writes — and even then their panel stays behind the centre's
 * approval. Invited AND proved possession AND approved: all three, in that order.
 *
 * Server-rendered with no client JavaScript, like /entrar — it has to work on a weak connection.
 */

export const dynamic = 'force-dynamic'

/** Which column the identifier belongs in. An address has an @; a number does not. Mirrors scripts/invitar.ts. */
function clasificar(valor: string): { correo: string | null; telefono: string | null } {
  const limpio = valor.trim()
  if (limpio.includes('@')) return { correo: limpio.toLowerCase(), telefono: null }
  const telefono = aE164(limpio)
  return /^\+[1-9][0-9]{7,14}$/.test(telefono) ? { correo: null, telefono } : { correo: null, telefono: null }
}

async function solicitarCentro(formData: FormData) {
  'use server'

  const centro = String(formData.get('centro') ?? '').trim()
  const solicitante = String(formData.get('solicitante') ?? '').trim()
  const detalle = String(formData.get('detalle') ?? '').trim()
  const { correo, telefono } = clasificar(String(formData.get('contacto') ?? ''))

  if (centro.length < 3) redirect('/solicitar-centro?error=centro')
  if (!correo && !telefono) redirect('/solicitar-centro?error=contacto')

  const client = await getPool().connect()
  try {
    await client.query('begin')

    // The centre starts pending. `activo` stays true — approval is a separate axis from the
    // soft-delete flag, and a rejected-then-reconsidered centre should not have to be
    // reactivated as well as re-approved.
    const { rows } = await client.query<{ id: string }>(
      `insert into organizaciones (nombre, estado_aprobacion) values ($1, 'pendiente') returning id`,
      [centro],
    )
    const orgId = rows[0]!.id

    // The requester becomes the centre's admin-to-be: an ordinary invitation, on the allowlist,
    // not staff. es_plataforma is left at its default false — this path can never mint the
    // platform tier, and the escalation guard in 0034 would refuse it even if it tried.
    await client.query(
      `insert into invitaciones_staff (correo, telefono, rol_staff, organizacion_id)
         values ($1, $2, 'admin', $3)`,
      [correo, telefono, orgId],
    )

    // No actor: nobody is signed in. The detail the requester gave is kept for the platform
    // admin who will review it.
    await client.query(
      `insert into auditoria (actor_id, accion, entidad, entidad_id, despues)
         values (null, 'centro.solicitado', 'organizaciones', $1, $2)`,
      [orgId, JSON.stringify({ centro, solicitante: solicitante || null, contacto: correo ?? telefono, detalle: detalle || null })],
    )

    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => {})
    // The organisation name is unique, and so is each identifier on the allowlist. Either
    // collision means «this has been asked already» — a legible answer, not a stack trace, and
    // it does not reveal which of the two matched.
    const mensaje = error instanceof Error ? error.message : ''
    if (mensaje.includes('organizaciones_nombre_key')) redirect('/solicitar-centro?error=centro_existe')
    if (mensaje.includes('invitaciones_correo_key') || mensaje.includes('invitaciones_telefono_key')) {
      redirect('/solicitar-centro?error=ya_invitado')
    }
    redirect('/solicitar-centro?error=general')
  } finally {
    client.release()
  }

  redirect('/solicitar-centro?enviado=1')
}

export default async function SolicitarCentro({
  searchParams,
}: {
  searchParams: Promise<{ enviado?: string; error?: string }>
}) {
  const { enviado, error } = await searchParams

  return (
    <div className="min-h-dvh bg-barro-50">
      <main className="mx-auto grid min-h-dvh max-w-5xl items-center gap-12 px-5 py-12 sm:px-6 md:grid-cols-2">
        <section className="order-2 max-w-sm md:order-1">
          <div className="flex items-center gap-2 text-barro-900">
            <Waves className="h-6 w-6 text-selva-700" aria-hidden />
            <span className="text-2xl font-semibold tracking-tight">Convite</span>
          </div>
          <p className="mt-3 text-lg leading-snug text-barro-700">
            ¿Su organización quiere operar un centro de acopio?
          </p>
          <p className="mt-4 text-barro-600">
            Un centro coordina la ayuda de una zona: recibe donaciones, verifica necesidades y
            organiza los envíos. Por eso maneja datos sensibles y lo aprueba Alisio antes de
            operar.
          </p>

          <ul className="mt-8 space-y-3 text-sm text-barro-700">
            {[
              'Déjenos sus datos y una persona de Alisio revisa la solicitud.',
              'Cuando quede aprobado, quien la pidió entra y arma su equipo.',
              'Solo para operar un centro: reportar o donar no necesita esto.',
            ].map((linea) => (
              <li key={linea} className="flex gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-selva-700" aria-hidden />
                <span>{linea}</span>
              </li>
            ))}
          </ul>

          <p className="mt-8 text-sm text-barro-500">
            ¿Ya tiene acceso?{' '}
            <Link href="/entrar" className="underline hover:text-barro-800">
              Entrar
            </Link>
            .
          </p>
        </section>

        <section className="order-1 md:order-2">
          <div className="rounded-xl border border-barro-200 bg-white p-6 shadow-sm">
            {enviado ? (
              <div>
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-selva-50">
                  <CheckCircle2 className="h-5 w-5 text-selva-700" aria-hidden />
                </div>
                <h1 className="mt-4 text-lg font-semibold text-barro-900">Solicitud recibida</h1>
                <p className="mt-2 text-barro-600">
                  Gracias. Alisio va a revisar la solicitud de su centro. Cuando quede aprobado, le
                  avisamos al correo o número que dejó y ya podrá entrar a armar su equipo.
                </p>
                <p className="mt-4 text-sm text-barro-500">
                  Mientras tanto, si intenta entrar verá que su centro sigue en revisión.
                </p>
              </div>
            ) : (
              <>
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-barro-100">
                  <Building2 className="h-5 w-5 text-barro-700" aria-hidden />
                </div>
                <h1 className="mt-4 text-lg font-semibold text-barro-900">Solicitar un centro</h1>
                <p className="mt-1 text-barro-600">
                  Cuéntenos de su centro y cómo contactarlo. No se crea ninguna cuenta todavía.
                </p>

                <form action={solicitarCentro} className="mt-6 space-y-4">
                  <div>
                    <label htmlFor="centro" className="block text-sm font-medium text-barro-800">
                      Nombre del centro u organización
                    </label>
                    <input
                      id="centro"
                      name="centro"
                      type="text"
                      required
                      autoFocus
                      placeholder="Consejo Comunitario del Medio Atrato"
                      className="mt-1.5 w-full rounded-lg border border-barro-200 bg-white px-3 py-2.5
                                 text-base text-barro-900 placeholder:text-barro-400
                                 focus:border-selva-600 focus:outline-none focus:ring-2
                                 focus:ring-selva-600/20"
                    />
                  </div>

                  <div>
                    <label htmlFor="contacto" className="block text-sm font-medium text-barro-800">
                      Su correo o WhatsApp
                    </label>
                    <input
                      id="contacto"
                      name="contacto"
                      type="text"
                      required
                      autoComplete="email"
                      placeholder="nombre@organizacion.org o 300 111 2233"
                      aria-describedby="ayuda-contacto"
                      className="mt-1.5 w-full rounded-lg border border-barro-200 bg-white px-3 py-2.5
                                 text-base text-barro-900 placeholder:text-barro-400
                                 focus:border-selva-600 focus:outline-none focus:ring-2
                                 focus:ring-selva-600/20"
                    />
                    <p id="ayuda-contacto" className="mt-1.5 flex gap-2 text-sm text-barro-500">
                      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <span>Por aquí le avisamos y por aquí entrará cuando lo aprueben.</span>
                    </p>
                  </div>

                  <div>
                    <label htmlFor="solicitante" className="block text-sm font-medium text-barro-800">
                      Su nombre <span className="font-normal text-barro-500">(opcional)</span>
                    </label>
                    <input
                      id="solicitante"
                      name="solicitante"
                      type="text"
                      autoComplete="name"
                      placeholder="Rosa Palacios"
                      className="mt-1.5 w-full rounded-lg border border-barro-200 bg-white px-3 py-2.5
                                 text-base text-barro-900 placeholder:text-barro-400
                                 focus:border-selva-600 focus:outline-none focus:ring-2
                                 focus:ring-selva-600/20"
                    />
                  </div>

                  <div>
                    <label htmlFor="detalle" className="block text-sm font-medium text-barro-800">
                      ¿Qué zona atiende? <span className="font-normal text-barro-500">(opcional)</span>
                    </label>
                    <textarea
                      id="detalle"
                      name="detalle"
                      rows={3}
                      placeholder="Municipios, ríos o comunidades donde trabaja su centro."
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
                    Enviar solicitud
                    <ArrowRight
                      className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </button>
                </form>
              </>
            )}
          </div>

          {error === 'centro' && (
            <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
              Escriba el nombre del centro para poder registrarlo.
            </p>
          )}
          {error === 'contacto' && (
            <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
              Déjenos un correo válido o un número de WhatsApp con indicativo, así: +57 300 111 2233.
            </p>
          )}
          {error === 'centro_existe' && (
            <p className="mt-4 rounded-lg border border-atrato-100 bg-atrato-50 px-4 py-3 text-sm text-barro-800">
              Ya hay una solicitud con ese nombre. Si es su centro, espere a que Alisio la revise.
            </p>
          )}
          {error === 'ya_invitado' && (
            <p className="mt-4 rounded-lg border border-atrato-100 bg-atrato-50 px-4 py-3 text-sm text-barro-800">
              Ese correo o número ya está habilitado en Convite. Entre desde{' '}
              <Link href="/entrar" className="underline hover:text-barro-950">
                /entrar
              </Link>
              .
            </p>
          )}
          {error === 'general' && (
            <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
              No pudimos registrar la solicitud. Intente de nuevo en un momento.
            </p>
          )}
        </section>
      </main>
    </div>
  )
}
