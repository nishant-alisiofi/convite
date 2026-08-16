import { Boxes, PackageSearch, TriangleAlert } from 'lucide-react'
import { redirect } from 'next/navigation'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * Demand against stock, side by side.
 *
 * The whole product is Section 1: a count only becomes a phone call when you can see the
 * request next to what would answer it. So this screen puts every open request beside the
 * counted stock that might cover it, one row per catalogue item.
 *
 * Non-negotiable 2.3: inventory is never a promise. Every stock figure travels with the day
 * it was counted, and a count that has gone stale is said so loudly — an amber «desactualizado»
 * rather than a number that quietly sends a boat three hours upriver to an empty store. The
 * confirmation of what is really there happens on arrival, and the copy says as much.
 *
 * Demand and stock are deliberately NOT subtracted. A request is measured in families and a
 * store in item units; treating «90 families» minus «243 sacks» as a coverage number would be
 * a promise dressed as arithmetic. The two columns sit next to each other and the coordinator
 * makes the call — which is exactly the judgement the tool exists to inform, not replace.
 */

const PUEDEN_VER = ['verificador', 'despachador', 'coordinador', 'admin']

/**
 * A count older than this reads as stale. It matches the default community check-in interval
 * (`comunidades.intervalo_chequeo_dias`, 14 days): if we would worry about a community that
 * has been quiet this long, we should worry about a stock figure of the same age.
 */
const DIAS_CONTEO_VIEJO = 14

type FilaDemanda = {
  codigo_item: string
  familias: number
  pedidos: number
  comunidades: number
  urgencia_max: number
}

type FilaStock = {
  codigo_item: string
  cantidad: number
  dias: number
  contado_en: Date
  nodo: string
  comunidad: string
}

type FilaCatalogo = {
  codigo: string
  item_label: string
  familia_label: string
  unidad_singular: string | null
  unidad_plural: string | null
  urgencia_min: number
}

type Articulo = {
  codigo: string
  etiqueta: string
  familia: string
  unidad: string | null
  urgencia: number
  familias: number
  pedidos: number
  comunidades: number
  stockTotal: number
  existencias: FilaStock[]
  /** Oldest count among this item's stores — the most conservative freshness we can claim. */
  diasMasViejo: number | null
}

export default async function Inventario() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  if (!PUEDEN_VER.includes(sesion.rolStaff)) {
    return (
      <main>
        <h1 className="text-xl font-semibold text-barro-900">Inventario</h1>
        <p className="mt-4 max-w-2xl text-barro-700">
          Su rol no ve las existencias ni los pedidos abiertos.
        </p>
      </main>
    )
  }

  const { demanda, stock, catalogo } = await conSesion(sesion, async (client) => {
    // Open demand: every request that is neither delivered nor cancelled still owes stock.
    const demanda = await client.query<FilaDemanda>(
      `select p.codigo_item,
              sum(p.familias)::int          as familias,
              count(*)::int                 as pedidos,
              count(distinct p.comunidad_id)::int as comunidades,
              max(p.urgencia)::int          as urgencia_max
         from pedidos p
        where p.estado not in ('ENTREGADO', 'CANCELADO')
        group by p.codigo_item`,
    )

    // Every counted stock figure, with the store it sits in and how old the count is. A
    // figure with no last-count cannot exist — `contado_en` is NOT NULL by design (2.3).
    const stock = await client.query<FilaStock>(
      `select e.codigo_item,
              e.cantidad,
              e.contado_en,
              date_part('day', now() - e.contado_en)::int as dias,
              n.nombre as nodo,
              c.nombre as comunidad
         from existencias e
         join nodos n       on n.id = e.nodo_id
         join comunidades c on c.id = n.comunidad_id
        order by e.contado_en asc`,
    )

    const catalogo = await client.query<FilaCatalogo>(
      `select codigo, item_label, familia_label, unidad_singular, unidad_plural, urgencia_min
         from catalogo_items
        where activo`,
    )

    return { demanda: demanda.rows, stock: stock.rows, catalogo: catalogo.rows }
  })

  const porCodigo = new Map(catalogo.map((c) => [c.codigo, c]))
  const demandaPorItem = new Map(demanda.map((d) => [d.codigo_item, d]))
  const stockPorItem = new Map<string, FilaStock[]>()
  for (const fila of stock) {
    const lista = stockPorItem.get(fila.codigo_item) ?? []
    lista.push(fila)
    stockPorItem.set(fila.codigo_item, lista)
  }

  // The rows are exactly the items that carry a request or hold stock — the full catalogue
  // lives on its own screen, and padding this one with 0-against-0 lines would bury the
  // handful that matter.
  const codigos = new Set<string>([...demandaPorItem.keys(), ...stockPorItem.keys()])

  const articulos: Articulo[] = [...codigos].map((codigo) => {
    const meta = porCodigo.get(codigo)
    const d = demandaPorItem.get(codigo)
    const existencias = stockPorItem.get(codigo) ?? []
    const stockTotal = existencias.reduce((n, e) => n + e.cantidad, 0)
    const diasMasViejo = existencias.length ? Math.max(...existencias.map((e) => e.dias)) : null

    return {
      codigo,
      etiqueta: meta?.item_label ?? codigo,
      familia: meta?.familia_label ?? '',
      unidad: meta ? (stockTotal === 1 ? meta.unidad_singular : meta.unidad_plural) : null,
      urgencia: d?.urgencia_max ?? meta?.urgencia_min ?? 1,
      familias: d?.familias ?? 0,
      pedidos: d?.pedidos ?? 0,
      comunidades: d?.comunidades ?? 0,
      stockTotal,
      existencias,
      diasMasViejo,
    }
  })

  // Requests first, most urgent at the top, then the biggest asks; stock-only items sink to
  // the bottom, in catalogue reading order, as reference.
  articulos.sort((a, b) => {
    const aPide = a.familias > 0 ? 1 : 0
    const bPide = b.familias > 0 ? 1 : 0
    if (aPide !== bPide) return bPide - aPide
    if (aPide === 1) {
      if (b.urgencia !== a.urgencia) return b.urgencia - a.urgencia
      return b.familias - a.familias
    }
    return a.codigo.localeCompare(b.codigo)
  })

  const desactualizados = articulos.filter(
    (a) => a.diasMasViejo !== null && a.diasMasViejo > DIAS_CONTEO_VIEJO,
  ).length
  const conDemanda = articulos.filter((a) => a.familias > 0).length

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-barro-900">Inventario</h1>
        <p className="text-sm text-barro-600">
          {conDemanda} artículo{conDemanda === 1 ? '' : 's'} con pedidos abiertos
          {desactualizados > 0 && (
            <>
              {' · '}
              <span className="text-atrato-700">
                {desactualizados} con conteo desactualizado
              </span>
            </>
          )}
        </p>
      </div>

      <p className="mt-2 max-w-3xl text-sm text-barro-700">
        Lo que piden las comunidades, al lado de lo que hay contado en los centros. La
        existencia no es una promesa: cada cifra dice de cuándo es el conteo, y se confirma al
        llegar. Un conteo de hace más de {DIAS_CONTEO_VIEJO} días va marcado — puede que ya no
        quede nada de eso.
      </p>

      {articulos.length === 0 ? (
        <p className="mt-6 flex items-center gap-2 rounded-lg border border-barro-200 bg-white px-4 py-3 text-barro-700">
          <PackageSearch className="size-4 shrink-0" aria-hidden />
          Todavía no hay pedidos abiertos ni existencias contadas.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {articulos.map((a) => (
            <ArticuloFila key={a.codigo} articulo={a} />
          ))}
        </ul>
      )}
    </main>
  )
}

function ArticuloFila({ articulo: a }: { articulo: Articulo }) {
  const stockViejo = a.diasMasViejo !== null && a.diasMasViejo > DIAS_CONTEO_VIEJO

  return (
    <li className="rounded-lg border border-barro-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-sm text-barro-500">{a.codigo}</span>
        <span className="font-medium text-barro-900">{a.etiqueta}</span>
        <span className="text-sm text-barro-500">{a.familia}</span>
        {a.urgencia === 3 && a.familias > 0 && (
          <span className="flex shrink-0 items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-900">
            <TriangleAlert className="size-3" aria-hidden />
            urgente
          </span>
        )}
      </div>

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {/* Demand */}
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-barro-500">Piden</p>
          {a.familias > 0 ? (
            <p className="mt-0.5 text-sm text-barro-900">
              <span className="font-semibold">{a.familias}</span> familias
              <span className="text-barro-600">
                {' · '}
                {a.comunidades} comunidad{a.comunidades === 1 ? '' : 'es'}
                {' · '}
                {a.pedidos} pedido{a.pedidos === 1 ? '' : 's'}
              </span>
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-barro-500">Sin demanda abierta</p>
          )}
        </div>

        {/* Stock */}
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-barro-500">
            Existencias
          </p>
          {a.existencias.length > 0 ? (
            <>
              <p className="mt-0.5 flex items-center gap-1 text-sm text-barro-900">
                <Boxes className="size-4 text-barro-400" aria-hidden />
                <span className="font-semibold">{a.stockTotal}</span>
                {a.unidad && <span className="text-barro-600">{a.unidad}</span>}
                <span className="text-barro-600">
                  {' '}
                  en {a.existencias.length} punto{a.existencias.length === 1 ? '' : 's'}
                </span>
              </p>
              <ul className="mt-1 space-y-0.5">
                {a.existencias.map((e) => {
                  const viejo = e.dias > DIAS_CONTEO_VIEJO
                  return (
                    <li
                      key={`${e.nodo}-${e.contado_en.toISOString()}`}
                      className="flex flex-wrap items-baseline gap-x-1.5 text-sm"
                    >
                      <span className="text-barro-700">{e.nodo}</span>
                      <span className="font-medium text-barro-900">{e.cantidad}</span>
                      <span
                        className={
                          viejo
                            ? 'inline-flex items-center gap-1 rounded bg-atrato-100 px-1.5 py-0.5 text-xs font-medium text-atrato-700'
                            : 'text-xs text-barro-500'
                        }
                        title={e.contado_en.toLocaleDateString('es-CO', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                      >
                        {viejo && <TriangleAlert className="size-3" aria-hidden />}
                        contado hace {e.dias} {e.dias === 1 ? 'día' : 'días'}
                        {viejo && ' · desactualizado'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : (
            <p className="mt-0.5 flex items-center gap-1 text-sm font-medium text-atrato-700">
              <TriangleAlert className="size-4 shrink-0" aria-hidden />
              Sin existencias contadas
            </p>
          )}
        </div>
      </div>

      {a.familias > 0 && a.existencias.length > 0 && stockViejo && (
        <p className="mt-2 text-sm text-barro-600">
          Hay pedidos abiertos y el conteo más viejo de este artículo ya pasó los{' '}
          {DIAS_CONTEO_VIEJO} días. Conviene contar antes de prometer.
        </p>
      )}
    </li>
  )
}
