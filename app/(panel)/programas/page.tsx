import {
  CalendarRange,
  Coins,
  HandCoins,
  MapPinned,
  Plus,
  ShieldCheck,
  TriangleAlert,
  UsersRound,
} from 'lucide-react'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { CadenciaPrograma, EstadoPrograma } from '@/db/schema/programas'
import { ETIQUETA_TIPO_JORNADA } from '@/lib/jornadas'
import type { TipoJornada } from '@/db/schema/vocabulario'
import { fechaCorta, fechaSoloDia } from '@/lib/fechas'
import { listarJornadas } from '@/lib/jornadas'
import {
  actualizarApadrinamiento,
  actualizarPrograma,
  agregarComunidad,
  agregarParticipante,
  apadrinamientosDe,
  aplicacionesDe,
  aplicarFondos,
  CADENCIAS_PROGRAMA,
  comunidadesDe,
  crearApadrinamiento,
  crearPrograma,
  ESTADOS_PROGRAMA,
  ETIQUETA_CADENCIA,
  ETIQUETA_ESTADO_PROGRAMA,
  type Feasibilidad,
  feasibilidadDePrograma,
  listarProgramas,
  marcarCompletado,
  MESES_ES,
  participantesDe,
  PROGRAMA_ROLES,
  programaPorId,
  quitarComunidad,
  quitarParticipante,
  resumenPadrinazgo,
  resumenPresupuesto,
} from '@/lib/programas'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * PRD-31 (§21b) «Agenda › Programas» — the funded layer above jornadas.
 *
 * A programa is what an organisation plans and funds: an objective, a target population, a cadence,
 * a budget and a financiador, realised by a set of jornadas over months. This screen creates and
 * plans them; tracks the budget (comprometido/aplicado/restante); funds them via programa-level
 * sponsorship; carries a persistent roster for talleres/formaciones; and answers the question no
 * external tool can — the seasonal-feasibility calendar (§21b.2): which months each target
 * community is actually reachable, and what the year costs. Planning/funding is coordination work,
 * so the screen is coordinador/admin; RLS (0045) is the real boundary.
 */

const CLASE_CAMPO = 'mt-1 w-full rounded border border-barro-200 bg-white px-2 py-1.5 text-sm'
const pesos = (n: number) => `$${n.toLocaleString('es-CO')}`

type Params = Promise<{ ver?: string; error?: string }>

export default async function Programas({ searchParams }: { searchParams: Params }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { ver, error } = await searchParams

  if (!PROGRAMA_ROLES.includes(sesion.rolStaff as (typeof PROGRAMA_ROLES)[number])) {
    return (
      <main>
        <h1 className="text-xl font-semibold text-barro-900">Programas</h1>
        <p className="mt-4 max-w-2xl text-barro-700">
          Un programa es lo que una organización planea y financia: un objetivo, una población, una
          cadencia, un presupuesto y las jornadas que lo realizan. Planearlo y financiarlo es trabajo
          de coordinación, y su rol no lo ve.
        </p>
      </main>
    )
  }

  const { programas, comunidadesDisp, detalle } = await conSesion(sesion, async (client) => {
    const programas = await listarProgramas(client)
    const { rows: comunidadesDisp } = await client.query<{ id: string; nombre: string }>(
      `select id, nombre from comunidades where activa order by nombre`,
    )

    const elegido = ver ? await programaPorId(client, ver) : null
    const detalle = elegido
      ? {
          programa: elegido,
          comunidades: await comunidadesDe(client, elegido.id),
          participantes: await participantesDe(client, elegido.id),
          padrinazgos: await apadrinamientosDe(client, elegido.id),
          aplicaciones: await aplicacionesDe(client, elegido.id),
          jornadas: await listarJornadas(client, { programaId: elegido.id }),
          feasibilidad: await feasibilidadDePrograma(client, elegido.id),
        }
      : null

    return { programas, comunidadesDisp, detalle }
  })

  // ── Server actions ───────────────────────────────────────────────────────────────────────
  async function crearProgramaAction(formData: FormData) {
    'use server'
    const s = await sesionCoordinacion()
    const titulo = String(formData.get('titulo') ?? '').trim()
    const objetivo = String(formData.get('objetivo') ?? '').trim()
    const cadencia = String(formData.get('cadencia') ?? '')
    const presupuesto = Number(String(formData.get('presupuesto') ?? '').replace(/[^\d]/g, ''))

    if (!titulo || !objetivo) redirect('/programas?error=Falta+el+nombre+o+el+objetivo')
    if (!CADENCIAS_PROGRAMA.includes(cadencia as CadenciaPrograma)) {
      redirect('/programas?error=Elija+una+cadencia')
    }

    try {
      const id = await conSesion(
        s!,
        (client) =>
          crearPrograma(
            client,
            {
              organizacionId: s!.organizacionId,
              titulo,
              objetivo,
              poblacionObjetivo: String(formData.get('poblacionObjetivo') ?? '').trim() || null,
              familiasObjetivo: familiaONull(formData.get('familiasObjetivo')),
              cadencia: cadencia as CadenciaPrograma,
              fechaInicio: String(formData.get('fechaInicio') ?? '') || null,
              fechaFin: String(formData.get('fechaFin') ?? '') || null,
              renueva: formData.get('renueva') === 'on',
              presupuestoComprometidoCop: Number.isFinite(presupuesto) ? presupuesto : 0,
              financiador: String(formData.get('financiador') ?? '').trim() || null,
              financiadorReporte: String(formData.get('financiadorReporte') ?? '').trim() || null,
            },
            s!.authId,
          ),
        { escribe: true },
      )
      revalidatePath('/programas')
      redirect(`/programas?ver=${id}`)
    } catch (e) {
      if (esRedireccion(e)) throw e
      redirect('/programas?error=No+se+pudo+crear+el+programa')
    }
  }

  async function editarProgramaAction(formData: FormData) {
    'use server'
    const s = await sesionCoordinacion()
    const id = String(formData.get('id') ?? '')
    if (!id) redirect('/programas?error=Falta+el+programa')
    const estado = String(formData.get('estado') ?? '')
    const presupuesto = Number(String(formData.get('presupuesto') ?? '').replace(/[^\d]/g, ''))
    try {
      await conSesion(
        s!,
        (client) =>
          actualizarPrograma(client, id, {
            estado: estado ? (estado as EstadoPrograma) : undefined,
            objetivo: String(formData.get('objetivo') ?? '').trim() || undefined,
            poblacionObjetivo: String(formData.get('poblacionObjetivo') ?? '').trim() || null,
            familiasObjetivo: familiaONull(formData.get('familiasObjetivo')),
            fechaInicio: String(formData.get('fechaInicio') ?? '') || null,
            fechaFin: String(formData.get('fechaFin') ?? '') || null,
            renueva: formData.get('renueva') === 'on',
            presupuestoComprometidoCop: Number.isFinite(presupuesto) ? presupuesto : 0,
            financiador: String(formData.get('financiador') ?? '').trim() || null,
            financiadorReporte: String(formData.get('financiadorReporte') ?? '').trim() || null,
          }),
        { escribe: true },
      )
    } catch (e) {
      if (esRedireccion(e)) throw e
      redirect(`/programas?ver=${id}&error=No+se+pudo+guardar`)
    }
    revalidatePath('/programas')
    redirect(`/programas?ver=${id}`)
  }

  async function agregarComunidadAction(formData: FormData) {
    'use server'
    const s = await sesionCoordinacion()
    const id = String(formData.get('programaId') ?? '')
    const comunidadId = String(formData.get('comunidadId') ?? '')
    if (!id) redirect('/programas?error=Falta+el+programa')
    if (!comunidadId) redirect(`/programas?ver=${id}&error=Elija+una+comunidad`)
    try {
      await conSesion(
        s!,
        (client) =>
          agregarComunidad(client, id, comunidadId, familiaONull(formData.get('familiasEstimadas'))),
        { escribe: true },
      )
    } catch (e) {
      if (esRedireccion(e)) throw e
      redirect(`/programas?ver=${id}&error=No+se+pudo+agregar+la+comunidad`)
    }
    revalidatePath('/programas')
    redirect(`/programas?ver=${id}`)
  }

  async function quitarComunidadAction(formData: FormData) {
    'use server'
    const s = await sesionCoordinacion()
    const id = String(formData.get('programaId') ?? '')
    const filaId = String(formData.get('filaId') ?? '')
    try {
      await conSesion(s!, (client) => quitarComunidad(client, filaId), { escribe: true })
    } catch (e) {
      if (esRedireccion(e)) throw e
      redirect(`/programas?ver=${id}&error=No+se+pudo+quitar`)
    }
    revalidatePath('/programas')
    redirect(`/programas?ver=${id}`)
  }

  async function agregarParticipanteAction(formData: FormData) {
    'use server'
    const s = await sesionCoordinacion()
    const id = String(formData.get('programaId') ?? '')
    const nombre = String(formData.get('nombre') ?? '').trim()
    if (!id) redirect('/programas?error=Falta+el+programa')
    if (!nombre) redirect(`/programas?ver=${id}&error=El+participante+necesita+un+nombre`)
    try {
      await conSesion(
        s!,
        (client) =>
          agregarParticipante(client, id, nombre, String(formData.get('contacto') ?? '').trim() || null),
        { escribe: true },
      )
    } catch (e) {
      if (esRedireccion(e)) throw e
      redirect(`/programas?ver=${id}&error=No+se+pudo+agregar+el+participante`)
    }
    revalidatePath('/programas')
    redirect(`/programas?ver=${id}`)
  }

  async function completarParticipanteAction(formData: FormData) {
    'use server'
    const s = await sesionCoordinacion()
    const id = String(formData.get('programaId') ?? '')
    const participanteId = String(formData.get('participanteId') ?? '')
    const completar = String(formData.get('completar') ?? '') === '1'
    try {
      await conSesion(s!, (client) => marcarCompletado(client, participanteId, completar), {
        escribe: true,
      })
    } catch (e) {
      if (esRedireccion(e)) throw e
      redirect(`/programas?ver=${id}&error=No+se+pudo+actualizar`)
    }
    revalidatePath('/programas')
    redirect(`/programas?ver=${id}`)
  }

  async function quitarParticipanteAction(formData: FormData) {
    'use server'
    const s = await sesionCoordinacion()
    const id = String(formData.get('programaId') ?? '')
    const participanteId = String(formData.get('participanteId') ?? '')
    try {
      await conSesion(s!, (client) => quitarParticipante(client, participanteId), { escribe: true })
    } catch (e) {
      if (esRedireccion(e)) throw e
      redirect(`/programas?ver=${id}&error=No+se+pudo+quitar`)
    }
    revalidatePath('/programas')
    redirect(`/programas?ver=${id}`)
  }

  async function crearApadrinamientoAction(formData: FormData) {
    'use server'
    const s = await sesionCoordinacion()
    const id = String(formData.get('programaId') ?? '')
    const etiqueta = String(formData.get('etiqueta') ?? '').trim()
    const padrinoNombre = String(formData.get('padrinoNombre') ?? '').trim()
    const monto = Number(String(formData.get('montoCop') ?? '').replace(/[^\d]/g, ''))
    if (!id) redirect('/programas?error=Falta+el+programa')
    if (!etiqueta || !padrinoNombre) {
      redirect(`/programas?ver=${id}&error=Falta+la+etiqueta+o+el+padrino`)
    }
    if (!Number.isFinite(monto) || monto <= 0) {
      redirect(`/programas?ver=${id}&error=El+monto+debe+ser+mayor+que+cero`)
    }
    const padrinoTipo = String(formData.get('padrinoTipo') ?? 'individuo')
    const recurrencia = String(formData.get('recurrencia') ?? 'unico')
    try {
      await conSesion(
        s!,
        (client) =>
          crearApadrinamiento(
            client,
            {
              programaId: id,
              etiqueta,
              padrinoNombre,
              padrinoContacto: String(formData.get('padrinoContacto') ?? '').trim() || null,
              padrinoTipo: padrinoTipo === 'organizacion' ? 'organizacion' : 'individuo',
              montoCop: monto,
              recurrencia: recurrencia === 'mensual' ? 'mensual' : 'unico',
              consentimiento: formData.get('consentimiento') === 'on',
            },
            s!.authId,
          ),
        { escribe: true },
      )
    } catch (e) {
      if (esRedireccion(e)) throw e
      redirect(`/programas?ver=${id}&error=No+se+pudo+registrar+el+apadrinamiento`)
    }
    revalidatePath('/programas')
    redirect(`/programas?ver=${id}`)
  }

  async function estadoApadrinamientoAction(formData: FormData) {
    'use server'
    const s = await sesionCoordinacion()
    const id = String(formData.get('programaId') ?? '')
    const apadrinamientoId = String(formData.get('apadrinamientoId') ?? '')
    const estado = String(formData.get('estado') ?? '')
    if (!ESTADOS_PROGRAMA.includes(estado as EstadoPrograma)) {
      redirect(`/programas?ver=${id}&error=Estado+desconocido`)
    }
    try {
      await conSesion(
        s!,
        (client) => actualizarApadrinamiento(client, apadrinamientoId, { estado: estado as EstadoPrograma }),
        { escribe: true },
      )
    } catch (e) {
      if (esRedireccion(e)) throw e
      redirect(`/programas?ver=${id}&error=No+se+pudo+actualizar`)
    }
    revalidatePath('/programas')
    redirect(`/programas?ver=${id}`)
  }

  async function aplicarFondosAction(formData: FormData) {
    'use server'
    const s = await sesionCoordinacion()
    const id = String(formData.get('programaId') ?? '')
    const monto = Number(String(formData.get('montoAplicadoCop') ?? '').replace(/[^\d]/g, ''))
    if (!id) redirect('/programas?error=Falta+el+programa')
    if (!Number.isFinite(monto) || monto <= 0) {
      redirect(`/programas?ver=${id}&error=El+monto+debe+ser+mayor+que+cero`)
    }
    try {
      await conSesion(
        s!,
        (client) =>
          aplicarFondos(
            client,
            {
              programaId: id,
              apadrinamientoId: String(formData.get('apadrinamientoId') ?? '') || null,
              jornadaId: String(formData.get('jornadaId') ?? '') || null,
              montoAplicadoCop: monto,
              concepto: String(formData.get('concepto') ?? '').trim() || null,
            },
            s!.authId,
          ),
        { escribe: true },
      )
    } catch (e) {
      if (esRedireccion(e)) throw e
      redirect(`/programas?ver=${id}&error=No+se+pudo+aplicar+el+fondo`)
    }
    revalidatePath('/programas')
    redirect(`/programas?ver=${id}`)
  }

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-barro-900">Programas</h1>
        <p className="text-sm text-barro-600">
          {programas.length} {programas.length === 1 ? 'programa' : 'programas'}
        </p>
      </div>

      <p className="mt-2 max-w-3xl text-sm text-barro-700">
        Un programa es lo que se planea y se financia: un objetivo, una población, una cadencia, un
        presupuesto y las jornadas que lo realizan a lo largo de meses. El calendario de
        alcanzabilidad dice, antes de prometer nada, qué meses cada comunidad se puede alcanzar y
        cuánto cuesta el año.
      </p>

      {error && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      )}

      {!detalle && (
        <section className="mt-6">
          <h2 className="flex items-center gap-2 font-semibold text-barro-900">
            <Plus className="size-4" aria-hidden />
            Nuevo programa
          </h2>
          <form
            action={crearProgramaAction}
            className="mt-3 grid gap-3 rounded-lg border border-barro-200 bg-white p-4 sm:grid-cols-2"
          >
            <Campo etiqueta="Nombre">
              <input name="titulo" required className={CLASE_CAMPO} placeholder="Plan de respuesta 2026" />
            </Campo>
            <Campo etiqueta="Cadencia">
              <select name="cadencia" defaultValue="" required className={CLASE_CAMPO}>
                <option value="" disabled>
                  Elija una cadencia
                </option>
                {CADENCIAS_PROGRAMA.map((c) => (
                  <option key={c} value={c}>
                    {ETIQUETA_CADENCIA[c]}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Objetivo" ayuda="Qué cambio se busca, en una frase.">
              <input name="objetivo" required className={CLASE_CAMPO} />
            </Campo>
            <Campo etiqueta="Población objetivo (opcional)" ayuda="A quiénes y con qué criterio.">
              <input name="poblacionObjetivo" className={CLASE_CAMPO} />
            </Campo>
            <Campo etiqueta="Familias objetivo (opcional)">
              <input name="familiasObjetivo" inputMode="numeric" className={CLASE_CAMPO} />
            </Campo>
            <Campo etiqueta="Presupuesto comprometido (COP)">
              <input name="presupuesto" inputMode="numeric" className={CLASE_CAMPO} />
            </Campo>
            <Campo etiqueta="Desde (opcional)">
              <input type="date" name="fechaInicio" className={CLASE_CAMPO} />
            </Campo>
            <Campo etiqueta="Hasta (opcional)">
              <input type="date" name="fechaFin" className={CLASE_CAMPO} />
            </Campo>
            <Campo etiqueta="Financiador (opcional)">
              <input name="financiador" className={CLASE_CAMPO} />
            </Campo>
            <Campo etiqueta="Qué necesita reportado (opcional)">
              <input name="financiadorReporte" className={CLASE_CAMPO} />
            </Campo>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="renueva" />
              <span className="text-barro-800">Se renueva al terminar.</span>
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
              >
                Crear programa
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-semibold text-barro-900">
          Todos los programas
          <span className="ml-2 font-normal text-barro-600">{programas.length}</span>
        </h2>
        {programas.length === 0 ? (
          <p className="mt-3 rounded-lg border border-barro-200 bg-white px-4 py-3 text-barro-700">
            Todavía no hay programas.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
            {programas.map((p) => (
              <li key={p.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <Link
                    href={`/programas?ver=${p.id}`}
                    className={`font-medium underline-offset-2 hover:underline ${
                      p.id === ver ? 'text-selva-700' : 'text-barro-900'
                    }`}
                  >
                    {p.titulo}
                  </Link>
                  <EstadoPill estado={p.estado} />
                  <span className="text-barro-500">{ETIQUETA_CADENCIA[p.cadencia as CadenciaPrograma] ?? p.cadencia}</span>
                  <span className="ml-auto text-barro-600">
                    {pesos(p.aplicadoCop)} de {pesos(p.presupuestoComprometidoCop)}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-barro-700">{p.objetivo}</p>
                <p className="mt-0.5 text-xs text-barro-500">
                  {p.comunidades} {p.comunidades === 1 ? 'comunidad' : 'comunidades'} · {p.jornadas}{' '}
                  {p.jornadas === 1 ? 'jornada' : 'jornadas'}
                  {p.participantes > 0 && ` · ${p.participantes} en el roster`} · {p.codigo}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detalle && (
        <Detalle
          detalle={detalle}
          comunidadesDisp={comunidadesDisp}
          acciones={{
            editarProgramaAction,
            agregarComunidadAction,
            quitarComunidadAction,
            agregarParticipanteAction,
            completarParticipanteAction,
            quitarParticipanteAction,
            crearApadrinamientoAction,
            estadoApadrinamientoAction,
            aplicarFondosAction,
          }}
        />
      )}
    </main>
  )
}

// ── Detail ─────────────────────────────────────────────────────────────────────────────────────

type DetalleDatos = {
  programa: Awaited<ReturnType<typeof programaPorId>> & object
  comunidades: Awaited<ReturnType<typeof comunidadesDe>>
  participantes: Awaited<ReturnType<typeof participantesDe>>
  padrinazgos: Awaited<ReturnType<typeof apadrinamientosDe>>
  aplicaciones: Awaited<ReturnType<typeof aplicacionesDe>>
  jornadas: Awaited<ReturnType<typeof listarJornadas>>
  feasibilidad: Feasibilidad
}

type Acciones = {
  editarProgramaAction: (f: FormData) => Promise<void>
  agregarComunidadAction: (f: FormData) => Promise<void>
  quitarComunidadAction: (f: FormData) => Promise<void>
  agregarParticipanteAction: (f: FormData) => Promise<void>
  completarParticipanteAction: (f: FormData) => Promise<void>
  quitarParticipanteAction: (f: FormData) => Promise<void>
  crearApadrinamientoAction: (f: FormData) => Promise<void>
  estadoApadrinamientoAction: (f: FormData) => Promise<void>
  aplicarFondosAction: (f: FormData) => Promise<void>
}

function Detalle({
  detalle,
  comunidadesDisp,
  acciones,
}: {
  detalle: DetalleDatos
  comunidadesDisp: { id: string; nombre: string }[]
  acciones: Acciones
}) {
  const p = detalle.programa!
  const presupuesto = resumenPresupuesto(p.presupuestoComprometidoCop, p.aplicadoCop)
  const padrinazgo = resumenPadrinazgo(detalle.padrinazgos)
  const conRoster = detalle.jornadas.some((j) => j.tipo === 'taller' || j.tipo === 'formacion')

  return (
    <section className="mt-10 border-t border-barro-200 pt-6">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-lg font-semibold text-barro-900">{p.titulo}</h2>
        <EstadoPill estado={p.estado} />
        <span className="text-sm text-barro-500">
          {ETIQUETA_CADENCIA[p.cadencia as CadenciaPrograma] ?? p.cadencia} · {p.codigo}
        </span>
        <Link href="/programas" className="ml-auto text-sm text-barro-600 underline-offset-2 hover:underline">
          ← todos
        </Link>
      </div>
      <p className="mt-1 max-w-3xl text-sm text-barro-700">{p.objetivo}</p>
      {p.financiador && (
        <p className="mt-1 text-sm text-barro-600">
          Financia: {p.financiador}
          {p.financiadorReporte && ` · reporta: ${p.financiadorReporte}`}
        </p>
      )}

      {/* Budget (AC2) */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Tarjeta etiqueta="Comprometido" valor={pesos(presupuesto.comprometidoCop)} />
        <Tarjeta etiqueta="Aplicado" valor={pesos(presupuesto.aplicadoCop)} />
        <Tarjeta etiqueta="Restante" valor={pesos(presupuesto.restanteCop)} destacado />
      </div>

      {/* Seasonal feasibility (§21b.2 / AC3) — the differentiated capability */}
      <div className="mt-8">
        <h3 className="flex items-center gap-2 font-semibold text-barro-900">
          <CalendarRange className="size-4" aria-hidden />
          Alcanzabilidad por mes
        </h3>
        <CalendarioFeasibilidad f={detalle.feasibilidad} comunidades={detalle.comunidades.length} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Target communities (AC1 target population / feasibility input) */}
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-barro-900">
            <MapPinned className="size-4" aria-hidden />
            Comunidades objetivo
            <span className="font-normal text-barro-500">{detalle.comunidades.length}</span>
          </h3>
          {detalle.comunidades.length === 0 ? (
            <p className="mt-2 text-sm text-barro-600">
              Sin comunidades todavía. Agréguelas para calcular el calendario.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-barro-100 rounded-lg border border-barro-200 bg-white">
              {detalle.comunidades.map((c) => (
                <li key={c.id} className="flex items-baseline gap-2 px-3 py-2 text-sm">
                  <span className="text-barro-900">{c.comunidadNombre ?? '—'}</span>
                  {c.familiasEstimadas !== null && (
                    <span className="text-barro-500">{c.familiasEstimadas} familias</span>
                  )}
                  <form action={acciones.quitarComunidadAction} className="ml-auto">
                    <input type="hidden" name="programaId" value={p.id} />
                    <input type="hidden" name="filaId" value={c.id} />
                    <button type="submit" className="text-xs text-rose-700 underline-offset-2 hover:underline">
                      quitar
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={acciones.agregarComunidadAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="programaId" value={p.id} />
            <label className="block flex-1 text-sm">
              <span className="font-medium text-barro-800">Agregar comunidad</span>
              <select name="comunidadId" defaultValue="" required className={CLASE_CAMPO}>
                <option value="" disabled>
                  Elija una comunidad
                </option>
                {comunidadesDisp.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="block w-28 text-sm">
              <span className="font-medium text-barro-800">Familias</span>
              <input name="familiasEstimadas" inputMode="numeric" className={CLASE_CAMPO} />
            </label>
            <button
              type="submit"
              className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
            >
              Agregar
            </button>
          </form>
        </div>

        {/* Plan settings (cadence, duration, budget, financiador) */}
        <form action={acciones.editarProgramaAction} className="rounded-lg border border-barro-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-barro-900">Plan y presupuesto</h3>
          <input type="hidden" name="id" value={p.id} />
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Estado">
              <select name="estado" defaultValue={p.estado} className={CLASE_CAMPO}>
                {ESTADOS_PROGRAMA.map((e) => (
                  <option key={e} value={e}>
                    {ETIQUETA_ESTADO_PROGRAMA[e]}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Presupuesto (COP)">
              <input
                name="presupuesto"
                inputMode="numeric"
                defaultValue={p.presupuestoComprometidoCop || ''}
                className={CLASE_CAMPO}
              />
            </Campo>
            <Campo etiqueta="Desde">
              <input type="date" name="fechaInicio" defaultValue={p.fechaInicio ?? ''} className={CLASE_CAMPO} />
            </Campo>
            <Campo etiqueta="Hasta">
              <input type="date" name="fechaFin" defaultValue={p.fechaFin ?? ''} className={CLASE_CAMPO} />
            </Campo>
            <Campo etiqueta="Objetivo">
              <input name="objetivo" defaultValue={p.objetivo} className={CLASE_CAMPO} />
            </Campo>
            <Campo etiqueta="Población objetivo">
              <input name="poblacionObjetivo" defaultValue={p.poblacionObjetivo ?? ''} className={CLASE_CAMPO} />
            </Campo>
            <Campo etiqueta="Familias objetivo">
              <input
                name="familiasObjetivo"
                inputMode="numeric"
                defaultValue={p.familiasObjetivo ?? ''}
                className={CLASE_CAMPO}
              />
            </Campo>
            <Campo etiqueta="Financiador">
              <input name="financiador" defaultValue={p.financiador ?? ''} className={CLASE_CAMPO} />
            </Campo>
            <Campo etiqueta="Qué reporta">
              <input name="financiadorReporte" defaultValue={p.financiadorReporte ?? ''} className={CLASE_CAMPO} />
            </Campo>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="renueva" defaultChecked={p.renueva} />
              <span className="text-barro-800">Se renueva.</span>
            </label>
          </div>
          <button
            type="submit"
            className="mt-3 rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
          >
            Guardar
          </button>
        </form>
      </div>

      {/* Jornadas under this programa (AC1 «set of jornadas» / AC6 planned vs actual) */}
      <div className="mt-8">
        <h3 className="flex items-center gap-2 font-semibold text-barro-900">
          <CalendarRange className="size-4" aria-hidden />
          Jornadas del programa
          <span className="font-normal text-barro-500">{detalle.jornadas.length}</span>
          <Link
            href="/jornadas"
            className="ml-auto text-sm font-normal text-selva-700 underline-offset-2 hover:underline"
          >
            + programar una jornada
          </Link>
        </h3>
        {detalle.jornadas.length === 0 ? (
          <p className="mt-2 text-sm text-barro-600">
            Ninguna todavía. Créelas en Jornadas y elija este programa.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-barro-100 rounded-lg border border-barro-200 bg-white">
            {detalle.jornadas.map((j) => (
              <li key={j.id} className="flex flex-wrap items-baseline gap-2 px-3 py-2 text-sm">
                <Link href={`/jornadas?ver=${j.id}`} className="font-medium text-barro-900 underline-offset-2 hover:underline">
                  {j.titulo}
                </Link>
                <span className="text-barro-500">{ETIQUETA_TIPO_JORNADA[j.tipo as TipoJornada] ?? j.tipo}</span>
                <EstadoPill estado={j.estado} pequeno />
                <span className="ml-auto text-barro-500">
                  {j.fechaInicio ? fechaSoloDia(j.fechaInicio) : 'sin fecha'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Persistent roster (§21b.3 / AC4) */}
      <div className="mt-8">
        <h3 className="flex items-center gap-2 font-semibold text-barro-900">
          <UsersRound className="size-4" aria-hidden />
          Roster
          <span className="font-normal text-barro-500">{detalle.participantes.length}</span>
        </h3>
        <p className="mt-1 text-sm text-barro-600">
          Las mismas personas a través de las sesiones. Se registra que asistieron, nunca a qué. La
          asistencia por sesión se marca en cada jornada.
          {!conRoster && ' Un roster tiene sentido en talleres y formaciones.'}
        </p>
        {detalle.participantes.length > 0 && (
          <ul className="mt-2 divide-y divide-barro-100 rounded-lg border border-barro-200 bg-white">
            {detalle.participantes.map((pt) => (
              <li key={pt.id} className="flex flex-wrap items-baseline gap-2 px-3 py-2 text-sm">
                <span className="text-barro-900">{pt.nombre}</span>
                {pt.contacto && <span className="text-barro-500">{pt.contacto}</span>}
                <span className="text-barro-500">
                  {pt.asistencias} {pt.asistencias === 1 ? 'sesión' : 'sesiones'}
                </span>
                {pt.completado && (
                  <span className="flex items-center gap-1 text-xs text-selva-700">
                    <ShieldCheck className="size-3" aria-hidden />
                    completó
                  </span>
                )}
                <div className="ml-auto flex items-center gap-3">
                  <form action={acciones.completarParticipanteAction}>
                    <input type="hidden" name="programaId" value={p.id} />
                    <input type="hidden" name="participanteId" value={pt.id} />
                    <input type="hidden" name="completar" value={pt.completado ? '0' : '1'} />
                    <button type="submit" className="text-xs text-selva-700 underline-offset-2 hover:underline">
                      {pt.completado ? 'marcar pendiente' : 'marcar completó'}
                    </button>
                  </form>
                  <form action={acciones.quitarParticipanteAction}>
                    <input type="hidden" name="programaId" value={p.id} />
                    <input type="hidden" name="participanteId" value={pt.id} />
                    <button type="submit" className="text-xs text-rose-700 underline-offset-2 hover:underline">
                      quitar
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form action={acciones.agregarParticipanteAction} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="programaId" value={p.id} />
          <label className="block flex-1 text-sm">
            <span className="font-medium text-barro-800">Agregar al roster</span>
            <input name="nombre" required className={CLASE_CAMPO} placeholder="Nombre" />
          </label>
          <label className="block flex-1 text-sm">
            <span className="font-medium text-barro-800">Contacto (opcional)</span>
            <input name="contacto" className={CLASE_CAMPO} />
          </label>
          <button
            type="submit"
            className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
          >
            Agregar
          </button>
        </form>
      </div>

      {/* Programa-level sponsorship (§21b.4 / AC5) */}
      <div className="mt-8">
        <h3 className="flex items-center gap-2 font-semibold text-barro-900">
          <HandCoins className="size-4" aria-hidden />
          Financiación del programa
        </h3>
        <p className="mt-1 max-w-3xl text-sm text-barro-600">
          Un apadrinamiento puede financiar el programa entero. Al padrino se le muestra una etiqueta
          y el programa, nunca un nombre.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Tarjeta etiqueta="Comprometido" valor={pesos(padrinazgo.comprometidoCop)} />
          <Tarjeta etiqueta="Aplicado" valor={pesos(padrinazgo.aplicadoCop)} />
          <Tarjeta etiqueta="Disponible" valor={pesos(padrinazgo.disponibleCop)} destacado />
        </div>

        {detalle.padrinazgos.length > 0 && (
          <ul className="mt-3 divide-y divide-barro-100 rounded-lg border border-barro-200 bg-white">
            {detalle.padrinazgos.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-2 px-3 py-2 text-sm">
                <span className="font-medium text-barro-900">{a.etiqueta}</span>
                <EstadoPill estado={a.estado} pequeno />
                <span className="text-barro-500">{a.padrinoNombre}</span>
                {a.consentimiento && (
                  <span className="flex items-center gap-1 text-xs text-selva-700">
                    <ShieldCheck className="size-3" aria-hidden />
                    con consentimiento
                  </span>
                )}
                <span className="ml-auto text-barro-600">
                  {pesos(a.aplicadoCop)} de {pesos(a.montoCop)} · {pesos(a.disponibleCop)} libre
                </span>
                {a.estado === 'activo' && (
                  <form action={acciones.estadoApadrinamientoAction} className="ml-2">
                    <input type="hidden" name="programaId" value={p.id} />
                    <input type="hidden" name="apadrinamientoId" value={a.id} />
                    <input type="hidden" name="estado" value="pausado" />
                    <button type="submit" className="text-xs text-barro-600 underline-offset-2 hover:underline">
                      pausar
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        <form action={acciones.crearApadrinamientoAction} className="mt-3 grid gap-3 rounded-lg border border-barro-200 bg-white p-4 sm:grid-cols-2">
          <input type="hidden" name="programaId" value={p.id} />
          <Campo etiqueta="Etiqueta" ayuda="Lo que ve el padrino. Sin nombres.">
            <input name="etiqueta" required className={CLASE_CAMPO} placeholder="el banco de medicamentos" />
          </Campo>
          <Campo etiqueta="Padrino">
            <input name="padrinoNombre" required className={CLASE_CAMPO} />
          </Campo>
          <Campo etiqueta="Contacto (opcional)">
            <input name="padrinoContacto" className={CLASE_CAMPO} />
          </Campo>
          <Campo etiqueta="Tipo">
            <select name="padrinoTipo" defaultValue="individuo" className={CLASE_CAMPO}>
              <option value="individuo">Individuo</option>
              <option value="organizacion">Organización</option>
            </select>
          </Campo>
          <Campo etiqueta="Monto (COP)">
            <input name="montoCop" inputMode="numeric" required className={CLASE_CAMPO} />
          </Campo>
          <Campo etiqueta="Recurrencia">
            <select name="recurrencia" defaultValue="unico" className={CLASE_CAMPO}>
              <option value="unico">Único</option>
              <option value="mensual">Mensual</option>
            </select>
          </Campo>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="consentimiento" className="mt-0.5" />
            <span className="text-barro-800">Hay consentimiento para lo que se muestre al padrino.</span>
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
            >
              Registrar financiación
            </button>
          </div>
        </form>
      </div>

      {/* Spend ledger (AC2 aplicado) */}
      <div className="mt-8">
        <h3 className="flex items-center gap-2 font-semibold text-barro-900">
          <Coins className="size-4" aria-hidden />
          Gasto aplicado
        </h3>
        {detalle.aplicaciones.length === 0 ? (
          <p className="mt-2 text-sm text-barro-600">Todavía no se ha aplicado nada.</p>
        ) : (
          <ol className="mt-2 divide-y divide-barro-100 rounded-lg border border-barro-200 bg-white">
            {detalle.aplicaciones.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-2 px-3 py-2 text-sm">
                <span className="font-medium text-barro-900">{pesos(a.montoAplicadoCop)}</span>
                {a.apadrinamientoEtiqueta && <span className="text-barro-600">{a.apadrinamientoEtiqueta}</span>}
                {a.jornadaTitulo && <span className="text-barro-500">{a.jornadaTitulo}</span>}
                {a.concepto && <span className="text-barro-500">«{a.concepto}»</span>}
                <span className="ml-auto text-barro-500">{fechaCorta(a.creadoEn)}</span>
              </li>
            ))}
          </ol>
        )}
        <form action={acciones.aplicarFondosAction} className="mt-3 grid gap-3 rounded-lg border border-barro-200 bg-white p-4 sm:grid-cols-2">
          <input type="hidden" name="programaId" value={p.id} />
          <Campo etiqueta="Financiación (opcional)">
            <select name="apadrinamientoId" defaultValue="" className={CLASE_CAMPO}>
              <option value="">Presupuesto general</option>
              {detalle.padrinazgos
                .filter((a) => a.estado === 'activo')
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.etiqueta} · {pesos(a.disponibleCop)} libre
                  </option>
                ))}
            </select>
          </Campo>
          <Campo etiqueta="Jornada que pagó (opcional)">
            <select name="jornadaId" defaultValue="" className={CLASE_CAMPO}>
              <option value="">Ninguna en particular</option>
              {detalle.jornadas.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.titulo}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Monto (COP)">
            <input name="montoAplicadoCop" inputMode="numeric" required className={CLASE_CAMPO} />
          </Campo>
          <Campo etiqueta="Concepto (opcional)">
            <input name="concepto" className={CLASE_CAMPO} />
          </Campo>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
            >
              Aplicar gasto
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}

// ── Feasibility calendar ─────────────────────────────────────────────────────────────────────

function CalendarioFeasibilidad({ f, comunidades }: { f: Feasibilidad; comunidades: number }) {
  if (comunidades === 0) {
    return (
      <p className="mt-2 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-600">
        Agregue comunidades objetivo para calcular qué meses son alcanzables y cuánto cuesta el año.
      </p>
    )
  }
  return (
    <div className="mt-2">
      {f.sinOrigenes && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-atrato-200 bg-atrato-50 px-4 py-3 text-sm text-atrato-800">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>No hay ningún nodo de acopio activo desde el cual salir, así que nada aparece como alcanzable.</span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {f.meses.map((m) => (
          <div
            key={m.indice}
            className={`rounded-lg border px-3 py-2 text-sm ${
              m.ocurre ? 'border-barro-200 bg-white' : 'border-dashed border-barro-200 bg-barro-50'
            }`}
          >
            <div className="flex items-baseline justify-between">
              <span className="font-medium text-barro-900 capitalize">
                {MESES_ES[m.mes]} {String(m.anio).slice(2)}
              </span>
              <span
                className={`rounded px-1 py-0.5 text-[10px] font-medium ${
                  m.temporada === 'seca' ? 'bg-atrato-50 text-atrato-700' : 'bg-selva-50 text-selva-700'
                }`}
              >
                {m.temporada}
              </span>
            </div>
            {m.ocurre ? (
              m.inalcanzables.length === 0 ? (
                <p className="mt-1 text-xs text-selva-700">Todas alcanzables · {pesos(m.costoMesCop)}</p>
              ) : (
                <p className="mt-1 text-xs text-atrato-800">
                  {m.inalcanzables.length}{' '}
                  {m.inalcanzables.length === 1 ? 'sin alcanzar' : 'sin alcanzar'} · {pesos(m.costoMesCop)}
                </p>
              )
            ) : (
              <p className="mt-1 text-xs text-barro-400">sin jornada</p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span className="font-medium text-barro-900">Costo del periodo: {pesos(f.costoAnioCop)}</span>
        {f.costoSegundoSemestrePct !== null && f.costoSegundoSemestrePct !== 0 && (
          <span className="text-barro-600">
            El segundo semestre {f.costoSegundoSemestrePct > 0 ? 'sube' : 'baja'}{' '}
            {Math.abs(f.costoSegundoSemestrePct)}%
          </span>
        )}
      </div>

      {f.brechas.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg border border-atrato-200 bg-atrato-50 px-4 py-3 text-sm text-atrato-900">
          {f.brechas.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Small shared pieces ────────────────────────────────────────────────────────────────────────

function familiaONull(v: FormDataEntryValue | null): number | null {
  const limpio = String(v ?? '').replace(/[^\d]/g, '')
  return limpio ? Number(limpio) : null
}

function esRedireccion(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'digest' in e && String((e as { digest: unknown }).digest).startsWith('NEXT_REDIRECT')
}

/**
 * The guard every write action shares: a signed-in coordinador/admin, or a redirect. Module-scope
 * (not a closure inside the page) so the server actions reference a stable binding rather than
 * capturing a per-render function. RLS (0045) is the real boundary; this is the courtesy message.
 */
async function sesionCoordinacion() {
  const s = await sesionActual()
  if (!s || !PROGRAMA_ROLES.includes(s.rolStaff as (typeof PROGRAMA_ROLES)[number])) {
    redirect('/programas?error=Solo+coordinación+gestiona+programas')
  }
  return s
}

function Tarjeta({ etiqueta, valor, destacado }: { etiqueta: string; valor: string; destacado?: boolean }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${destacado ? 'border-selva-200 bg-selva-50' : 'border-barro-200 bg-white'}`}>
      <p className="text-xs uppercase tracking-wide text-barro-500">{etiqueta}</p>
      <p className={`mt-1 text-lg font-semibold ${destacado ? 'text-selva-800' : 'text-barro-900'}`}>{valor}</p>
    </div>
  )
}

function EstadoPill({ estado, pequeno }: { estado: string; pequeno?: boolean }) {
  const tono =
    estado === 'activo' || estado === 'completada' || estado === 'completado'
      ? 'bg-selva-50 text-selva-700'
      : estado === 'cancelado' || estado === 'cancelada'
        ? 'bg-rose-50 text-rose-700'
        : estado === 'en_curso'
          ? 'bg-atrato-50 text-atrato-700'
          : 'bg-barro-100 text-barro-700'
  const etiqueta =
    ETIQUETA_ESTADO_PROGRAMA[estado as EstadoPrograma] ??
    ETIQUETA_ESTADO_JORNADA_LOCAL[estado] ??
    estado
  return <span className={`rounded px-1.5 py-0.5 ${pequeno ? 'text-[10px]' : 'text-xs'} font-medium ${tono}`}>{etiqueta}</span>
}

/** Jornada estado labels, so a pill shown for a nested jornada is legible without importing the map. */
const ETIQUETA_ESTADO_JORNADA_LOCAL: Record<string, string> = {
  borrador: 'Borrador',
  planificada: 'Planificada',
  en_curso: 'En curso',
  completada: 'Completada',
  cancelada: 'Cancelada',
  historico: 'Histórico',
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
