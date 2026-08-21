import { HeartHandshake } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { aE164 } from '@/lib/canales'
import { organizacionesQueReciben, registrarOfertaDonante } from '@/lib/donante'

/**
 * «Quiero donar» — the light door (§1, §2.2).
 *
 * The governing principle is that friction scales with power: a donor sees nothing sensitive, so
 * they meet no wall. A name, a number, and what they have. No password, no emailed link, no
 * account — and 2.10 still holds, because the number lands on an offer and opens no panel.
 *
 * The offer is made to a named organisation rather than «to Convite». There are several tenants
 * in the registry and they operate different territories; an offer with no recipient is an offer
 * nobody owns. Aportante organisations are excluded — those are one-person transporter records
 * with no desk to receive anything.
 *
 * Server-rendered, no client JavaScript, like /entrar and /solicitar-centro.
 */

export const dynamic = 'force-dynamic'

async function ofrecer(formData: FormData) {
  'use server'

  const telefono = aE164(String(formData.get('telefono') ?? ''))
  const cantidadCruda = Number(String(formData.get('cantidad') ?? '').trim())

  const r = await registrarOfertaDonante({
    organizacionId: String(formData.get('organizacionId') ?? ''),
    nombre: String(formData.get('nombre') ?? ''),
    telefono,
    texto: String(formData.get('texto') ?? ''),
    cantidad: Number.isFinite(cantidadCruda) && cantidadCruda > 0 ? cantidadCruda : null,
  })
  redirect(r.ok ? '/donar?ok=1' : `/donar?error=${encodeURIComponent(r.error)}`)
}

export default async function Donar({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>
}) {
  const { ok, error } = await searchParams
  const organizaciones = await organizacionesQueReciben()

  return (
    <main className="min-h-dvh bg-barro-50 px-5 py-12 sm:px-6">
      <div className="mx-auto max-w-xl">
        <p className="text-sm font-medium text-selva-700">Convite</p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold text-barro-900">
          <HeartHandshake className="h-6 w-6 text-selva-700" aria-hidden />
          Quiero donar
        </h1>

        {ok ? (
          <div className="mt-6 rounded-xl border border-selva-200 bg-selva-50 p-5">
            <p className="text-sm text-selva-900">
              Quedó anotado. Alguien del centro se comunica con usted para cuadrar la recogida.
            </p>
            {/* Deliberately no promise about when, and no claim that it is already on its way.
                An offer is not a delivery, and principle 6 applies to both directions. */}
            <p className="mt-2 text-xs text-barro-600">
              Todavía no es una entrega: primero confirman qué hace falta y dónde.
            </p>
            <Link href="/" className="mt-4 inline-block text-sm text-selva-700 underline">
              Volver
            </Link>
          </div>
        ) : (
          <>
            <p className="mt-3 text-barro-700">
              Díganos qué tiene y cómo ubicarlo. No hace falta crear una cuenta.
            </p>
            {error && (
              <p className="mt-4 rounded-lg border border-atrato-100 bg-atrato-50 px-4 py-3 text-sm text-barro-800">
                {error}
              </p>
            )}
            <form action={ofrecer} className="mt-6 space-y-4 rounded-xl border border-barro-200 bg-white p-5">
              <label className="block">
                <span className="text-sm text-barro-700">¿A qué organización?</span>
                <select name="organizacionId" required
                  className="mt-1 w-full rounded-lg border border-barro-300 px-3 py-3 text-base">
                  <option value="">Elija una</option>
                  {organizaciones.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nombre}
                      {o.municipio ? ` · ${o.municipio}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm text-barro-700">Su nombre</span>
                <input name="nombre" required autoComplete="name"
                  className="mt-1 w-full rounded-lg border border-barro-300 px-3 py-3 text-base" />
              </label>
              <label className="block">
                <span className="text-sm text-barro-700">Su WhatsApp</span>
                <input name="telefono" required inputMode="tel" autoComplete="tel"
                  placeholder="+57 300 111 2233"
                  className="mt-1 w-full rounded-lg border border-barro-300 px-3 py-3 text-base" />
              </label>
              <label className="block">
                <span className="text-sm text-barro-700">¿Qué puede aportar?</span>
                <textarea name="texto" required rows={3}
                  placeholder="20 mercados, tejas de zinc, un motor fuera de borda…"
                  className="mt-1 w-full rounded-lg border border-barro-300 px-3 py-3 text-base" />
              </label>
              <label className="block">
                <span className="text-sm text-barro-700">Cuántos, si sabe</span>
                <input name="cantidad" type="number" min="1" inputMode="numeric"
                  className="mt-1 w-full rounded-lg border border-barro-300 px-3 py-3 text-base" />
              </label>
              <button type="submit"
                className="w-full rounded-lg bg-selva-700 px-4 py-3 font-medium text-white hover:bg-selva-800">
                Ofrecer
              </button>
              <p className="text-xs text-barro-500">
                Su número se usa para cuadrar la recogida y nada más. No crea ninguna cuenta.
              </p>
            </form>
          </>
        )}
      </div>
    </main>
  )
}
