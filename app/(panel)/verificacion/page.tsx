import { HandHeart } from 'lucide-react'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  cargarBandeja,
  clasificar,
  corregirTranscripcion,
  itemsDelCatalogo,
  marcarDuplicado,
  posiblesDuplicados,
  promoverAPedido,
  verificar,
  type FiltroTipo,
} from '@/lib/verificacion/bandeja'
import { rutasAfectadasPor, type RutaAfectada } from '@/lib/verificacion/danos'
import Tarjeta from './tarjeta'
import { conSesion, sesionActual } from '@/lib/sesion'
import { temporadaVigente } from '@/lib/temporada'

export const dynamic = 'force-dynamic'

/**
 * The verification screen — Section 4.5's audio inbox, and the daily work of the system.
 *
 * What arrives is a message somebody sent from a phone. What leaves is either a `pedido`
 * somebody vouched for, a duplicate somebody recognised, or a referral. Every one of those
 * is a judgement with a name on it: intake creates the record on receipt (2.13) and never
 * decides anything, and the database refuses a `pedido` whose report nobody verified.
 *
 * Playback is a plain `<audio controls>` element — the browser's own player, no JavaScript
 * shipped, and it works on a laptop over a weak connection. Section 10 asks for exactly that.
 */

/** Section 11 gates the UI; RLS gates the data. This is the first half. */
const PUEDEN_VERIFICAR = ['verificador', 'coordinador', 'admin']

const FILTROS: { valor: FiltroTipo; etiqueta: string }[] = [
  { valor: 'todo', etiqueta: 'Todo' },
  { valor: 'necesidad', etiqueta: 'Necesidades' },
  { valor: 'dano', etiqueta: 'Daños' },
  { valor: 'sin_clasificar', etiqueta: 'Sin clasificar' },
]

type Params = Promise<{ tipo?: string; duplicado?: string; error?: string }>

export default async function Verificacion({ searchParams }: { searchParams: Params }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { tipo, duplicado, error } = await searchParams
  const filtro = (FILTROS.find((f) => f.valor === tipo)?.valor ?? 'todo') as FiltroTipo
  const puedeVerificar = PUEDEN_VERIFICAR.includes(sesion.rolStaff)

  const { bandeja, catalogo, candidatos, rutasPorReporte } = await conSesion(
    sesion,
    async (client) => {
      const bandeja = await cargarBandeja(client, filtro)
      const temporada = await temporadaVigente(client)

      // Section 9.3: a damage report never closes a leg on its own. What it can do is show
      // the verifier which legs it might be about, so the decision is one click from the
      // evidence instead of a hunt through the route table.
      const rutasPorReporte = new Map<string, RutaAfectada[]>()
      for (const r of bandeja.pendientes.filter((f) => f.tipo === 'dano')) {
        rutasPorReporte.set(r.id, await rutasAfectadasPor(client, r.id, temporada))
      }

      return {
        bandeja,
        catalogo: await itemsDelCatalogo(client),
        candidatos: duplicado ? await posiblesDuplicados(client, duplicado) : [],
        rutasPorReporte,
      }
    },
  )

  async function accion(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_VERIFICAR.includes(sesion.rolStaff)) {
      redirect('/verificacion?error=Sin+permiso')
    }

    const que = String(formData.get('accion') ?? '')
    const reporteId = String(formData.get('reporteId') ?? '')

    const resultado = await conSesion(
      sesion,
      async (client) => {
        switch (que) {
          case 'verificar':
            return verificar(client, reporteId, sesion.authId)
          case 'promover':
            return promoverAPedido(
              client,
              reporteId,
              sesion.authId,
              Number(formData.get('familias')),
            )
          case 'duplicado':
            return marcarDuplicado(
              client,
              reporteId,
              String(formData.get('padreId') ?? ''),
              sesion.authId,
            )
          case 'clasificar':
            return clasificar(
              client,
              reporteId,
              String(formData.get('codigoItem') ?? ''),
              sesion.authId,
            )
          case 'corregir':
            return corregirTranscripcion(
              client,
              String(formData.get('adjuntoId') ?? ''),
              String(formData.get('texto') ?? ''),
              sesion.authId,
            )
          default:
            return { ok: false as const, error: 'Acción desconocida.' }
        }
      },
      { escribe: true },
    )

    if (!resultado.ok) {
      redirect(`/verificacion?tipo=${filtro}&error=${encodeURIComponent(resultado.error)}`)
    }
    revalidatePath('/verificacion')
    redirect(`/verificacion?tipo=${filtro}`)
  }

  const total = bandeja.pendientes.length

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-barro-900">Verificación</h1>
        <p className="text-sm text-barro-600">
          {total === 0 ? 'Nada esperando.' : `${total} esperando revisión`}
        </p>
      </div>

      <p className="mt-2 max-w-3xl text-sm text-barro-700">
        Todo lo que entra queda registrado apenas llega, sin que nadie lo apruebe. Nada se
        convierte en pedido hasta que una persona lo lee, lo cree y lo firma.
      </p>

      <nav className="mt-4 flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <Link
            key={f.valor}
            href={`/verificacion?tipo=${f.valor}`}
            className={`rounded border px-3 py-1.5 text-sm ${
              f.valor === filtro
                ? 'border-selva-600 bg-selva-50 font-medium text-barro-900'
                : 'border-barro-200 bg-white text-barro-700'
            }`}
          >
            {f.etiqueta}
          </Link>
        ))}
      </nav>

      {error && (
        <p className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </p>
      )}

      {!puedeVerificar && (
        <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
          Su rol puede leer la cola pero no verificar. Verificar y despachar son trabajos
          distintos a propósito: quien confirma que una necesidad es real no decide después
          que se salta.
        </p>
      )}

      {total === 0 && (
        <p className="mt-8 text-barro-600">
          No hay nada por revisar. Cuando entre un mensaje aparece acá, con su audio y su
          transcripción al lado.
        </p>
      )}

      <ul className="mt-6 space-y-4">
        {bandeja.pendientes.map((r) => (
          <Tarjeta
            key={r.id}
            reporte={r}
            puedeVerificar={puedeVerificar}
            accion={accion}
            filtro={filtro}
            catalogo={catalogo}
            abriendoDuplicado={duplicado === r.id}
            candidatos={duplicado === r.id ? candidatos : []}
            rutasAfectadas={rutasPorReporte.get(r.id) ?? []}
          />
        ))}
      </ul>

      {bandeja.derivaciones.length > 0 && (
        <section className="mt-10">
          <h2 className="flex items-center gap-2 font-semibold text-barro-900">
            <HandHeart className="size-4" aria-hidden />
            Derivaciones
            <span className="font-normal text-barro-600">{bandeja.derivaciones.length}</span>
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-barro-700">
            Verificadas y atendidas por una visita, no por una caja. No entran a despacho: no
            son carga.
          </p>
          <ul className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
            {bandeja.derivaciones.map((r) => (
              <li key={r.id} className="px-4 py-3 text-sm">
                <span className="font-medium text-barro-900">{r.comunidad ?? 'Sin comunidad'}</span>
                <span className="ml-2 text-barro-700">{r.item}</span>
                <p className="mt-1 text-barro-700">{r.descripcion}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
