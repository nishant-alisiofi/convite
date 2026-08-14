import { CircleSlash, Pencil, Plus, RotateCcw, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { MODOS, TEMPORADAS } from '@/db/schema/vocabulario'
import {
  comunidadesParaRutas,
  comunidadesQueQuedanSinPaso,
  crearRuta,
  desactivarRuta,
  editarRuta,
  esquemaRuta,
  listarRutas,
  reactivarRuta,
  rutaPorId,
  type FilaRuta,
} from '@/lib/rutas/editor'
import { conSesion, sesionActual } from '@/lib/sesion'
import { temporadaVigente } from '@/lib/temporada'

export const dynamic = 'force-dynamic'

/**
 * The river-route editor.
 *
 * A first-class screen, not a settings page: 22 of the 36 legs in this basin are river, no
 * provider has data for any of them, and this is where they get entered. Nothing here calls
 * out to anything.
 *
 * Server-rendered with no client JavaScript, including the confirmation before a leg is
 * closed — that is a second page with the consequences on it and a reason to fill in, which
 * is a better confirmation than a dialog anyway: it can say that closing this one row
 * strands Tagachí, Beté and Bellavista.
 */

/** Section 11: rol_staff gates the UI, RLS gates the data. This is the first half. */
const PUEDEN_EDITAR = ['coordinador', 'admin']

type Params = Promise<{ editar?: string; cerrar?: string; error?: string }>

export default async function Rutas({ searchParams }: { searchParams: Params }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { editar, cerrar, error } = await searchParams
  const puedeEditar = PUEDEN_EDITAR.includes(sesion.rolStaff)

  const { rutas, comunidades, enEdicion, aCerrar, quedanSinPaso, temporada } = await conSesion(
    sesion,
    async (client) => {
      const temporada = await temporadaVigente(client)
      return {
        temporada,
        rutas: await listarRutas(client),
        comunidades: await comunidadesParaRutas(client),
        enEdicion: editar ? await rutaPorId(client, editar) : null,
        aCerrar: cerrar ? await rutaPorId(client, cerrar) : null,
        quedanSinPaso: cerrar
          ? await comunidadesQueQuedanSinPaso(client, cerrar, temporada)
          : [],
      }
    },
  )

  async function guardar(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_EDITAR.includes(sesion.rolStaff)) redirect('/rutas?error=Sin+permiso')

    const analisis = esquemaRuta.safeParse(Object.fromEntries(formData))
    if (!analisis.success) {
      const primero = analisis.error.issues[0]
      redirect(`/rutas?error=${encodeURIComponent(primero?.message ?? 'Datos inválidos.')}`)
    }

    const id = formData.get('id')
    const resultado = await conSesion(
      sesion,
      (client) =>
        typeof id === 'string' && id.length > 0
          ? editarRuta(client, id, analisis.data, sesion.authId)
          : crearRuta(client, analisis.data, sesion.authId),
      { escribe: true },
    )

    if (!resultado.ok) redirect(`/rutas?error=${encodeURIComponent(resultado.error)}`)
    revalidatePath('/rutas')
    redirect('/rutas')
  }

  async function cerrarTramo(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_EDITAR.includes(sesion.rolStaff)) redirect('/rutas?error=Sin+permiso')

    const id = String(formData.get('id') ?? '')
    const motivo = String(formData.get('motivo') ?? '')
    const resultado = await conSesion(
      sesion,
      (client) => desactivarRuta(client, id, motivo, sesion.authId),
      { escribe: true },
    )

    if (!resultado.ok) {
      redirect(`/rutas?cerrar=${id}&error=${encodeURIComponent(resultado.error)}`)
    }
    revalidatePath('/rutas')
    redirect('/rutas')
  }

  async function reabrir(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_EDITAR.includes(sesion.rolStaff)) redirect('/rutas?error=Sin+permiso')

    const id = String(formData.get('id') ?? '')
    const resultado = await conSesion(sesion, (client) => reactivarRuta(client, id, sesion.authId), {
      escribe: true,
    })

    if (!resultado.ok) redirect(`/rutas?error=${encodeURIComponent(resultado.error)}`)
    revalidatePath('/rutas')
    redirect('/rutas')
  }

  const activas = rutas.filter((r) => r.activa)
  const cerradas = rutas.filter((r) => !r.activa)

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-stone-900">Rutas</h1>
        <p className="text-sm text-stone-600">
          {activas.length} tramos abiertos · {cerradas.length} cerrados · temporada {temporada}
        </p>
      </div>

      <p className="mt-2 max-w-3xl text-sm text-stone-700">
        Los tramos fluviales los escribe quien conoce el río: no hay proveedor con datos del
        Atrato, y este grafo es el que el emparejador usa para decidir a dónde se puede llegar.
        Nada en esta pantalla consulta un servicio externo.
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </p>
      )}

      {aCerrar && puedeEditar && (
        <section className="mt-6 rounded-lg border border-rose-300 bg-rose-50 px-4 py-4">
          <h2 className="flex items-center gap-2 font-semibold text-stone-900">
            <TriangleAlert className="size-4" aria-hidden />
            Cerrar {aCerrar.origen} → {aCerrar.destino}
          </h2>
          <p className="mt-1 text-sm text-stone-800">
            {aCerrar.modo} · {aCerrar.temporada}
            {aCerrar.minutos !== null && ` · ${aCerrar.minutos} min`}
          </p>

          {quedanSinPaso.length > 0 ? (
            <p className="mt-3 text-sm font-medium text-rose-900">
              Si cierra este tramo, {quedanSinPaso.join(', ')}{' '}
              {quedanSinPaso.length === 1 ? 'queda incomunicada' : 'quedan incomunicadas'}: no hay
              otra forma de llegar en temporada {temporada}.
            </p>
          ) : (
            <p className="mt-3 text-sm text-stone-800">
              Ninguna comunidad queda incomunicada: hay otro camino en temporada {temporada}.
            </p>
          )}

          <form action={cerrarTramo} className="mt-4">
            <input type="hidden" name="id" value={aCerrar.id} />
            <label className="block text-sm font-medium text-stone-800" htmlFor="motivo">
              ¿Por qué se cierra?
            </label>
            <textarea
              id="motivo"
              name="motivo"
              required
              rows={2}
              defaultValue={aCerrar.notas ?? ''}
              placeholder="Bajó una palizada y tapó el paso."
              className="mt-1 w-full max-w-xl rounded border border-barro-200 bg-white px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-stone-600">
              Queda registrado con su nombre y la fecha. Un daño reportado no cierra un tramo
              por sí solo: lo cierra una persona.
            </p>
            <div className="mt-3 flex gap-3">
              <button
                type="submit"
                className="rounded bg-rose-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-800"
              >
                Cerrar el tramo
              </button>
              <Link href="/rutas" className="px-3 py-1.5 text-sm text-stone-700 underline">
                Cancelar
              </Link>
            </div>
          </form>
        </section>
      )}

      {puedeEditar && (
        <section className="mt-6 rounded-lg border border-barro-200 bg-white px-4 py-4">
          <h2 className="flex items-center gap-2 font-semibold text-stone-900">
            {enEdicion ? <Pencil className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
            {enEdicion ? `Editar ${enEdicion.origen} → ${enEdicion.destino}` : 'Nuevo tramo'}
          </h2>

          <form action={guardar} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {enEdicion && <input type="hidden" name="id" value={enEdicion.id} />}

            <Campo etiqueta="Origen">
              <select name="origenId" defaultValue={enEdicion?.origenId ?? ''} required className={CLASE_CAMPO}>
                <option value="">…</option>
                {comunidades.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo etiqueta="Destino">
              <select name="destinoId" defaultValue={enEdicion?.destinoId ?? ''} required className={CLASE_CAMPO}>
                <option value="">…</option>
                {comunidades.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo etiqueta="Modo">
              <select name="modo" defaultValue={enEdicion?.modo ?? 'lancha'} className={CLASE_CAMPO}>
                {MODOS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo etiqueta="Temporada">
              <select
                name="temporada"
                defaultValue={enEdicion?.temporada ?? 'todo_el_ano'}
                className={CLASE_CAMPO}
              >
                {TEMPORADAS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Campo>

            <Campo etiqueta="Minutos" ayuda="Vacío si nadie lo ha cronometrado.">
              <input
                name="minutos"
                inputMode="numeric"
                defaultValue={enEdicion?.minutos ?? ''}
                className={CLASE_CAMPO}
              />
            </Campo>

            <Campo etiqueta="Distancia (m)" ayuda="Vacío en tramos de río: nadie ha medido el canal.">
              <input
                name="distanciaM"
                inputMode="numeric"
                defaultValue={enEdicion?.distanciaM ?? ''}
                className={CLASE_CAMPO}
              />
            </Campo>

            <Campo etiqueta="Costo (COP)">
              <input
                name="costoEstimadoCop"
                inputMode="numeric"
                defaultValue={enEdicion?.costoEstimadoCop ?? ''}
                className={CLASE_CAMPO}
              />
            </Campo>

            <Campo etiqueta="Notas">
              <input name="notas" defaultValue={enEdicion?.notas ?? ''} className={CLASE_CAMPO} />
            </Campo>

            <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-4">
              <button
                type="submit"
                className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
              >
                {enEdicion ? 'Guardar cambios' : 'Agregar tramo'}
              </button>
              {enEdicion && (
                <Link href="/rutas" className="text-sm text-stone-700 underline">
                  Cancelar
                </Link>
              )}
            </div>
          </form>
        </section>
      )}

      <Tabla titulo="Abiertos" rutas={activas} puedeEditar={puedeEditar} accionReabrir={reabrir} />
      {cerradas.length > 0 && (
        <Tabla titulo="Cerrados" rutas={cerradas} puedeEditar={puedeEditar} accionReabrir={reabrir} />
      )}
    </main>
  )
}

const CLASE_CAMPO = 'mt-1 w-full rounded border border-barro-200 bg-white px-2 py-1.5 text-sm'

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
      <span className="font-medium text-stone-800">{etiqueta}</span>
      {children}
      {ayuda && <span className="mt-0.5 block text-xs text-stone-600">{ayuda}</span>}
    </label>
  )
}

function Tabla({
  titulo,
  rutas,
  puedeEditar,
  accionReabrir,
}: {
  titulo: string
  rutas: FilaRuta[]
  puedeEditar: boolean
  accionReabrir: (formData: FormData) => Promise<void>
}) {
  return (
    <section className="mt-8">
      <h2 className="font-semibold text-stone-900">
        {titulo}
        <span className="ml-2 font-normal text-stone-600">{rutas.length}</span>
      </h2>

      <ul className="mt-3 divide-y divide-stone-200 rounded-lg border border-barro-200 bg-white">
        {rutas.map((r) => (
          <li key={r.id} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-medium text-stone-900">
                {r.origen} → {r.destino}
              </span>
              <span className="text-stone-600">{r.modo}</span>
              <span className="text-stone-500">{r.temporada}</span>
              <span className="text-stone-600">
                {r.minutos === null ? 'sin tiempo' : `${r.minutos} min`}
              </span>
              {r.costoEstimadoCop !== null && (
                <span className="text-stone-600">
                  ${r.costoEstimadoCop.toLocaleString('es-CO')}
                </span>
              )}

              {puedeEditar && (
                <span className="ml-auto flex items-center gap-3">
                  <Link
                    href={`/rutas?editar=${r.id}`}
                    className="flex items-center gap-1 text-stone-700 underline"
                  >
                    <Pencil className="size-3.5" aria-hidden />
                    Editar
                  </Link>
                  {r.activa ? (
                    <Link
                      href={`/rutas?cerrar=${r.id}`}
                      className="flex items-center gap-1 text-rose-800 underline"
                    >
                      <CircleSlash className="size-3.5" aria-hidden />
                      Cerrar
                    </Link>
                  ) : (
                    <form action={accionReabrir}>
                      <input type="hidden" name="id" value={r.id} />
                      <button
                        type="submit"
                        className="flex items-center gap-1 text-selva-700 underline"
                      >
                        <RotateCcw className="size-3.5" aria-hidden />
                        Reabrir
                      </button>
                    </form>
                  )}
                </span>
              )}
            </div>

            {r.notas && <p className="mt-1 text-sm text-stone-700">{r.notas}</p>}

            {!r.activa && r.desactivadaEn && (
              <p className="mt-1 text-xs text-stone-600">
                Cerrado el {r.desactivadaEn.toLocaleDateString('es-CO')}
                {r.desactivadaPor && ' por un miembro del equipo'}.
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
