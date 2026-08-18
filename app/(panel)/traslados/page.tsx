import { BedDouble, Ship, Soup, TriangleAlert, UserRound, Users } from 'lucide-react'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  confirmarLlegada,
  confirmarRegreso,
  crearTraslado,
  despacharRegreso,
  despacharTraslado,
  listarTraslados,
  MOTIVOS_TRASLADO,
  type Traslado,
} from '@/lib/traslados'
import {
  esModoFluvial,
  lancherosDisponibles,
  type LancheroOpcion,
  marcarPagoLancheroPagado,
  type PagoLanchero,
  pagosDeTraslado,
  registrarPagoLanchero,
} from '@/lib/lanchero-pagos'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * PRD-8 «Traslado de personas» — moving a person, not only goods (§25).
 *
 * A partera out for surgery, a patient to a health post: demand is a person who needs to reach
 * care, capacity is a vehicle going that way with a free seat, and the match is the same one the
 * goods engine makes — reused, not forked (lib/traslados/emparejador.ts). This screen creates a
 * request, shows the seat the matcher proposes, lets a person dispatch it (2.1), confirms arrival
 * by a 4-digit code, and — when §25 applies — walks the RETURN leg the same way.
 *
 * A named person's travel is PII: this screen is coordinador/admin/despachador only, RLS (0048) is
 * the real boundary, and the public map never sees any of it.
 */

const PUEDEN_VER = ['coordinador', 'admin', 'despachador']

const MOTIVO_LABEL: Record<string, string> = {
  parto: 'Parto',
  cirugia: 'Cirugía',
  especialista: 'Especialista',
  urgencia: 'Urgencia',
  control: 'Control',
  acompanamiento: 'Acompañamiento',
  otro: 'Otro',
}

type Params = Promise<{ error?: string; ok?: string }>

export default async function Traslados({ searchParams }: { searchParams: Params }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { error, ok } = await searchParams

  if (!PUEDEN_VER.includes(sesion.rolStaff)) {
    return (
      <main>
        <h1 className="text-xl font-semibold text-barro-900">Traslado de personas</h1>
        <p className="mt-4 max-w-2xl text-barro-700">
          Mover a una persona a su atención carga datos suyos que no todos los roles ven, y eso es a
          propósito. Su rol no lo ve.
        </p>
      </main>
    )
  }

  const { traslados, comunidades, pagosPorTraslado, lancheroOpciones } = await conSesion(
    sesion,
    async (client) => {
      const traslados = await listarTraslados(client)
      const { rows: comunidades } = await client.query<{ id: string; nombre: string }>(
        `select id, nombre from comunidades where activa order by nombre`,
      )
      const conLancha = traslados.filter((t) => esModoFluvial(t.capacidadModo))
      const pagosPorTraslado: Record<string, PagoLanchero[]> = {}
      for (const t of conLancha) {
        pagosPorTraslado[t.id] = await pagosDeTraslado(client, t.id)
      }
      return {
        traslados,
        comunidades,
        pagosPorTraslado,
        lancheroOpciones: conLancha.length > 0 ? await lancherosDisponibles(client) : [],
      }
    },
  )

  async function registrarTraslado(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_VER.includes(sesion.rolStaff)) {
      redirect('/traslados?error=Solo+coordinación+registra+traslados')
    }

    const personaEtiqueta = String(formData.get('personaEtiqueta') ?? '').trim()
    const personas = Number(String(formData.get('personas') ?? '1').replace(/[^\d]/g, '')) || 0
    const motivoCategoria = String(formData.get('motivoCategoria') ?? 'otro')
    const origenComunidadId = String(formData.get('origenComunidadId') ?? '')
    const destinoComunidadId = String(formData.get('destinoComunidadId') ?? '')
    const ventanaDesde = new Date(String(formData.get('ventanaDesde') ?? ''))
    const ventanaHasta = new Date(String(formData.get('ventanaHasta') ?? ''))
    const requiereRegreso = formData.get('requiereRegreso') === 'on'
    const regresoDesdeRaw = String(formData.get('regresoVentanaDesde') ?? '')
    const regresoHastaRaw = String(formData.get('regresoVentanaHasta') ?? '')

    if (!personaEtiqueta) redirect('/traslados?error=Falta+la+etiqueta+de+la+persona')
    if (personas <= 0) redirect('/traslados?error=El+número+de+personas+debe+ser+mayor+que+cero')
    if (!origenComunidadId || !destinoComunidadId) {
      redirect('/traslados?error=Elija+origen+y+destino')
    }
    if (origenComunidadId === destinoComunidadId) {
      redirect('/traslados?error=Origen+y+destino+no+pueden+ser+el+mismo+lugar')
    }
    if (Number.isNaN(ventanaDesde.getTime()) || Number.isNaN(ventanaHasta.getTime())) {
      redirect('/traslados?error=Falta+la+ventana+de+viaje')
    }
    if (ventanaHasta < ventanaDesde) {
      redirect('/traslados?error=La+ventana+termina+antes+de+empezar')
    }
    const regresoVentanaDesde = requiereRegreso && regresoDesdeRaw ? new Date(regresoDesdeRaw) : null
    const regresoVentanaHasta = requiereRegreso && regresoHastaRaw ? new Date(regresoHastaRaw) : null
    if (requiereRegreso && (!regresoVentanaDesde || !regresoVentanaHasta)) {
      redirect('/traslados?error=Un+regreso+necesita+su+propia+ventana')
    }

    try {
      await conSesion(
        sesion,
        (client) =>
          crearTraslado(
            client,
            {
              organizacionId: sesion.organizacionId,
              personaEtiqueta,
              personaNombre: String(formData.get('personaNombre') ?? '').trim() || null,
              personaTelefono: String(formData.get('personaTelefono') ?? '').trim() || null,
              personas,
              motivoCategoria: motivoCategoria as (typeof MOTIVOS_TRASLADO)[number],
              motivoDetalle: String(formData.get('motivoDetalle') ?? '').trim() || null,
              necesidadAccesibilidad: String(formData.get('necesidadAccesibilidad') ?? '').trim() || null,
              origenComunidadId,
              destinoComunidadId,
              ventanaDesde,
              ventanaHasta,
              requiereAlojamiento: formData.get('requiereAlojamiento') === 'on',
              requiereAlimentacion: formData.get('requiereAlimentacion') === 'on',
              requiereAcompanamiento: formData.get('requiereAcompanamiento') === 'on',
              requiereRegreso,
              regresoVentanaDesde,
              regresoVentanaHasta,
              notas: String(formData.get('notas') ?? '').trim() || null,
            },
            sesion.authId,
          ),
        { escribe: true },
      )
    } catch {
      redirect('/traslados?error=No+se+pudo+registrar+el+traslado')
    }

    revalidatePath('/traslados')
    redirect('/traslados?ok=Traslado+registrado')
  }

  async function accionDespachar(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_VER.includes(sesion.rolStaff)) redirect('/traslados?error=Sin+permiso')
    const id = String(formData.get('id') ?? '')
    const capacidadId = String(formData.get('capacidadId') ?? '') || null
    if (!id) redirect('/traslados?error=Falta+el+traslado')
    await conSesion(sesion, (client) => despacharTraslado(client, id, capacidadId, sesion.authId), {
      escribe: true,
    })
    revalidatePath('/traslados')
    redirect('/traslados?ok=Traslado+despachado.+Confirme+la+llegada+con+el+código')
  }

  async function accionConfirmarLlegada(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_VER.includes(sesion.rolStaff)) redirect('/traslados?error=Sin+permiso')
    const id = String(formData.get('id') ?? '')
    const codigo = String(formData.get('codigo') ?? '').trim()
    const ok = await conSesion(
      sesion,
      (client) => confirmarLlegada(client, id, codigo, 'web'),
      { escribe: true },
    )
    revalidatePath('/traslados')
    redirect(ok ? '/traslados?ok=Llegada+confirmada' : '/traslados?error=El+código+no+coincide')
  }

  async function accionDespacharRegreso(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_VER.includes(sesion.rolStaff)) redirect('/traslados?error=Sin+permiso')
    const id = String(formData.get('id') ?? '')
    await conSesion(sesion, (client) => despacharRegreso(client, id, null, sesion.authId), {
      escribe: true,
    })
    revalidatePath('/traslados')
    redirect('/traslados?ok=Regreso+despachado')
  }

  async function accionConfirmarRegreso(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_VER.includes(sesion.rolStaff)) redirect('/traslados?error=Sin+permiso')
    const id = String(formData.get('id') ?? '')
    const codigo = String(formData.get('codigo') ?? '').trim()
    const ok = await conSesion(sesion, (client) => confirmarRegreso(client, id, codigo), {
      escribe: true,
    })
    revalidatePath('/traslados')
    redirect(ok ? '/traslados?ok=Regreso+confirmado' : '/traslados?error=El+código+no+coincide')
  }

  async function accionRegistrarPago(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_VER.includes(sesion.rolStaff)) redirect('/traslados?error=Sin+permiso')
    const trasladoPersonaId = String(formData.get('trasladoPersonaId') ?? '')
    const costoRaw = String(formData.get('costoTotalCop') ?? '').trim()

    const resultado = await conSesion(
      sesion,
      (client) =>
        registrarPagoLanchero(
          client,
          {
            organizacionId: sesion.organizacionId,
            trasladoPersonaId,
            lancheroContactoId: String(formData.get('lancheroContactoId') ?? ''),
            costoTotalCop: costoRaw ? Number(costoRaw) : null,
            montoLancheroCop: Number(formData.get('montoLancheroCop')),
            notas: String(formData.get('notas') ?? '').trim() || null,
          },
          sesion.authId,
        ),
      { escribe: true },
    )
    if (!resultado.ok) redirect(`/traslados?error=${encodeURIComponent(resultado.error)}`)
    revalidatePath('/traslados')
    redirect('/traslados?ok=Costo+y+pago+registrados')
  }

  async function accionMarcarPagado(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_VER.includes(sesion.rolStaff)) redirect('/traslados?error=Sin+permiso')
    const pagoId = String(formData.get('pagoId') ?? '')
    await conSesion(sesion, (client) => marcarPagoLancheroPagado(client, pagoId, sesion.authId), {
      escribe: true,
    })
    revalidatePath('/traslados')
    redirect('/traslados?ok=Pago+marcado')
  }

  const pendientes = traslados.filter((t) => !['REGRESADO', 'CERRADO', 'CANCELADO'].includes(t.estado))

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-barro-900">Traslado de personas</h1>
        <p className="text-sm text-barro-600">
          {pendientes.length} {pendientes.length === 1 ? 'en curso' : 'en curso'}
        </p>
      </div>

      <p className="mt-2 max-w-3xl text-sm text-barro-700">
        Una persona que necesita salir a su atención es una demanda; una lancha, un carro o una
        avioneta que va para allá con cupo es la capacidad. Es el mismo emparejamiento de los
        insumos, por cupo y por ventana de tiempo. Incluye alojamiento, comida, acompañamiento y el
        regreso.
      </p>

      {error && <Aviso tono="error">{error}</Aviso>}
      {ok && <Aviso tono="ok">{ok}</Aviso>}

      <section className="mt-6">
        <h2 className="flex items-center gap-2 font-semibold text-barro-900">
          <UserRound className="size-4" aria-hidden />
          Registrar un traslado
        </h2>
        <form
          action={registrarTraslado}
          className="mt-3 grid gap-3 rounded-lg border border-barro-200 bg-white p-4 sm:grid-cols-2"
        >
          <Campo etiqueta="Etiqueta de la persona" ayuda="Sin nombres exactos si no hace falta. Ej: «Partera del Atrato medio».">
            <input name="personaEtiqueta" required className={CLASE_CAMPO} placeholder="Partera del Atrato medio" />
          </Campo>
          <Campo etiqueta="Nombre (opcional)" ayuda="Dato reservado: solo lo ve coordinación.">
            <input name="personaNombre" className={CLASE_CAMPO} />
          </Campo>
          <Campo etiqueta="Personas (con acompañantes)">
            <input name="personas" inputMode="numeric" defaultValue="1" required className={CLASE_CAMPO} />
          </Campo>
          <Campo etiqueta="Motivo">
            <select name="motivoCategoria" defaultValue="cirugia" className={CLASE_CAMPO}>
              {MOTIVOS_TRASLADO.map((m) => (
                <option key={m} value={m}>
                  {MOTIVO_LABEL[m] ?? m}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Origen">
            <select name="origenComunidadId" defaultValue="" required className={CLASE_CAMPO}>
              <option value="" disabled>
                Elija origen
              </option>
              {comunidades.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Destino">
            <select name="destinoComunidadId" defaultValue="" required className={CLASE_CAMPO}>
              <option value="" disabled>
                Elija destino
              </option>
              {comunidades.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Puede salir desde">
            <input name="ventanaDesde" type="datetime-local" required className={CLASE_CAMPO} />
          </Campo>
          <Campo etiqueta="A más tardar">
            <input name="ventanaHasta" type="datetime-local" required className={CLASE_CAMPO} />
          </Campo>
          <Campo etiqueta="Necesidad de accesibilidad (opcional)">
            <input name="necesidadAccesibilidad" className={CLASE_CAMPO} />
          </Campo>
          <Campo etiqueta="Detalle (opcional)" ayuda="Reservado, solo coordinación.">
            <input name="motivoDetalle" className={CLASE_CAMPO} />
          </Campo>

          <fieldset className="sm:col-span-2 grid gap-2 rounded border border-barro-200 p-3 sm:grid-cols-2">
            <legend className="px-1 text-xs uppercase tracking-wide text-barro-500">Lo que necesita el viaje (§25)</legend>
            <Check name="requiereAlojamiento" etiqueta="Alojamiento" />
            <Check name="requiereAlimentacion" etiqueta="Alimentación" />
            <Check name="requiereAcompanamiento" etiqueta="Acompañamiento" />
            <Check name="requiereRegreso" etiqueta="Regreso (viaje de vuelta)" />
          </fieldset>

          <Campo etiqueta="Regreso: puede salir desde (si aplica)">
            <input name="regresoVentanaDesde" type="datetime-local" className={CLASE_CAMPO} />
          </Campo>
          <Campo etiqueta="Regreso: a más tardar (si aplica)">
            <input name="regresoVentanaHasta" type="datetime-local" className={CLASE_CAMPO} />
          </Campo>

          <div className="sm:col-span-2">
            <button type="submit" className={CLASE_BOTON}>
              Registrar y emparejar
            </button>
          </div>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold text-barro-900">
          Traslados
          <span className="ml-2 font-normal text-barro-600">{traslados.length}</span>
        </h2>

        {traslados.length === 0 ? (
          <p className="mt-3 rounded-lg border border-barro-200 bg-white px-4 py-3 text-barro-700">
            Todavía no hay traslados registrados.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {traslados.map((t) => (
              <Tarjeta
                key={t.id}
                t={t}
                onDespachar={accionDespachar}
                onConfirmarLlegada={accionConfirmarLlegada}
                onDespacharRegreso={accionDespacharRegreso}
                onConfirmarRegreso={accionConfirmarRegreso}
                pagos={pagosPorTraslado[t.id] ?? []}
                lancheroOpciones={lancheroOpciones}
                onRegistrarPago={accionRegistrarPago}
                onMarcarPagado={accionMarcarPagado}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

const CLASE_CAMPO = 'mt-1 w-full rounded border border-barro-200 bg-white px-2 py-1.5 text-sm'
const CLASE_BOTON = 'rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700'

function fecha(d: Date | null): string {
  return d ? d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '—'
}

function Tarjeta({
  t,
  onDespachar,
  onConfirmarLlegada,
  onDespacharRegreso,
  onConfirmarRegreso,
  pagos,
  lancheroOpciones,
  onRegistrarPago,
  onMarcarPagado,
}: {
  t: Traslado
  onDespachar: (fd: FormData) => void
  onConfirmarLlegada: (fd: FormData) => void
  onDespacharRegreso: (fd: FormData) => void
  onConfirmarRegreso: (fd: FormData) => void
  pagos: PagoLanchero[]
  lancheroOpciones: LancheroOpcion[]
  onRegistrarPago: (fd: FormData) => void
  onMarcarPagado: (fd: FormData) => void
}) {
  const preDespacho = ['SOLICITADO', 'SIN_RUTA', 'SIN_CAPACIDAD', 'LISTO'].includes(t.estado)
  const enViaje = ['DESPACHADO', 'EN_CAMINO'].includes(t.estado)
  return (
    <li className="rounded-lg border border-barro-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium text-barro-900">{t.personaEtiqueta}</span>
        <span className="flex items-center gap-1 text-barro-600">
          <Users className="size-3.5" aria-hidden />
          {t.personas}
        </span>
        <EstadoPill estado={t.estado} />
        <span className="text-barro-500">
          {t.origenNombre ?? '—'} → {t.destinoNombre ?? '—'}
        </span>
        <span className="ml-auto text-barro-500">
          {fecha(t.ventanaDesde)}–{fecha(t.ventanaHasta)}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-barro-600">
        <span>{t.motivoCategoria}</span>
        {t.requiereAlojamiento && <Badge icon={<BedDouble className="size-3" />}>alojamiento</Badge>}
        {t.requiereAlimentacion && <Badge icon={<Soup className="size-3" />}>comida</Badge>}
        {t.requiereAcompanamiento && <Badge>acompañamiento</Badge>}
        {t.requiereRegreso && (
          <Badge>regreso {fecha(t.regresoVentanaDesde)}–{fecha(t.regresoVentanaHasta)}</Badge>
        )}
      </div>

      {t.motivo && <p className="mt-1 text-sm text-barro-700">{t.motivo}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {preDespacho && (
          <form action={onDespachar}>
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="capacidadId" value={t.capacidadId ?? ''} />
            <button type="submit" className={CLASE_BOTON}>
              Despachar
            </button>
          </form>
        )}

        {enViaje && (
          <>
            {t.codigoLlegada && (
              <span className="text-xs text-barro-600">
                Código de llegada: <span className="font-mono font-semibold">{t.codigoLlegada}</span>
              </span>
            )}
            <form action={onConfirmarLlegada} className="flex items-center gap-2">
              <input type="hidden" name="id" value={t.id} />
              <input name="codigo" inputMode="numeric" placeholder="4 dígitos" className="w-28 rounded border border-barro-200 px-2 py-1 text-sm" />
              <button type="submit" className={CLASE_BOTON}>
                Confirmar llegada
              </button>
            </form>
          </>
        )}

        {t.estado === 'LLEGO' && t.requiereRegreso && (
          <form action={onDespacharRegreso}>
            <input type="hidden" name="id" value={t.id} />
            <button type="submit" className={CLASE_BOTON}>
              Despachar regreso
            </button>
          </form>
        )}
        {t.estado === 'LLEGO' && !t.requiereRegreso && (
          <span className="text-xs text-selva-700">Llegó. Sin regreso pedido.</span>
        )}

        {t.estado === 'REGRESO_DESPACHADO' && (
          <>
            {t.codigoRegreso && (
              <span className="text-xs text-barro-600">
                Código de regreso: <span className="font-mono font-semibold">{t.codigoRegreso}</span>
              </span>
            )}
            <form action={onConfirmarRegreso} className="flex items-center gap-2">
              <input type="hidden" name="id" value={t.id} />
              <input name="codigo" inputMode="numeric" placeholder="4 dígitos" className="w-28 rounded border border-barro-200 px-2 py-1 text-sm" />
              <button type="submit" className={CLASE_BOTON}>
                Confirmar regreso
              </button>
            </form>
          </>
        )}

        {t.estado === 'REGRESADO' && <span className="text-xs text-selva-700">De vuelta en casa.</span>}
      </div>

      {esModoFluvial(t.capacidadModo) && (
        <div className="mt-3 rounded border border-barro-200 bg-barro-50 px-3 py-2">
          <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-barro-600">
            <Ship className="size-3.5" aria-hidden />
            Costo y pago del lanchero
          </p>

          {pagos.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {pagos.map((p) => (
                <li key={p.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-medium text-barro-900">{p.lancheroNombre ?? p.lancheroTelefono}</span>
                  <span className="text-barro-700">{p.montoLancheroCop.toLocaleString('es-CO')} COP</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                      p.estadoPago === 'pagado' ? 'bg-selva-50 text-selva-700' : 'bg-atrato-50 text-atrato-700'
                    }`}
                  >
                    {p.estadoPago}
                  </span>
                  {p.estadoPago === 'pendiente' && (
                    <form action={onMarcarPagado} className="ml-auto">
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

          <form action={onRegistrarPago} className="mt-2 flex flex-wrap items-end gap-2">
            <input type="hidden" name="trasladoPersonaId" value={t.id} />
            <label className="text-xs">
              <span className="block text-barro-600">Lanchero</span>
              <select
                name="lancheroContactoId"
                required
                className="mt-0.5 rounded border border-barro-300 px-2 py-1 text-sm"
              >
                <option value="">…</option>
                {lancheroOpciones.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nombre} · {l.telefono}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="block text-barro-600">Monto lanchero (COP)</span>
              <input
                name="montoLancheroCop"
                type="number"
                min={1}
                required
                inputMode="numeric"
                className="mt-0.5 w-28 rounded border border-barro-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              <span className="block text-barro-600">Costo total (opcional)</span>
              <input
                name="costoTotalCop"
                type="number"
                min={0}
                inputMode="numeric"
                className="mt-0.5 w-28 rounded border border-barro-300 px-2 py-1 text-sm"
              />
            </label>
            <button type="submit" className={CLASE_BOTON}>
              Registrar
            </button>
          </form>
        </div>
      )}
    </li>
  )
}

function EstadoPill({ estado }: { estado: string }) {
  const tono = estado.startsWith('SIN_')
    ? 'bg-barro-100 text-atrato-700'
    : estado === 'CANCELADO'
      ? 'bg-rose-50 text-rose-700'
      : estado === 'LISTO' || estado === 'LLEGO' || estado === 'REGRESADO'
        ? 'bg-selva-50 text-selva-700'
        : 'bg-barro-100 text-barro-700'
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${tono}`}>{estado}</span>
}

function Badge({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1 rounded bg-barro-100 px-1.5 py-0.5 text-barro-700">
      {icon}
      {children}
    </span>
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

function Check({ name, etiqueta }: { name: string; etiqueta: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-barro-800">
      <input type="checkbox" name={name} />
      {etiqueta}
    </label>
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
