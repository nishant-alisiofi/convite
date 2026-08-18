import { Ship, Users } from 'lucide-react'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  catalogoActivo,
  comunidadesDeOrganizacion,
  lancherosDeOrganizacion,
  registrarLanchero,
  registrarReporteRelevo,
  reportesRelevoRecientes,
} from '@/lib/relevo'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * Red de lancheros — PRD-47.
 *
 * Upriver, a lanchero passing through a community with no channel at all can carry a report out
 * and hand it to a coordinator once they reach connectivity. Built on stated assumptions (flag
 * for partner review): a lanchero is a REGISTERED, VETTED relay, never an anonymous self-signup —
 * mirroring the vetted stance FR-18 drew for transport. Register one against the communities on
 * their route, then relay what they carried out; a verifier always sees who relayed it and for
 * which community.
 */

const CLASE_CAMPO = 'mt-1 block w-full rounded border border-barro-300 px-3 py-2 text-barro-900'
const CLASE_BOTON = 'rounded bg-selva-600 px-4 py-2 text-sm font-medium text-white hover:bg-selva-700'

const PUEDEN_REGISTRAR = ['coordinador', 'admin']
const PUEDEN_RELEVAR = ['verificador', 'coordinador', 'admin']

type Params = Promise<{ error?: string; ok?: string }>

export default async function Relevo({ searchParams }: { searchParams: Params }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { error, ok } = await searchParams
  const puedeRegistrar = PUEDEN_REGISTRAR.includes(sesion.rolStaff)
  const puedeRelevar = PUEDEN_RELEVAR.includes(sesion.rolStaff)

  const { comunidades, catalogo, lancheros, recientes } = await conSesion(sesion, async (client) => ({
    comunidades: await comunidadesDeOrganizacion(client, sesion.organizacionId),
    catalogo: await catalogoActivo(client),
    lancheros: await lancherosDeOrganizacion(client, sesion.organizacionId),
    recientes: await reportesRelevoRecientes(client),
  }))

  async function accionRegistrar(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion) redirect('/entrar')
    if (!PUEDEN_REGISTRAR.includes(sesion.rolStaff)) {
      redirect(`/relevo?error=${encodeURIComponent('Su rol no puede registrar lancheros.')}`)
    }

    const resultado = await conSesion(
      sesion,
      (client) =>
        registrarLanchero(client, {
          nombre: String(formData.get('nombre') ?? ''),
          telefono: String(formData.get('telefono') ?? ''),
          comunidadIds: formData.getAll('comunidadIds').map((v) => String(v)),
        }),
      { escribe: true },
    )

    if (!resultado.ok) {
      redirect(`/relevo?error=${encodeURIComponent(resultado.error)}`)
    }
    revalidatePath('/relevo')
    redirect(`/relevo?ok=${encodeURIComponent('Lanchero registrado con su cobertura.')}`)
  }

  async function accionRelevar(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion) redirect('/entrar')
    if (!PUEDEN_RELEVAR.includes(sesion.rolStaff)) {
      redirect(`/relevo?error=${encodeURIComponent('Su rol no puede registrar relevos.')}`)
    }

    const familiasRaw = String(formData.get('familias') ?? '').trim()
    const urgenciaRaw = String(formData.get('urgencia') ?? '').trim()

    const resultado = await conSesion(
      sesion,
      (client) =>
        registrarReporteRelevo(client, {
          lancheroId: String(formData.get('lancheroId') ?? ''),
          comunidadId: String(formData.get('comunidadId') ?? ''),
          codigoItem: String(formData.get('codigoItem') ?? '') || null,
          familias: familiasRaw ? Number(familiasRaw) : null,
          urgencia: urgenciaRaw ? Number(urgenciaRaw) : null,
          detalle: String(formData.get('detalle') ?? ''),
        }),
      { escribe: true },
    )

    if (!resultado.ok) {
      redirect(`/relevo?error=${encodeURIComponent(resultado.error)}`)
    }
    revalidatePath('/relevo')
    redirect(
      `/relevo?ok=${encodeURIComponent(
        `Relevo registrado con el número ${resultado.folio}. Espera verificación.`,
      )}`,
    )
  }

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-barro-900">
          <Ship className="size-5" aria-hidden />
          Red de lancheros
        </h1>
        <p className="text-sm text-barro-600">Un sneakernet humano para las comunidades sin señal</p>
      </div>

      <p className="mt-2 max-w-3xl text-sm text-barro-700">
        Algunas comunidades río arriba no tienen ningún canal: ni WhatsApp, ni SMS, ni señal para
        una llamada perdida. Pero un lanchero pasa por ellas y luego llega a un pueblo con
        conectividad. Aquí se registra un lanchero de confianza contra las comunidades de su ruta,
        y se releva lo que trajo — nunca de forma anónima: el reporte queda con el lanchero y la
        comunidad de origen, para que quien verifique vea la cadena completa.
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

      <section className="mt-8">
        <h2 className="font-semibold text-barro-900">Registrar un lanchero</h2>
        <p className="mt-1 max-w-3xl text-sm text-barro-700">
          Un lanchero es un contacto de confianza, nunca un autoregistro anónimo. Márquelo con las
          comunidades de su ruta — solo podrá relevar reportes de esas comunidades.
        </p>

        {!puedeRegistrar ? (
          <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
            Su rol puede leer esta pantalla pero no registrar lancheros.
          </p>
        ) : comunidades.length === 0 ? (
          <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
            Todavía no hay comunidades en su organización. Regístrelas primero.
          </p>
        ) : (
          <form
            action={accionRegistrar}
            className="mt-4 max-w-2xl space-y-3 rounded-lg border border-barro-200 bg-white p-4"
          >
            <label className="block text-sm">
              <span className="text-barro-700">Nombre</span>
              <input name="nombre" required className={CLASE_CAMPO} placeholder="Don Elkin" />
            </label>
            <label className="block text-sm">
              <span className="text-barro-700">Teléfono</span>
              <input
                name="telefono"
                required
                placeholder="+573001234567"
                className={CLASE_CAMPO}
              />
              <span className="mt-0.5 block text-xs text-barro-500">Formato internacional, con +.</span>
            </label>
            <fieldset className="rounded border border-barro-200 p-3">
              <legend className="px-1 text-xs uppercase tracking-wide text-barro-500">
                Comunidades de su ruta
              </legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {comunidades.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm text-barro-800">
                    <input type="checkbox" name="comunidadIds" value={c.id} />
                    {c.nombre} · {c.municipio}
                  </label>
                ))}
              </div>
            </fieldset>
            <button type="submit" className={CLASE_BOTON}>
              Registrar lanchero
            </button>
          </form>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-semibold text-barro-900">Relevar un reporte</h2>

        {!puedeRelevar ? (
          <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
            Su rol puede leer esta pantalla pero no registrar relevos.
          </p>
        ) : lancheros.length === 0 ? (
          <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
            Todavía no hay lancheros registrados. Registre uno arriba primero.
          </p>
        ) : (
          <form
            action={accionRelevar}
            className="mt-4 max-w-2xl space-y-3 rounded-lg border border-barro-200 bg-white p-4"
          >
            <label className="block text-sm">
              <span className="text-barro-700">Lanchero que releva</span>
              <select name="lancheroId" required className={CLASE_CAMPO}>
                <option value="">…</option>
                {lancheros.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nombre ?? l.telefono} · {l.telefono}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-barro-700">Comunidad de origen</span>
              <select name="comunidadId" required className={CLASE_CAMPO}>
                <option value="">…</option>
                {comunidades.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} · {c.municipio}
                  </option>
                ))}
              </select>
              <span className="mt-0.5 block text-xs text-barro-500">
                Debe ser una comunidad de la ruta del lanchero elegido.
              </span>
            </label>
            <label className="block text-sm">
              <span className="text-barro-700">
                Qué se necesita (opcional — un verificador lo confirma)
              </span>
              <select name="codigoItem" className={CLASE_CAMPO}>
                <option value="">Sin clasificar</option>
                {catalogo.map((it) => (
                  <option key={it.codigo} value={it.codigo}>
                    {it.codigo} · {it.itemLabel} ({it.familiaLabel})
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-barro-700">Familias (opcional)</span>
                <input name="familias" type="number" min={1} inputMode="numeric" className={CLASE_CAMPO} />
              </label>
              <label className="block text-sm">
                <span className="text-barro-700">Urgencia (opcional)</span>
                <select name="urgencia" className={CLASE_CAMPO}>
                  <option value="">Sin definir</option>
                  <option value="1">1 · rutinaria</option>
                  <option value="2">2 · elevada</option>
                  <option value="3">3 · urgente</option>
                </select>
              </label>
            </div>
            <label className="block text-sm">
              <span className="text-barro-700">Detalle</span>
              <textarea
                name="detalle"
                rows={3}
                placeholder="Lo que el lanchero contó, tal cual lo trajo."
                className={CLASE_CAMPO}
              />
            </label>
            <p className="text-xs text-barro-500">
              Elija un ítem del catálogo o escriba el detalle — uno de los dos, al menos.
            </p>
            <button type="submit" className={CLASE_BOTON}>
              Registrar relevo
            </button>
          </form>
        )}
      </section>

      {lancheros.length > 0 && (
        <section className="mt-10">
          <h2 className="font-semibold text-barro-900">Lancheros registrados</h2>
          <ul className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
            {lancheros.map((l) => (
              <li key={l.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-barro-900">{l.nombre ?? l.telefono}</span>
                  <span className="text-barro-500">{l.telefono}</span>
                </div>
                <p className="mt-1 flex items-center gap-1 text-barro-600">
                  <Users className="size-3.5" aria-hidden />
                  {l.comunidades.map((c) => c.nombre).join(', ')}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recientes.length > 0 && (
        <section className="mt-10">
          <h2 className="font-semibold text-barro-900">Relevos recientes</h2>
          <ul className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
            {recientes.map((r) => (
              <li key={r.folio} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium text-barro-900">#{r.folio}</span>
                  {r.comunidad && <span className="text-barro-700">{r.comunidad}</span>}
                  {r.municipio && <span className="text-barro-500">· {r.municipio}</span>}
                  <span className="rounded border border-barro-200 px-1.5 py-0.5 text-xs text-barro-600">
                    {r.estado}
                  </span>
                  <span className="ml-auto text-xs text-barro-500">
                    relevado por {r.lancheroNombre ?? 'lanchero'}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-2 text-xs text-barro-500">
                  <span>
                    {r.item ?? r.tipo.replace(/_/g, ' ')}
                    {r.familias != null && ` · ${r.familias} familias`}
                  </span>
                </div>
                {r.detalle && <p className="mt-1 text-barro-700">{r.detalle}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
