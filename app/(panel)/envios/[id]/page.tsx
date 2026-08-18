import { Clock, FileText, Scale, Send, Ship, TriangleAlert, X } from 'lucide-react'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { coberturaDePedido, combinarOfertas } from '@/lib/despacho/agregacion'
import { cargarManifiesto } from '@/lib/despacho/manifiesto'
import {
  candidatosParaEnvio,
  despachar,
  ordenarPorRecorrido,
  ponerParada,
  quitarParada,
  registrarDecision,
} from '@/lib/despacho/plan'
import { fechaHoraCorta } from '@/lib/fechas'
import {
  esModoFluvial,
  lancherosDisponibles,
  marcarPagoLancheroPagado,
  pagosDeEnvio,
  registrarPagoLanchero,
} from '@/lib/lanchero-pagos'
import { conSesion, sesionActual } from '@/lib/sesion'
import { temporadaVigente } from '@/lib/temporada'

export const dynamic = 'force-dynamic'

/**
 * Planning one shipment.
 *
 * The arithmetic is done for you — who is reachable on this trip, what is already committed,
 * how much room is left. The judgement is not: when the boat is smaller than the queue,
 * somebody decides who waits, and the database will not let the shipment leave until that
 * decision is written down in their name.
 */

const PUEDEN_DESPACHAR = ['despachador', 'coordinador', 'admin']

type Params = Promise<{ id: string }>
type Query = Promise<{ cubrir?: string; error?: string }>

export default async function Envio({
  params,
  searchParams,
}: {
  params: Params
  searchParams: Query
}) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { id } = await params
  const { cubrir, error } = await searchParams
  const puedeDespachar = PUEDEN_DESPACHAR.includes(sesion.rolStaff)

  const { manifiesto, candidatos, cobertura, capacidadId, pagosLanchero, lancheroOpciones } =
    await conSesion(sesion, async (client) => {
      const manifiesto = await cargarManifiesto(client, id)
      const { rows } = await client.query<{ id: string }>(
        `select c.id from capacidades c
           join envios e on e.responsable_id = c.contacto_id
                        and e.origen_nodo_id = c.origen_nodo_id
                        and e.salida_programada = c.sale_en
          where e.id = $1 limit 1`,
        [id],
      )
      const capacidadId = rows[0]?.id ?? null

      return {
        manifiesto,
        capacidadId,
        candidatos:
          capacidadId && manifiesto?.estado === 'PLANEADO'
            ? await candidatosParaEnvio(client, capacidadId, await temporadaVigente(client))
            : [],
        cobertura: cubrir ? await coberturaDePedido(client, cubrir) : null,
        pagosLanchero: await pagosDeEnvio(client, id),
        lancheroOpciones: await lancherosDisponibles(client),
      }
    })

  if (!manifiesto) redirect('/envios')

  async function accion(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_DESPACHAR.includes(sesion.rolStaff)) {
      redirect(`/envios/${id}?error=Sin+permiso`)
    }

    const que = String(formData.get('accion') ?? '')
    const resultado = await conSesion(
      sesion,
      async (client) => {
        switch (que) {
          case 'poner': {
            const puesta = await ponerParada(
              client,
              id,
              String(formData.get('pedidoId') ?? ''),
              Number(formData.get('familias')),
            )
            // Geography decides the visiting order, not the order they were added.
            if (puesta.ok) await ordenarPorRecorrido(client, id, await temporadaVigente(client))
            return puesta
          }
          case 'quitar': {
            const quitada = await quitarParada(client, id, String(formData.get('pedidoId') ?? ''))
            if (quitada.ok) await ordenarPorRecorrido(client, id, await temporadaVigente(client))
            return quitada
          }
          case 'decidir':
            return registrarDecision(
              client,
              id,
              {
                regla: String(formData.get('regla') ?? ''),
                nota: String(formData.get('nota') ?? ''),
              },
              sesion.authId,
            )
          case 'combinar': {
            const ofertas = formData.getAll('ofertaId').map((o) => String(o))
            const cantidades = formData.getAll('cantidad').map((c) => Number(c))
            const selecciones = ofertas
              .map((ofertaId, i) => ({ ofertaId, cantidad: cantidades[i] ?? 0 }))
              .filter((s) => s.cantidad > 0)
            return combinarOfertas(
              client,
              String(formData.get('pedidoId') ?? ''),
              selecciones,
              sesion.authId,
            )
          }
          case 'despachar':
            return despachar(client, id, sesion.authId)
          case 'pago_registrar': {
            const costoRaw = String(formData.get('costoTotalCop') ?? '').trim()
            return registrarPagoLanchero(
              client,
              {
                organizacionId: sesion.organizacionId,
                envioId: id,
                lancheroContactoId: String(formData.get('lancheroContactoId') ?? ''),
                costoTotalCop: costoRaw ? Number(costoRaw) : null,
                montoLancheroCop: Number(formData.get('montoLancheroCop')),
                notas: String(formData.get('notas') ?? '').trim() || null,
              },
              sesion.authId,
            )
          }
          case 'pago_pagar': {
            const pagado = await marcarPagoLancheroPagado(
              client,
              String(formData.get('pagoId') ?? ''),
              sesion.authId,
            )
            return pagado ? { ok: true as const } : { ok: false as const, error: 'No se pudo marcar el pago.' }
          }
          default:
            return { ok: false as const, error: 'Acción desconocida.' }
        }
      },
      { escribe: true },
    )

    if (!resultado.ok) {
      redirect(`/envios/${id}?error=${encodeURIComponent(resultado.error)}`)
    }
    revalidatePath(`/envios/${id}`)
    redirect(`/envios/${id}`)
  }

  const asignadas = manifiesto.paradas.reduce((n, p) => n + p.familiasAsignadas, 0)
  const recortados = manifiesto.paradas.filter((p) => p.familiasAsignadas < p.familiasPedidas)
  const libre = manifiesto.cupoFamilias - asignadas
  const planeado = manifiesto.estado === 'PLANEADO'
  const yaEnPlan = new Set(manifiesto.paradas.map((p) => p.pedidoId))
  // What is left to offer, not what the trip could theoretically serve. Everything already
  // on board is not a candidate, and a heading over an empty list reads as a broken screen.
  const porSubir = candidatos.filter((c) => !yaEnPlan.has(c.pedidoId))

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-mono text-xl font-semibold text-barro-900">{manifiesto.codigo}</h1>
        <Link href={`/envios/${id}/manifiesto`} className="flex items-center gap-1 text-sm text-barro-700 underline">
          <FileText className="size-4" aria-hidden />
          Manifiesto para imprimir
        </Link>
      </div>

      <p className="mt-1 text-sm text-barro-700">
        {manifiesto.modo} · {manifiesto.transportista} · desde {manifiesto.origenNodo} · sale{' '}
        {manifiesto.salidaProgramada ? fechaHoraCorta(manifiesto.salidaProgramada) : 'sin fecha'} ·
        cupo{' '}
        {manifiesto.cupoFamilias} familias · <span className="font-medium">{manifiesto.estado.toLowerCase()}</span>
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </p>
      )}

      {esModoFluvial(manifiesto.modo) && (
        <section className="mt-6 rounded-lg border border-barro-200 bg-white px-4 py-4">
          <h2 className="flex items-center gap-2 font-semibold text-barro-900">
            <Ship className="size-4" aria-hidden />
            Costo y pago del lanchero
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-barro-700">
            Lo que costó el viaje y lo que se le debe al lanchero. Es solo registro — nada se paga
            desde acá, como el fondo de compra local.
          </p>

          {pagosLanchero.length > 0 && (
            <ul className="mt-3 divide-y divide-barro-200">
              {pagosLanchero.map((p) => (
                <li key={p.id} className="flex flex-wrap items-baseline gap-x-2 py-2 text-sm">
                  <span className="font-medium text-barro-900">{p.lancheroNombre ?? p.lancheroTelefono}</span>
                  <span className="text-barro-700">
                    {p.montoLancheroCop.toLocaleString('es-CO')} COP
                  </span>
                  {p.costoTotalCop != null && (
                    <span className="text-barro-500">
                      (costo total {p.costoTotalCop.toLocaleString('es-CO')} COP)
                    </span>
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                      p.estadoPago === 'pagado' ? 'bg-selva-50 text-selva-700' : 'bg-atrato-50 text-atrato-700'
                    }`}
                  >
                    {p.estadoPago}
                  </span>
                  {puedeDespachar && p.estadoPago === 'pendiente' && (
                    <form action={accion} className="ml-auto">
                      <input type="hidden" name="accion" value="pago_pagar" />
                      <input type="hidden" name="pagoId" value={p.id} />
                      <button type="submit" className="text-barro-700 underline">
                        Marcar pagado
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}

          {puedeDespachar && (
            <form action={accion} className="mt-3 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="accion" value="pago_registrar" />
              <label className="block text-sm">
                <span className="text-barro-700">Lanchero a pagar</span>
                <select name="lancheroContactoId" required className="mt-1 block w-full rounded border border-barro-300 px-2 py-1.5 text-sm">
                  <option value="">…</option>
                  {lancheroOpciones.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nombre} · {l.telefono}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-barro-700">Monto para el lanchero (COP)</span>
                <input
                  name="montoLancheroCop"
                  type="number"
                  min={1}
                  required
                  inputMode="numeric"
                  className="mt-1 block w-full rounded border border-barro-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="text-barro-700">Costo total del viaje (COP, opcional)</span>
                <input
                  name="costoTotalCop"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  className="mt-1 block w-full rounded border border-barro-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="text-barro-700">Notas (opcional)</span>
                <input
                  name="notas"
                  className="mt-1 block w-full rounded border border-barro-300 px-2 py-1.5 text-sm"
                />
              </label>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
                >
                  Registrar costo y pago
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-semibold text-barro-900">
          Paradas
          <span className="ml-2 font-normal text-barro-600">
            {asignadas}/{manifiesto.cupoFamilias} familias
            {libre > 0 && planeado && ` · quedan ${libre}`}
          </span>
        </h2>

        {manifiesto.paradas.length === 0 ? (
          <p className="mt-3 text-sm text-barro-600">Todavía no lleva nada.</p>
        ) : (
          <ol className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
            {manifiesto.paradas.map((p) => (
              <li key={p.pedidoId} className="flex flex-wrap items-baseline gap-x-2 px-4 py-3 text-sm">
                <span className="font-semibold text-barro-900">{p.orden}.</span>
                <span className="font-medium text-barro-900">{p.comunidad}</span>
                <span className="text-barro-700">{p.item}</span>
                <span className={p.familiasAsignadas < p.familiasPedidas ? 'text-rose-800' : 'text-barro-600'}>
                  {p.familiasAsignadas} de {p.familiasPedidas} familias
                </span>
                {p.codigoConfirmacion && (
                  <span className="font-mono text-barro-700">{p.codigoConfirmacion}</span>
                )}
                {planeado && puedeDespachar && (
                  <span className="ml-auto flex items-center gap-3">
                    <Link href={`/envios/${id}?cubrir=${p.pedidoId}`} className="text-barro-700 underline">
                      Cubrir con varios
                    </Link>
                    <form action={accion}>
                      <input type="hidden" name="accion" value="quitar" />
                      <input type="hidden" name="pedidoId" value={p.pedidoId} />
                      <button type="submit" className="flex items-center gap-1 text-barro-600 underline">
                        <X className="size-3.5" aria-hidden />
                        Quitar
                      </button>
                    </form>
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {cobertura && planeado && puedeDespachar && (
        <section className="mt-6 rounded-lg border border-barro-200 bg-white px-4 py-4">
          <h2 className="font-semibold text-barro-900">
            Cubrir {cobertura.item} entre varios
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-barro-700">
            Se piden {cobertura.familias} familias y hay {cobertura.cubierto} cubiertas. Ningún
            ofrecimiento tiene que alcanzar solo: escoja cuántas familias cubre cada uno.
          </p>

          <form action={accion} className="mt-3">
            <input type="hidden" name="accion" value="combinar" />
            <input type="hidden" name="pedidoId" value={cobertura.pedidoId} />

            <ul className="divide-y divide-barro-200">
              {cobertura.candidatas.map((o) => (
                <li key={o.ofertaId} className="flex flex-wrap items-center gap-x-3 py-2 text-sm">
                  <input type="hidden" name="ofertaId" value={o.ofertaId} />
                  <input
                    name="cantidad"
                    inputMode="numeric"
                    defaultValue="0"
                    aria-label={`Familias que cubre ${o.ofrecidoPor ?? 'este ofrecimiento'}`}
                    className="w-16 rounded border border-barro-200 px-2 py-1 text-sm"
                  />
                  <span className="font-medium text-barro-900">{o.ofrecidoPor}</span>
                  <span className="text-barro-600">
                    {o.cantidad === null ? 'sin cantidad dicha' : `${o.cantidad} ${o.unidad ?? ''}`}
                  </span>
                  {o.perecedero && (
                    <span className="flex items-center gap-1 rounded bg-atrato-100 px-1.5 py-0.5 text-xs text-atrato-700">
                      <Clock className="size-3" aria-hidden />
                      vence {o.venceEn?.toLocaleString('es-CO')}
                    </span>
                  )}
                  {o.comprometida && <span className="text-barro-500">ya comprometido</span>}
                  <span className="ml-auto text-barro-600">«{o.textoOriginal}»</span>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex gap-3">
              <button
                type="submit"
                className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
              >
                Asignar estos ofrecimientos
              </button>
              <Link href={`/envios/${id}`} className="px-3 py-1.5 text-sm text-barro-700 underline">
                Cancelar
              </Link>
            </div>
          </form>
        </section>
      )}

      {planeado && puedeDespachar && porSubir.length > 0 && (
        <section className="mt-8">
          <h2 className="font-semibold text-barro-900">Lo que este viaje podría llevar</h2>
          <p className="mt-1 max-w-3xl text-sm text-barro-700">
            Comunidades a las que va o por las que pasa. El orden que ve es urgencia y luego
            días esperando; el reparto lo decide usted.
          </p>

          <ul className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
            {porSubir.map((c) => (
                <li key={c.pedidoId} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-barro-900">{c.comunidad}</span>
                    <span className="text-barro-700">{c.item}</span>
                    <span className="text-barro-600">{c.familias} familias</span>
                    {c.urgencia === 3 && (
                      <span className="rounded bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-900">
                        urgente
                      </span>
                    )}
                    {c.minutos !== null && <span className="text-barro-500">{c.minutos} min</span>}
                    <span className="text-barro-500">hace {c.dias} d</span>
                    {c.yaAsignado && <span className="text-barro-500">ya va en otro envío</span>}

                    <form action={accion} className="ml-auto flex items-center gap-2">
                      <input type="hidden" name="accion" value="poner" />
                      <input type="hidden" name="pedidoId" value={c.pedidoId} />
                      <input
                        name="familias"
                        inputMode="numeric"
                        defaultValue={Math.min(c.familias, Math.max(libre, 0)) || c.familias}
                        aria-label={`Familias para ${c.comunidad}`}
                        className="w-16 rounded border border-barro-200 px-2 py-1 text-sm"
                      />
                      <button
                        type="submit"
                        className="rounded border border-barro-200 bg-white px-3 py-1 text-sm text-barro-800"
                      >
                        Subir al viaje
                      </button>
                    </form>
                  </div>

                  {c.venceAntesDeSalir && (
                    <p className="mt-1 flex items-start gap-2 text-sm text-rose-900">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                      Lo que sostiene este pedido se vence antes de que el bote salga. Mandarlo
                      así es mandar comida dañada.
                    </p>
                  )}
                {c.motivo && <p className="mt-1 text-barro-600">{c.motivo}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {manifiesto.decision ? (
        <section className="mt-8 rounded-lg border border-barro-200 bg-white px-4 py-4">
          <h2 className="flex items-center gap-2 font-semibold text-barro-900">
            <Scale className="size-4" aria-hidden />
            Cómo se repartió
          </h2>
          <p className="mt-1 text-sm text-barro-900">{manifiesto.decision.reglaAplicada}</p>
          {manifiesto.decision.nota && (
            <p className="mt-1 text-sm text-barro-700">{manifiesto.decision.nota}</p>
          )}
          {manifiesto.decision.postergados.length > 0 && (
            <p className="mt-2 text-sm text-barro-800">
              Quedaron para después:{' '}
              {manifiesto.decision.postergados.map((p) => `${p.comunidad} (${p.pedidas})`).join(', ')}.
            </p>
          )}
          <p className="mt-2 text-xs text-barro-600">
            Registrado el {manifiesto.decision.confirmadoEn.toLocaleString('es-CO')}. Nadie puede
            editarlo ni borrarlo, y esa es la idea.
          </p>
        </section>
      ) : (
        planeado &&
        puedeDespachar &&
        recortados.length > 0 && (
          <section className="mt-8 rounded-lg border border-atrato-100 bg-atrato-50 px-4 py-4">
            <h2 className="flex items-center gap-2 font-semibold text-barro-900">
              <Scale className="size-4" aria-hidden />
              Hay que decir cómo se repartió
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-barro-800">
              {recortados.length === 1
                ? `${recortados[0]!.comunidad} recibe menos de lo que pidió.`
                : `${recortados.length} comunidades reciben menos de lo que pidieron.`}{' '}
              El envío no sale hasta que quede escrito con qué criterio, y con su nombre. Una
              comunidad postergada sin nadie con quien reclamar es como se pierde la red de
              reportantes.
            </p>

            <form action={accion} className="mt-3">
              <input type="hidden" name="accion" value="decidir" />
              <label className="block text-sm">
                <span className="font-medium text-barro-800">¿Con qué criterio repartió?</span>
                <input
                  name="regla"
                  required
                  placeholder="Urgencia primero, y a igual urgencia los que llevan más días esperando."
                  className="mt-1 w-full max-w-2xl rounded border border-barro-200 bg-white px-3 py-2 text-sm"
                />
              </label>
              <label className="mt-2 block text-sm">
                <span className="font-medium text-barro-800">Nota (opcional)</span>
                <input
                  name="nota"
                  className="mt-1 w-full max-w-2xl rounded border border-barro-200 bg-white px-3 py-2 text-sm"
                />
              </label>
              <button
                type="submit"
                className="mt-3 rounded bg-atrato-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-atrato-600"
              >
                Registrar la decisión
              </button>
            </form>
          </section>
        )
      )}

      {planeado && puedeDespachar && manifiesto.paradas.length > 0 && (
        <form action={accion} className="mt-8">
          <input type="hidden" name="accion" value="despachar" />
          <button
            type="submit"
            className="flex items-center gap-2 rounded bg-selva-600 px-4 py-2 font-medium text-white hover:bg-selva-700"
          >
            <Send className="size-4" aria-hidden />
            Despachar
          </button>
          <p className="mt-2 text-sm text-barro-600">
            Queda su nombre y la hora. Se generan los códigos de cuatro dígitos que cada
            comunidad va a leer de vuelta.
          </p>
        </form>
      )}
    </main>
  )
}
