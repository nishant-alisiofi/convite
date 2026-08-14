import {
  CheckCheck,
  Copy,
  HandHeart,
  MessageSquare,
  Mic,
  Phone,
  Radio,
  TriangleAlert,
} from 'lucide-react'
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
  type FilaBandeja,
} from '@/lib/verificacion/bandeja'
import { conSesion, sesionActual } from '@/lib/sesion'

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

const ICONO_CANAL: Record<string, typeof MessageSquare> = {
  whatsapp: MessageSquare,
  sms: MessageSquare,
  ivr: Phone,
  radio: Radio,
  papel: Copy,
  web: MessageSquare,
}

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

  const { bandeja, catalogo, candidatos } = await conSesion(sesion, async (client) => ({
    bandeja: await cargarBandeja(client, filtro),
    catalogo: await itemsDelCatalogo(client),
    candidatos: duplicado ? await posiblesDuplicados(client, duplicado) : [],
  }))

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
        <h1 className="text-xl font-semibold text-stone-900">Verificación</h1>
        <p className="text-sm text-stone-600">
          {total === 0 ? 'Nada esperando.' : `${total} esperando revisión`}
        </p>
      </div>

      <p className="mt-2 max-w-3xl text-sm text-stone-700">
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
                ? 'border-selva-600 bg-selva-50 font-medium text-stone-900'
                : 'border-barro-200 bg-white text-stone-700'
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
        <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-stone-700">
          Su rol puede leer la cola pero no verificar. Verificar y despachar son trabajos
          distintos a propósito: quien confirma que una necesidad es real no decide después
          que se salta.
        </p>
      )}

      {total === 0 && (
        <p className="mt-8 text-stone-600">
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
          />
        ))}
      </ul>

      {bandeja.derivaciones.length > 0 && (
        <section className="mt-10">
          <h2 className="flex items-center gap-2 font-semibold text-stone-900">
            <HandHeart className="size-4" aria-hidden />
            Derivaciones
            <span className="font-normal text-stone-600">{bandeja.derivaciones.length}</span>
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-stone-700">
            Verificadas y atendidas por una visita, no por una caja. No entran a despacho: no
            son carga.
          </p>
          <ul className="mt-3 divide-y divide-stone-200 rounded-lg border border-barro-200 bg-white">
            {bandeja.derivaciones.map((r) => (
              <li key={r.id} className="px-4 py-3 text-sm">
                <span className="font-medium text-stone-900">{r.comunidad ?? 'Sin comunidad'}</span>
                <span className="ml-2 text-stone-700">{r.item}</span>
                <p className="mt-1 text-stone-700">{r.descripcion}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

function Tarjeta({
  reporte: r,
  puedeVerificar,
  accion,
  filtro,
  catalogo,
  abriendoDuplicado,
  candidatos,
}: {
  reporte: FilaBandeja
  puedeVerificar: boolean
  accion: (formData: FormData) => Promise<void>
  filtro: FiltroTipo
  catalogo: { codigo: string; item_label: string; tipo: string; entregable: boolean }[]
  abriendoDuplicado: boolean
  candidatos: FilaBandeja[]
}) {
  const IconoCanal = ICONO_CANAL[r.canal] ?? MessageSquare
  const sinClasificar = r.tipo === 'sin_clasificar'
  const faltaDetalle = r.pideDetalle && !r.detalleLibre

  return (
    <li className="rounded-lg border border-barro-200 bg-white px-4 py-4">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-mono text-stone-500">#{r.folio}</span>
        <span className="font-medium text-stone-900">{r.comunidad ?? 'Sin comunidad'}</span>
        {r.municipio && <span className="text-stone-500">{r.municipio}</span>}
        <span className="flex items-center gap-1 text-stone-600">
          <IconoCanal className="size-3.5" aria-hidden />
          {r.canal}
        </span>
        {r.urgencia === 3 && (
          <span className="rounded bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-900">
            urgente
          </span>
        )}
        <span className="ml-auto text-stone-500">
          {r.dias === 0 ? 'hoy' : `hace ${r.dias} d`}
        </span>
      </div>

      <p className="mt-2 text-stone-900">{r.descripcion ?? 'Sin descripción.'}</p>
      {r.detalleLibre && <p className="mt-1 text-sm text-stone-700">{r.detalleLibre}</p>}

      <p className="mt-1 text-sm text-stone-600">
        {r.item ?? 'sin ítem'}
        {r.familias !== null && ` · ${r.familias} familia${r.familias === 1 ? '' : 's'}`}
        {r.contacto && ` · ${r.contacto}`}
      </p>

      {faltaDetalle && (
        <p className="mt-2 flex items-start gap-2 rounded border border-atrato-100 bg-atrato-50 px-3 py-2 text-sm text-stone-800">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Este ítem pide detalle y no lo trae. Falta preguntar antes de que entre a la cola.
          </span>
        </p>
      )}

      {r.adjuntos
        .filter((a) => a.tipo === 'audio')
        .map((a) => (
          <div key={a.id} className="mt-3 rounded border border-barro-200 bg-barro-50 px-3 py-3">
            <p className="flex items-center gap-2 text-sm font-medium text-stone-800">
              <Mic className="size-4" aria-hidden />
              Nota de voz
              {a.duracionSeg !== null && (
                <span className="font-normal text-stone-600">{a.duracionSeg}s</span>
              )}
            </p>

            {/* The browser's own player: no JavaScript, works on a weak connection. */}
            <audio controls preload="none" className="mt-2 w-full max-w-md">
              <source src={`/verificacion/audio/${a.id}`} type={a.mime ?? 'audio/ogg'} />
              Su navegador no puede reproducir esta nota.
            </audio>

            <p className="mt-2 text-sm text-stone-700">
              <span className="text-stone-500">Transcripción: </span>
              {a.transcripcion ?? 'sin transcribir'}
              {a.transcripcionConfianza !== null && (
                <span className="ml-1 text-stone-500">
                  ({Math.round(a.transcripcionConfianza * 100)}%)
                </span>
              )}
            </p>

            {a.transcripcionCorregida && (
              <p className="mt-1 text-sm text-stone-900">
                <span className="text-stone-500">Corregido: </span>
                {a.transcripcionCorregida}
              </p>
            )}

            {puedeVerificar && (
              <form action={accion} className="mt-2 flex flex-wrap items-end gap-2">
                <input type="hidden" name="accion" value="corregir" />
                <input type="hidden" name="reporteId" value={r.id} />
                <input type="hidden" name="adjuntoId" value={a.id} />
                <label className="flex-1 text-sm">
                  <span className="text-stone-700">¿Qué dice en realidad?</span>
                  <input
                    name="texto"
                    defaultValue={a.transcripcionCorregida ?? a.transcripcion ?? ''}
                    className="mt-1 w-full rounded border border-barro-200 bg-white px-2 py-1.5 text-sm"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded border border-barro-200 bg-white px-3 py-1.5 text-sm text-stone-800"
                >
                  Guardar corrección
                </button>
              </form>
            )}
            <p className="mt-1 text-xs text-stone-500">
              Lo que oyó la máquina se conserva aparte; la corrección no lo borra.
            </p>
          </div>
        ))}

      {puedeVerificar && (
        <div className="mt-3 border-t border-stone-200 pt-3">
          {sinClasificar ? (
            <form action={accion} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="accion" value="clasificar" />
              <input type="hidden" name="reporteId" value={r.id} />
              <label className="text-sm">
                <span className="text-stone-700">Nadie pudo clasificarlo. ¿Qué es?</span>
                <select
                  name="codigoItem"
                  required
                  className="mt-1 block rounded border border-barro-200 bg-white px-2 py-1.5 text-sm"
                >
                  <option value="">…</option>
                  {catalogo.map((ci) => (
                    <option key={ci.codigo} value={ci.codigo}>
                      {ci.codigo} · {ci.item_label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
              >
                Clasificar
              </button>
            </form>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              {r.tipo === 'necesidad' && r.entregable && !faltaDetalle && (
                <form action={accion} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="accion" value="promover" />
                  <input type="hidden" name="reporteId" value={r.id} />
                  <label className="text-sm">
                    <span className="text-stone-700">Familias</span>
                    <input
                      name="familias"
                      inputMode="numeric"
                      required
                      defaultValue={r.familias ?? ''}
                      className="mt-1 block w-24 rounded border border-barro-200 bg-white px-2 py-1.5 text-sm"
                    />
                  </label>
                  <button
                    type="submit"
                    className="flex items-center gap-1 rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
                  >
                    <CheckCheck className="size-4" aria-hidden />
                    Verificar y crear pedido
                  </button>
                </form>
              )}

              <form action={accion}>
                <input type="hidden" name="accion" value="verificar" />
                <input type="hidden" name="reporteId" value={r.id} />
                <button
                  type="submit"
                  className="rounded border border-barro-200 bg-white px-3 py-1.5 text-sm text-stone-800"
                >
                  Solo verificar
                </button>
              </form>

              <Link
                href={`/verificacion?tipo=${filtro}&duplicado=${r.id}`}
                className="flex items-center gap-1 px-1 py-1.5 text-sm text-stone-700 underline"
              >
                <Copy className="size-3.5" aria-hidden />
                Marcar duplicado
              </Link>
            </div>
          )}

          {abriendoDuplicado && (
            <div className="mt-3 rounded border border-barro-200 bg-barro-50 px-3 py-3">
              <p className="text-sm font-medium text-stone-900">¿De cuál reporte es duplicado?</p>
              {candidatos.length === 0 ? (
                <p className="mt-1 text-sm text-stone-700">
                  No hay otro reporte parecido de esa comunidad en tres días. Dos familias
                  reportando la misma creciente siguen siendo dos familias.
                </p>
              ) : (
                <form action={accion} className="mt-2 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="accion" value="duplicado" />
                  <input type="hidden" name="reporteId" value={r.id} />
                  <label className="text-sm">
                    <select
                      name="padreId"
                      required
                      className="mt-1 block rounded border border-barro-200 bg-white px-2 py-1.5 text-sm"
                    >
                      <option value="">…</option>
                      {candidatos.map((c) => (
                        <option key={c.id} value={c.id}>
                          #{c.folio} · {c.descripcion?.slice(0, 60) ?? c.item} · hace {c.dias} d
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="submit"
                    className="rounded border border-barro-200 bg-white px-3 py-1.5 text-sm text-stone-800"
                  >
                    Marcar duplicado
                  </button>
                  <Link href={`/verificacion?tipo=${filtro}`} className="text-sm text-stone-700 underline">
                    Cancelar
                  </Link>
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  )
}
