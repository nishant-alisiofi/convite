import { AlertTriangle, EarOff, PackageX, ShieldAlert } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { FaseRespuesta } from '@/db/schema/vocabulario'
import { InsigniaCanal, InsigniaTranscrito } from '@/components/insignias'
import { cargarBandejaUnificada, type ItemBandeja } from '@/lib/bandeja/unificada'
import { conSesion, sesionActual } from '@/lib/sesion'

/**
 * The Bandeja — everything awaiting a person, in one place (§18, §19; PRD-28 AC 2–5).
 *
 * The shell shipped seven sections with Tablero and Verificación as two separate Bandeja
 * entries, and `secciones.ts` said plainly that this was interim: «Two entries + silence until
 * the single queue exists.» This is the queue. Tablero moves under Agenda, where §18 puts a
 * goods-dispatch board — it is the tail of the pipeline, not its head, and nothing appears on it
 * until a human has verified a report and the matcher has run.
 *
 * Silence is a first-class item here rather than a link to an anchor on another page (§19: «the
 * only signal that fires when nobody reports»). It is also the reason this page exists at all:
 * silence cannot compete with `urgencia` because it has none, so somebody had to decide what a
 * quiet community is worth against a stuck lorry. That decision is in lib/bandeja/rango.ts,
 * where it can be read and argued with.
 */

export const dynamic = 'force-dynamic'

const ASPECTO: Record<
  ItemBandeja['tipo'],
  { etiqueta: string; Icono: typeof PackageX; clase: string }
> = {
  verificar: { etiqueta: 'Por verificar', Icono: AlertTriangle, clase: 'text-atrato-700' },
  atascado: { etiqueta: 'Atascado', Icono: PackageX, clase: 'text-barro-700' },
  silencio: { etiqueta: 'En silencio', Icono: EarOff, clase: 'text-barro-500' },
}

const LIDERA: Record<FaseRespuesta, string> = {
  impacto: 'En impacto, primero el silencio: quién quedó incomunicado.',
  emergencia: 'En emergencia, primero lo atascado: lo que ya se puede mover y no se mueve.',
  recuperacion: 'En recuperación, primero lo que hay que valorar y costear.',
  ordinario: 'Sin emergencia abierta, primero lo que hay que revisar y programar.',
}

export default async function Bandeja() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const fase = (sesion.faseOrganizacion ?? 'emergencia') as FaseRespuesta
  const { items, conteos } = await conSesion(sesion, (client) =>
    cargarBandejaUnificada(client, fase),
  )

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-lg font-semibold text-barro-900">Bandeja</h1>
        <p className="text-sm text-barro-500">
          {items.length === 0
            ? 'Nada esperando a nadie.'
            : `${items.length} cosas esperan a alguien · ${conteos.verificar} por verificar · ${conteos.atascado} atascadas · ${conteos.silencio} en silencio`}
        </p>
      </div>
      <p className="mt-1 text-sm text-barro-600">{LIDERA[fase]}</p>

      {items.length === 0 ? (
        <p className="mt-6 rounded-lg border border-barro-200 bg-white px-4 py-6 text-sm text-barro-600">
          No hay nada pendiente. Eso puede ser buena señal o puede ser que no esté llegando nada —
          revise <Link href="/comunidades" className="underline">Comunidades</Link> para ver quién
          lleva tiempo sin reportar.
        </p>
      ) : (
        <ul className="mt-5 divide-y divide-barro-200 overflow-hidden rounded-xl border border-barro-200 bg-white">
          {items.map((it) => {
            const { etiqueta, Icono, clase } = ASPECTO[it.tipo]
            return (
              <li key={`${it.tipo}:${it.id}`}>
                <Link href={it.href} className="block px-4 py-3 hover:bg-barro-50">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Icono className={`h-4 w-4 shrink-0 ${clase}`} aria-hidden />
                    <span className="font-medium text-barro-900">{it.comunidad}</span>
                    {it.municipio && it.municipio !== it.comunidad && (
                      <span className="text-xs text-barro-500">{it.municipio}</span>
                    )}
                    {/* PRD-49: a routing signal, never a description of the content. */}
                    {it.sensible && (
                      <span className="inline-flex items-center gap-1 rounded bg-atrato-50 px-1.5 py-0.5 text-xs font-medium text-atrato-800 ring-1 ring-atrato-100">
                        <ShieldAlert className="h-3 w-3" aria-hidden />
                        sensible
                      </span>
                    )}
                    {it.urgencia === 3 && (
                      <span className="rounded bg-atrato-100 px-1.5 py-0.5 text-xs font-medium text-atrato-800">
                        urgente
                      </span>
                    )}
                    <span className="text-xs text-barro-400">· {etiqueta}</span>
                    <span className="ml-auto shrink-0 text-xs text-barro-400">
                      {it.dias <= 0 ? 'hoy' : `hace ${it.dias} d`}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-barro-700">{it.detalle}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-barro-500">
                    {it.contexto && <span>{it.contexto}</span>}
                    {it.canal && <InsigniaCanal canal={it.canal} />}
                    {it.transcrito && <InsigniaTranscrito />}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
