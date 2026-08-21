import { Boxes, ClipboardPlus, Map as MapaIcono } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { existenciasVisibles, puedeReportar, puedeVerExistencias } from '@/lib/campo'
import { catalogoActivo, comunidadesDeOrganizacion, registrarReporteManual } from '@/lib/manual'
import { conSesion, sesionActual } from '@/lib/sesion'

/**
 * /campo — the phone surface, for the people who touch this product occasionally.
 *
 * The panel targets «a laptop over a weak connection» (app/(panel)/layout.tsx) and that is right
 * for a coordinator at a desk. It is wrong for somebody minding an acopio, or standing at a muelle
 * between runs, or reporting on behalf of a community — who are on a phone, once a week, with one
 * thing to do. This is those two things, thumb-sized.
 *
 * Two capabilities, each behind its own role gate (lib/campo.ts):
 *
 *   Existencias — what a node has, and **how old the count is**, always. Non-negotiable 2.3: a
 *   quantity without its date is a rumour, and «40 bidones» read on a phone at the muelle gets
 *   acted on immediately. Signed-in staff only, by founder decision — deliberately not the
 *   reportante-facing e-Catalog, which stays an open question precisely because telling a
 *   community what sits in a warehouse promises an outcome nobody has agreed to deliver
 *   (principle 6, «inventory is never a promise»).
 *
 *   Reportar — the same write /manual does, on a form that fits a phone. One screen, no wizard.
 *
 * Lives inside (panel) so it inherits the session gate, the org-approval gate and RLS rather than
 * re-implementing three security boundaries for a small screen, and renders its own wide-thumb
 * layout inside that shell. Inputs are `text-base` so iOS does not zoom on focus, and the targets
 * are py-3 — the same choices /transportar already makes.
 */

export const dynamic = 'force-dynamic'

export default async function Campo({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>
}) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')
  const { ok, error } = await searchParams

  const verStock = puedeVerExistencias(sesion)
  const reportar = puedeReportar(sesion)

  const { existencias, comunidades, catalogo } = await conSesion(sesion, async (client) => ({
    existencias: verStock ? await existenciasVisibles(client) : [],
    comunidades: reportar ? await comunidadesDeOrganizacion(client, sesion.organizacionId) : [],
    catalogo: reportar ? await catalogoActivo(client) : [],
  }))

  async function registrar(formData: FormData) {
    'use server'
    const s = await sesionActual()
    if (!s) redirect('/entrar')
    if (!puedeReportar(s)) redirect('/campo?error=permiso')

    const familias = Number(String(formData.get('familias') ?? '').trim())
    const r = await conSesion(
      s,
      (client) =>
        registrarReporteManual(client, {
          comunidadId: String(formData.get('comunidadId') ?? ''),
          codigoItem: String(formData.get('codigoItem') ?? '') || null,
          familias: Number.isFinite(familias) ? familias : null,
          detalle: String(formData.get('detalle') ?? ''),
        }),
      { escribe: true },
    )
    redirect(r.ok ? `/campo?ok=${r.folio}` : `/campo?error=${encodeURIComponent(r.error)}`)
  }

  // Grouped by node: somebody minding one acopio cares about one of these and should not have to
  // read past the others to find it.
  const porNodo = new Map<string, typeof existencias>()
  for (const e of existencias) {
    const lista = porNodo.get(e.nodo) ?? []
    lista.push(e)
    porNodo.set(e.nodo, lista)
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-lg font-semibold text-barro-900">Campo</h1>
      <p className="mt-1 text-sm text-barro-600">
        Lo que se hace desde el teléfono: ver qué hay en el acopio y avisar qué falta.
      </p>

      {ok && (
        <p className="mt-4 rounded-lg border border-selva-200 bg-selva-50 px-4 py-3 text-sm text-selva-900">
          Quedó registrado con el folio {ok}. Pasa por verificación antes de volverse un pedido.
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-lg border border-atrato-100 bg-atrato-50 px-4 py-3 text-sm text-barro-800">
          {error === 'permiso' ? 'Su rol no registra reportes.' : error}
        </p>
      )}

      {verStock && (
        <section className="mt-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-barro-900">
            <Boxes className="h-4 w-4 text-selva-700" aria-hidden />
            Existencias
          </h2>
          {porNodo.size === 0 ? (
            <p className="mt-2 rounded-lg border border-barro-200 bg-white px-4 py-4 text-sm text-barro-600">
              No hay nada contado todavía.
            </p>
          ) : (
            [...porNodo.entries()].map(([nodo, filas]) => (
              <div key={nodo} className="mt-3 overflow-hidden rounded-xl border border-barro-200 bg-white">
                <p className="border-b border-barro-100 px-4 py-2 text-sm font-medium text-barro-900">
                  {nodo} <span className="text-xs font-normal text-barro-500">· {filas[0]!.comunidad}</span>
                </p>
                <ul className="divide-y divide-barro-100">
                  {filas.map((f) => (
                    <li key={`${f.nodoId}:${f.item}`} className="flex items-baseline gap-3 px-4 py-3">
                      <span className="text-base font-semibold tabular-nums text-barro-900">{f.cantidad}</span>
                      <span className="min-w-0 flex-1 text-sm text-barro-800">
                        {f.unidad ? `${f.unidad} · ` : ''}
                        {f.item}
                      </span>
                      {/* 2.3: never a quantity without the age of the count. */}
                      <span className="shrink-0 text-xs text-barro-500">
                        {f.diasDesdeConteo === null
                          ? 'sin fecha de conteo'
                          : f.diasDesdeConteo <= 0
                            ? 'contado hoy'
                            : `contado hace ${f.diasDesdeConteo} d`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      )}

      {reportar && (
        <section className="mt-8">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-barro-900">
            <ClipboardPlus className="h-4 w-4 text-selva-700" aria-hidden />
            Avisar qué falta
          </h2>
          <form action={registrar} className="mt-3 space-y-3 rounded-xl border border-barro-200 bg-white p-4">
            <label className="block">
              <span className="text-sm text-barro-700">Comunidad</span>
              <select name="comunidadId" required className="mt-1 w-full rounded-lg border border-barro-300 px-3 py-3 text-base">
                <option value="">Elija una</option>
                {comunidades.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre} · {c.municipio}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-barro-700">Qué se necesita</span>
              <select name="codigoItem" className="mt-1 w-full rounded-lg border border-barro-300 px-3 py-3 text-base">
                <option value="">Sin clasificar todavía</option>
                {catalogo.map((i) => (
                  <option key={i.codigo} value={i.codigo}>{i.itemLabel}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-barro-700">Cuántas familias</span>
              <input name="familias" type="number" min="1" inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-barro-300 px-3 py-3 text-base" />
            </label>
            <label className="block">
              <span className="text-sm text-barro-700">En sus palabras</span>
              <textarea name="detalle" rows={3}
                className="mt-1 w-full rounded-lg border border-barro-300 px-3 py-3 text-base"
                placeholder="Lo que le dijeron, tal como se lo dijeron." />
            </label>
            <button type="submit" className="w-full rounded-lg bg-selva-700 px-4 py-3 font-medium text-white hover:bg-selva-800">
              Registrar
            </button>
          </form>
        </section>
      )}

      {!verStock && !reportar && (
        <p className="mt-6 rounded-lg border border-barro-200 bg-white px-4 py-4 text-sm text-barro-600">
          Su rol no ve existencias ni registra reportes. Hable con el admin de su organización.
        </p>
      )}

      <Link href="/mapa-offline" className="mt-8 flex items-center gap-2 text-sm text-selva-700 underline">
        <MapaIcono className="h-4 w-4" aria-hidden />
        Descargar el mapa para usar sin conexión
      </Link>
    </div>
  )
}
