import { Clock, MapPinOff, PackageCheck, Truck } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { nodosParaRecogida, planearRecogida, RADIO_BARRIO_M } from '@/lib/recogidas/plan'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * The first-mile pickup run.
 *
 * In the first week of a response the supply is in people's houses, not in warehouses, and
 * fetching it is a town errand: many stops a few hundred metres apart, over roads. This
 * screen turns the scattered offers into **one ordered run** — six donations across three
 * neighbourhoods come back as six numbered stops, not six separate trips.
 *
 * Order is not distance alone. A perishable sets the departure time for the whole run, so
 * the neighbourhood holding tomorrow's cooked lunches is visited first (2.15).
 *
 * Addresses appear here because a coordinator planning the run needs them and RLS says they
 * may see them; they arrive through `direccion_de_oferta()`, which is the only way an
 * address leaves the database (2.16).
 */

const PUEDEN_PLANEAR = ['coordinador', 'admin']

type Params = Promise<{ nodo?: string }>

export default async function Recogidas({ searchParams }: { searchParams: Params }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { nodo: nodoPedido } = await searchParams

  const { nodos, plan, nodoActivo } = await conSesion(sesion, async (client) => {
    const nodos = await nodosParaRecogida(client)
    const ubicados = nodos.filter((n) => n.ubicado)

    const pedido = nodoPedido ? ubicados.find((n) => n.id === nodoPedido) : undefined
    if (pedido) {
      return { nodos, nodoActivo: pedido, plan: await planearRecogida(client, pedido.id) }
    }

    /*
     * With no node asked for, open on the one that actually has a run.
     *
     * The obvious default — the first node — is alphabetical, which lands on «Acopio
     * Tagachí» while every offer in the basin is around the Quibdó warehouse. The screen
     * then greets the person whose job this is with «no hay ofrecimientos por recoger»,
     * and they have to know to click elsewhere to find out that is false.
     */
    const planes = []
    for (const nodo of ubicados) {
      planes.push({ nodo, plan: await planearRecogida(client, nodo.id) })
    }
    const mejor = planes.sort((a, b) => b.plan.paradas.length - a.plan.paradas.length)[0]

    return { nodos, nodoActivo: mejor?.nodo ?? null, plan: mejor?.plan ?? null }
  })

  if (!PUEDEN_PLANEAR.includes(sesion.rolStaff)) {
    return (
      <main>
        <h1 className="text-xl font-semibold text-barro-900">Recogidas</h1>
        <p className="mt-4 max-w-2xl text-barro-700">
          Planear una recogida es trabajo de coordinación. Su rol no ve dónde vive quien dona,
          y eso es a propósito: una dirección junto a un nombre y «tiene mercado» es un blanco.
        </p>
      </main>
    )
  }

  const sinUbicar = nodos.filter((n) => !n.ubicado)

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-barro-900">Recogidas</h1>
        {plan && (
          <p className="text-sm text-barro-600">
            {plan.paradas.length} paradas en {plan.grupos}{' '}
            {plan.grupos === 1 ? 'barrio' : 'barrios'} · una sola vuelta
          </p>
        )}
      </div>

      <p className="mt-2 max-w-3xl text-sm text-barro-700">
        Las ofertas que hay que recoger, agrupadas por cercanía y puestas en orden de recorrido.
        Se agrupa lo que está a menos de {RADIO_BARRIO_M} m, que es más o menos una cuadra larga
        de Quibdó. Lo perecedero va primero: marca la hora de salida de toda la vuelta.
      </p>

      <nav className="mt-4 flex flex-wrap gap-2">
        {nodos
          .filter((n) => n.ubicado)
          .map((n) => (
            <Link
              key={n.id}
              href={`/recogidas?nodo=${n.id}`}
              className={`rounded border px-3 py-1.5 text-sm ${
                n.id === nodoActivo?.id
                  ? 'border-selva-600 bg-selva-50 font-medium text-barro-900'
                  : 'border-barro-200 bg-white text-barro-700'
              }`}
            >
              {n.nombre}
            </Link>
          ))}
      </nav>

      {!nodoActivo && (
        <p className="mt-6 rounded-lg border border-barro-200 bg-white px-4 py-3 text-barro-700">
          Ningún centro tiene ubicación, así que no hay desde dónde medir un recorrido.
        </p>
      )}

      {plan && plan.paradas.length === 0 && (
        <p className="mt-6 rounded-lg border border-barro-200 bg-white px-4 py-3 text-barro-700">
          No hay ofrecimientos por recoger cerca de {nodoActivo?.nombre} en este momento.
        </p>
      )}

      {plan && plan.paradas.length > 0 && (
        <section className="mt-6">
          <h2 className="flex items-center gap-2 font-semibold text-barro-900">
            <Truck className="size-4" aria-hidden />
            Vuelta hacia {nodoActivo?.nombre}
          </h2>

          <ol className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
            {plan.paradas.map((p, i) => {
              const nuevoBarrio = i === 0 || plan.paradas[i - 1]!.grupo !== p.grupo
              return (
                <li key={p.ofertaId} className="px-4 py-3">
                  {nuevoBarrio && (
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-barro-500">
                      Barrio {p.grupo}
                    </p>
                  )}

                  <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-semibold text-barro-900">{p.orden}.</span>
                    <span className="font-medium text-barro-900">
                      {p.ofrecidoPor ?? 'Sin nombre'}
                    </span>
                    <span className="text-barro-700">
                      {p.item ?? 'sin clasificar'}
                      {p.cantidad !== null && ` · ${p.cantidad} ${p.unidad ?? ''}`}
                    </span>
                    {p.perecedero && (
                      <span className="flex items-center gap-1 rounded bg-atrato-100 px-1.5 py-0.5 text-xs font-medium text-atrato-700">
                        <Clock className="size-3" aria-hidden />
                        vence{' '}
                        {p.venceEn?.toLocaleString('es-CO', {
                          weekday: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    )}
                    <span className="ml-auto text-barro-500">
                      {(p.metrosAlNodo / 1000).toFixed(1)} km
                    </span>
                  </div>

                  {p.direccion && <p className="mt-1 text-sm text-barro-800">{p.direccion}</p>}
                  <p className="mt-0.5 text-sm text-barro-600">«{p.textoOriginal}»</p>
                </li>
              )
            })}
          </ol>

          <p className="mt-3 flex items-start gap-2 text-sm text-barro-600">
            <PackageCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Las distancias son en línea recta hasta el centro, para ordenar la vuelta. El
              recorrido lo decide quien maneja: conoce las calles mejor que nosotros.
            </span>
          </p>
        </section>
      )}

      {sinUbicar.length > 0 && (
        <p className="mt-6 flex items-start gap-2 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-800">
          <MapPinOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Sin ubicación, y por eso sin recorrido posible: {sinUbicar.map((n) => n.nombre).join(', ')}.
          </span>
        </p>
      )}
    </main>
  )
}
