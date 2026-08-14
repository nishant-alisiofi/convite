import { Ship, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  capacidadesOfrecidas,
  crearEnvio,
  esquemaCapacidad,
  opcionesDeCapacidad,
  registrarCapacidad,
} from '@/lib/despacho/plan'
import { MODOS } from '@/db/schema/vocabulario'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * Who is travelling, and what we have planned onto them.
 *
 * Capacity is the thin side of this marketplace — stock can be found and routes can be
 * opened, but somebody actually going that week usually cannot — so this screen leads with
 * the trips on offer rather than with the queue.
 */

const PUEDEN_DESPACHAR = ['despachador', 'coordinador', 'admin']

const TONO_ESTADO: Record<string, string> = {
  PLANEADO: 'bg-atrato-50 text-atrato-700',
  DESPACHADO: 'bg-selva-50 text-selva-700',
  EN_RUTA: 'bg-selva-50 text-selva-700',
  COMPLETADO: 'bg-barro-50 text-barro-600',
  CANCELADO: 'bg-barro-50 text-barro-500',
}

const CLASE_CAMPO = 'mt-1 w-full rounded border border-barro-200 bg-white px-2 py-1.5 text-sm'

export default async function Envios({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { error } = await searchParams
  const puedeDespachar = PUEDEN_DESPACHAR.includes(sesion.rolStaff)

  const { capacidades, opciones, envios } = await conSesion(sesion, async (client) => {
    const { rows: envios } = await client.query<{
      id: string
      codigo: string
      modo: string
      estado: string
      transportista: string
      salida_programada: Date | null
      cupo_familias: number
      paradas: number
      asignadas: number
    }>(
      `select e.id, e.codigo, e.modo, e.estado, ct.nombre as transportista,
              e.salida_programada, e.cupo_familias,
              (select count(*) from envio_items ei where ei.envio_id = e.id)::int as paradas,
              (select coalesce(sum(ei.familias_asignadas), 0) from envio_items ei
                where ei.envio_id = e.id)::int as asignadas
         from envios e join contactos ct on ct.id = e.responsable_id
        order by e.estado <> 'PLANEADO', e.salida_programada nulls last`,
    )
    return {
      capacidades: await capacidadesOfrecidas(client),
      opciones: await opcionesDeCapacidad(client),
      envios,
    }
  })

  async function planear(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_DESPACHAR.includes(sesion.rolStaff)) {
      redirect('/envios?error=Sin+permiso')
    }

    const resultado = await conSesion(
      sesion,
      (client) => crearEnvio(client, String(formData.get('capacidadId') ?? ''), sesion.authId),
      { escribe: true },
    )

    if (!resultado.ok) redirect(`/envios?error=${encodeURIComponent(resultado.error)}`)
    revalidatePath('/envios')
    redirect(`/envios/${resultado.id}`)
  }

  async function registrar(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_DESPACHAR.includes(sesion.rolStaff)) {
      redirect('/envios?error=Sin+permiso')
    }

    const analisis = esquemaCapacidad.safeParse(Object.fromEntries(formData))
    if (!analisis.success) {
      const primero = analisis.error.issues[0]
      redirect(`/envios?error=${encodeURIComponent(primero?.message ?? 'Datos inválidos.')}`)
    }

    const resultado = await conSesion(
      sesion,
      (client) => registrarCapacidad(client, analisis.data, sesion.authId),
      { escribe: true },
    )
    if (!resultado.ok) redirect(`/envios?error=${encodeURIComponent(resultado.error)}`)
    revalidatePath('/envios')
    redirect('/envios')
  }

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-barro-900">Envíos</h1>
        <p className="text-sm text-barro-600">
          {capacidades.length} transporte{capacidades.length === 1 ? '' : 's'} ofrecido
          {capacidades.length === 1 ? '' : 's'}
        </p>
      </div>

      <p className="mt-2 max-w-3xl text-sm text-barro-700">
        El transporte es el lado flaco: existencias se consiguen y tramos se abren, pero que
        alguien vaya esa semana casi nunca. Por eso empieza por quién viaja.
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </p>
      )}

      {puedeDespachar && (
        <section className="mt-6 rounded-lg border border-barro-200 bg-white px-4 py-4">
          <h2 className="font-semibold text-barro-900">Anotar un transporte</h2>
          <p className="mt-1 max-w-3xl text-sm text-barro-700">
            Casi siempre llega por WhatsApp o por teléfono: alguien avisa que sube el jueves y
            que le caben cuarenta. Anótelo acá y aparece para planear.
          </p>

          <form action={registrar} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-sm">
              <span className="font-medium text-barro-800">Quién viaja</span>
              <select name="contactoId" required className={CLASE_CAMPO}>
                <option value="">…</option>
                {opciones.transportistas.map((t) => (
                  <option key={t.id} value={t.id}>{t.nombre}</option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="font-medium text-barro-800">Modo</span>
              <select name="modo" defaultValue="lancha" className={CLASE_CAMPO}>
                {MODOS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="font-medium text-barro-800">Carga desde</span>
              <select name="origenNodoId" required className={CLASE_CAMPO}>
                <option value="">…</option>
                {opciones.nodos.map((n) => (
                  <option key={n.id} value={n.id}>{n.nombre}</option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="font-medium text-barro-800">Hasta</span>
              <select name="hastaComunidadId" required className={CLASE_CAMPO}>
                <option value="">…</option>
                {opciones.comunidades.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </label>

            <label className="block text-sm">
              <span className="font-medium text-barro-800">Sale</span>
              <input type="datetime-local" name="saleEn" required className={CLASE_CAMPO} />
            </label>

            <label className="block text-sm">
              <span className="font-medium text-barro-800">Cupo (familias)</span>
              <input name="cupoFamilias" inputMode="numeric" required className={CLASE_CAMPO} />
            </label>

            <label className="block text-sm sm:col-span-2 lg:col-span-3">
              <span className="font-medium text-barro-800">Notas</span>
              <input
                name="notas"
                placeholder="Va con carga de la alcaldía, lleva lo que quepa."
                className={CLASE_CAMPO}
              />
            </label>

            <div className="sm:col-span-2 lg:col-span-3">
              <button
                type="submit"
                className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
              >
                Anotar el transporte
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-semibold text-barro-900">Quién viaja</h2>
        {capacidades.length === 0 ? (
          <p className="mt-3 text-sm text-barro-600">
            Nadie ha ofrecido transporte. Mientras tanto, todo lo que tiene ruta y existencia
            se queda esperando.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
            {capacidades.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 px-4 py-3 text-sm">
                <Ship className="size-4 text-barro-500" aria-hidden />
                <span className="font-medium text-barro-900">{c.transportista}</span>
                <span className="text-barro-700">
                  {c.modo} · {c.origenNodo} → {c.hastaComunidad}
                </span>
                <span className="text-barro-600">
                  sale {c.saleEn.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
                </span>
                <span className="text-barro-600">cupo {c.cupoFamilias}</span>

                {puedeDespachar && (
                  <span className="ml-auto">
                    {c.envioId ? (
                      <Link href={`/envios/${c.envioId}`} className="text-barro-700 underline">
                        Ver el plan
                      </Link>
                    ) : (
                      <form action={planear}>
                        <input type="hidden" name="capacidadId" value={c.id} />
                        <button
                          type="submit"
                          className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
                        >
                          Planear este viaje
                        </button>
                      </form>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-semibold text-barro-900">Envíos</h2>
        {envios.length === 0 ? (
          <p className="mt-3 text-sm text-barro-600">Todavía no se ha planeado ninguno.</p>
        ) : (
          <ul className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
            {envios.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 px-4 py-3 text-sm">
                <Link href={`/envios/${e.id}`} className="font-mono font-medium text-barro-900 underline">
                  {e.codigo}
                </Link>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${TONO_ESTADO[e.estado] ?? ''}`}
                >
                  {e.estado.toLowerCase()}
                </span>
                <span className="text-barro-700">
                  {e.modo} · {e.transportista}
                </span>
                <span className="text-barro-600">
                  {e.paradas} parada{e.paradas === 1 ? '' : 's'} · {e.asignadas}/{e.cupo_familias}{' '}
                  familias
                </span>
                {e.estado === 'PLANEADO' && e.paradas === 0 && (
                  <span className="flex items-center gap-1 text-barro-500">
                    <TriangleAlert className="size-3.5" aria-hidden />
                    sin paradas
                  </span>
                )}
                <span className="ml-auto text-barro-500">
                  {e.salida_programada?.toLocaleDateString('es-CO') ?? 'sin fecha'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
