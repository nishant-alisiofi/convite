'use client'

import { Layers, PencilRuler, X } from 'lucide-react'
import type { CapaId } from '@/lib/mapa/planificacion'

/**
 * The map's controls: which layers are lit, and how an area is selected (§23.4, §23.5).
 *
 * Presentational only — every decision is the map component's; this renders the toggles and
 * the selection tools and calls back. Kept out of the map component so the imperative MapLibre
 * wiring and the React form controls do not tangle.
 */

export type MetaCapa = { id: CapaId; nombre: string; ayuda: string }

/** The §23.4 layers, in the order the panel lists them. */
export const CAPAS: MetaCapa[] = [
  { id: 'pedidos', nombre: 'Pedidos pendientes', ayuda: 'El color de cada comunidad es su estado más urgente.' },
  { id: 'rutas', nombre: 'Estado de rutas', ayuda: 'Los tramos de la temporada; los desactivados salen en rojo.' },
  {
    id: 'recencia',
    nombre: 'Recencia de evaluación',
    ayuda: 'Sombra por tiempo desde la última evaluación. Gris = nunca evaluada.',
  },
  { id: 'conexion', nombre: 'Puntos de conexión', ayuda: 'Dónde hay señal, con su seguridad y energía.' },
  { id: 'existencias', nombre: 'Existencias por nodo', ayuda: 'Lo contado en cada nodo, con la fecha del conteo.' },
  { id: 'conectividad', nombre: 'Tier de conectividad', ayuda: 'De datos confiables (1) a relevo por radio (4).' },
  { id: 'silencio', nombre: 'Comunidades en silencio', ayuda: 'Sin contacto más allá de su intervalo, o nunca.' },
  { id: 'contacto', nombre: 'Último contacto', ayuda: 'Sombra por tiempo desde el último mensaje recibido.' },
  {
    id: 'cems',
    nombre: 'Evaluación satelital (Copernicus)',
    // Deliberately says «dónde miraron», not «dónde hay daño». The AOI is the footprint of the
    // assessment, not its findings — claiming otherwise would paint a whole city as damaged
    // because a satellite looked at it.
    ayuda: 'Áreas que Copernicus EMS evaluó tras el sismo del 10 de agosto. Marca dónde hay informe, no dónde hay daño.',
  },
]

export type TipoSeleccion = 'municipio' | 'cuenca' | 'agrupador'

type Props = {
  activas: readonly CapaId[]
  onToggle: (id: CapaId) => void
  modoPoligono: boolean
  onModoPoligono: (activo: boolean) => void
  municipios: readonly string[]
  regiones: readonly { id: string; nombre: string }[]
  agrupadores: readonly string[]
  seleccionActual: { tipo: TipoSeleccion; valor: string } | null
  onSeleccionarPor: (tipo: TipoSeleccion, valor: string) => void
  haySeleccion: boolean
  onLimpiar: () => void
}

export default function ControlesMapa({
  activas,
  onToggle,
  modoPoligono,
  onModoPoligono,
  municipios,
  regiones,
  agrupadores,
  seleccionActual,
  onSeleccionarPor,
  haySeleccion,
  onLimpiar,
}: Props) {
  const valorDe = (tipo: TipoSeleccion) =>
    seleccionActual && seleccionActual.tipo === tipo ? seleccionActual.valor : ''

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-barro-200 bg-white p-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-barro-900">
          <Layers className="size-4" aria-hidden />
          Capas
        </h3>
        <ul className="mt-2 space-y-1.5">
          {CAPAS.map((capa) => {
            const on = activas.includes(capa.id)
            return (
              <li key={capa.id}>
                <label className="flex cursor-pointer items-start gap-2 text-sm text-barro-800">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onToggle(capa.id)}
                    className="mt-0.5 size-4 shrink-0 accent-selva-600"
                  />
                  <span>
                    <span className="font-medium text-barro-900">{capa.nombre}</span>
                    <span className="block text-xs text-barro-500">{capa.ayuda}</span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="border-t border-barro-100 pt-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-barro-900">
          <PencilRuler className="size-4" aria-hidden />
          Seleccionar un área
        </h3>
        <p className="mt-1 text-xs text-barro-500">
          Dibuja un polígono, o elige por municipio, cuenca o agrupador. El panel de abajo resume lo
          que hay dentro.
        </p>

        <button
          type="button"
          onClick={() => onModoPoligono(!modoPoligono)}
          aria-pressed={modoPoligono}
          className={`mt-3 w-full rounded border px-3 py-1.5 text-sm font-medium ${
            modoPoligono
              ? 'border-selva-600 bg-selva-600 text-white'
              : 'border-barro-300 bg-white text-barro-800 hover:bg-barro-50'
          }`}
        >
          {modoPoligono ? 'Dibujando — toca el mapa · doble toque para cerrar' : 'Dibujar polígono'}
        </button>

        <div className="mt-3 grid gap-2">
          <label className="text-xs font-medium text-barro-700">
            Municipio
            <select
              value={valorDe('municipio')}
              onChange={(e) => e.target.value && onSeleccionarPor('municipio', e.target.value)}
              className="mt-1 w-full rounded border border-barro-300 bg-white px-2 py-1.5 text-sm text-barro-900"
            >
              <option value="">—</option>
              {municipios.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-barro-700">
            Cuenca / región
            <select
              value={valorDe('cuenca')}
              onChange={(e) => e.target.value && onSeleccionarPor('cuenca', e.target.value)}
              className="mt-1 w-full rounded border border-barro-300 bg-white px-2 py-1.5 text-sm text-barro-900"
            >
              <option value="">—</option>
              {regiones.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-barro-700">
            Agrupador
            <select
              value={valorDe('agrupador')}
              onChange={(e) => e.target.value && onSeleccionarPor('agrupador', e.target.value)}
              className="mt-1 w-full rounded border border-barro-300 bg-white px-2 py-1.5 text-sm text-barro-900"
            >
              <option value="">—</option>
              {agrupadores.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        </div>

        {haySeleccion && (
          <button
            type="button"
            onClick={onLimpiar}
            className="mt-3 flex items-center gap-1 text-xs font-medium text-barro-600 hover:text-barro-900"
          >
            <X className="size-3.5" aria-hidden />
            Limpiar selección
          </button>
        )}
      </div>
    </div>
  )
}
