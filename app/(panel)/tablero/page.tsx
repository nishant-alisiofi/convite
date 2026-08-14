import { redirect } from 'next/navigation'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * The Tablero. Section 10 calls it the home screen, and Section 1 says why: "38 pendientes"
 * helps nobody, while "12 esperan transporte, 8 esperan donación, 3 están incomunicadas"
 * turns each number into a specific phone call to a specific person.
 *
 * So the buckets are the layout, and every row shows its `motivo` verbatim — that sentence
 * is the product, not a tooltip.
 *
 * Everything is read through `conSesion`, i.e. as the signed-in user with RLS in force. A
 * verificador scoped to the Atrato medio sees their communities and no others, because the
 * database says so and not because this file filtered anything.
 */

type Fila = {
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
    tono: 'border-emerald-300 bg-emerald-50',
  },
  {
    estado: 'SIN_CAPACIDAD',
    titulo: 'Esperan transporte',
    ayuda: 'Hay con qué y se puede llegar, pero nadie va para allá.',
    tono: 'border-amber-300 bg-amber-50',
  },
  {
    estado: 'SIN_EXISTENCIA',
    titulo: 'Esperan donación',
    ayuda: 'No hay en bodega ni nadie lo está ofreciendo.',
    tono: 'border-sky-300 bg-sky-50',
  },
  {
    estado: 'SIN_RUTA',
    titulo: 'Incomunicadas',
    ayuda: 'No hay cómo llegar en esta temporada.',
    tono: 'border-rose-300 bg-rose-50',
  },
  {
    estado: 'EN_CAMINO',
    titulo: 'En camino',
    ayuda: 'Ya salieron.',
    tono: 'border-stone-300 bg-stone-100',
  },
] as const

export default async function Tablero() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const filas = await conSesion(sesion, async (client) => {
    const { rows } = await client.query<Fila>(
      `select p.id, p.estado, p.motivo, p.familias, p.urgencia,
              c.nombre as comunidad, c.municipio,
              ci.item_label as item,
              extract(day from now() - p.creado_en)::int as dias
         from pedidos p
         join comunidades c on c.id = p.comunidad_id
         join catalogo_items ci on ci.codigo = p.codigo_item
        where p.estado <> 'ENTREGADO' and p.estado <> 'CANCELADO'
        order by p.urgencia desc, p.creado_en`,
    )
    return rows
  })

  const total = filas.length

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-stone-900">Tablero</h1>
        <p className="text-sm text-stone-600">
          {total === 0
            ? 'No hay solicitudes abiertas.'
            : `${total} solicitud${total === 1 ? '' : 'es'} abierta${total === 1 ? '' : 's'}.`}
        </p>
      </div>

      {total === 0 && (
        <p className="mt-8 text-stone-600">
          Cuando entre una necesidad verificada, aparece acá clasificada por lo que le falta.
        </p>
      )}

      <div className="mt-6 space-y-8">
        {BUCKETS.map((bucket) => {
          const delBucket = filas.filter((f) => f.estado === bucket.estado)
          if (delBucket.length === 0) return null

          return (
            <section key={bucket.estado}>
              <div className={`rounded-t-lg border-x border-t px-4 py-3 ${bucket.tono}`}>
                <h2 className="font-semibold text-stone-900">
                  {bucket.titulo}
                  <span className="ml-2 font-normal text-stone-600">{delBucket.length}</span>
                </h2>
                <p className="text-sm text-stone-700">{bucket.ayuda}</p>
              </div>

              <ul className="divide-y divide-stone-200 rounded-b-lg border border-stone-200 bg-white">
                {delBucket.map((fila) => (
                  <li key={fila.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-baseline gap-x-2 text-sm text-stone-600">
                      <span className="font-medium text-stone-900">{fila.comunidad}</span>
                      <span>·</span>
                      <span>{fila.item}</span>
                      <span>·</span>
                      <span>
                        {fila.familias} familia{fila.familias === 1 ? '' : 's'}
                      </span>
                      {fila.urgencia === 3 && (
                        <span className="rounded bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-900">
                          urgente
                        </span>
                      )}
                      <span className="ml-auto text-stone-500">
                        {fila.dias === 0 ? 'hoy' : `hace ${fila.dias} d`}
                      </span>
                    </div>
                    {/* The sentence the matcher wrote. This is the phone call. */}
                    <p className="mt-1 text-stone-800">{fila.motivo}</p>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </main>
  )
}
