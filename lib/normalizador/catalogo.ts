import type { Pool, PoolClient } from 'pg'
import { CATALOGO_SEMILLA, UNIDADES_SEMILLA } from '@/db/seed/catalogo'
import type { TipoReporte } from '@/db/schema/vocabulario'

/**
 * A read-only snapshot of `catalogo_items`, handed to the extractor.
 *
 * The extractor is pure and must not know what any code means — non-negotiable 2.8 says
 * nothing in the repo may branch on an item code, and the catalogue is editable from the
 * Catálogo screen without a deploy. So the semantics travel with the data: whether an item
 * asks for detail, what its minimum urgency is, how a person counts it out loud.
 */

export type ItemCatalogo = {
  codigo: string
  tipo: TipoReporte
  itemLabel: string
  familiaLabel: string
  unidadSingular: string | null
  unidadPlural: string | null
  pideDetalle: boolean
  urgenciaMin: number
  entregable: boolean
}

export type Catalogo = ReadonlyMap<string, ItemCatalogo>

export async function cargarCatalogo(ejecutor: Pool | PoolClient): Promise<Catalogo> {
  const { rows } = await ejecutor.query<{
    codigo: string
    tipo: string
    item_label: string
    familia_label: string
    unidad_singular: string | null
    unidad_plural: string | null
    pide_detalle: boolean
    urgencia_min: number
    entregable: boolean
  }>(
    `select codigo, tipo, item_label, familia_label, unidad_singular, unidad_plural,
            pide_detalle, urgencia_min, entregable
       from catalogo_items
      where activo`,
  )

  return new Map(
    rows.map((r) => [
      r.codigo.trim(),
      {
        codigo: r.codigo.trim(),
        tipo: r.tipo as TipoReporte,
        itemLabel: r.item_label,
        familiaLabel: r.familia_label,
        unidadSingular: r.unidad_singular,
        unidadPlural: r.unidad_plural,
        pideDetalle: r.pide_detalle,
        urgenciaMin: r.urgencia_min,
        entregable: r.entregable,
      },
    ]),
  )
}

/**
 * The same snapshot built from the seed, for tests that have no database. It is the seed the
 * hosted catalogue was created from, so the two agree until a coordinator edits one.
 */
export function catalogoDesdeSemilla(): Catalogo {
  return new Map(
    CATALOGO_SEMILLA.map((i) => [
      i.codigo,
      {
        codigo: i.codigo,
        tipo: i.tipo,
        itemLabel: i.itemLabel,
        familiaLabel: i.familiaLabel,
        unidadSingular: UNIDADES_SEMILLA[i.codigo]?.[0] ?? null,
        unidadPlural: UNIDADES_SEMILLA[i.codigo]?.[1] ?? null,
        pideDetalle: i.pideDetalle ?? false,
        urgenciaMin: i.urgenciaMin ?? 1,
        entregable: i.entregable ?? true,
      },
    ]),
  )
}
