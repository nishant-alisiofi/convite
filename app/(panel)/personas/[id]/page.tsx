import Link from 'next/link'
import { redirect } from 'next/navigation'
import { fechaHoraCorta } from '@/lib/fechas'
import { personaPorId, type ReporteDePersona } from '@/lib/personas/busqueda'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * FR-42 — where a search result lands. The person's own record, their community (linked into
 * the Comunidades registry), and their reports — the two destinations AC #3 asks for.
 *
 * There is no separate report-detail screen in the panel yet (a report lives inside the
 * Verificación inbox only while it is unverified, then becomes a `pedido` on the Tablero), so
 * the reports show here directly rather than linking somewhere that would 404 for anything
 * already resolved.
 */

const PUEDEN_VER = ['verificador', 'despachador', 'coordinador', 'admin']

const ESTADO_REPORTE_ETIQUETA: Record<string, string> = {
  RECIBIDO: 'recibido',
  VERIFICADO: 'verificado',
  DUPLICADO: 'duplicado',
  CANCELADO: 'cancelado',
}

const TIPO_REPORTE_ETIQUETA: Record<string, string> = {
  necesidad: 'necesidad',
  dano: 'daño',
  sin_clasificar: 'sin clasificar',
}

type Params = Promise<{ id: string }>

export default async function Persona({ params }: { params: Params }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { id } = await params
  const puedeVer = PUEDEN_VER.includes(sesion.rolStaff)

  if (!puedeVer) {
    return (
      <main>
        <h1 className="text-xl font-semibold text-barro-900">Persona</h1>
        <p className="mt-4 max-w-2xl text-barro-700">Su rol no ve el registro de personas.</p>
      </main>
    )
  }

  const persona = await conSesion(sesion, (client) => personaPorId(client, id))
  if (!persona) redirect('/personas')

  return (
    <main>
      <p className="text-sm text-barro-500">
        <Link href="/personas" className="hover:underline">
          ← Personas
        </Link>
      </p>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
        <h1 className="text-xl font-semibold text-barro-900">
          {persona.nombre ?? 'Sin nombre registrado'}
        </h1>
        <span className="text-sm text-barro-500">{persona.rol}</span>
        {!persona.activo && <span className="text-sm text-barro-400">inactivo</span>}
      </div>

      <dl className="mt-4 grid max-w-xl gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-barro-500">Teléfono</dt>
          <dd className="text-barro-900">{persona.telefono}</dd>
        </div>
        <div>
          <dt className="text-barro-500">Canal preferido</dt>
          <dd className="text-barro-900">{persona.canalPreferido}</dd>
        </div>
        <div>
          <dt className="text-barro-500">Idioma</dt>
          <dd className="text-barro-900">{persona.idioma}</dd>
        </div>
        <div>
          <dt className="text-barro-500">Acepta llamadas</dt>
          <dd className="text-barro-900">{persona.aceptaLlamadas ? 'sí' : 'no'}</dd>
        </div>
        <div>
          <dt className="text-barro-500">Último contacto</dt>
          <dd className="text-barro-900">
            {persona.ultimoContactoEn ? fechaHoraCorta(persona.ultimoContactoEn) : 'nunca'}
          </dd>
        </div>
        <div>
          <dt className="text-barro-500">Comunidad</dt>
          <dd className="text-barro-900">
            {persona.comunidadNombre ? (
              <Link
                href={`/comunidades#comunidad-${persona.comunidadId}`}
                className="text-selva-700 hover:underline"
              >
                {persona.comunidadNombre} · {persona.comunidadMunicipio}
              </Link>
            ) : (
              'sin comunidad'
            )}
          </dd>
        </div>
      </dl>

      <section className="mt-8">
        <h2 className="font-semibold text-barro-900">
          Reportes
          <span className="ml-2 font-normal text-barro-600">{persona.reportes.length}</span>
        </h2>

        {persona.reportes.length === 0 ? (
          <p className="mt-2 text-sm text-barro-600">
            Sin reportes registrados a nombre de esta persona.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
            {persona.reportes.map((r) => (
              <ReporteFila key={r.id} r={r} />
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function ReporteFila({ r }: { r: ReporteDePersona }) {
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-sm text-barro-500">#{r.folio}</span>
        <span className="text-sm text-barro-700">
          {TIPO_REPORTE_ETIQUETA[r.tipo] ?? r.tipo}
        </span>
        <span className="text-sm font-medium text-barro-900">
          {ESTADO_REPORTE_ETIQUETA[r.estado] ?? r.estado}
        </span>
        <span className="ml-auto text-sm text-barro-500">{fechaHoraCorta(r.creadoEn)}</span>
      </div>
      {(r.descripcion || r.detalleLibre) && (
        <p className="mt-1 text-sm text-barro-700">{r.descripcion ?? r.detalleLibre}</p>
      )}
    </li>
  )
}
