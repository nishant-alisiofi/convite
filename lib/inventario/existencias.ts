import type { PoolClient } from 'pg'

/**
 * FR-43 — reading and recording expiry lots against counted node stock (`existencias`).
 *
 * Every function runs against the client `conSesion()` hands it, so RLS (0054) is the real
 * boundary — this module never re-implements it, it drives it. Classification (vencido /
 * próximo / sin fecha) is pure logic in `lib/inventario/lotes.ts`; this module only reads and
 * writes rows.
 */

export type LoteInventario = {
  id: string
  existenciaId: string
  cantidad: number
  /** Null = unknown, never a fabricated date (2.3, BUG-23). */
  fechaCaducidad: Date | null
  codigoItem: string
  itemLabel: string
  nodoNombre: string
  comunidadNombre: string
  contadoEn: Date
}

/** Every recorded lot for perishable items, across every node this session can see. */
export async function listarLotes(client: PoolClient): Promise<LoteInventario[]> {
  const { rows } = await client.query<{
    id: string
    existencia_id: string
    cantidad: number
    fecha_caducidad: Date | null
    codigo_item: string
    item_label: string
    nodo_nombre: string
    comunidad_nombre: string
    contado_en: Date
  }>(
    `select l.id, l.existencia_id, l.cantidad, l.fecha_caducidad,
            e.codigo_item, ci.item_label, n.nombre as nodo_nombre, c.nombre as comunidad_nombre,
            l.contado_en
       from existencia_lotes l
       join existencias e on e.id = l.existencia_id
       join catalogo_items ci on ci.codigo = e.codigo_item
       join nodos n on n.id = e.nodo_id
       join comunidades c on c.id = n.comunidad_id
      order by l.fecha_caducidad nulls last, l.contado_en`,
  )
  return rows.map((r) => ({
    id: r.id,
    existenciaId: r.existencia_id,
    cantidad: r.cantidad,
    fechaCaducidad: r.fecha_caducidad,
    codigoItem: r.codigo_item,
    itemLabel: r.item_label,
    nodoNombre: r.nodo_nombre,
    comunidadNombre: r.comunidad_nombre,
    contadoEn: r.contado_en,
  }))
}

export type NuevoLote = {
  existenciaId: string
  cantidad: number
  /** Optional on purpose (2.3, BUG-23) — omit rather than guess when the date is not known. */
  fechaCaducidad?: Date | null
  notas?: string | null
}

/** Records a new lot against an already-counted `existencias` row. */
export async function registrarLote(client: PoolClient, entrada: NuevoLote, actorId: string): Promise<void> {
  await client.query(
    `insert into existencia_lotes (existencia_id, cantidad, fecha_caducidad, contado_por, notas)
       values ($1, $2, $3, $4, $5)`,
    [
      entrada.existenciaId,
      entrada.cantidad,
      entrada.fechaCaducidad ?? null,
      actorId,
      entrada.notas ?? null,
    ],
  )
}
