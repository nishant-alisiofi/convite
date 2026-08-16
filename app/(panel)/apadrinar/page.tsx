import { HandCoins, HeartHandshake, ShieldCheck, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  aplicarFondos,
  asignacionesDe,
  crearApadrinamiento,
  listarApadrinamientos,
  RECURRENCIAS_APADRINAMIENTO,
  resumenPool,
  TIPOS_PADRINO,
  type AsignacionApadrinamiento,
} from '@/lib/apadrinamiento'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * PRD-12 «Apadrina una partera» — the funding side of the marketplace.
 *
 * A padrino earmarks money to one beneficiary (a partera, her community, or a shared pool), and
 * this screen shows the whole chain: what was committed, how much of it has been applied to real
 * pedidos, and what is left for a funded purchase to spend. Recording and applying are
 * coordination work, so the screen is for coordinador/admin; RLS (0041) is the real boundary and
 * this gate merely spares everyone else a screen they could not use.
 *
 * Privacy (Ley 1581): a sponsor is only ever represented by `beneficiario_etiqueta`, and a
 * sponsorship tied to a *named* community cannot be recorded as active without consent — the
 * database refuses it (apadrinamientos_consentida_check), and the form surfaces that plainly.
 */

const PUEDEN_APADRINAR = ['coordinador', 'admin']

const pesos = (n: number) => `$${n.toLocaleString('es-CO')}`

type Params = Promise<{ ver?: string; error?: string }>

export default async function Apadrinar({ searchParams }: { searchParams: Params }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { ver, error } = await searchParams

  if (!PUEDEN_APADRINAR.includes(sesion.rolStaff)) {
    return (
      <main>
        <h1 className="text-xl font-semibold text-barro-900">Apadrinamientos</h1>
        <p className="mt-4 max-w-2xl text-barro-700">
          Registrar quién apadrina a una partera y a qué se destina ese dinero es trabajo de
          coordinación. Su rol no lo ve, y eso es a propósito: junta nombres de donantes con
          comunidades.
        </p>
      </main>
    )
  }

  const { sponsorships, comunidades, pedidosAbiertos, detalle } = await conSesion(
    sesion,
    async (client) => {
      const sponsorships = await listarApadrinamientos(client)

      const { rows: comunidades } = await client.query<{ id: string; nombre: string }>(
        `select id, nombre from comunidades where activa order by nombre`,
      )

      const { rows: pedidosAbiertos } = await client.query<{
        id: string
        codigo_item: string
        familias: number
        comunidad: string
      }>(
        `select p.id, p.codigo_item, p.familias, c.nombre as comunidad
           from pedidos p
           join comunidades c on c.id = p.comunidad_id
          where p.estado in ('ABIERTO', 'SIN_RUTA', 'SIN_EXISTENCIA', 'SIN_CAPACIDAD', 'LISTO')
          order by p.creado_en desc
          limit 100`,
      )

      const elegido = ver ? sponsorships.find((s) => s.id === ver) : undefined
      const detalle = elegido
        ? { sponsorship: elegido, asignaciones: await asignacionesDe(client, elegido.id) }
        : null

      return { sponsorships, comunidades, pedidosAbiertos, detalle }
    },
  )

  const pool = resumenPool(sponsorships)

  async function registrarApadrinamiento(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_APADRINAR.includes(sesion.rolStaff)) {
      redirect('/apadrinar?error=Solo+coordinación+registra+apadrinamientos')
    }

    const beneficiarioEtiqueta = String(formData.get('beneficiarioEtiqueta') ?? '').trim()
    const padrinoNombre = String(formData.get('padrinoNombre') ?? '').trim()
    const proposito = String(formData.get('proposito') ?? '').trim()
    const montoCop = Number(String(formData.get('montoCop') ?? '').replace(/[^\d]/g, ''))
    const comunidadId = String(formData.get('comunidadId') ?? '') || null
    const padrinoTipo = String(formData.get('padrinoTipo') ?? 'individuo')
    const recurrencia = String(formData.get('recurrencia') ?? 'unico')
    const consentimiento = formData.get('consentimiento') === 'on'

    if (!beneficiarioEtiqueta || !padrinoNombre || !proposito) {
      redirect('/apadrinar?error=Falta+la+etiqueta,+el+padrino+o+el+propósito')
    }
    if (!Number.isFinite(montoCop) || montoCop <= 0) {
      redirect('/apadrinar?error=El+monto+debe+ser+un+número+mayor+que+cero')
    }
    if (!TIPOS_PADRINO.includes(padrinoTipo as (typeof TIPOS_PADRINO)[number])) {
      redirect('/apadrinar?error=Tipo+de+padrino+desconocido')
    }
    if (
      !RECURRENCIAS_APADRINAMIENTO.includes(
        recurrencia as (typeof RECURRENCIAS_APADRINAMIENTO)[number],
      )
    ) {
      redirect('/apadrinar?error=Recurrencia+desconocida')
    }
    // The privacy invariant, caught before the write for a legible message. The database
    // enforces it too (apadrinamientos_consentida_check) — this is the courtesy, not the guard.
    if (comunidadId && !consentimiento) {
      redirect(
        '/apadrinar?error=Una+partera+con+nombre+necesita+su+consentimiento+antes+de+mostrarse',
      )
    }

    try {
      await conSesion(
        sesion,
        (client) =>
          crearApadrinamiento(
            client,
            {
              organizacionId: sesion.organizacionId,
              comunidadId,
              beneficiarioEtiqueta,
              padrinoNombre,
              padrinoContacto: String(formData.get('padrinoContacto') ?? '').trim() || null,
              padrinoTipo: padrinoTipo as (typeof TIPOS_PADRINO)[number],
              proposito,
              montoCop,
              recurrencia: recurrencia as (typeof RECURRENCIAS_APADRINAMIENTO)[number],
              consentimientoBeneficiario: consentimiento,
              notas: String(formData.get('notas') ?? '').trim() || null,
            },
            sesion.authId,
          ),
        { escribe: true },
      )
    } catch {
      redirect('/apadrinar?error=No+se+pudo+registrar+el+apadrinamiento')
    }

    revalidatePath('/apadrinar')
    redirect('/apadrinar')
  }

  async function registrarAsignacion(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_APADRINAR.includes(sesion.rolStaff)) {
      redirect('/apadrinar?error=Solo+coordinación+aplica+fondos')
    }

    const apadrinamientoId = String(formData.get('apadrinamientoId') ?? '')
    const pedidoId = String(formData.get('pedidoId') ?? '') || null
    const montoAplicadoCop = Number(String(formData.get('montoAplicadoCop') ?? '').replace(/[^\d]/g, ''))
    const concepto = String(formData.get('concepto') ?? '').trim() || null

    if (!apadrinamientoId) redirect('/apadrinar?error=Falta+el+apadrinamiento')
    if (!pedidoId) {
      redirect(`/apadrinar?ver=${apadrinamientoId}&error=Elija+el+pedido+que+financia`)
    }
    if (!Number.isFinite(montoAplicadoCop) || montoAplicadoCop <= 0) {
      redirect(`/apadrinar?ver=${apadrinamientoId}&error=El+monto+debe+ser+mayor+que+cero`)
    }

    try {
      await conSesion(
        sesion,
        (client) =>
          aplicarFondos(
            client,
            { apadrinamientoId, pedidoId, montoAplicadoCop, concepto },
            sesion.authId,
          ),
        { escribe: true },
      )
    } catch {
      redirect(`/apadrinar?ver=${apadrinamientoId}&error=No+se+pudo+aplicar+el+fondo`)
    }

    revalidatePath('/apadrinar')
    redirect(`/apadrinar?ver=${apadrinamientoId}`)
  }

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-barro-900">Apadrinamientos</h1>
        <p className="text-sm text-barro-600">
          {pool.activos} {pool.activos === 1 ? 'activo' : 'activos'}
        </p>
      </div>

      <p className="mt-2 max-w-3xl text-sm text-barro-700">
        Quién apadrina a una partera o a un fondo común, cuánto comprometió y en qué se ha usado.
        Al padrino se le muestra una etiqueta, nunca el nombre, el teléfono ni la ubicación de la
        partera. Una partera con nombre solo aparece si ya dio su consentimiento.
      </p>

      {error && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      )}

      {/* AC #3 / #4: the pool PRD-9 draws on, and the aggregate impact a sponsor is shown. */}
      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <Tarjeta etiqueta="Comprometido" valor={pesos(pool.comprometidoCop)} />
        <Tarjeta etiqueta="Aplicado" valor={pesos(pool.aplicadoCop)} />
        <Tarjeta etiqueta="Disponible para compras" valor={pesos(pool.disponibleCop)} destacado />
      </section>

      <section className="mt-8">
        <h2 className="flex items-center gap-2 font-semibold text-barro-900">
          <HeartHandshake className="size-4" aria-hidden />
          Registrar un apadrinamiento
        </h2>
        <form
          action={registrarApadrinamiento}
          className="mt-3 grid gap-3 rounded-lg border border-barro-200 bg-white p-4 sm:grid-cols-2"
        >
          <Campo etiqueta="Etiqueta del beneficiario" ayuda="Lo que ve el padrino. Sin nombres ni lugares exactos.">
            <input name="beneficiarioEtiqueta" required className={CLASE_CAMPO} placeholder="Partera del Atrato medio" />
          </Campo>

          <Campo etiqueta="Comunidad (opcional)" ayuda="Vacío = fondo común, sin una partera con nombre.">
            <select name="comunidadId" defaultValue="" className={CLASE_CAMPO}>
              <option value="">Fondo común</option>
              {comunidades.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </Campo>

          <Campo etiqueta="Padrino">
            <input name="padrinoNombre" required className={CLASE_CAMPO} />
          </Campo>

          <Campo etiqueta="Contacto del padrino (opcional)">
            <input name="padrinoContacto" className={CLASE_CAMPO} placeholder="correo o teléfono" />
          </Campo>

          <Campo etiqueta="Tipo de padrino">
            <select name="padrinoTipo" defaultValue="individuo" className={CLASE_CAMPO}>
              {TIPOS_PADRINO.map((t) => (
                <option key={t} value={t}>
                  {t === 'individuo' ? 'Individuo' : 'Organización'}
                </option>
              ))}
            </select>
          </Campo>

          <Campo etiqueta="Recurrencia">
            <select name="recurrencia" defaultValue="unico" className={CLASE_CAMPO}>
              {RECURRENCIAS_APADRINAMIENTO.map((r) => (
                <option key={r} value={r}>
                  {r === 'unico' ? 'Único' : 'Mensual'}
                </option>
              ))}
            </select>
          </Campo>

          <Campo etiqueta="Propósito" ayuda="A qué se destina.">
            <input name="proposito" required className={CLASE_CAMPO} placeholder="insumos de partería" />
          </Campo>

          <Campo etiqueta="Monto (COP)">
            <input name="montoCop" inputMode="numeric" required className={CLASE_CAMPO} />
          </Campo>

          <Campo etiqueta="Notas (opcional)">
            <input name="notas" className={CLASE_CAMPO} />
          </Campo>

          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="consentimiento" className="mt-0.5" />
            <span className="text-barro-800">
              La partera dio su consentimiento para aparecer ante un padrino (obligatorio si eligió
              una comunidad con nombre).
            </span>
          </label>

          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
            >
              Registrar
            </button>
          </div>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold text-barro-900">
          Apadrinamientos
          <span className="ml-2 font-normal text-barro-600">{sponsorships.length}</span>
        </h2>

        {sponsorships.length === 0 ? (
          <p className="mt-3 rounded-lg border border-barro-200 bg-white px-4 py-3 text-barro-700">
            Todavía no hay apadrinamientos registrados.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
            {sponsorships.map((s) => (
              <li key={s.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <Link
                    href={`/apadrinar?ver=${s.id}`}
                    className={`font-medium underline-offset-2 hover:underline ${
                      s.id === ver ? 'text-selva-700' : 'text-barro-900'
                    }`}
                  >
                    {s.beneficiarioEtiqueta}
                  </Link>
                  {s.comunidadNombre && <span className="text-barro-500">{s.comunidadNombre}</span>}
                  <EstadoPill estado={s.estado} />
                  {s.consentimientoBeneficiario ? (
                    <span className="flex items-center gap-1 text-xs text-selva-700">
                      <ShieldCheck className="size-3" aria-hidden />
                      con consentimiento
                    </span>
                  ) : (
                    s.comunidadId && (
                      <span className="text-xs text-atrato-700">sin consentimiento</span>
                    )
                  )}
                  <span className="ml-auto text-barro-600">
                    {pesos(s.aplicadoCop)} de {pesos(s.montoCop)} · {pesos(s.disponibleCop)} libre
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-barro-700">
                  {s.padrinoNombre} · {s.proposito} · {s.recurrencia === 'mensual' ? 'mensual' : 'único'}
                  {s.aplicaciones > 0 && ` · ${s.aplicaciones} ${s.aplicaciones === 1 ? 'aplicación' : 'aplicaciones'}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detalle && (
        <section className="mt-8">
          <h2 className="flex items-center gap-2 font-semibold text-barro-900">
            <HandCoins className="size-4" aria-hidden />
            En qué se usó: {detalle.sponsorship.beneficiarioEtiqueta}
          </h2>

          <Trace asignaciones={detalle.asignaciones} />

          {detalle.sponsorship.disponibleCop > 0 && detalle.sponsorship.estado === 'activo' ? (
            <form
              action={registrarAsignacion}
              className="mt-4 grid gap-3 rounded-lg border border-barro-200 bg-white p-4 sm:grid-cols-2"
            >
              <input type="hidden" name="apadrinamientoId" value={detalle.sponsorship.id} />

              <Campo etiqueta="Pedido que financia">
                <select name="pedidoId" defaultValue="" required className={CLASE_CAMPO}>
                  <option value="" disabled>
                    Elija un pedido abierto
                  </option>
                  {pedidosAbiertos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.comunidad} · {p.codigo_item} · {p.familias} fam.
                    </option>
                  ))}
                </select>
              </Campo>

              <Campo etiqueta="Monto a aplicar (COP)" ayuda={`Disponible: ${pesos(detalle.sponsorship.disponibleCop)}`}>
                <input name="montoAplicadoCop" inputMode="numeric" required className={CLASE_CAMPO} />
              </Campo>

              <Campo etiqueta="Concepto (opcional)">
                <input name="concepto" className={CLASE_CAMPO} />
              </Campo>

              <div className="flex items-end">
                <button
                  type="submit"
                  className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
                >
                  Aplicar fondo
                </button>
              </div>
            </form>
          ) : (
            <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-600">
              {detalle.sponsorship.estado === 'activo'
                ? 'Todo el monto comprometido ya está aplicado.'
                : 'Este apadrinamiento no está activo, así que no admite nuevas aplicaciones.'}
            </p>
          )}
        </section>
      )}
    </main>
  )
}

const CLASE_CAMPO = 'mt-1 w-full rounded border border-barro-200 bg-white px-2 py-1.5 text-sm'

function Tarjeta({ etiqueta, valor, destacado }: { etiqueta: string; valor: string; destacado?: boolean }) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        destacado ? 'border-selva-200 bg-selva-50' : 'border-barro-200 bg-white'
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-barro-500">{etiqueta}</p>
      <p className={`mt-1 text-lg font-semibold ${destacado ? 'text-selva-800' : 'text-barro-900'}`}>
        {valor}
      </p>
    </div>
  )
}

function EstadoPill({ estado }: { estado: string }) {
  const tono =
    estado === 'activo'
      ? 'bg-selva-50 text-selva-700'
      : estado === 'cancelado'
        ? 'bg-rose-50 text-rose-700'
        : 'bg-barro-100 text-barro-700'
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${tono}`}>{estado}</span>
}

function Trace({ asignaciones }: { asignaciones: AsignacionApadrinamiento[] }) {
  if (asignaciones.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-600">
        Este apadrinamiento todavía no ha financiado ningún pedido.
      </p>
    )
  }
  return (
    <ol className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
      {asignaciones.map((a) => (
        <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 px-4 py-3 text-sm">
          <span className="font-medium text-barro-900">${a.montoAplicadoCop.toLocaleString('es-CO')}</span>
          {a.comunidadPedido && <span className="text-barro-700">{a.comunidadPedido}</span>}
          {a.codigoItem && <span className="text-barro-600">{a.codigoItem}</span>}
          {a.familias !== null && <span className="text-barro-600">{a.familias} fam.</span>}
          {a.entregaId && (
            <span className="text-xs text-selva-700">
              {a.entregaConfirmada ? 'entregado' : 'en entrega'}
            </span>
          )}
          {a.concepto && <span className="text-barro-500">«{a.concepto}»</span>}
          <span className="ml-auto text-barro-500">
            {a.creadoEn.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
          </span>
        </li>
      ))}
    </ol>
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
