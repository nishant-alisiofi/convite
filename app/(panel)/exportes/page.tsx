import { Download, FileSpreadsheet } from 'lucide-react'
import { redirect } from 'next/navigation'
import { sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * Informes › Exportes (§18 / PRD-34 item 2) — a CSV of every jornada this session may see, plus
 * its stops, one click. The nav has carried this as an «en construcción» placeholder since the
 * seven-section shell landed (PRD-28); this is the build.
 *
 * No role gate here beyond being signed in: `filasExporteAgenda` reads through the same
 * `lib/jornadas.ts` calls the Jornadas screen makes, so RLS (`jornadas_lectura`, 0043) is
 * already the boundary — a role that cannot see jornadas there gets an empty file here, not a
 * blocked screen, matching how the rest of the panel prefers an empty result over a gate
 * duplicated in two places.
 *
 * XLSX is not offered: no spreadsheet dependency exists in this codebase today (checked before
 * building this — see `lib/exportes.ts`), so this ships CSV-only until one is approved.
 */
export default async function Exportes() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  return (
    <main>
      <h1 className="flex items-center gap-2 text-xl font-semibold text-barro-900">
        <FileSpreadsheet className="size-5" aria-hidden />
        Exportes
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-barro-700">
        Descargue la agenda — jornadas y sus paradas — en un archivo que abre en Excel, Google
        Sheets o Numbers.
      </p>

      <div className="mt-6 rounded-lg border border-barro-200 bg-white p-4">
        <h2 className="font-semibold text-barro-900">Agenda (jornadas y paradas)</h2>
        <p className="mt-1 text-sm text-barro-600">
          Una fila por parada; una jornada sin paradas todavía aparece con esa columna vacía.
        </p>
        <a
          href="/api/exportes/agenda"
          className="mt-3 inline-flex items-center gap-2 rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
        >
          <Download className="size-4" aria-hidden />
          Descargar CSV
        </a>
      </div>
    </main>
  )
}
