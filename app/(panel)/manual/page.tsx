import { PencilLine } from 'lucide-react'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  catalogoActivo,
  comunidadesDeOrganizacion,
  registrarReporteManual,
  reportesManualesRecientes,
} from '@/lib/manual'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * Manual entry — the zeroth channel (PRD-35, §29.3b).
 *
 * Stage-0 setup must work with no channel at all. Once the data agreement is signed, a coordinator
 * types in reports they are already receiving — by phone, on paper, in a WhatsApp group. Every such
 * record is an ordinary report tagged `canal = 'manual'`, born RECIBIDO like any other, carrying the
 * person who entered it. A live channel attaches later and nothing already entered changes. This is
 * the screen for that: pick a community, say what is needed, and it enters the verification queue.
 */

const PUEDEN_REGISTRAR = ['verificador', 'coordinador', 'admin']

type Params = Promise<{ error?: string; ok?: string }>

export default async function Manual({ searchParams }: { searchParams: Params }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { error, ok } = await searchParams
  const puedeRegistrar = PUEDEN_REGISTRAR.includes(sesion.rolStaff)

  const { comunidades, catalogo, recientes } = await conSesion(sesion, async (client) => ({
    comunidades: await comunidadesDeOrganizacion(client, sesion.organizacionId),
    catalogo: await catalogoActivo(client),
    recientes: await reportesManualesRecientes(client),
  }))

  async function accion(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion) redirect('/entrar')
    if (!PUEDEN_REGISTRAR.includes(sesion.rolStaff)) {
      redirect(`/manual?error=${encodeURIComponent('Su rol no puede registrar reportes manuales.')}`)
    }

    const familiasRaw = String(formData.get('familias') ?? '').trim()
    const urgenciaRaw = String(formData.get('urgencia') ?? '').trim()

    const resultado = await conSesion(
      sesion,
      (client) =>
        registrarReporteManual(client, {
          comunidadId: String(formData.get('comunidadId') ?? ''),
          codigoItem: String(formData.get('codigoItem') ?? '') || null,
          familias: familiasRaw ? Number(familiasRaw) : null,
          urgencia: urgenciaRaw ? Number(urgenciaRaw) : null,
          detalle: String(formData.get('detalle') ?? ''),
        }),
      { escribe: true },
    )

    if (!resultado.ok) {
      redirect(`/manual?error=${encodeURIComponent(resultado.error)}`)
    }
    revalidatePath('/manual')
    redirect(
      `/manual?ok=${encodeURIComponent(
        `Reporte registrado con el número ${resultado.folio}. Espera verificación.`,
      )}`,
    )
  }

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-barro-900">
          <PencilLine className="size-5" aria-hidden />
          Entrada manual
        </h1>
        <p className="text-sm text-barro-600">El canal cero, sin trámite de Meta</p>
      </div>

      <p className="mt-2 max-w-3xl text-sm text-barro-700">
        Antes de que exista un canal, la respuesta ya está pasando: la gente llama, escribe al grupo,
        avisa en papel. Aquí se registra lo que ya está recibiendo. Cada reporte queda con el canal
        «manual» y con su nombre, entra a la misma cola de verificación que cualquier otro, y no
        cambia cuando después se conecte WhatsApp o la radio.
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
        <h2 className="font-semibold text-barro-900">Registrar un reporte</h2>

        {!puedeRegistrar ? (
          <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
            Su rol puede leer esta pantalla pero no registrar reportes manuales.
          </p>
        ) : comunidades.length === 0 ? (
          <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
            Todavía no hay comunidades en su organización. Regístrelas primero para poder anotar sus
            reportes.
          </p>
        ) : (
          <form
            action={accion}
            className="mt-4 max-w-2xl space-y-3 rounded-lg border border-barro-200 bg-white p-4"
          >
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
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="text-barro-700">
                Qué se necesita (opcional — un verificador lo confirma)
              </span>
              <select
                name="codigoItem"
                className="mt-1 block w-full rounded border border-barro-300 px-3 py-2 text-barro-900"
              >
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
                <input
                  name="familias"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  placeholder="p. ej. 18"
                  className="mt-1 block w-full rounded border border-barro-300 px-3 py-2 text-barro-900"
                />
              </label>
              <label className="block text-sm">
                <span className="text-barro-700">Urgencia (opcional)</span>
                <select
                  name="urgencia"
                  className="mt-1 block w-full rounded border border-barro-300 px-3 py-2 text-barro-900"
                >
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
                placeholder="Lo que le dijeron, tal cual lo recibió. Su escritura es el registro."
                className="mt-1 block w-full rounded border border-barro-300 px-3 py-2 text-barro-900"
              />
            </label>

            <p className="text-xs text-barro-500">
              Elija un ítem del catálogo o escriba el detalle — uno de los dos, al menos.
            </p>

            <button
              type="submit"
              className="rounded bg-selva-600 px-4 py-2 text-sm font-medium text-white"
            >
              Registrar reporte
            </button>
          </form>
        )}
      </section>

      {recientes.length > 0 && (
        <section className="mt-10">
          <h2 className="font-semibold text-barro-900">Reportes manuales recientes</h2>
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
