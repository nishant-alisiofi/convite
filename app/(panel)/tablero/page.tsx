import { redirect } from 'next/navigation'
import { conSesion, sesionActual } from '@/lib/sesion'
import TableroVista, { type Fila } from './vista'

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

export default async function Tablero() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const filas = await conSesion(sesion, async (client) => {
    const { rows } = await client.query<Fila>(
      // The report is joined in only to carry how the need arrived onto the board (its channel,
      // and whether it was a transcribed voice note). LEFT JOIN so a pedido never drops off the
      // Tablero if RLS happens to hide its report row — the badge just goes quiet.
      `select p.id, p.estado, p.motivo, p.familias, p.urgencia,
              c.nombre as comunidad, c.municipio,
              ci.item_label as item,
              extract(day from now() - p.creado_en)::int as dias,
              r.canal,
              exists (
                select 1 from adjuntos a
                 where a.reporte_id = r.id and a.tipo = 'audio'
                   and coalesce(a.transcripcion_corregida, a.transcripcion) is not null
              ) as transcrito
         from pedidos p
         join comunidades c on c.id = p.comunidad_id
         join catalogo_items ci on ci.codigo = p.codigo_item
         left join reportes r on r.id = p.reporte_id
        where p.estado <> 'ENTREGADO' and p.estado <> 'CANCELADO'
        order by p.urgencia desc, p.creado_en`,
    )
    return rows
  })

  const total = filas.length

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-barro-900">Tablero</h1>
        <p className="text-sm text-barro-600">
          {total === 0
            ? 'No hay solicitudes abiertas.'
            : `${total} solicitud${total === 1 ? '' : 'es'} abierta${total === 1 ? '' : 's'}.`}
        </p>
      </div>

      {total === 0 && (
        <p className="mt-8 text-barro-600">
          Cuando entre una necesidad verificada, aparece acá clasificada por lo que le falta.
        </p>
      )}

      <TableroVista filas={filas} />
    </main>
  )
}
