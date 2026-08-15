import { TriangleAlert } from 'lucide-react'

/**
 * The Tablero's markup, kept out of the route so it renders without a signed-in session.
 *
 * `page.tsx` runs the query under RLS and hands the rows here; this file only lays them out —
 * the same split as `verificacion/tarjeta.tsx`, and for the same reason: a screen behind auth
 * that a local clone can't reach is a screen whose layout nobody checks.
 *
 * The board is the layout. Each state owns one hue and carries it as a left rail, so a
 * coordinator scanning down the page sees which pile a card is in before reading a word — and
 * the `motivo` sentence is set as the body of each row, because that sentence is the phone
 * call, not a tooltip.
 */

export type Fila = {
  id: string
  estado: string
  motivo: string | null
  familias: number
  urgencia: number
  comunidad: string
  municipio: string
  item: string
  dias: number
}

const BUCKETS = [
  {
    estado: 'LISTO',
    titulo: 'Listos para despachar',
    ayuda: 'Hay ruta, hay con qué y hay quién lo lleve. Falta que alguien confirme.',
    tinta: 'bg-selva-50',
    borde: 'border-l-selva-600',
  },
  {
    estado: 'SIN_CAPACIDAD',
    titulo: 'Esperan transporte',
    ayuda: 'Hay con qué y se puede llegar, pero nadie va para allá.',
    tinta: 'bg-atrato-50',
    borde: 'border-l-atrato-600',
  },
  {
    estado: 'SIN_EXISTENCIA',
    titulo: 'Esperan donación',
    ayuda: 'No hay en bodega ni nadie lo está ofreciendo.',
    tinta: 'bg-sky-50',
    borde: 'border-l-sky-500',
  },
  {
    estado: 'SIN_RUTA',
    titulo: 'Incomunicadas',
    ayuda: 'No hay cómo llegar en esta temporada.',
    tinta: 'bg-rose-50',
    borde: 'border-l-rose-500',
  },
  {
    estado: 'EN_CAMINO',
    titulo: 'En camino',
    ayuda: 'Ya salieron.',
    tinta: 'bg-barro-100',
    borde: 'border-l-barro-400',
  },
] as const

export default function TableroVista({ filas }: { filas: Fila[] }) {
  return (
    <div className="mt-6 space-y-6">
      {BUCKETS.map((bucket) => {
        const delBucket = filas.filter((f) => f.estado === bucket.estado)
        if (delBucket.length === 0) return null

        return (
          <section
            key={bucket.estado}
            className={`overflow-hidden rounded-lg border border-l-4 border-barro-200 ${bucket.borde}`}
          >
            <div className={`px-4 py-3 ${bucket.tinta}`}>
              <h2 className="flex items-center gap-2 font-semibold text-barro-900">
                {bucket.titulo}
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium tabular-nums text-barro-700">
                  {delBucket.length}
                </span>
              </h2>
              <p className="mt-0.5 text-sm text-barro-700">{bucket.ayuda}</p>
            </div>

            <ul className="divide-y divide-barro-100 bg-white">
              {delBucket.map((fila) => (
                <li key={fila.id} className="px-4 py-3">
                  {/* Line 1: the community is the anchor, and urgency sits right beside it so a
                      coordinator scanning down the pile catches it first. The age is pinned to
                      the right and never wraps onto its own orphaned line. */}
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium text-barro-900">{fila.comunidad}</span>
                      {fila.urgencia === 3 && (
                        <span className="flex shrink-0 items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-900">
                          <TriangleAlert className="size-3" aria-hidden />
                          urgente
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-barro-500">
                      {fila.dias === 0 ? 'hoy' : `hace ${fila.dias} d`}
                    </span>
                  </div>
                  {/* Line 2: what and how many, flowing and wrapping cleanly. */}
                  <p className="mt-0.5 text-sm text-barro-600">
                    {fila.item}
                    <span className="text-barro-300"> · </span>
                    {fila.familias} familia{fila.familias === 1 ? '' : 's'}
                  </p>
                  {/* The sentence the matcher wrote. This is the phone call. */}
                  <p className="mt-1.5 text-barro-800">{fila.motivo}</p>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
