import { CalendarDays, MapPin, Plus, TriangleAlert, UsersRound } from 'lucide-react'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  actualizarJornada,
  agregarParada,
  crearJornada,
  ETIQUETA_ESTADO_JORNADA,
  ETIQUETA_TIPO_JORNADA,
  ESTADOS_JORNADA,
  jornadaPorId,
  JORNADA_ROLES_ESCRITURA,
  JORNADA_ROLES_LECTURA,
  listarJornadas,
  paradasDe,
  PAYLOAD_TIPO_JORNADA,
  quitarParada,
  TIPOS_CON_ROSTER,
  TIPOS_JORNADA,
} from '@/lib/jornadas'
import type { EstadoJornada, TipoJornada } from '@/db/schema/vocabulario'
import { fechaSoloDia } from '@/lib/fechas'
import {
  agregarParticipante,
  marcarAsistencia,
  type ParticipanteConAsistencia,
  participantesConAsistencia,
} from '@/lib/programas'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * PRD-30 (§22) «Agenda › Jornadas» — a jornada is one occurrence at a place, on a date, of a given
 * type. This screen creates and lists them, links them to a programa (PRD-31), edits a diverging
 * one (§21b.5 — edited, never deleted) and orders its stops. RLS (0043) is the boundary; this gate
 * spares the wrong role a screen they could not use.
 */

const CLASE_CAMPO = 'mt-1 w-full rounded border border-barro-200 bg-white px-2 py-1.5 text-sm'

type Params = Promise<{ ver?: string; error?: string }>

export default async function Jornadas({ searchParams }: { searchParams: Params }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { ver, error } = await searchParams
  const puedeLeer = JORNADA_ROLES_LECTURA.includes(
    sesion.rolStaff as (typeof JORNADA_ROLES_LECTURA)[number],
  )
  const puedeEscribir = JORNADA_ROLES_ESCRITURA.includes(
    sesion.rolStaff as (typeof JORNADA_ROLES_ESCRITURA)[number],
  )

  if (!puedeLeer) {
    return (
      <main>
        <h1 className="text-xl font-semibold text-barro-900">Jornadas</h1>
        <p className="mt-4 max-w-2xl text-barro-700">
          Una jornada lleva personas y cosas a un lugar, en una fecha, para una comunidad a la que
          hay que avisarle con tiempo. Su rol no la gestiona.
        </p>
      </main>
    )
  }

  const { jornadas, regiones, comunidades, programas, detalle } = await conSesion(
    sesion,
    async (client) => {
      const jornadas = await listarJornadas(client)

      const { rows: regiones } = await client.query<{ id: string; nombre: string }>(
        `select id, nombre from regiones where activa order by nombre`,
      )
      const { rows: comunidades } = await client.query<{ id: string; nombre: string }>(
        `select id, nombre from comunidades where activa order by nombre`,
      )
      const { rows: programas } = await client.query<{ id: string; titulo: string }>(
        `select id, titulo from programas order by titulo`,
      )

      const elegida = ver ? await jornadaPorId(client, ver) : null
      const conRoster =
        !!elegida?.programaId && TIPOS_CON_ROSTER.includes(elegida.tipo as (typeof TIPOS_CON_ROSTER)[number])
      const detalle = elegida
        ? {
            jornada: elegida,
            paradas: await paradasDe(client, elegida.id),
            roster: conRoster
              ? await participantesConAsistencia(client, elegida.programaId!, elegida.id)
              : null,
          }
        : null

      return { jornadas, regiones, comunidades, programas, detalle }
    },
  )

  async function crearJornadaAction(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (
      !sesion ||
      !JORNADA_ROLES_ESCRITURA.includes(sesion.rolStaff as (typeof JORNADA_ROLES_ESCRITURA)[number])
    ) {
      redirect('/jornadas?error=Solo+coordinación+crea+jornadas')
    }

    const tipo = String(formData.get('tipo') ?? '')
    const titulo = String(formData.get('titulo') ?? '').trim()
    const regionId = String(formData.get('regionId') ?? '')
    const programaId = String(formData.get('programaId') ?? '') || null
    const fechaInicio = String(formData.get('fechaInicio') ?? '') || null
    const fechaFin = String(formData.get('fechaFin') ?? '') || null

    if (!TIPOS_JORNADA.includes(tipo as TipoJornada)) {
      redirect('/jornadas?error=Elija+un+tipo+de+jornada')
    }
    if (!titulo) redirect('/jornadas?error=La+jornada+necesita+un+nombre')
    if (!regionId) redirect('/jornadas?error=Elija+la+región')

    try {
      await conSesion(
        sesion,
        (client) =>
          crearJornada(client, {
            organizacionId: sesion.organizacionId,
            tipo: tipo as TipoJornada,
            titulo,
            regionId,
            programaId,
            fechaInicio,
            fechaFin,
            notas: String(formData.get('notas') ?? '').trim() || null,
          }),
        { escribe: true },
      )
    } catch {
      redirect('/jornadas?error=No+se+pudo+crear+la+jornada')
    }
    revalidatePath('/jornadas')
    redirect('/jornadas')
  }

  async function editarJornadaAction(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (
      !sesion ||
      !JORNADA_ROLES_ESCRITURA.includes(sesion.rolStaff as (typeof JORNADA_ROLES_ESCRITURA)[number])
    ) {
      redirect('/jornadas?error=Solo+coordinación+edita+jornadas')
    }
    const id = String(formData.get('id') ?? '')
    if (!id) redirect('/jornadas?error=Falta+la+jornada')

    const estado = String(formData.get('estado') ?? '')
    const familiasRaw = String(formData.get('familiasAtendidas') ?? '').replace(/[^\d]/g, '')
    if (estado && !ESTADOS_JORNADA.includes(estado as EstadoJornada)) {
      redirect(`/jornadas?ver=${id}&error=Estado+desconocido`)
    }

    try {
      await conSesion(
        sesion,
        (client) =>
          actualizarJornada(client, id, {
            estado: estado ? (estado as EstadoJornada) : undefined,
            fechaInicio: String(formData.get('fechaInicio') ?? '') || null,
            fechaFin: String(formData.get('fechaFin') ?? '') || null,
            familiasAtendidas: familiasRaw ? Number(familiasRaw) : null,
            notas: String(formData.get('notas') ?? '').trim() || null,
          }),
        { escribe: true },
      )
    } catch {
      redirect(`/jornadas?ver=${id}&error=No+se+pudo+guardar`)
    }
    revalidatePath('/jornadas')
    redirect(`/jornadas?ver=${id}`)
  }

  async function agregarParadaAction(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (
      !sesion ||
      !JORNADA_ROLES_ESCRITURA.includes(sesion.rolStaff as (typeof JORNADA_ROLES_ESCRITURA)[number])
    ) {
      redirect('/jornadas?error=Solo+coordinación+edita+paradas')
    }
    const id = String(formData.get('jornadaId') ?? '')
    const comunidadId = String(formData.get('comunidadId') ?? '')
    if (!id) redirect('/jornadas?error=Falta+la+jornada')
    if (!comunidadId) redirect(`/jornadas?ver=${id}&error=Elija+una+comunidad`)

    try {
      await conSesion(
        sesion,
        (client) =>
          agregarParada(client, id, comunidadId, String(formData.get('notas') ?? '').trim() || null),
        { escribe: true },
      )
    } catch {
      redirect(`/jornadas?ver=${id}&error=No+se+pudo+agregar+la+parada`)
    }
    revalidatePath('/jornadas')
    redirect(`/jornadas?ver=${id}`)
  }

  async function quitarParadaAction(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (
      !sesion ||
      !JORNADA_ROLES_ESCRITURA.includes(sesion.rolStaff as (typeof JORNADA_ROLES_ESCRITURA)[number])
    ) {
      redirect('/jornadas?error=Solo+coordinación+edita+paradas')
    }
    const id = String(formData.get('jornadaId') ?? '')
    const paradaId = String(formData.get('paradaId') ?? '')
    try {
      await conSesion(sesion, (client) => quitarParada(client, paradaId), { escribe: true })
    } catch {
      redirect(`/jornadas?ver=${id}&error=No+se+pudo+quitar+la+parada`)
    }
    revalidatePath('/jornadas')
    redirect(`/jornadas?ver=${id}`)
  }

  /** Roster + attendance (PRD-30 AC4 / PRD-31 §21b.3) — records only THAT someone attended. */
  async function marcarAsistenciaAction(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (
      !sesion ||
      !JORNADA_ROLES_ESCRITURA.includes(sesion.rolStaff as (typeof JORNADA_ROLES_ESCRITURA)[number])
    ) {
      redirect('/jornadas?error=Solo+coordinación+registra+asistencia')
    }
    const id = String(formData.get('jornadaId') ?? '')
    const participanteId = String(formData.get('participanteId') ?? '')
    const asistio = String(formData.get('asistio') ?? '') === '1'
    if (!id || !participanteId) redirect(`/jornadas?ver=${id}&error=Falta+el+participante`)
    try {
      await conSesion(sesion, (client) => marcarAsistencia(client, participanteId, id, asistio), {
        escribe: true,
      })
    } catch {
      redirect(`/jornadas?ver=${id}&error=No+se+pudo+registrar+la+asistencia`)
    }
    revalidatePath('/jornadas')
    redirect(`/jornadas?ver=${id}`)
  }

  async function agregarAlRosterAction(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (
      !sesion ||
      !JORNADA_ROLES_ESCRITURA.includes(sesion.rolStaff as (typeof JORNADA_ROLES_ESCRITURA)[number])
    ) {
      redirect('/jornadas?error=Solo+coordinación+edita+el+roster')
    }
    const id = String(formData.get('jornadaId') ?? '')
    const programaId = String(formData.get('programaId') ?? '')
    const nombre = String(formData.get('nombre') ?? '').trim()
    if (!id || !programaId) redirect(`/jornadas?ver=${id}&error=Falta+el+programa`)
    if (!nombre) redirect(`/jornadas?ver=${id}&error=El+participante+necesita+un+nombre`)
    try {
      await conSesion(
        sesion,
        (client) =>
          agregarParticipante(client, programaId, nombre, String(formData.get('contacto') ?? '').trim() || null),
        { escribe: true },
      )
    } catch {
      redirect(`/jornadas?ver=${id}&error=No+se+pudo+agregar+al+roster`)
    }
    revalidatePath('/jornadas')
    redirect(`/jornadas?ver=${id}`)
  }

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-barro-900">Jornadas</h1>
        <p className="text-sm text-barro-600">
          {jornadas.length} {jornadas.length === 1 ? 'jornada' : 'jornadas'}
        </p>
      </div>

      <p className="mt-2 max-w-3xl text-sm text-barro-700">
        Una jornada es una ocurrencia: personas y cosas que llegan a un lugar, en una fecha, para
        una comunidad a la que se le avisa con tiempo. Una distribución, una brigada, un taller, una
        evaluación, una obra. Puede pertenecer a un programa o ser suelta.
      </p>

      {error && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      )}

      {puedeEscribir && (
        <section className="mt-6">
          <h2 className="flex items-center gap-2 font-semibold text-barro-900">
            <Plus className="size-4" aria-hidden />
            Nueva jornada
          </h2>
          <form
            action={crearJornadaAction}
            className="mt-3 grid gap-3 rounded-lg border border-barro-200 bg-white p-4 sm:grid-cols-2"
          >
            <Campo etiqueta="Tipo" ayuda="Lo que llega decide qué se pide.">
              <select name="tipo" defaultValue="" required className={CLASE_CAMPO}>
                <option value="" disabled>
                  Elija un tipo
                </option>
                {TIPOS_JORNADA.map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETA_TIPO_JORNADA[t]} · {PAYLOAD_TIPO_JORNADA[t]}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo etiqueta="Nombre">
              <input name="titulo" required className={CLASE_CAMPO} placeholder="Brigada de salud, agosto" />
            </Campo>

            <Campo etiqueta="Región">
              <select name="regionId" defaultValue="" required className={CLASE_CAMPO}>
                <option value="" disabled>
                  Elija la región
                </option>
                {regiones.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo etiqueta="Programa (opcional)" ayuda="Vacío = jornada suelta, fuera de un programa.">
              <select name="programaId" defaultValue="" className={CLASE_CAMPO}>
                <option value="">Sin programa</option>
                {programas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.titulo}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo etiqueta="Desde (opcional)">
              <input type="date" name="fechaInicio" className={CLASE_CAMPO} />
            </Campo>

            <Campo etiqueta="Hasta (opcional)">
              <input type="date" name="fechaFin" className={CLASE_CAMPO} />
            </Campo>

            <Campo etiqueta="Notas (opcional)">
              <input name="notas" className={CLASE_CAMPO} />
            </Campo>

            <div className="flex items-end">
              <button
                type="submit"
                className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
              >
                Crear borrador
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-semibold text-barro-900">
          Todas las jornadas
          <span className="ml-2 font-normal text-barro-600">{jornadas.length}</span>
        </h2>

        {jornadas.length === 0 ? (
          <p className="mt-3 rounded-lg border border-barro-200 bg-white px-4 py-3 text-barro-700">
            Todavía no hay jornadas.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
            {jornadas.map((j) => (
              <li key={j.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <Link
                    href={`/jornadas?ver=${j.id}`}
                    className={`font-medium underline-offset-2 hover:underline ${
                      j.id === ver ? 'text-selva-700' : 'text-barro-900'
                    }`}
                  >
                    {j.titulo}
                  </Link>
                  <span className="text-barro-500">{ETIQUETA_TIPO_JORNADA[j.tipo as TipoJornada] ?? j.tipo}</span>
                  <EstadoPill estado={j.estado} />
                  {j.programaTitulo && (
                    <span className="text-xs text-selva-700">programa: {j.programaTitulo}</span>
                  )}
                  <span className="ml-auto text-barro-600">{formatoFecha(j.fechaInicio)}</span>
                </div>
                <p className="mt-0.5 text-sm text-barro-600">
                  {j.regionNombre ?? 'sin región'} · {j.paradas}{' '}
                  {j.paradas === 1 ? 'parada' : 'paradas'}
                  {j.familiasAtendidas !== null && ` · ${j.familiasAtendidas} familias`} · {j.codigo}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detalle && (
        <section className="mt-8">
          <h2 className="flex items-center gap-2 font-semibold text-barro-900">
            <CalendarDays className="size-4" aria-hidden />
            {detalle.jornada.titulo}
          </h2>
          <p className="mt-1 text-sm text-barro-600">
            {ETIQUETA_TIPO_JORNADA[detalle.jornada.tipo as TipoJornada] ?? detalle.jornada.tipo} ·{' '}
            {detalle.jornada.regionNombre ?? 'sin región'} · {detalle.jornada.codigo}
          </p>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {/* Stops — the ordered communities this jornada reaches (§23.5). */}
            <div className="rounded-lg border border-barro-200 bg-white p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-barro-900">
                <MapPin className="size-4" aria-hidden />
                Paradas
              </h3>
              {detalle.paradas.length === 0 ? (
                <p className="mt-2 text-sm text-barro-600">Sin paradas todavía.</p>
              ) : (
                <ol className="mt-2 divide-y divide-barro-100">
                  {detalle.paradas.map((p) => (
                    <li key={p.id} className="flex items-baseline gap-2 py-2 text-sm">
                      <span className="text-barro-400">{p.orden + 1}.</span>
                      <span className="text-barro-900">{p.comunidadNombre ?? '—'}</span>
                      {p.notas && <span className="text-barro-500">«{p.notas}»</span>}
                      {puedeEscribir && (
                        <form action={quitarParadaAction} className="ml-auto">
                          <input type="hidden" name="jornadaId" value={detalle.jornada.id} />
                          <input type="hidden" name="paradaId" value={p.id} />
                          <button
                            type="submit"
                            className="text-xs text-rose-700 underline-offset-2 hover:underline"
                          >
                            quitar
                          </button>
                        </form>
                      )}
                    </li>
                  ))}
                </ol>
              )}

              {puedeEscribir && (
                <form action={agregarParadaAction} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="jornadaId" value={detalle.jornada.id} />
                  <label className="block flex-1 text-sm">
                    <span className="font-medium text-barro-800">Agregar parada</span>
                    <select name="comunidadId" defaultValue="" required className={CLASE_CAMPO}>
                      <option value="" disabled>
                        Elija una comunidad
                      </option>
                      {comunidades.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nombre}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="submit"
                    className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
                  >
                    Agregar
                  </button>
                </form>
              )}
            </div>

            {/* Edit — a jornada that happens differently is edited, not deleted (§21b.5). */}
            {puedeEscribir && (
              <form action={editarJornadaAction} className="rounded-lg border border-barro-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-barro-900">Actualizar</h3>
                <input type="hidden" name="id" value={detalle.jornada.id} />
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <Campo etiqueta="Estado">
                    <select name="estado" defaultValue={detalle.jornada.estado} className={CLASE_CAMPO}>
                      {ESTADOS_JORNADA.map((e) => (
                        <option key={e} value={e}>
                          {ETIQUETA_ESTADO_JORNADA[e]}
                        </option>
                      ))}
                    </select>
                  </Campo>
                  <Campo etiqueta="Familias atendidas" ayuda="Lo real, cuando ya ocurrió.">
                    <input
                      name="familiasAtendidas"
                      inputMode="numeric"
                      defaultValue={detalle.jornada.familiasAtendidas ?? ''}
                      className={CLASE_CAMPO}
                    />
                  </Campo>
                  <Campo etiqueta="Desde">
                    <input
                      type="date"
                      name="fechaInicio"
                      defaultValue={detalle.jornada.fechaInicio ?? ''}
                      className={CLASE_CAMPO}
                    />
                  </Campo>
                  <Campo etiqueta="Hasta">
                    <input
                      type="date"
                      name="fechaFin"
                      defaultValue={detalle.jornada.fechaFin ?? ''}
                      className={CLASE_CAMPO}
                    />
                  </Campo>
                  <Campo etiqueta="Notas">
                    <input name="notas" defaultValue={detalle.jornada.notas ?? ''} className={CLASE_CAMPO} />
                  </Campo>
                </div>
                <button
                  type="submit"
                  className="mt-3 rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
                >
                  Guardar cambios
                </button>
              </form>
            )}
          </div>

          {/* Roster + attendance (PRD-30 AC4 / PRD-31 §21b.3) — a taller/formación under a
              programa carries the same participants across sessions; here is one session. */}
          {detalle.roster !== null && (
            <div className="mt-4 rounded-lg border border-barro-200 bg-white p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-barro-900">
                <UsersRound className="size-4" aria-hidden />
                Roster y asistencia
                <span className="font-normal text-barro-500">{detalle.roster.length}</span>
              </h3>
              <p className="mt-1 text-sm text-barro-600">
                Se registra que asistieron a esta jornada, nunca a qué. El roster completo —
                agregar o quitar participantes — se administra desde el programa.
              </p>
              {detalle.roster.length === 0 ? (
                <p className="mt-2 text-sm text-barro-600">
                  El programa todavía no tiene participantes en el roster.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-barro-100">
                  {detalle.roster.map((pt) => (
                    <FilaRoster
                      key={pt.id}
                      participante={pt}
                      jornadaId={detalle.jornada.id}
                      puedeEscribir={puedeEscribir}
                      accion={marcarAsistenciaAction}
                    />
                  ))}
                </ul>
              )}
              {puedeEscribir && (
                <form action={agregarAlRosterAction} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="jornadaId" value={detalle.jornada.id} />
                  <input type="hidden" name="programaId" value={detalle.jornada.programaId ?? ''} />
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
              )}
            </div>
          )}
        </section>
      )}
    </main>
  )
}

function formatoFecha(fecha: string | null): string {
  return fecha ? fechaSoloDia(fecha) : 'sin fecha'
}

/** One roster row: the participant, their attendance at THIS jornada, and the toggle to record it. */
function FilaRoster({
  participante,
  jornadaId,
  puedeEscribir,
  accion,
}: {
  participante: ParticipanteConAsistencia
  jornadaId: string
  puedeEscribir: boolean
  accion: (f: FormData) => Promise<void>
}) {
  const asistio = participante.asistioEnJornada
  return (
    <li className="flex flex-wrap items-baseline gap-2 py-2 text-sm">
      <span className="text-barro-900">{participante.nombre}</span>
      <span className="text-barro-500">
        {participante.asistencias} {participante.asistencias === 1 ? 'sesión' : 'sesiones'}
      </span>
      {asistio === true && <span className="text-xs text-selva-700">asistió</span>}
      {asistio === false && <span className="text-xs text-rose-700">no asistió</span>}
      {asistio === null && <span className="text-xs text-barro-400">sin registrar</span>}
      {puedeEscribir && (
        <div className="ml-auto flex items-center gap-3">
          <form action={accion}>
            <input type="hidden" name="jornadaId" value={jornadaId} />
            <input type="hidden" name="participanteId" value={participante.id} />
            <input type="hidden" name="asistio" value="1" />
            <button type="submit" className="text-xs text-selva-700 underline-offset-2 hover:underline">
              marcar asistió
            </button>
          </form>
          <form action={accion}>
            <input type="hidden" name="jornadaId" value={jornadaId} />
            <input type="hidden" name="participanteId" value={participante.id} />
            <input type="hidden" name="asistio" value="0" />
            <button type="submit" className="text-xs text-rose-700 underline-offset-2 hover:underline">
              marcar no asistió
            </button>
          </form>
        </div>
      )}
    </li>
  )
}

function EstadoPill({ estado }: { estado: string }) {
  const tono =
    estado === 'completada'
      ? 'bg-selva-50 text-selva-700'
      : estado === 'cancelada'
        ? 'bg-rose-50 text-rose-700'
        : estado === 'en_curso'
          ? 'bg-atrato-50 text-atrato-700'
          : 'bg-barro-100 text-barro-700'
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${tono}`}>
      {ETIQUETA_ESTADO_JORNADA[estado as EstadoJornada] ?? estado}
    </span>
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
