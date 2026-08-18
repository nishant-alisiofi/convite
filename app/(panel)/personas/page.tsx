import { MapPinOff, Phone, Radio } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { fechaCorta } from '@/lib/fechas'
import {
  buscarPersonas,
  LONGITUD_MINIMA_BUSQUEDA,
  type ResultadoPersona,
} from '@/lib/personas/busqueda'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * FR-42 — one box, one keystroke.
 *
 * Field feedback from Chocó: finding a specific person today means drilling down through
 * Comunidades. On a weak connection and a small screen that is too many taps. This is a plain
 * GET form — no JavaScript ships, so it works the same on a 2G connection as on the office
 * wifi, and the result is a real URL (`/personas?q=…`) a coordinator can hand off in a message.
 *
 * Section 11: `rol_staff` gates the UI, RLS gates the data. This screen shows the same rows
 * Comunidades and Verificación already do, through the same `contactos_lectura` /
 * `comunidades_lectura` policies (0017) — never a wider read.
 */

const PUEDEN_VER = ['verificador', 'despachador', 'coordinador', 'admin']

type Query = Promise<{ q?: string }>

export default async function Personas({ searchParams }: { searchParams: Query }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { q } = await searchParams
  const termino = (q ?? '').trim()
  const puedeVer = PUEDEN_VER.includes(sesion.rolStaff)

  const resultados = puedeVer
    ? await conSesion(sesion, (client) => buscarPersonas(client, termino))
    : []

  return (
    <main>
      <h1 className="text-xl font-semibold text-barro-900">Personas</h1>
      <p className="mt-2 max-w-2xl text-sm text-barro-700">
        Busque por nombre, teléfono (local o con indicativo) o comunidad. Acentos y mayúsculas no
        importan — «marta» encuentra «Marta», «quibdo» encuentra «Quibdó».
      </p>

      {!puedeVer && (
        <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-barro-700">
          Su rol no ve el registro de personas.
        </p>
      )}

      {puedeVer && (
        <>
          <form className="mt-4 flex max-w-xl flex-wrap gap-2">
            <input
              type="search"
              name="q"
              defaultValue={q ?? ''}
              placeholder="Nombre, teléfono o comunidad"
              autoFocus
              className="min-w-0 flex-1 rounded border border-barro-300 px-3 py-2 text-barro-900"
            />
            <button
              type="submit"
              className="rounded bg-selva-600 px-4 py-2 text-sm font-medium text-white"
            >
              Buscar
            </button>
          </form>

          {termino.length > 0 && termino.length < LONGITUD_MINIMA_BUSQUEDA && (
            <p className="mt-4 text-sm text-barro-600">
              Escriba al menos {LONGITUD_MINIMA_BUSQUEDA} caracteres.
            </p>
          )}

          {termino.length >= LONGITUD_MINIMA_BUSQUEDA && (
            <>
              <p className="mt-4 text-sm text-barro-600">
                {resultados.length === 0
                  ? 'Sin coincidencias.'
                  : `${resultados.length} ${resultados.length === 1 ? 'persona' : 'personas'}`}
              </p>

              {resultados.length > 0 && (
                <ul className="mt-2 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
                  {resultados.map((r) => (
                    <PersonaFila key={r.id} p={r} />
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </main>
  )
}

function PersonaFila({ p }: { p: ResultadoPersona }) {
  return (
    <li>
      <Link
        href={`/personas/${p.id}`}
        className="block px-4 py-3 hover:bg-barro-50 focus-visible:bg-barro-50"
      >
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-barro-900">{p.nombre ?? 'Sin nombre registrado'}</span>
          <span className="text-sm text-barro-500">{p.rol}</span>
          {!p.activo && <span className="text-sm text-barro-400">inactivo</span>}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-barro-600">
          <span className="flex items-center gap-1">
            {p.canalPreferido === 'radio' && <Radio className="size-3.5 text-barro-400" aria-hidden />}
            {p.canalPreferido !== 'radio' && <Phone className="size-3.5 text-barro-400" aria-hidden />}
            {p.telefono}
          </span>

          {p.comunidadNombre ? (
            <span>
              {p.comunidadNombre} · {p.comunidadMunicipio}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-barro-400">
              <MapPinOff className="size-3.5" aria-hidden />
              sin comunidad
            </span>
          )}

          {p.ultimoContactoEn && <span>último contacto {fechaCorta(p.ultimoContactoEn)}</span>}
        </div>
      </Link>
    </li>
  )
}
