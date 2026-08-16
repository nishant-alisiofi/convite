import { MapPin, MapPinned, PlusCircle } from 'lucide-react'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { TIPOS_COMUNIDAD } from '@/db/schema/vocabulario'
import { fechaCorta } from '@/lib/fechas'
import {
  coincidencias,
  comunidadesDelRegistro,
  crearPropuesta,
  propuestasVisibles,
  resolverPropuesta,
  type Coincidencia,
} from '@/lib/registro'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * The shared community gazetteer's correction desk (PRD-35, §29.3b).
 *
 * Communities are a common registry, seeded unverified on purpose — the territory is what makes a
 * row true. This screen is how the territory corrects it: propose a fix to an existing community
 * (a better name, a real coordinate, or that it does not exist), or propose one the registry lacks —
 * matched by name and proximity against what is already there so «Bellavista» is never entered
 * twice. A coordinator reviews each; accepting stamps it verified.
 */

const PUEDEN_VER = ['verificador', 'coordinador', 'admin']
const PUEDEN_RESOLVER = ['coordinador', 'admin']

const ETIQUETA_TIPO_COMUNIDAD: Record<string, string> = {
  cabecera: 'cabecera',
  corregimiento: 'corregimiento',
  vereda: 'vereda',
  resguardo: 'resguardo',
  consejo_comunitario: 'consejo comunitario',
}

type Params = Promise<{ error?: string; ok?: string }>

function num(formData: FormData, name: string): number | null {
  const raw = String(formData.get(name) ?? '').trim()
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function dupesDe(dupes: Record<string, Coincidencia[]>, id: string): Coincidencia[] {
  return dupes[id] ?? []
}

export default async function Registro({ searchParams }: { searchParams: Params }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  if (!PUEDEN_VER.includes(sesion.rolStaff)) {
    return (
      <main>
        <h1 className="text-xl font-semibold text-barro-900">Registro común</h1>
        <p className="mt-4 max-w-2xl text-barro-700">Su rol no ve el registro común.</p>
      </main>
    )
  }

  const { error, ok } = await searchParams
  const puedeResolver = PUEDEN_RESOLVER.includes(sesion.rolStaff)

  const { propuestas, comunidades, dupes } = await conSesion(sesion, async (client) => {
    const propuestas = await propuestasVisibles(client)
    const comunidades = await comunidadesDelRegistro(client, sesion.organizacionId)
    const dupes: Record<string, Coincidencia[]> = {}
    for (const p of propuestas) {
      if (p.estado === 'pendiente' && p.tipoPropuesta === 'nueva' && p.nombrePropuesto) {
        dupes[p.id] = await coincidencias(client, {
          nombre: p.nombrePropuesto,
          lat: p.lat,
          lon: p.lon,
        })
      }
    }
    return { propuestas, comunidades, dupes }
  })

  async function accion(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion) redirect('/entrar')

    const que = String(formData.get('accion') ?? '')

    const resultado = await conSesion(
      sesion,
      async (client) => {
        switch (que) {
          case 'correccion': {
            const noExiste = formData.get('noExiste') === 'on'
            return crearPropuesta(client, {
              tipoPropuesta: 'correccion',
              organizacionId: sesion.organizacionId,
              propuestoPor: sesion.authId,
              comunidadId: String(formData.get('comunidadId') ?? ''),
              nombrePropuesto: String(formData.get('nombrePropuesto') ?? ''),
              lat: num(formData, 'lat'),
              lon: num(formData, 'lon'),
              ubicacionPrecisionM: num(formData, 'precision'),
              existeReal: noExiste ? false : null,
              motivo: String(formData.get('motivo') ?? ''),
            })
          }
          case 'nueva':
            return crearPropuesta(client, {
              tipoPropuesta: 'nueva',
              organizacionId: sesion.organizacionId,
              propuestoPor: sesion.authId,
              nombrePropuesto: String(formData.get('nombrePropuesto') ?? ''),
              municipioPropuesto: String(formData.get('municipioPropuesto') ?? ''),
              tipoComunidadPropuesto: String(formData.get('tipoComunidad') ?? '') || null,
              lat: num(formData, 'lat'),
              lon: num(formData, 'lon'),
              ubicacionPrecisionM: num(formData, 'precision'),
              motivo: String(formData.get('motivo') ?? ''),
            })
          case 'aceptar':
          case 'rechazar':
            if (!PUEDEN_RESOLVER.includes(sesion.rolStaff)) {
              return { ok: false as const, error: 'Su rol no puede resolver propuestas.' }
            }
            return resolverPropuesta(client, {
              propuestaId: String(formData.get('propuestaId') ?? ''),
              aceptar: que === 'aceptar',
              nota: String(formData.get('nota') ?? '') || null,
            })
          default:
            return { ok: false as const, error: 'Acción desconocida.' }
        }
      },
      { escribe: true },
    )

    if (!resultado.ok) {
      redirect(`/registro?error=${encodeURIComponent(resultado.error)}`)
    }
    revalidatePath('/registro')
    const nota =
      que === 'aceptar'
        ? 'Propuesta aceptada. La comunidad quedó verificada.'
        : que === 'rechazar'
          ? 'Propuesta rechazada.'
          : 'Propuesta registrada. Espera revisión de coordinación.'
    redirect(`/registro?ok=${encodeURIComponent(nota)}`)
  }

  const pendientes = propuestas.filter((p) => p.estado === 'pendiente')
  const resueltas = propuestas.filter((p) => p.estado !== 'pendiente')

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-barro-900">
          <MapPinned className="size-5" aria-hidden />
          Registro común
        </h1>
        <p className="text-sm text-barro-600">
          {pendientes.length === 0
            ? 'Sin propuestas pendientes'
            : `${pendientes.length} propuesta${pendientes.length === 1 ? '' : 's'} pendiente${
                pendientes.length === 1 ? '' : 's'
              }`}
        </p>
      </div>

      <p className="mt-2 max-w-3xl text-sm text-barro-700">
        Las comunidades son un registro compartido: todas las organizaciones ven las mismas, y nadie
        las «posee». Vienen sin verificar a propósito — es el territorio el que las confirma. Aquí se
        propone una corrección a una comunidad (su nombre, su ubicación, o que no existe) o una
        comunidad nueva, comparada por nombre y cercanía con lo que ya hay para no registrar dos veces
        el mismo pueblo. Coordinación revisa; al aceptar, queda verificada.
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </p>
      )}
      {ok && (
        <p className="mt-4 rounded-lg border border-selva-600 bg-selva-50 px-4 py-3 text-sm text-selva-900">
          {ok}
        </p>
      )}

      {/* ── Pending review ────────────────────────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="font-semibold text-barro-900">Propuestas por revisar</h2>
        {pendientes.length === 0 ? (
          <p className="mt-3 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
            No hay propuestas pendientes.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {pendientes.map((p) => (
              <li key={p.id} className="rounded-lg border border-barro-200 bg-white p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="rounded bg-barro-100 px-1.5 py-0.5 text-xs font-medium text-barro-700">
                    {p.tipoPropuesta === 'nueva' ? 'Comunidad nueva' : 'Corrección'}
                  </span>
                  <span className="text-xs text-barro-500">
                    {p.propuestoPorNombre ? `Propuso ${p.propuestoPorNombre}` : 'Propuesta'}
                    {p.organizacion ? ` · ${p.organizacion}` : ''} · {fechaCorta(p.creadoEn)}
                  </span>
                </div>

                {p.tipoPropuesta === 'correccion' ? (
                  <div className="mt-2 text-sm text-barro-800">
                    <p>
                      <span className="text-barro-500">Comunidad actual: </span>
                      {p.comunidadActual ?? '—'}
                      {p.comunidadMunicipio ? ` · ${p.comunidadMunicipio}` : ''}
                      {p.comunidadVerificada === false && (
                        <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">
                          sin verificar
                        </span>
                      )}
                    </p>
                    <ul className="mt-1 list-disc pl-5 text-barro-700">
                      {p.nombrePropuesto && (
                        <li>
                          Nombre propuesto: <span className="font-medium">{p.nombrePropuesto}</span>
                        </li>
                      )}
                      {p.lat != null && p.lon != null && (
                        <li className="flex items-center gap-1">
                          <MapPin className="size-3.5 text-barro-400" aria-hidden />
                          Ubicación propuesta: {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
                          {p.ubicacionPrecisionM != null && ` · ±${p.ubicacionPrecisionM} m`}
                        </li>
                      )}
                      {p.existeReal === false && (
                        <li className="text-rose-800">Propone que no existe / es duplicada.</li>
                      )}
                    </ul>
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-barro-800">
                    <p>
                      <span className="font-medium">{p.nombrePropuesto}</span>
                      {p.municipioPropuesto ? ` · ${p.municipioPropuesto}` : ''}
                      {p.tipoComunidadPropuesto
                        ? ` · ${ETIQUETA_TIPO_COMUNIDAD[p.tipoComunidadPropuesto] ?? p.tipoComunidadPropuesto}`
                        : ''}
                    </p>
                    {p.lat != null && p.lon != null && (
                      <p className="mt-1 flex items-center gap-1 text-barro-700">
                        <MapPin className="size-3.5 text-barro-400" aria-hidden />
                        {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
                        {p.ubicacionPrecisionM != null && ` · ±${p.ubicacionPrecisionM} m`}
                      </p>
                    )}
                    {dupesDe(dupes, p.id).length > 0 && (
                      <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        <p className="font-medium">Posibles duplicados en el registro:</p>
                        <ul className="mt-1 space-y-0.5">
                          {dupesDe(dupes, p.id).map((d) => (
                            <li key={d.comunidadId}>
                              {d.nombre} · {d.municipio}
                              {d.distanciaM != null && ` · a ${(d.distanciaM / 1000).toFixed(1)} km`}
                              {d.verificado ? ' · verificada' : ' · sin verificar'}
                            </li>
                          ))}
                        </ul>
                        <p className="mt-1">
                          Si es una de estas, rechace y proponga una corrección sobre la existente.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <p className="mt-2 text-sm text-barro-700">
                  <span className="text-barro-500">Motivo: </span>
                  {p.motivo}
                </p>

                {puedeResolver && (
                  <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-barro-100 pt-3">
                    <form action={accion} className="flex flex-1 flex-wrap items-end gap-2">
                      <input type="hidden" name="propuestaId" value={p.id} />
                      <label className="flex-1 text-xs">
                        <span className="text-barro-600">Nota de resolución (opcional)</span>
                        <input
                          name="nota"
                          className="mt-1 block w-full rounded border border-barro-300 px-2 py-1 text-barro-900"
                        />
                      </label>
                      <button
                        type="submit"
                        name="accion"
                        value="aceptar"
                        className="rounded bg-selva-600 px-3 py-1.5 text-xs font-medium text-white"
                      >
                        Aceptar
                      </button>
                      <button
                        type="submit"
                        name="accion"
                        value="rechazar"
                        className="rounded border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-900"
                      >
                        Rechazar
                      </button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Propose a correction ──────────────────────────────────────────────────────────── */}
      <section className="mt-10 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="font-semibold text-barro-900">Corregir una comunidad existente</h2>
          {comunidades.length === 0 ? (
            <p className="mt-3 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
              No hay comunidades de su organización para corregir.
            </p>
          ) : (
            <form
              action={accion}
              className="mt-3 space-y-3 rounded-lg border border-barro-200 bg-white p-4"
            >
              <input type="hidden" name="accion" value="correccion" />
              <label className="block text-sm">
                <span className="text-barro-700">Comunidad</span>
                <select
                  name="comunidadId"
                  required
                  className="mt-1 block w-full rounded border border-barro-300 px-3 py-2 text-barro-900"
                >
                  {comunidades.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre} · {c.municipio}
                      {c.verificado ? '' : ' (sin verificar)'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-barro-700">Nombre corregido (opcional)</span>
                <input
                  name="nombrePropuesto"
                  placeholder="Nombre correcto de la comunidad"
                  className="mt-1 block w-full rounded border border-barro-300 px-3 py-2 text-barro-900"
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="block text-xs">
                  <span className="text-barro-600">Latitud</span>
                  <input
                    name="lat"
                    inputMode="decimal"
                    placeholder="5.69"
                    className="mt-1 block w-full rounded border border-barro-300 px-2 py-1 text-barro-900"
                  />
                </label>
                <label className="block text-xs">
                  <span className="text-barro-600">Longitud</span>
                  <input
                    name="lon"
                    inputMode="decimal"
                    placeholder="-76.66"
                    className="mt-1 block w-full rounded border border-barro-300 px-2 py-1 text-barro-900"
                  />
                </label>
                <label className="block text-xs">
                  <span className="text-barro-600">Radio (m)</span>
                  <input
                    name="precision"
                    type="number"
                    min={1}
                    placeholder="1000"
                    className="mt-1 block w-full rounded border border-barro-300 px-2 py-1 text-barro-900"
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-barro-700">
                <input type="checkbox" name="noExiste" className="size-4" />
                Esta comunidad no existe o es un duplicado
              </label>
              <label className="block text-sm">
                <span className="text-barro-700">Motivo</span>
                <textarea
                  name="motivo"
                  required
                  rows={2}
                  placeholder="Por qué esta corrección — quién lo confirmó, cómo se supo."
                  className="mt-1 block w-full rounded border border-barro-300 px-3 py-2 text-barro-900"
                />
              </label>
              <button
                type="submit"
                className="rounded bg-selva-600 px-4 py-2 text-sm font-medium text-white"
              >
                Proponer corrección
              </button>
            </form>
          )}
        </div>

        {/* ── Propose a new community ───────────────────────────────────────────────────────── */}
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-barro-900">
            <PlusCircle className="size-4" aria-hidden />
            Proponer una comunidad nueva
          </h2>
          <form
            action={accion}
            className="mt-3 space-y-3 rounded-lg border border-barro-200 bg-white p-4"
          >
            <input type="hidden" name="accion" value="nueva" />
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-barro-700">Nombre</span>
                <input
                  name="nombrePropuesto"
                  required
                  className="mt-1 block w-full rounded border border-barro-300 px-3 py-2 text-barro-900"
                />
              </label>
              <label className="block text-sm">
                <span className="text-barro-700">Municipio</span>
                <input
                  name="municipioPropuesto"
                  required
                  className="mt-1 block w-full rounded border border-barro-300 px-3 py-2 text-barro-900"
                />
              </label>
            </div>
            <label className="block text-sm">
              <span className="text-barro-700">Tipo</span>
              <select
                name="tipoComunidad"
                className="mt-1 block w-full rounded border border-barro-300 px-3 py-2 text-barro-900"
              >
                {TIPOS_COMUNIDAD.map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETA_TIPO_COMUNIDAD[t] ?? t}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="block text-xs">
                <span className="text-barro-600">Latitud</span>
                <input
                  name="lat"
                  inputMode="decimal"
                  className="mt-1 block w-full rounded border border-barro-300 px-2 py-1 text-barro-900"
                />
              </label>
              <label className="block text-xs">
                <span className="text-barro-600">Longitud</span>
                <input
                  name="lon"
                  inputMode="decimal"
                  className="mt-1 block w-full rounded border border-barro-300 px-2 py-1 text-barro-900"
                />
              </label>
              <label className="block text-xs">
                <span className="text-barro-600">Radio (m)</span>
                <input
                  name="precision"
                  type="number"
                  min={1}
                  className="mt-1 block w-full rounded border border-barro-300 px-2 py-1 text-barro-900"
                />
              </label>
            </div>
            <label className="block text-sm">
              <span className="text-barro-700">Motivo</span>
              <textarea
                name="motivo"
                required
                rows={2}
                placeholder="Por qué debería estar en el registro."
                className="mt-1 block w-full rounded border border-barro-300 px-3 py-2 text-barro-900"
              />
            </label>
            <button
              type="submit"
              className="rounded bg-selva-600 px-4 py-2 text-sm font-medium text-white"
            >
              Proponer comunidad
            </button>
          </form>
        </div>
      </section>

      {/* ── Resolved ──────────────────────────────────────────────────────────────────────── */}
      {resueltas.length > 0 && (
        <section className="mt-10">
          <h2 className="font-semibold text-barro-900">Propuestas resueltas</h2>
          <ul className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
            {resueltas.map((p) => (
              <li key={p.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                      p.estado === 'aceptada'
                        ? 'bg-selva-50 text-selva-900'
                        : 'bg-rose-50 text-rose-900'
                    }`}
                  >
                    {p.estado}
                  </span>
                  <span className="text-barro-800">
                    {p.tipoPropuesta === 'nueva'
                      ? p.nombrePropuesto
                      : (p.nombrePropuesto ?? p.comunidadActual ?? 'corrección')}
                  </span>
                  {p.resueltoEn && (
                    <span className="ml-auto text-xs text-barro-500">{fechaCorta(p.resueltoEn)}</span>
                  )}
                </div>
                {p.notaResolucion && <p className="mt-1 text-barro-600">{p.notaResolucion}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
