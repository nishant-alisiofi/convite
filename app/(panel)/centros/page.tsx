import { Building2, Check, Clock, ShieldCheck, X } from 'lucide-react'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * The platform tier's screen (§2.5): approve or reject the centres that have asked to operate,
 * and see across every organisation.
 *
 * Only a platform admin reaches it. RLS is the real boundary — a centre admin who typed the URL
 * would read nothing and `convite_decidir_centro` would refuse them — but the page checks
 * `esPlataforma` too so the answer is a legible «not for you» rather than an empty screen.
 *
 * Server-rendered, no client JavaScript: approve and reject are ordinary form posts.
 */

type PendienteFila = {
  id: string
  nombre: string
  creado_en: Date
  correo: string | null
  telefono: string | null
  detalle: { solicitante?: string | null; contacto?: string | null; detalle?: string | null } | null
}

type OrgFila = {
  id: string
  nombre: string
  estado_aprobacion: string
  miembros: number
}

const ESTADO_ETIQUETA: Record<string, string> = {
  pendiente: 'En revisión',
  aprobada: 'Aprobado',
  rechazada: 'Rechazado',
}

export default async function Centros({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>
}) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { ok, error } = await searchParams

  if (!sesion.esPlataforma) {
    return (
      <main>
        <h1 className="text-xl font-semibold text-barro-900">Centros</h1>
        <p className="mt-4 max-w-2xl rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
          Esta pantalla es solo para el equipo de plataforma de Alisio, que aprueba los centros.
        </p>
      </main>
    )
  }

  const { pendientes, organizaciones } = await conSesion(sesion, async (client) => {
    const { rows: pendientes } = await client.query<PendienteFila>(
      `select o.id, o.nombre, o.creado_en, inv.correo, inv.telefono, det.despues as detalle
         from organizaciones o
         left join lateral (
           select correo, telefono from invitaciones_staff i
            where i.organizacion_id = o.id and i.rol_staff = 'admin' and i.usado_en is null
            order by i.creado_en limit 1
         ) inv on true
         left join lateral (
           select despues from auditoria a
            where a.entidad = 'organizaciones' and a.entidad_id = o.id
              and a.accion = 'centro.solicitado'
            order by a.creado_en desc limit 1
         ) det on true
        where o.estado_aprobacion = 'pendiente'
        order by o.creado_en`,
    )

    const { rows: organizaciones } = await client.query<OrgFila>(
      `select o.id, o.nombre, o.estado_aprobacion,
              count(u.id) filter (where u.activo)::int as miembros
         from organizaciones o
         left join usuarios u on u.organizacion_id = o.id
        group by o.id
        order by o.nombre`,
    )

    return { pendientes, organizaciones }
  })

  async function decidir(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion?.esPlataforma) redirect('/centros?error=permiso')

    const orgId = String(formData.get('org') ?? '')
    const decision = String(formData.get('decision') ?? '')
    if (!['aprobada', 'rechazada'].includes(decision)) redirect('/centros?error=decision')

    const resultado = await conSesion(
      sesion,
      async (client) => {
        const { rows } = await client.query<{ convite_decidir_centro: string }>(
          'select convite_decidir_centro($1, $2)',
          [orgId, decision],
        )
        return rows[0]!.convite_decidir_centro
      },
      { escribe: true },
    )

    revalidatePath('/centros')
    redirect(resultado === 'aprobada' || resultado === 'rechazada' ? `/centros?ok=${resultado}` : `/centros?error=${resultado}`)
  }

  return (
    <main>
      <h1 className="flex items-center gap-2 text-xl font-semibold text-barro-900">
        <ShieldCheck className="size-5 text-selva-700" aria-hidden />
        Centros
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-barro-600">
        Los centros que piden operar aparecen aquí. Aprobarlos los deja entrar; rechazarlos los
        deja fuera. Todo queda registrado con su nombre.
      </p>

      {ok && (
        <p className="mt-4 rounded-lg border border-selva-200 bg-selva-50 px-4 py-3 text-sm text-barro-800">
          {ok === 'aprobada' ? 'Centro aprobado. Su admin ya puede entrar.' : 'Centro rechazado.'}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error === 'ya_decidida'
            ? 'Ese centro ya había sido decidido.'
            : 'No se pudo completar la acción.'}
        </p>
      )}

      <section className="mt-6">
        <h2 className="flex items-center gap-2 font-semibold text-barro-900">
          <Clock className="size-4" aria-hidden />
          En revisión ({pendientes.length})
        </h2>

        {pendientes.length === 0 ? (
          <p className="mt-3 text-sm text-barro-600">No hay centros esperando aprobación.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {pendientes.map((c) => (
              <li key={c.id} className="rounded-lg border border-barro-200 bg-white px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium text-barro-900">
                      <Building2 className="size-4 shrink-0 text-barro-500" aria-hidden />
                      {c.nombre}
                    </p>
                    <p className="mt-1 text-sm text-barro-600">
                      Contacto: {c.correo ?? c.telefono ?? c.detalle?.contacto ?? '—'}
                      {c.detalle?.solicitante ? ` · ${c.detalle.solicitante}` : ''}
                    </p>
                    {c.detalle?.detalle && (
                      <p className="mt-1 text-sm text-barro-600">Zona: {c.detalle.detalle}</p>
                    )}
                    <p className="mt-1 text-xs text-barro-400">
                      Solicitado el {c.creado_en.toLocaleDateString('es-CO')}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <form action={decidir}>
                      <input type="hidden" name="org" value={c.id} />
                      <input type="hidden" name="decision" value="aprobada" />
                      <button
                        type="submit"
                        className="flex items-center gap-1.5 rounded-lg bg-selva-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-900"
                      >
                        <Check className="size-4" aria-hidden />
                        Aprobar
                      </button>
                    </form>
                    <form action={decidir}>
                      <input type="hidden" name="org" value={c.id} />
                      <input type="hidden" name="decision" value="rechazada" />
                      <button
                        type="submit"
                        className="flex items-center gap-1.5 rounded-lg border border-barro-300 bg-white px-3 py-1.5 text-sm font-medium text-barro-700 hover:bg-barro-50"
                      >
                        <X className="size-4" aria-hidden />
                        Rechazar
                      </button>
                    </form>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-semibold text-barro-900">Todas las organizaciones</h2>
        <ul className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
          {organizaciones.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
              <span className="font-medium text-barro-900">{o.nombre}</span>
              <span
                className={
                  o.estado_aprobacion === 'aprobada'
                    ? 'rounded-full bg-selva-50 px-2 py-0.5 text-xs text-selva-800'
                    : o.estado_aprobacion === 'pendiente'
                      ? 'rounded-full bg-atrato-50 px-2 py-0.5 text-xs text-barro-700'
                      : 'rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-800'
                }
              >
                {ESTADO_ETIQUETA[o.estado_aprobacion] ?? o.estado_aprobacion}
              </span>
              <span className="ml-auto text-barro-500">
                {o.miembros} {o.miembros === 1 ? 'miembro' : 'miembros'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
