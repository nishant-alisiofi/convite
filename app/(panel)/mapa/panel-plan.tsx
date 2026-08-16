'use client'

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ClipboardList,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import type {
  Borrador,
  CosteoBorrador,
  Pierna,
  ResumenSeleccion,
  RutaEnArea,
} from '@/lib/mapa/planificacion'
import { temporadaDeFecha } from '@/lib/mapa/planificacion'
import type { ComunidadPlan, PuntoConexionPlan } from '@/lib/mapa/planificacion-datos'

/**
 * The selection panel and the draft builder (§23.5, §23.2, §23.6).
 *
 * The map hands this what falls inside a selection and the draft being composed; this renders
 * the aggregate — need, coverage-with-age, routes-by-season, silence, connection points — and
 * the «armar una jornada» builder that turns picked stops into a costed draft for its own date.
 * Presentational: it never resolves a route or persists a draft, it asks the map to. Nothing
 * here commits a jornada — a draft is saved locally and committed by a person later (PRD-30).
 */

const ETIQUETA_ESTADO: Record<string, string> = {
  SIN_RUTA: 'sin ruta',
  SIN_EXISTENCIA: 'sin existencia',
  SIN_CAPACIDAD: 'sin capacidad',
  LISTO: 'listo',
}

const ETIQUETA_TEMPORADA: Record<string, string> = { lluvias: 'lluvias', seca: 'seca' }

const pesos = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})

function tiempo(min: number | null): string {
  if (min === null) return 'sin dato'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

function edadTexto(dias: number | null): string {
  if (dias === null) return 'nunca'
  if (dias === 0) return 'hoy'
  if (dias < 30) return `hace ${dias} d`
  if (dias < 365) return `hace ${Math.floor(dias / 30)} mes${dias < 60 ? '' : 'es'}`
  return `hace ${Math.floor(dias / 365)} año${dias < 730 ? '' : 's'}`
}

type SeleccionVista = {
  resumen: ResumenSeleccion
  rutas: RutaEnArea[]
  puntos: PuntoConexionPlan[]
  comunidades: ComunidadPlan[]
}

type Props = {
  seleccion: SeleccionVista | null
  onArmarJornada: () => void
  borradores: readonly Borrador[]
  borradorActivo: Borrador | null
  costeo: CosteoBorrador | null
  comunidadesById: ReadonlyMap<string, ComunidadPlan>
  comunidadesTodas: readonly ComunidadPlan[]
  onNuevoBorrador: () => void
  onSeleccionarBorrador: (id: string) => void
  onCambiarBorrador: (patch: Partial<Borrador>) => void
  onMoverParada: (index: number, dir: -1 | 1) => void
  onQuitarParada: (id: string) => void
  onAgregarParada: (id: string) => void
  onGuardarBorrador: () => void
  onEliminarBorrador: (id: string) => void
}

export default function PanelPlan({
  seleccion,
  onArmarJornada,
  borradores,
  borradorActivo,
  costeo,
  comunidadesById,
  comunidadesTodas,
  onNuevoBorrador,
  onSeleccionarBorrador,
  onCambiarBorrador,
  onMoverParada,
  onQuitarParada,
  onAgregarParada,
  onGuardarBorrador,
  onEliminarBorrador,
}: Props) {
  return (
    <div className="flex flex-col gap-4">
      {seleccion && <ResumenArea seleccion={seleccion} onArmarJornada={onArmarJornada} />}

      <ConstructorBorrador
        borradores={borradores}
        borradorActivo={borradorActivo}
        costeo={costeo}
        comunidadesById={comunidadesById}
        comunidadesTodas={comunidadesTodas}
        onNuevoBorrador={onNuevoBorrador}
        onSeleccionarBorrador={onSeleccionarBorrador}
        onCambiarBorrador={onCambiarBorrador}
        onMoverParada={onMoverParada}
        onQuitarParada={onQuitarParada}
        onAgregarParada={onAgregarParada}
        onGuardarBorrador={onGuardarBorrador}
        onEliminarBorrador={onEliminarBorrador}
      />
    </div>
  )
}

function ResumenArea({
  seleccion,
  onArmarJornada,
}: {
  seleccion: SeleccionVista
  onArmarJornada: () => void
}) {
  const { resumen, rutas, puntos } = seleccion
  const { cobertura } = resumen

  return (
    <section className="rounded-lg border border-barro-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-barro-900">
          Selección · {resumen.comunidades} comunidad{resumen.comunidades === 1 ? '' : 'es'}
        </h3>
        <span className="text-sm text-barro-600">
          {resumen.familiasEstimadas.toLocaleString('es-CO')} familias estimadas
        </span>
      </div>

      {/* Coverage as assessed/total + age, never a bare count (§23.5). */}
      <div className="mt-3 rounded border border-barro-100 bg-barro-50 px-3 py-2 text-sm">
        <p className="font-medium text-barro-900">
          Cobertura de evaluación: {cobertura.evaluadas} de {cobertura.total}
        </p>
        <p className="mt-0.5 text-xs text-barro-600">
          {cobertura.evaluadas === 0
            ? 'Ninguna evaluada. El gris del mapa es la próxima ruta del equipo de diagnóstico.'
            : `La más reciente ${edadTexto(cobertura.edadMasRecienteDias)}, la más antigua ${edadTexto(
                cobertura.edadMasAntiguaDias,
              )}.`}
        </p>
      </div>

      {resumen.pendientesPorCategoria.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-barro-500">
            Pedidos por categoría
          </h4>
          <ul className="mt-1 space-y-0.5 text-sm text-barro-800">
            {resumen.pendientesPorCategoria.map((p) => (
              <li key={p.codigo} className="flex justify-between gap-2">
                <span>{p.etiqueta}</span>
                <span className="tabular-nums text-barro-600">
                  {p.pedidos} · {p.familias} fam.
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {resumen.pendientesPorEstado.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-barro-500">
            Pedidos por estado trancado
          </h4>
          <ul className="mt-1 flex flex-wrap gap-1.5 text-xs">
            {resumen.pendientesPorEstado.map((p) => (
              <li key={p.estado} className="rounded bg-barro-100 px-2 py-0.5 text-barro-800">
                {ETIQUETA_ESTADO[p.estado] ?? p.estado}: {p.familias} fam.
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-barro-500">
          Rutas que sirven el área
        </h4>
        {rutas.length === 0 ? (
          <p className="mt-1 text-xs text-barro-500">Ningún tramo registrado toca esta selección.</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-sm text-barro-800">
            {rutas.map((r, i) => (
              <li key={`${r.origen}-${r.destino}-${r.temporada}-${i}`} className="flex flex-wrap gap-x-2">
                <span>
                  {r.origen} ↔ {r.destino}
                </span>
                <span className="text-barro-500">
                  {r.modo} · {ETIQUETA_TEMPORADA[r.temporada] ?? r.temporada}
                </span>
                {!r.activa && (
                  <span className="rounded bg-rose-100 px-1 text-xs font-medium text-rose-900">
                    cerrada
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {resumen.nuncaContactadas.length > 0 && (
        <p className="mt-3 flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Nunca se ha sabido de: {resumen.nuncaContactadas.join(', ')}. El silencio es una señal,
            no una ausencia de necesidad.
          </span>
        </p>
      )}

      {puntos.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-barro-500">
            Puntos de conexión dentro
          </h4>
          <ul className="mt-1 space-y-0.5 text-xs text-barro-700">
            {puntos.map((p) => (
              <li key={p.id}>
                {p.nombre} · seguridad {p.seguridad} · energía {p.energia}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={onArmarJornada}
        className="mt-4 w-full rounded bg-selva-600 px-3 py-2 text-sm font-medium text-white hover:bg-selva-700"
      >
        Armar una jornada con estas comunidades
      </button>
    </section>
  )
}

function ConstructorBorrador({
  borradores,
  borradorActivo,
  costeo,
  comunidadesById,
  comunidadesTodas,
  onNuevoBorrador,
  onSeleccionarBorrador,
  onCambiarBorrador,
  onMoverParada,
  onQuitarParada,
  onAgregarParada,
  onGuardarBorrador,
  onEliminarBorrador,
}: Omit<Props, 'seleccion' | 'onArmarJornada'>) {
  const nombreDe = (id: string) => comunidadesById.get(id)?.nombre ?? id
  const disponibles = borradorActivo
    ? comunidadesTodas.filter(
        (c) => !borradorActivo.paradas.includes(c.id) && c.lat !== null && c.lon !== null,
      )
    : []

  return (
    <section className="rounded-lg border border-barro-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-barro-900">
          <ClipboardList className="size-4" aria-hidden />
          Borradores de jornada
        </h3>
        <button
          type="button"
          onClick={onNuevoBorrador}
          className="flex items-center gap-1 rounded border border-barro-300 px-2 py-1 text-xs font-medium text-barro-800 hover:bg-barro-50"
        >
          <Plus className="size-3.5" aria-hidden />
          Nuevo
        </button>
      </div>

      {borradores.length > 0 && (
        <ul className="mt-3 space-y-1">
          {borradores.map((b) => {
            const activo = b.id === borradorActivo?.id
            return (
              <li key={b.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSeleccionarBorrador(b.id)}
                  className={`flex-1 rounded border px-2 py-1 text-left text-sm ${
                    activo
                      ? 'border-selva-500 bg-selva-50 text-barro-900'
                      : 'border-barro-200 text-barro-700 hover:bg-barro-50'
                  }`}
                >
                  {b.nombre}
                  <span className="ml-2 text-xs text-barro-500">
                    {b.paradas.length} parada{b.paradas.length === 1 ? '' : 's'} · {b.fecha}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onEliminarBorrador(b.id)}
                  aria-label={`Eliminar ${b.nombre}`}
                  className="text-barro-400 hover:text-rose-700"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {!borradorActivo ? (
        <p className="mt-3 text-sm text-barro-500">
          Selecciona un área y usa «Armar una jornada», o crea un borrador en blanco. Nada se
          confirma hasta que una persona lo decida.
        </p>
      ) : (
        <div className="mt-4 space-y-4 border-t border-barro-100 pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-barro-700">
              Nombre
              <input
                type="text"
                value={borradorActivo.nombre}
                onChange={(e) => onCambiarBorrador({ nombre: e.target.value })}
                className="mt-1 w-full rounded border border-barro-300 px-2 py-1.5 text-sm text-barro-900"
              />
            </label>
            <label className="text-xs font-medium text-barro-700">
              Fecha
              <input
                type="date"
                value={borradorActivo.fecha}
                onChange={(e) => e.target.value && onCambiarBorrador({ fecha: e.target.value })}
                className="mt-1 w-full rounded border border-barro-300 px-2 py-1.5 text-sm text-barro-900"
              />
            </label>
          </div>

          <p className="text-xs text-barro-600">
            La fecha define la temporada, y la temporada define la ruta:{' '}
            <span className="font-medium text-barro-900">
              {ETIQUETA_TEMPORADA[temporadaDeFecha(borradorActivo.fecha)]}
            </span>
            . Una jornada en octubre cuesta lo que cuesta octubre, no lo de hoy.
          </p>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-barro-500">
              Paradas, en orden
            </h4>
            {borradorActivo.paradas.length === 0 ? (
              <p className="mt-1 text-sm text-barro-500">Sin paradas todavía.</p>
            ) : (
              <ol className="mt-1 space-y-1">
                {borradorActivo.paradas.map((id, i) => (
                  <li
                    key={id}
                    className="flex items-center gap-2 rounded border border-barro-200 px-2 py-1 text-sm text-barro-900"
                  >
                    <span className="tabular-nums text-barro-400">{i + 1}.</span>
                    <span className="flex-1">{nombreDe(id)}</span>
                    <button
                      type="button"
                      onClick={() => onMoverParada(i, -1)}
                      disabled={i === 0}
                      aria-label="Subir"
                      className="text-barro-400 enabled:hover:text-barro-900 disabled:opacity-30"
                    >
                      <ArrowUp className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMoverParada(i, 1)}
                      disabled={i === borradorActivo.paradas.length - 1}
                      aria-label="Bajar"
                      className="text-barro-400 enabled:hover:text-barro-900 disabled:opacity-30"
                    >
                      <ArrowDown className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => onQuitarParada(id)}
                      aria-label="Quitar"
                      className="text-barro-400 hover:text-rose-700"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </li>
                ))}
              </ol>
            )}

            {disponibles.length > 0 && (
              <label className="mt-2 block text-xs font-medium text-barro-700">
                Agregar parada
                <select
                  value=""
                  onChange={(e) => e.target.value && onAgregarParada(e.target.value)}
                  className="mt-1 w-full rounded border border-barro-300 bg-white px-2 py-1.5 text-sm text-barro-900"
                >
                  <option value="">—</option>
                  {disponibles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <label className="block text-xs font-medium text-barro-700">
            Cupo ofrecido (familias)
            <input
              type="number"
              min={0}
              value={borradorActivo.cupoOfrecido ?? ''}
              onChange={(e) =>
                onCambiarBorrador({
                  cupoOfrecido: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
                })
              }
              placeholder="sin transporte asignado"
              className="mt-1 w-full rounded border border-barro-300 px-2 py-1.5 text-sm text-barro-900"
            />
          </label>

          {costeo && <ResumenCosteo costeo={costeo} nombreDe={nombreDe} />}

          <button
            type="button"
            onClick={onGuardarBorrador}
            className="flex w-full items-center justify-center gap-1.5 rounded bg-selva-600 px-3 py-2 text-sm font-medium text-white hover:bg-selva-700"
          >
            <Save className="size-4" aria-hidden />
            Guardar borrador
          </button>
        </div>
      )}
    </section>
  )
}

function ResumenCosteo({
  costeo,
  nombreDe,
}: {
  costeo: CosteoBorrador
  nombreDe: (id: string) => string
}) {
  const problemas = costeo.piernas.filter((p): p is Extract<Pierna, { estado: 'cerrada' | 'sin_ruta' }> =>
    p.estado !== 'ok',
  )

  return (
    <div className="rounded border border-atrato-100 bg-atrato-50 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-barro-900">
          Costeo · temporada {ETIQUETA_TEMPORADA[costeo.temporada]}
        </span>
        <span className="text-barro-700">
          {tiempo(costeo.minutosTotal)} ·{' '}
          {costeo.costoTotal === null ? 'costo sin dato' : pesos.format(costeo.costoTotal)}
        </span>
      </div>

      <p className="mt-1 text-xs text-barro-700">
        Requiere {costeo.familiasRequeridas} fam.
        {costeo.cupoOfrecido === null
          ? ' · sin cupo ofrecido todavía'
          : costeo.faltante && costeo.faltante > 0
            ? ` · faltan ${costeo.faltante} fam. de cupo`
            : ' · el cupo alcanza'}
      </p>

      {problemas.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-rose-900">
          {problemas.map((p, i) => (
            <li key={`${p.origenId}-${p.destinoId}-${i}`} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {p.estado === 'cerrada' ? (
                <span>
                  {nombreDe(p.origenId)} → {nombreDe(p.destinoId)}: ruta cerrada por reporte de daño
                  {p.cierres.some((c) => c.motivo)
                    ? ` (${p.cierres.map((c) => c.motivo).filter(Boolean).join('; ')})`
                    : ''}
                  . Queda cerrada en el borrador.
                </span>
              ) : (
                <span>
                  {nombreDe(p.origenId)} → {nombreDe(p.destinoId)}: sin ruta en esta temporada.
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
