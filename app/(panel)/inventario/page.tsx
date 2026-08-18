import { Boxes, CalendarClock, PackageSearch, Store, TriangleAlert } from 'lucide-react'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { listarExistenciasFarmacias } from '@/lib/compra-local'
import { listarLotes, registrarLote } from '@/lib/inventario/existencias'
import { clasificarCaducidad, type EstadoCaducidad, ordenarPorCaducidad } from '@/lib/inventario/lotes'
import { conSesion, sesionActual } from '@/lib/sesion'
import type { FamiliaAyuda } from '@/db/schema/vocabulario'
import { FAMILIAS_AYUDA } from '@/db/schema/vocabulario'

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
 *
 * FR-45 layers a coarse family filter on top (alimentos / medicinas / construcción) — Doña
 * Marta's ask for distinct tracking of the three families the field actually triages by.
 * FR-43 adds expiry lots for perishable items, sorted soonest-first and flagged. FR-44 folds
 * a local pharmacy's structured stock into the same Existencias view, since medicine already
 * sitting in a community is a fulfilment option, not a different screen.
 */

const PUEDEN_VER = ['verificador', 'despachador', 'coordinador', 'admin']
const PUEDEN_REGISTRAR_LOTE = ['coordinador', 'admin']

/**
 * A count older than this reads as stale. It matches the default community check-in interval
 * (`comunidades.intervalo_chequeo_dias`, 14 days): if we would worry about a community that
 * has been quiet this long, we should worry about a stock figure of the same age.
 */
const DIAS_CONTEO_VIEJO = 14

const ETIQUETA_FAMILIA: Record<FamiliaAyuda, string> = {
  alimentos: 'Alimentos',
  medicinas: 'Medicinas',
  construccion: 'Construcción',
}

const ETIQUETA_CADUCIDAD: Record<EstadoCaducidad, string> = {
  vencido: 'vencido',
  proximo: 'por vencer',
  vigente: 'vigente',
  sinFecha: 'sin fecha',
}

type FilaDemanda = {
  codigo_item: string
  familias: number
  pedidos: number
  comunidades: number
  urgencia_max: number
}

type FilaStock = {
  id: string
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
  familia_ayuda: FamiliaAyuda | null
  perecedero: boolean
  unidad_singular: string | null
  unidad_plural: string | null
  urgencia_min: number
}

type LoteVista = {
  id: string
  cantidad: number
  fechaCaducidad: Date | null
  estado: EstadoCaducidad
  nodoNombre: string
}

type FarmaciaVista = { proveedorNombre: string; comunidadNombre: string | null; cantidad: number }

type Articulo = {
  codigo: string
  etiqueta: string
  familia: string
  familiaAyuda: FamiliaAyuda | null
  perecedero: boolean
  unidad: string | null
  urgencia: number
  familias: number
  pedidos: number
  comunidades: number
  stockTotal: number
  existencias: (FilaStock & { lotes: LoteVista[] })[]
  farmacias: FarmaciaVista[]
  /** Oldest count among this item's stores — the most conservative freshness we can claim. */
  diasMasViejo: number | null
}

type Params = Promise<{ familia?: string }>

export default async function Inventario({ searchParams }: { searchParams?: Params }) {
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

  const params = (await searchParams) ?? {}
  const familiaFiltro = FAMILIAS_AYUDA.includes(params.familia as FamiliaAyuda)
    ? (params.familia as FamiliaAyuda)
    : null

  const { demanda, stock, catalogo, lotes, farmacias } = await conSesion(sesion, async (client) => {
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
      `select e.id,
              e.codigo_item,
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
      `select codigo, item_label, familia_label, familia_ayuda, perecedero,
              unidad_singular, unidad_plural, urgencia_min
         from catalogo_items
        where activo`,
    )

    const lotes = await listarLotes(client)
    const farmacias = await listarExistenciasFarmacias(client)

    return { demanda: demanda.rows, stock: stock.rows, catalogo: catalogo.rows, lotes, farmacias }
  })

  async function agregarLote(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_REGISTRAR_LOTE.includes(sesion.rolStaff)) {
      redirect('/inventario?error=Sin+permiso+para+registrar+lotes')
    }
    const existenciaId = String(formData.get('existenciaId') ?? '')
    const cantidad = Number(String(formData.get('cantidad') ?? '').replace(/[^\d]/g, ''))
    const fechaRaw = String(formData.get('fechaCaducidad') ?? '').trim()
    if (!existenciaId) redirect('/inventario?error=Falta+la+existencia')
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      redirect('/inventario?error=La+cantidad+del+lote+debe+ser+mayor+que+cero')
    }
    try {
      await conSesion(
        sesion,
        (client) =>
          registrarLote(
            client,
            {
              existenciaId,
              cantidad,
              // Empty on purpose stays null — an honest "sin fecha", never a guessed date (2.3).
              fechaCaducidad: fechaRaw ? new Date(fechaRaw) : null,
            },
            sesion.authId,
          ),
        { escribe: true },
      )
    } catch {
      redirect('/inventario?error=No+se+pudo+registrar+el+lote')
    }
    revalidatePath('/inventario')
    redirect('/inventario?ok=Lote+registrado')
  }

  const porCodigo = new Map(catalogo.map((c) => [c.codigo, c]))
  const demandaPorItem = new Map(demanda.map((d) => [d.codigo_item, d]))
  const stockPorItem = new Map<string, FilaStock[]>()
  for (const fila of stock) {
    const lista = stockPorItem.get(fila.codigo_item) ?? []
    lista.push(fila)
    stockPorItem.set(fila.codigo_item, lista)
  }
  const lotesPorExistencia = new Map<string, LoteVista[]>()
  for (const l of lotes) {
    const lista = lotesPorExistencia.get(l.existenciaId) ?? []
    lista.push({
      id: l.id,
      cantidad: l.cantidad,
      fechaCaducidad: l.fechaCaducidad,
      estado: clasificarCaducidad(l.fechaCaducidad),
      nodoNombre: l.nodoNombre,
    })
    lotesPorExistencia.set(l.existenciaId, lista)
  }
  const farmaciasPorItem = new Map<string, FarmaciaVista[]>()
  for (const f of farmacias) {
    const lista = farmaciasPorItem.get(f.codigoItem) ?? []
    lista.push({ proveedorNombre: f.proveedorNombre, comunidadNombre: f.comunidadNombre, cantidad: f.cantidad })
    farmaciasPorItem.set(f.codigoItem, lista)
  }

  // The rows are exactly the items that carry a request, hold stock, or sit in a pharmacy —
  // the full catalogue lives on its own screen, and padding this one with 0-against-0 lines
  // would bury the handful that matter.
  const codigos = new Set<string>([
    ...demandaPorItem.keys(),
    ...stockPorItem.keys(),
    ...farmaciasPorItem.keys(),
  ])

  let articulos: Articulo[] = [...codigos].map((codigo) => {
    const meta = porCodigo.get(codigo)
    const d = demandaPorItem.get(codigo)
    const existenciasCrudas = stockPorItem.get(codigo) ?? []
    const stockTotal = existenciasCrudas.reduce((n, e) => n + e.cantidad, 0)
    const diasMasViejo = existenciasCrudas.length
      ? Math.max(...existenciasCrudas.map((e) => e.dias))
      : null
    const existencias = existenciasCrudas.map((e) => ({
      ...e,
      lotes: ordenarPorCaducidad(lotesPorExistencia.get(e.id) ?? []),
    }))

    return {
      codigo,
      etiqueta: meta?.item_label ?? codigo,
      familia: meta?.familia_label ?? '',
      familiaAyuda: meta?.familia_ayuda ?? null,
      perecedero: meta?.perecedero ?? false,
      unidad: meta ? (stockTotal === 1 ? meta.unidad_singular : meta.unidad_plural) : null,
      urgencia: d?.urgencia_max ?? meta?.urgencia_min ?? 1,
      familias: d?.familias ?? 0,
      pedidos: d?.pedidos ?? 0,
      comunidades: d?.comunidades ?? 0,
      stockTotal,
      existencias,
      farmacias: farmaciasPorItem.get(codigo) ?? [],
      diasMasViejo,
    }
  })

  // FR-45: the summary strip is over the unfiltered set — a coordinator switching families
  // should still see the whole picture of how the three add up.
  const resumenFamilias = FAMILIAS_AYUDA.map((familia) => {
    const deLaFamilia = articulos.filter((a) => a.familiaAyuda === familia)
    return {
      familia,
      etiqueta: ETIQUETA_FAMILIA[familia],
      articulos: deLaFamilia.length,
      stockTotal: deLaFamilia.reduce((n, a) => n + a.stockTotal, 0),
    }
  })

  if (familiaFiltro) {
    articulos = articulos.filter((a) => a.familiaAyuda === familiaFiltro)
  }

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
  const puedeRegistrarLote = PUEDEN_REGISTRAR_LOTE.includes(sesion.rolStaff)

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
        Lo que piden las comunidades, al lado de lo que hay contado en los centros — y en las
        farmacias locales. La existencia no es una promesa: cada cifra dice de cuándo es el
        conteo, y se confirma al llegar. Un conteo de hace más de {DIAS_CONTEO_VIEJO} días va
        marcado — puede que ya no quede nada de eso.
      </p>

      {/* FR-45: filter by the three coarse aid families */}
      <nav className="mt-4 flex flex-wrap gap-2" aria-label="Filtrar por familia">
        <FiltroFamilia etiqueta="Todos" activo={familiaFiltro === null} href="/inventario" />
        {resumenFamilias.map((r) => (
          <FiltroFamilia
            key={r.familia}
            etiqueta={`${r.etiqueta} · ${r.articulos} artículo${r.articulos === 1 ? '' : 's'} · ${r.stockTotal} en existencia`}
            activo={familiaFiltro === r.familia}
            href={`/inventario?familia=${r.familia}`}
          />
        ))}
      </nav>

      {articulos.length === 0 ? (
        <p className="mt-6 flex items-center gap-2 rounded-lg border border-barro-200 bg-white px-4 py-3 text-barro-700">
          <PackageSearch className="size-4 shrink-0" aria-hidden />
          {familiaFiltro
            ? 'Ningún artículo de esta familia tiene pedidos abiertos ni existencias contadas.'
            : 'Todavía no hay pedidos abiertos ni existencias contadas.'}
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {articulos.map((a) => (
            <ArticuloFila
              key={a.codigo}
              articulo={a}
              puedeRegistrarLote={puedeRegistrarLote}
              onAgregarLote={agregarLote}
            />
          ))}
        </ul>
      )}
    </main>
  )
}

function FiltroFamilia({ etiqueta, activo, href }: { etiqueta: string; activo: boolean; href: string }) {
  return (
    <a
      href={href}
      className={
        activo
          ? 'rounded-full bg-selva-700 px-3 py-1.5 text-xs font-medium text-white'
          : 'rounded-full border border-barro-200 bg-white px-3 py-1.5 text-xs font-medium text-barro-700 hover:bg-barro-50'
      }
    >
      {etiqueta}
    </a>
  )
}

function ArticuloFila({
  articulo: a,
  puedeRegistrarLote,
  onAgregarLote,
}: {
  articulo: Articulo
  puedeRegistrarLote: boolean
  onAgregarLote: (fd: FormData) => void
}) {
  const stockViejo = a.diasMasViejo !== null && a.diasMasViejo > DIAS_CONTEO_VIEJO
  const farmaciaTotal = a.farmacias.reduce((n, f) => n + f.cantidad, 0)

  return (
    <li className="rounded-lg border border-barro-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        {/* D9: a bare two-digit code beside PIDEN/EXISTENCIAS counts reads as a quantity
            («12 Agua potable» → «12 units»). A bordered chip with a «cód.» prefix makes it
            unmistakably the catalogue code, not a number. The code itself is unchanged. */}
        <span className="self-center rounded border border-barro-200 bg-barro-50 px-1.5 py-0.5 font-mono text-xs text-barro-500">
          cód. {a.codigo}
        </span>
        <span className="font-medium text-barro-900">{a.etiqueta}</span>
        <span className="text-sm text-barro-500">{a.familia}</span>
        {a.familiaAyuda && (
          <span className="rounded bg-selva-100 px-1.5 py-0.5 text-xs font-medium text-selva-800">
            {ETIQUETA_FAMILIA[a.familiaAyuda]}
          </span>
        )}
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
                    <li key={e.id} className="text-sm">
                      <div className="flex flex-wrap items-baseline gap-x-1.5">
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
                      </div>

                      {/* FR-43: perishable lots for this store, soonest expiry first */}
                      {(e.lotes.length > 0 || (a.perecedero && puedeRegistrarLote)) && (
                        <div className="mt-1 ml-3 border-l-2 border-barro-100 pl-2">
                          {e.lotes.map((l) => (
                            <LoteFila key={l.id} lote={l} />
                          ))}
                          {a.perecedero && puedeRegistrarLote && (
                            <FormularioLote existenciaId={e.id} onAgregarLote={onAgregarLote} />
                          )}
                        </div>
                      )}
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

          {/* FR-44: local pharmacy stock — a fulfilment option before shipping anything in */}
          {a.farmacias.length > 0 && (
            <div className="mt-2 border-t border-barro-100 pt-2">
              <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-barro-500">
                <Store className="size-3.5" aria-hidden />
                En farmacias locales
              </p>
              <ul className="mt-1 space-y-0.5">
                {a.farmacias.map((f, i) => (
                  <li key={`${f.proveedorNombre}-${i}`} className="text-sm text-barro-700">
                    {f.proveedorNombre}
                    {f.comunidadNombre && ` (${f.comunidadNombre})`}
                    {' · '}
                    <span className="font-medium text-barro-900">{f.cantidad}</span>
                  </li>
                ))}
              </ul>
              {farmaciaTotal > 0 && (
                <p className="mt-0.5 text-xs text-barro-500">
                  {farmaciaTotal} en total — opción de abastecimiento local antes de enviar.
                </p>
              )}
            </div>
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

const CLASE_ESTADO_CADUCIDAD: Record<EstadoCaducidad, string> = {
  vencido: 'bg-rose-100 text-rose-900',
  proximo: 'bg-atrato-100 text-atrato-700',
  vigente: 'text-barro-500',
  sinFecha: 'text-barro-500',
}

function LoteFila({ lote }: { lote: LoteVista }) {
  const destacado = lote.estado === 'vencido' || lote.estado === 'proximo'
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs">
      <CalendarClock className="size-3 text-barro-400" aria-hidden />
      <span className="font-medium text-barro-800">{lote.cantidad}</span>
      <span className="text-barro-500">lote</span>
      <span
        className={
          destacado
            ? `inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${CLASE_ESTADO_CADUCIDAD[lote.estado]}`
            : CLASE_ESTADO_CADUCIDAD[lote.estado]
        }
      >
        {destacado && <TriangleAlert className="size-3" aria-hidden />}
        {lote.fechaCaducidad
          ? `vence ${lote.fechaCaducidad.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}`
          : 'sin fecha'}
        {' · '}
        {ETIQUETA_CADUCIDAD[lote.estado]}
      </span>
    </p>
  )
}

function FormularioLote({
  existenciaId,
  onAgregarLote,
}: {
  existenciaId: string
  onAgregarLote: (fd: FormData) => void
}) {
  return (
    <form action={onAgregarLote} className="mt-1 flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="existenciaId" value={existenciaId} />
      <input
        name="cantidad"
        inputMode="numeric"
        placeholder="Cant."
        className="w-16 rounded border border-barro-200 px-1.5 py-0.5 text-xs"
      />
      <input
        name="fechaCaducidad"
        type="date"
        aria-label="Fecha de caducidad (opcional)"
        className="rounded border border-barro-200 px-1.5 py-0.5 text-xs"
      />
      <button
        type="submit"
        className="rounded border border-barro-300 px-2 py-0.5 text-xs font-medium text-barro-800 hover:bg-barro-50"
      >
        + lote
      </button>
    </form>
  )
}
