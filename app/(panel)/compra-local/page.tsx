import { CheckCircle2, Circle, PackageCheck, ShoppingBasket, Store, TriangleAlert, Wallet } from 'lucide-react'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  agregarEvidencia,
  CADENA_COMPRA_LOCAL,
  cerrarCompra,
  type CompraLocal,
  crearCompra,
  crearFondo,
  crearProveedor,
  distribuirCompra,
  type EstadoCompraLocal,
  type ExistenciaProveedor,
  type Fondo,
  listarCompras,
  listarExistenciasFarmacias,
  listarFondos,
  listarProveedores,
  PASO_COMPRA_LOCAL,
  pasosCompletados,
  pedidosSinExistencia,
  registrarExistenciaProveedor,
  registrarRecibo,
  verificarCompra,
} from '@/lib/compra-local'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * PRD-9 «Compra local financiada» — the third supply mode (§24 / §30).
 *
 * Instead of shipping a thing in, allocate funds to a territorial responsible who buys near the
 * municipality. This screen is the six-step traceability chain made operable: authorise a purchase
 * against a funding pool (whose ceiling the database enforces), record the receipt, verify the
 * materials arrived, mark distribution, and close with photographic/documentary evidence. Every
 * step carries who did it and when; the authorisation is immutable once recorded.
 *
 * FR-44 folds in the supply-side twin: a local pharmacy already sitting in a community is a
 * fulfilment option that costs nothing to ship, so it lives on the same screen as the fund it
 * would otherwise draw from.
 */

const PUEDEN_VER = ['coordinador', 'admin', 'despachador']
const PUEDEN_FONDO = ['coordinador', 'admin']

const pesos = (n: number) => `$${n.toLocaleString('es-CO')}`

type Params = Promise<{ error?: string; ok?: string }>

export default async function CompraLocal({ searchParams }: { searchParams: Params }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { error, ok } = await searchParams

  if (!PUEDEN_VER.includes(sesion.rolStaff)) {
    return (
      <main>
        <h1 className="text-xl font-semibold text-barro-900">Compra local financiada</h1>
        <p className="mt-4 max-w-2xl text-barro-700">
          Autorizar dinero para comprar cerca del territorio es trabajo de coordinación y despacho.
          Su rol no lo ve.
        </p>
      </main>
    )
  }

  const { fondos, proveedores, compras, pedidos, contactos, catalogo, comunidades, existenciasFarmacias } =
    await conSesion(sesion, async (client) => {
      const fondos = await listarFondos(client)
      const proveedores = await listarProveedores(client)
      const compras = await listarCompras(client)
      const pedidos = await pedidosSinExistencia(client)
      const existenciasFarmacias = await listarExistenciasFarmacias(client)
      const { rows: contactos } = await client.query<{ id: string; nombre: string }>(
        `select id, nombre from contactos order by nombre limit 300`,
      )
      const { rows: catalogo } = await client.query<{ codigo: string; item_label: string }>(
        `select codigo, item_label from catalogo_items order by codigo`,
      )
      // FR-44: a pharmacy has to be tied to a community (AC #1) — the picker for the vendor
      // form.
      const { rows: comunidades } = await client.query<{ id: string; nombre: string }>(
        `select id, nombre from comunidades order by nombre`,
      )
      return { fondos, proveedores, compras, pedidos, contactos, catalogo, comunidades, existenciasFarmacias }
    })

  async function registrarFondo(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_FONDO.includes(sesion.rolStaff)) {
      redirect('/compra-local?error=Solo+coordinación+crea+fondos')
    }
    const nombre = String(formData.get('nombre') ?? '').trim()
    const techoCop = Number(String(formData.get('techoCop') ?? '').replace(/[^\d]/g, ''))
    const umbralRaw = String(formData.get('umbralAlertaCop') ?? '').replace(/[^\d]/g, '')
    const umbralAlertaCop = umbralRaw ? Number(umbralRaw) : null
    if (!nombre) redirect('/compra-local?error=Falta+el+nombre+del+fondo')
    if (!Number.isFinite(techoCop) || techoCop <= 0) {
      redirect('/compra-local?error=El+techo+debe+ser+mayor+que+cero')
    }
    if (umbralAlertaCop !== null && umbralAlertaCop > techoCop) {
      redirect('/compra-local?error=La+alerta+no+puede+superar+el+techo')
    }
    try {
      await conSesion(
        sesion,
        (client) =>
          crearFondo(
            client,
            { organizacionId: sesion.organizacionId, nombre, techoCop, umbralAlertaCop },
            sesion.authId,
          ),
        { escribe: true },
      )
    } catch {
      redirect('/compra-local?error=No+se+pudo+crear+el+fondo')
    }
    revalidatePath('/compra-local')
    redirect('/compra-local?ok=Fondo+creado')
  }

  async function registrarProveedor(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_FONDO.includes(sesion.rolStaff)) {
      redirect('/compra-local?error=Solo+coordinación+registra+proveedores')
    }
    const nombre = String(formData.get('nombre') ?? '').trim()
    if (!nombre) redirect('/compra-local?error=Falta+el+nombre+del+proveedor')
    const esFarmacia = formData.get('esFarmacia') === 'on'
    const comunidadId = String(formData.get('comunidadId') ?? '') || null
    // FR-44 AC #1: a pharmacy is a supply source tied to a community — not optional for one.
    if (esFarmacia && !comunidadId) {
      redirect('/compra-local?error=Una+farmacia+necesita+una+comunidad')
    }
    try {
      await conSesion(
        sesion,
        (client) =>
          crearProveedor(
            client,
            {
              organizacionId: sesion.organizacionId,
              nombre,
              comunidadId,
              municipio: String(formData.get('municipio') ?? '').trim() || null,
              suministra: String(formData.get('suministra') ?? '').trim() || null,
              contacto: String(formData.get('contacto') ?? '').trim() || null,
              esFarmacia,
            },
            sesion.authId,
          ),
        { escribe: true },
      )
    } catch {
      redirect('/compra-local?error=No+se+pudo+registrar+el+proveedor')
    }
    revalidatePath('/compra-local')
    redirect('/compra-local?ok=Proveedor+registrado')
  }

  async function autorizarCompra(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_VER.includes(sesion.rolStaff)) {
      redirect('/compra-local?error=Sin+permiso')
    }
    const fondoId = String(formData.get('fondoId') ?? '')
    const responsableId = String(formData.get('responsableId') ?? '')
    const concepto = String(formData.get('concepto') ?? '').trim()
    const montoAutorizadoCop = Number(String(formData.get('montoAutorizadoCop') ?? '').replace(/[^\d]/g, ''))
    const pedidoId = String(formData.get('pedidoId') ?? '') || null
    const proveedorId = String(formData.get('proveedorId') ?? '') || null

    if (!fondoId) redirect('/compra-local?error=Elija+un+fondo')
    if (!responsableId) redirect('/compra-local?error=Elija+el+responsable+territorial')
    if (!concepto) redirect('/compra-local?error=Falta+el+concepto')
    if (!Number.isFinite(montoAutorizadoCop) || montoAutorizadoCop <= 0) {
      redirect('/compra-local?error=El+monto+debe+ser+mayor+que+cero')
    }

    const items: { codigoItem: string; cantidad: number; costoCop: number | null }[] = []
    for (let i = 0; i < 3; i++) {
      const codigoItem = String(formData.get(`item${i}Codigo`) ?? '')
      const cantidad = Number(String(formData.get(`item${i}Cantidad`) ?? '').replace(/[^\d]/g, ''))
      if (!codigoItem || !Number.isFinite(cantidad) || cantidad <= 0) continue
      const costoRaw = String(formData.get(`item${i}Costo`) ?? '').replace(/[^\d]/g, '')
      items.push({ codigoItem, cantidad, costoCop: costoRaw ? Number(costoRaw) : null })
    }

    try {
      await conSesion(
        sesion,
        (client) =>
          crearCompra(
            client,
            {
              organizacionId: sesion.organizacionId,
              fondoId,
              pedidoId,
              proveedorId,
              responsableId,
              comunidadId: String(formData.get('comunidadId') ?? '') || null,
              concepto,
              montoAutorizadoCop,
              items,
            },
            sesion.authId,
          ),
        { escribe: true },
      )
    } catch {
      // The most likely failure is the pool ceiling guardrail refusing the purchase (AC #4).
      redirect('/compra-local?error=No+se+pudo+autorizar:+puede+superar+el+techo+del+fondo')
    }
    revalidatePath('/compra-local')
    redirect('/compra-local?ok=Compra+autorizada')
  }

  async function avanzar(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_VER.includes(sesion.rolStaff)) redirect('/compra-local?error=Sin+permiso')
    const id = String(formData.get('id') ?? '')
    const paso = String(formData.get('paso') ?? '')
    if (!id) redirect('/compra-local?error=Falta+la+compra')

    try {
      await conSesion(
        sesion,
        async (client) => {
          if (paso === 'recibo') {
            const reciboRef = String(formData.get('reciboRef') ?? '').trim()
            const montoRaw = String(formData.get('montoRealCop') ?? '').replace(/[^\d]/g, '')
            if (!reciboRef) throw new Error('falta recibo')
            await registrarRecibo(client, id, reciboRef, montoRaw ? Number(montoRaw) : null, sesion.authId)
          } else if (paso === 'verificar') {
            await verificarCompra(client, id, sesion.authId)
          } else if (paso === 'distribuir') {
            await distribuirCompra(client, id, sesion.authId)
          } else if (paso === 'cerrar') {
            const ok = await cerrarCompra(client, id, sesion.authId)
            if (!ok) throw new Error('sin evidencia')
          }
        },
        { escribe: true },
      )
    } catch (e) {
      const razon = e instanceof Error && e.message === 'sin evidencia'
        ? 'Suba una foto o documento antes de cerrar'
        : e instanceof Error && e.message === 'falta recibo'
          ? 'Falta la referencia del recibo'
          : 'No se pudo avanzar la compra'
      redirect(`/compra-local?error=${encodeURIComponent(razon)}`)
    }
    revalidatePath('/compra-local')
    redirect('/compra-local?ok=Compra+actualizada')
  }

  async function subirEvidencia(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_VER.includes(sesion.rolStaff)) redirect('/compra-local?error=Sin+permiso')
    const id = String(formData.get('id') ?? '')
    const tipo = String(formData.get('tipo') ?? 'foto')
    const referencia = String(formData.get('referencia') ?? '').trim()
    if (!id || !referencia) redirect('/compra-local?error=Falta+la+referencia+de+la+evidencia')
    await conSesion(
      sesion,
      (client) =>
        agregarEvidencia(
          client,
          id,
          tipo as 'recibo' | 'foto' | 'documento' | 'acta',
          referencia,
          String(formData.get('descripcion') ?? '').trim() || null,
          sesion.authId,
        ),
      { escribe: true },
    )
    revalidatePath('/compra-local')
    redirect('/compra-local?ok=Evidencia+agregada')
  }

  async function registrarStockFarmacia(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_VER.includes(sesion.rolStaff)) redirect('/compra-local?error=Sin+permiso')
    const proveedorId = String(formData.get('proveedorId') ?? '')
    const codigoItem = String(formData.get('codigoItem') ?? '')
    const cantidad = Number(String(formData.get('cantidad') ?? '').replace(/[^\d]/g, ''))
    if (!proveedorId || !codigoItem) redirect('/compra-local?error=Falta+la+farmacia+o+el+ítem')
    if (!Number.isFinite(cantidad) || cantidad < 0) {
      redirect('/compra-local?error=La+cantidad+debe+ser+cero+o+más')
    }
    try {
      await conSesion(
        sesion,
        (client) =>
          registrarExistenciaProveedor(
            client,
            sesion.organizacionId,
            { proveedorId, codigoItem, cantidad },
            sesion.authId,
          ),
        { escribe: true },
      )
    } catch {
      redirect('/compra-local?error=No+se+pudo+registrar+la+existencia')
    }
    revalidatePath('/compra-local')
    redirect('/compra-local?ok=Existencia+de+farmacia+registrada')
  }

  return (
    <main>
      <h1 className="text-xl font-semibold text-barro-900">Compra local financiada</h1>
      <p className="mt-2 max-w-3xl text-sm text-barro-700">
        El tercer modo de abastecer: en vez de mandar la cosa, se autoriza dinero a un responsable
        del territorio que compra cerca del municipio. Cada compra deja su rastro completo —
        autorización, responsable, recibo, verificación, distribución y evidencia — y el fondo no
        deja autorizar por encima de su techo.
      </p>

      {error && <Aviso tono="error">{error}</Aviso>}
      {ok && <Aviso tono="ok">{ok}</Aviso>}

      {/* Pools */}
      <section className="mt-6">
        <h2 className="flex items-center gap-2 font-semibold text-barro-900">
          <Wallet className="size-4" aria-hidden />
          Fondos
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {fondos.map((f) => (
            <TarjetaFondo key={f.id} f={f} />
          ))}
          {fondos.length === 0 && (
            <p className="rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
              Todavía no hay fondos.
            </p>
          )}
        </div>
        {PUEDEN_FONDO.includes(sesion.rolStaff) && (
          <form action={registrarFondo} className="mt-3 grid gap-3 rounded-lg border border-barro-200 bg-white p-4 sm:grid-cols-3">
            <Campo etiqueta="Nombre del fondo">
              <input name="nombre" required className={CLASE_CAMPO} placeholder="Banco de medicamentos" />
            </Campo>
            <Campo etiqueta="Techo (COP)">
              <input name="techoCop" inputMode="numeric" required className={CLASE_CAMPO} />
            </Campo>
            <Campo etiqueta="Alerta en (COP, opcional)">
              <input name="umbralAlertaCop" inputMode="numeric" className={CLASE_CAMPO} />
            </Campo>
            <div className="sm:col-span-3">
              <button type="submit" className={CLASE_BOTON}>
                Crear fondo
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Authorise a purchase */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 font-semibold text-barro-900">
          <ShoppingBasket className="size-4" aria-hidden />
          Autorizar una compra
        </h2>
        {fondos.length === 0 || contactos.length === 0 ? (
          <p className="mt-3 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-600">
            Se necesita al menos un fondo y un contacto responsable para autorizar una compra.
          </p>
        ) : (
          <form action={autorizarCompra} className="mt-3 grid gap-3 rounded-lg border border-barro-200 bg-white p-4 sm:grid-cols-2">
            <Campo etiqueta="Fondo">
              <select name="fondoId" defaultValue="" required className={CLASE_CAMPO}>
                <option value="" disabled>
                  Elija un fondo
                </option>
                {fondos.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nombre} · libre {pesos(f.disponibleCop)}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Responsable territorial" ayuda="Quien compra cerca del municipio.">
              <select name="responsableId" defaultValue="" required className={CLASE_CAMPO}>
                <option value="" disabled>
                  Elija un responsable
                </option>
                {contactos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Proveedor (opcional)">
              <select name="proveedorId" defaultValue="" className={CLASE_CAMPO}>
                <option value="">Sin proveedor fijo</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                    {p.esFarmacia && ' (farmacia)'}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Resuelve un pedido sin existencia (opcional)">
              <select name="pedidoId" defaultValue="" className={CLASE_CAMPO}>
                <option value="">Ninguno</option>
                {pedidos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.comunidad ?? '—'} · {p.codigoItem} · {p.familias} fam.
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Concepto">
              <input name="concepto" required className={CLASE_CAMPO} placeholder="Medicamentos crónicos" />
            </Campo>
            <Campo etiqueta="Monto autorizado (COP)">
              <input name="montoAutorizadoCop" inputMode="numeric" required className={CLASE_CAMPO} />
            </Campo>

            <fieldset className="sm:col-span-2 grid gap-2 rounded border border-barro-200 p-3">
              <legend className="px-1 text-xs uppercase tracking-wide text-barro-500">Ítems (hasta 3)</legend>
              {[0, 1, 2].map((i) => (
                <div key={i} className="grid grid-cols-3 gap-2">
                  <select name={`item${i}Codigo`} defaultValue="" className={CLASE_CAMPO}>
                    <option value="">Ítem</option>
                    {catalogo.map((c) => (
                      <option key={c.codigo} value={c.codigo}>
                        {c.codigo} · {c.item_label}
                      </option>
                    ))}
                  </select>
                  <input name={`item${i}Cantidad`} inputMode="numeric" placeholder="Cantidad" className={CLASE_CAMPO} />
                  <input name={`item${i}Costo`} inputMode="numeric" placeholder="Costo COP (opcional)" className={CLASE_CAMPO} />
                </div>
              ))}
            </fieldset>

            <div className="sm:col-span-2">
              <button type="submit" className={CLASE_BOTON}>
                Autorizar compra
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Purchases + their chain */}
      <section className="mt-8">
        <h2 className="font-semibold text-barro-900">
          Compras
          <span className="ml-2 font-normal text-barro-600">{compras.length}</span>
        </h2>
        {compras.length === 0 ? (
          <p className="mt-3 rounded-lg border border-barro-200 bg-white px-4 py-3 text-barro-700">
            Todavía no hay compras autorizadas.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {compras.map((c) => (
              <TarjetaCompra key={c.id} c={c} onAvanzar={avanzar} onEvidencia={subirEvidencia} />
            ))}
          </ul>
        )}
      </section>

      {/* Vendors */}
      {PUEDEN_FONDO.includes(sesion.rolStaff) && (
        <section className="mt-8">
          <h2 className="font-semibold text-barro-900">Proveedores locales</h2>
          <p className="mt-1 max-w-2xl text-sm text-barro-600">
            Una farmacia es un proveedor cuyo inventario se sigue ítem por ítem — abajo, en
            «Farmacias locales» — en vez de solo el texto libre de «qué suministra».
          </p>
          <form action={registrarProveedor} className="mt-3 grid gap-3 rounded-lg border border-barro-200 bg-white p-4 sm:grid-cols-4">
            <Campo etiqueta="Nombre">
              <input name="nombre" required className={CLASE_CAMPO} />
            </Campo>
            <Campo etiqueta="Comunidad" ayuda="Obligatoria si es farmacia.">
              <select name="comunidadId" defaultValue="" className={CLASE_CAMPO}>
                <option value="">Sin comunidad</option>
                {comunidades.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Municipio">
              <input name="municipio" className={CLASE_CAMPO} />
            </Campo>
            <Campo etiqueta="Qué suministra">
              <input name="suministra" className={CLASE_CAMPO} />
            </Campo>
            <Campo etiqueta="Contacto">
              <input name="contacto" className={CLASE_CAMPO} />
            </Campo>
            <label className="flex items-center gap-2 self-end text-sm text-barro-800">
              <input type="checkbox" name="esFarmacia" className="size-4" />
              Es una farmacia
            </label>
            <div className="sm:col-span-4">
              <button type="submit" className={CLASE_BOTON}>
                Registrar proveedor
              </button>
            </div>
          </form>
        </section>
      )}

      {/* FR-44: pharmacy stock — the supply-side twin of Compra local, tracked item by item */}
      {PUEDEN_FONDO.includes(sesion.rolStaff) && (
        <section className="mt-8">
          <h2 className="flex items-center gap-2 font-semibold text-barro-900">
            <Store className="size-4" aria-hidden />
            Farmacias locales
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-barro-700">
            Medicina que ya está en la comunidad — más rápido y más barato que enviarla. Su
            existencia también aparece en Inventario y como opción antes de autorizar una compra
            local para una necesidad médica.
          </p>

          {proveedores.filter((p) => p.esFarmacia).length === 0 ? (
            <p className="mt-3 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-600">
              Todavía no hay ninguna farmacia registrada. Márquela como «Es una farmacia» arriba.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {proveedores
                .filter((p) => p.esFarmacia)
                .map((p) => {
                  const stock = existenciasFarmacias.filter((e) => e.proveedorId === p.id)
                  return (
                    <TarjetaFarmacia
                      key={p.id}
                      proveedorId={p.id}
                      nombre={p.nombre}
                      comunidadNombre={p.comunidadNombre}
                      stock={stock}
                      catalogo={catalogo}
                      onRegistrar={registrarStockFarmacia}
                    />
                  )
                })}
            </ul>
          )}
        </section>
      )}
    </main>
  )
}

const CLASE_CAMPO = 'mt-1 w-full rounded border border-barro-200 bg-white px-2 py-1.5 text-sm'
const CLASE_BOTON = 'rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700'

function TarjetaFondo({ f }: { f: Fondo }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${f.enAlerta ? 'border-atrato-300 bg-atrato-50' : 'border-barro-200 bg-white'}`}>
      <div className="flex items-baseline justify-between">
        <p className="font-medium text-barro-900">{f.nombre}</p>
        {f.enAlerta && <span className="text-xs font-medium text-atrato-700">en alerta</span>}
      </div>
      <p className="mt-1 text-sm text-barro-700">
        {`$${f.comprometidoCop.toLocaleString('es-CO')}`} de {`$${f.techoCop.toLocaleString('es-CO')}`} ·{' '}
        <span className="font-semibold text-selva-800">{`$${f.disponibleCop.toLocaleString('es-CO')}`} libre</span>
      </p>
    </div>
  )
}

function TarjetaCompra({
  c,
  onAvanzar,
  onEvidencia,
}: {
  c: CompraLocal
  onAvanzar: (fd: FormData) => void
  onEvidencia: (fd: FormData) => void
}) {
  const completados = pasosCompletados(c.estado as EstadoCompraLocal)
  const cancelada = c.estado === 'CANCELADA'
  return (
    <li className="rounded-lg border border-barro-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium text-barro-900">{c.concepto}</span>
        <span className="text-barro-500">{c.fondoNombre}</span>
        {c.responsableNombre && <span className="text-barro-500">· {c.responsableNombre}</span>}
        {c.comunidadNombre && <span className="text-barro-500">· {c.comunidadNombre}</span>}
        <span className="ml-auto text-barro-600">
          {`$${c.montoAutorizadoCop.toLocaleString('es-CO')}`}
          {c.montoRealCop !== null && ` · real $${c.montoRealCop.toLocaleString('es-CO')}`}
        </span>
      </div>

      {/* The six-step chain */}
      <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {CADENA_COMPRA_LOCAL.map((estado) => {
          const hecho = !cancelada && completados.includes(estado)
          return (
            <li key={estado} className={`flex items-center gap-1 ${hecho ? 'text-selva-700' : 'text-barro-400'}`}>
              {hecho ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Circle className="size-3.5" aria-hidden />}
              {PASO_COMPRA_LOCAL[estado]}
            </li>
          )
        })}
        {cancelada && <li className="text-rose-700">Cancelada</li>}
      </ol>

      {c.items.length > 0 && (
        <p className="mt-1 text-xs text-barro-600">
          {c.items.map((i) => `${i.cantidad}× ${i.codigoItem}`).join(' · ')}
        </p>
      )}
      {c.evidencias.length > 0 && (
        <p className="mt-1 flex items-center gap-1 text-xs text-barro-600">
          <PackageCheck className="size-3.5" aria-hidden />
          {c.evidencias.map((e) => e.tipo).join(', ')}
        </p>
      )}

      {!cancelada && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          {c.estado === 'AUTORIZADA' && (
            <form action={onAvanzar} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="paso" value="recibo" />
              <input name="reciboRef" placeholder="N° de recibo" className="w-40 rounded border border-barro-200 px-2 py-1 text-sm" />
              <input name="montoRealCop" inputMode="numeric" placeholder="Monto real" className="w-32 rounded border border-barro-200 px-2 py-1 text-sm" />
              <button type="submit" className={CLASE_BOTON}>
                Registrar recibo
              </button>
            </form>
          )}
          {c.estado === 'COMPRADA' && (
            <PasoBoton onAvanzar={onAvanzar} id={c.id} paso="verificar" texto="Verificar materiales" />
          )}
          {c.estado === 'VERIFICADA' && (
            <PasoBoton onAvanzar={onAvanzar} id={c.id} paso="distribuir" texto="Marcar distribución" />
          )}
          {c.estado === 'DISTRIBUIDA' && (
            <PasoBoton onAvanzar={onAvanzar} id={c.id} paso="cerrar" texto="Cerrar con evidencia" />
          )}

          {/* Evidence can be added at any live step (steps 3 and 6). */}
          <form action={onEvidencia} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={c.id} />
            <select name="tipo" defaultValue="foto" className="rounded border border-barro-200 px-2 py-1 text-sm">
              <option value="foto">Foto</option>
              <option value="documento">Documento</option>
              <option value="acta">Acta</option>
            </select>
            <input name="referencia" placeholder="Enlace o referencia" className="w-48 rounded border border-barro-200 px-2 py-1 text-sm" />
            <button type="submit" className="rounded border border-barro-300 px-3 py-1.5 text-sm font-medium text-barro-800 hover:bg-barro-50">
              Agregar evidencia
            </button>
          </form>
        </div>
      )}
    </li>
  )
}

function PasoBoton({
  onAvanzar,
  id,
  paso,
  texto,
}: {
  onAvanzar: (fd: FormData) => void
  id: string
  paso: string
  texto: string
}) {
  return (
    <form action={onAvanzar}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="paso" value={paso} />
      <button type="submit" className={CLASE_BOTON}>
        {texto}
      </button>
    </form>
  )
}

function TarjetaFarmacia({
  proveedorId,
  nombre,
  comunidadNombre,
  stock,
  catalogo,
  onRegistrar,
}: {
  proveedorId: string
  nombre: string
  comunidadNombre: string | null
  stock: ExistenciaProveedor[]
  catalogo: { codigo: string; item_label: string }[]
  onRegistrar: (fd: FormData) => void
}) {
  return (
    <li className="rounded-lg border border-barro-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium text-barro-900">{nombre}</span>
        {comunidadNombre && <span className="text-barro-500">{comunidadNombre}</span>}
      </div>

      {stock.length === 0 ? (
        <p className="mt-1 text-sm text-barro-500">Sin existencia registrada todavía.</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {stock.map((e) => (
            <li key={e.codigoItem} className="text-sm text-barro-700">
              {e.itemLabel} <span className="font-medium text-barro-900">· {e.cantidad}</span>
            </li>
          ))}
        </ul>
      )}

      <form action={onRegistrar} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="proveedorId" value={proveedorId} />
        <select name="codigoItem" defaultValue="" required className="rounded border border-barro-200 px-2 py-1 text-sm">
          <option value="" disabled>
            Ítem
          </option>
          {catalogo.map((c) => (
            <option key={c.codigo} value={c.codigo}>
              {c.codigo} · {c.item_label}
            </option>
          ))}
        </select>
        <input
          name="cantidad"
          inputMode="numeric"
          placeholder="Cantidad"
          className="w-24 rounded border border-barro-200 px-2 py-1 text-sm"
        />
        <button type="submit" className="rounded border border-barro-300 px-3 py-1.5 text-sm font-medium text-barro-800 hover:bg-barro-50">
          Registrar existencia
        </button>
      </form>
    </li>
  )
}

function Aviso({ tono, children }: { tono: 'error' | 'ok'; children: React.ReactNode }) {
  const clase =
    tono === 'error'
      ? 'border-rose-300 bg-rose-50 text-rose-900'
      : 'border-selva-300 bg-selva-50 text-selva-900'
  return (
    <p className={`mt-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${clase}`}>
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

function Campo({
  etiqueta,
  ayuda,
  children,
}: {
  etiqueta: string
  ayuda?: string
  children: React.ReactNode
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-barro-800">{etiqueta}</span>
      {children}
      {ayuda && <span className="mt-0.5 block text-xs text-barro-600">{ayuda}</span>}
    </label>
  )
}
