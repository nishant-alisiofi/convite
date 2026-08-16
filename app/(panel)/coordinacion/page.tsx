import { Ban, Network } from 'lucide-react'
import { redirect } from 'next/navigation'
import { fechaCorta } from '@/lib/fechas'
import { panoramaCoordinacion } from '@/lib/coordinacion'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * The aggregate coordination read layer (PRD-35, §29.3b).
 *
 * Every tier reads this — the same picture `/respuesta` publishes, extended and authenticated.
 * Municipality-level demand, which communities already have someone working in them and which do
 * not, and which route legs are reported closed. It shows aggregate and shared-registry facts
 * across every organisation — never another organisation's community-level operational detail,
 * which is negotiated bilaterally and is never default. The value is coordination at zero privacy
 * cost: nobody sends three convoys to Bellavista while nobody goes to Winandó.
 */

export default async function Coordinacion() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const panorama = await conSesion(sesion, (client) => panoramaCoordinacion(client))

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-barro-900">
          <Network className="size-5" aria-hidden />
          Coordinación
        </h1>
        <p className="text-sm text-barro-600">
          {panorama.totalCubiertas}/{panorama.totalComunidades} comunidades con cobertura
          {panorama.totalSinCubrir > 0 && (
            <>
              {' · '}
              <span className="text-atrato-700">{panorama.totalSinCubrir} sin cubrir</span>
            </>
          )}
        </p>
      </div>

      <p className="mt-2 max-w-3xl text-sm text-barro-700">
        La capa de coordinación de toda la cuenca, para cualquier organización: cuántas necesidades
        hay por municipio, qué comunidades ya tienen a alguien trabajando en ellas y cuáles no, y qué
        tramos están reportados cerrados. Son conteos y hechos compartidos del registro común — nunca
        el detalle a nivel de comunidad de otra organización, que se acuerda de forma bilateral y
        nunca por defecto.
      </p>

      {/* ── Basin totals ─────────────────────────────────────────────────────────────────── */}
      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-barro-200 bg-white px-4 py-3">
          <dt className="text-xs text-barro-500">Necesidades pendientes</dt>
          <dd className="mt-1 text-2xl font-semibold text-barro-900">{panorama.totalPendientes}</dd>
        </div>
        <div className="rounded-lg border border-barro-200 bg-white px-4 py-3">
          <dt className="text-xs text-barro-500">Atendidas</dt>
          <dd className="mt-1 text-2xl font-semibold text-barro-900">{panorama.totalAtendidos}</dd>
        </div>
        <div className="rounded-lg border border-barro-200 bg-white px-4 py-3">
          <dt className="text-xs text-barro-500">Comunidades con cobertura</dt>
          <dd className="mt-1 text-2xl font-semibold text-barro-900">{panorama.totalCubiertas}</dd>
        </div>
        <div className="rounded-lg border border-barro-200 bg-white px-4 py-3">
          <dt className="text-xs text-barro-500">Sin cubrir</dt>
          <dd className="mt-1 text-2xl font-semibold text-atrato-700">{panorama.totalSinCubrir}</dd>
        </div>
      </dl>

      {/* ── Per municipality ─────────────────────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="font-semibold text-barro-900">Por municipio</h2>
        {panorama.municipios.length === 0 ? (
          <p className="mt-3 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
            Todavía no hay comunidades en el registro.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
            {panorama.municipios.map((m) => (
              <li key={m.municipio} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-barro-900">{m.municipio}</span>
                  <span className="text-sm text-barro-600">
                    {m.comunidadesCubiertas}/{m.comunidadesTotal} con cobertura
                    {m.pendientes > 0 && (
                      <>
                        {' · '}
                        <span className="text-atrato-700">{m.pendientes} pendientes</span>
                      </>
                    )}
                    {m.atendidos > 0 && <> · {m.atendidos} atendidas</>}
                  </span>
                </div>
                {m.sinCubrir.length > 0 && (
                  <p className="mt-1 text-sm text-barro-600">
                    <span className="text-atrato-700">Sin cubrir:</span> {m.sinCubrir.join(', ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Closed route legs ────────────────────────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="flex items-center gap-2 font-semibold text-barro-900">
          <Ban className="size-4" aria-hidden />
          Tramos reportados cerrados
        </h2>
        {panorama.tramosCerrados.length === 0 ? (
          <p className="mt-3 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
            Ningún tramo está reportado cerrado.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
            {panorama.tramosCerrados.map((t, i) => (
              <li key={`${t.origen}-${t.destino}-${t.modo}-${i}`} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium text-barro-900">
                    {t.origen} → {t.destino}
                  </span>
                  <span className="rounded border border-barro-200 px-1.5 py-0.5 text-xs text-barro-600">
                    {t.modo}
                  </span>
                  {t.desactivadaEn && (
                    <span className="ml-auto text-xs text-barro-500">
                      cerrado {fechaCorta(t.desactivadaEn)}
                    </span>
                  )}
                </div>
                {t.notas && <p className="mt-1 text-barro-700">{t.notas}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
