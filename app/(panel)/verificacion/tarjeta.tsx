import {
  CheckCheck,
  Copy,
  MessageSquare,
  Mic,
  Phone,
  Radio,
  Route,
  TriangleAlert,
} from 'lucide-react'
import Link from 'next/link'
import type { FiltroTipo, FilaBandeja } from '@/lib/verificacion/bandeja'
import type { RutaAfectada } from '@/lib/verificacion/danos'

/**
 * One report in the inbox.
 *
 * Kept out of the page so the same markup can be rendered — with real rows — by
 * `pnpm vista:bandeja`, which is how this screen gets looked at without signing in:
 * /verificacion sits behind a session and a magic link. Two copies of the card would
 * drift, and the copy that drifted would be the one used to check the layout.
 *
 * `accion` is a server action on the real screen and a plain string in the harness, where
 * nothing is meant to submit.
 */

const ICONO_CANAL: Record<string, typeof MessageSquare> = {
  whatsapp: MessageSquare,
  sms: MessageSquare,
  ivr: Phone,
  radio: Radio,
  papel: Copy,
  web: MessageSquare,
}

export type AccionBandeja = ((formData: FormData) => Promise<void>) | string

export default function Tarjeta({
  reporte: r,
  puedeVerificar,
  accion,
  filtro,
  catalogo,
  abriendoDuplicado,
  candidatos,
  rutasAfectadas = [],
}: {
  reporte: FilaBandeja
  puedeVerificar: boolean
  accion: AccionBandeja
  filtro: FiltroTipo
  catalogo: { codigo: string; item_label: string; tipo: string; entregable: boolean }[]
  abriendoDuplicado: boolean
  candidatos: FilaBandeja[]
  /** Only ever populated for a `dano`: legs this report might be about. */
  rutasAfectadas?: RutaAfectada[]
}) {
  const IconoCanal = ICONO_CANAL[r.canal] ?? MessageSquare
  const sinClasificar = r.tipo === 'sin_clasificar'
  const faltaDetalle = r.pideDetalle && !r.detalleLibre

  return (
    <li className="rounded-lg border border-barro-200 bg-white px-4 py-4">
      {/* The age is pinned to the right so it never wraps onto its own orphaned line; the rest
          of the meta flows and wraps within its own group on the left. */}
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-barro-500">#{r.folio}</span>
          <span className="font-medium text-barro-900">{r.comunidad ?? 'Sin comunidad'}</span>
          {r.municipio && <span className="text-barro-500">{r.municipio}</span>}
          <span className="flex items-center gap-1 text-barro-600">
            <IconoCanal className="size-3.5" aria-hidden />
            {r.canal}
          </span>
          {r.urgencia === 3 && (
            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-900">
              urgente
            </span>
          )}
        </div>
        <span className="shrink-0 text-xs tabular-nums text-barro-500">
          {r.dias === 0 ? 'hoy' : `hace ${r.dias} d`}
        </span>
      </div>

      {/* Their words, first and verbatim. Never rewritten, never summarised (2.12). */}
      <p className="mt-2 text-barro-900">
        {r.textoOriginal ? `«${r.textoOriginal}»` : 'Sin texto.'}
      </p>
      {r.descripcion && r.detalleLibre && (
        <p className="mt-1 text-sm text-barro-700">{r.descripcion}</p>
      )}

      <p className="mt-1 text-sm text-barro-600">
        {r.item ?? 'sin ítem'}
        {r.familias !== null && ` · ${r.familias} familia${r.familias === 1 ? '' : 's'}`}
        {r.contacto && ` · ${r.contacto}`}
      </p>

      {r.motivos.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-barro-600">
            Por qué el clasificador lo lee así
          </summary>
          <ul className="mt-1 list-disc pl-5 text-barro-700">
            {r.motivos.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-barro-500">
            Léxico {r.versionLexico}. Es cómo lee el clasificador este texto hoy, no lo que
            concluyó el día que entró.
          </p>
        </details>
      )}

      {faltaDetalle && (
        <p className="mt-2 flex items-start gap-2 rounded border border-atrato-100 bg-atrato-50 px-3 py-2 text-sm text-barro-800">
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
            <p className="flex items-center gap-2 text-sm font-medium text-barro-800">
              <Mic className="size-4" aria-hidden />
              Nota de voz
              {a.duracionSeg !== null && (
                <span className="font-normal text-barro-600">{a.duracionSeg}s</span>
              )}
            </p>

            {/* The browser's own player: no JavaScript, works on a weak connection. */}
            <audio controls preload="none" className="mt-2 w-full max-w-md">
              <source src={`/verificacion/audio/${a.id}`} type={a.mime ?? 'audio/ogg'} />
              Su navegador no puede reproducir esta nota.
            </audio>

            <p className="mt-2 text-sm text-barro-700">
              <span className="text-barro-500">Transcripción: </span>
              {a.transcripcion ?? 'sin transcribir'}
              {a.transcripcionConfianza !== null && (
                <span className="ml-1 text-barro-500">
                  ({Math.round(a.transcripcionConfianza * 100)}%)
                </span>
              )}
            </p>

            {a.transcripcionCorregida && (
              <p className="mt-1 text-sm text-barro-900">
                <span className="text-barro-500">Corregido: </span>
                {a.transcripcionCorregida}
              </p>
            )}

            {puedeVerificar && (
              <form action={accion} className="mt-2 flex flex-wrap items-end gap-2">
                <input type="hidden" name="accion" value="corregir" />
                <input type="hidden" name="reporteId" value={r.id} />
                <input type="hidden" name="adjuntoId" value={a.id} />
                <label className="flex-1 text-sm">
                  <span className="text-barro-700">¿Qué dice en realidad?</span>
                  <input
                    name="texto"
                    defaultValue={a.transcripcionCorregida ?? a.transcripcion ?? ''}
                    className="mt-1 w-full rounded border border-barro-200 bg-white px-2 py-1.5 text-sm"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded border border-barro-200 bg-white px-3 py-1.5 text-sm text-barro-800"
                >
                  Guardar corrección
                </button>
              </form>
            )}
            <p className="mt-1 text-xs text-barro-500">
              Lo que oyó la máquina se conserva aparte; la corrección no lo borra.
            </p>
          </div>
        ))}

      {rutasAfectadas.length > 0 && (
        <div className="mt-3 rounded border border-atrato-100 bg-atrato-50 px-3 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-barro-900">
            <Route className="size-4" aria-hidden />
            Tramos que este daño podría haber cerrado
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {rutasAfectadas.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-barro-900">
                  {r.origen} → {r.destino}
                </span>
                <span className="text-barro-600">
                  {r.modo}
                  {r.minutos !== null && ` · ${r.minutos} min`}
                </span>
                {r.dejaSinPaso.length > 0 && (
                  <span className="text-rose-800">
                    cerrarlo deja sin paso a {r.dejaSinPaso.join(', ')}
                  </span>
                )}
                {puedeVerificar && (
                  <Link
                    href={`/rutas?cerrar=${r.id}`}
                    className="ml-auto text-barro-700 underline"
                  >
                    Cerrar este tramo
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-barro-600">
            Un reporte no cierra un tramo. Lo cierra una persona, después de verificarlo, y
            queda su nombre — un solo reporte exagerado no puede incomunicar una cuenca.
          </p>
        </div>
      )}

      {puedeVerificar && (
        <div className="mt-3 border-t border-barro-200 pt-3">
          {sinClasificar ? (
            <form action={accion} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="accion" value="clasificar" />
              <input type="hidden" name="reporteId" value={r.id} />
              <label className="text-sm">
                <span className="text-barro-700">Nadie pudo clasificarlo. ¿Qué es?</span>
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
                    <span className="text-barro-700">Familias</span>
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
                  className="rounded border border-barro-200 bg-white px-3 py-1.5 text-sm text-barro-800"
                >
                  Solo verificar
                </button>
              </form>

              <Link
                href={`/verificacion?tipo=${filtro}&duplicado=${r.id}`}
                className="flex items-center gap-1 px-1 py-1.5 text-sm text-barro-700 underline"
              >
                <Copy className="size-3.5" aria-hidden />
                Marcar duplicado
              </Link>
            </div>
          )}

          {abriendoDuplicado && (
            <div className="mt-3 rounded border border-barro-200 bg-barro-50 px-3 py-3">
              <p className="text-sm font-medium text-barro-900">¿De cuál reporte es duplicado?</p>
              {candidatos.length === 0 ? (
                <p className="mt-1 text-sm text-barro-700">
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
                    className="rounded border border-barro-200 bg-white px-3 py-1.5 text-sm text-barro-800"
                  >
                    Marcar duplicado
                  </button>
                  <Link href={`/verificacion?tipo=${filtro}`} className="text-sm text-barro-700 underline">
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
