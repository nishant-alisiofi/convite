import type { PoolClient } from 'pg'

/**
 * Covering one request with several offers.
 *
 * PRD §6, the offer aggregation gap: an offer currently has to cover a whole request on its
 * own, so eight people offering two mercados each will not satisfy a request for twelve even
 * though together they obviously do.
 *
 * This is deliberately not matcher logic. §13 says humans decide who gets what, and
 * combining offers is exactly that decision — somebody looks at eight households and picks
 * which ones to ask. So the engine keeps proposing single sources, and this is where a
 * person overrides it, one confirmed `emparejamientos` row per offer, each carrying the
 * share it covers.
 */

export type OfertaCandidata = {
  ofertaId: string
  ofrecidoPor: string | null
  textoOriginal: string
  cantidad: number | null
  unidad: string | null
  perecedero: boolean
  venceEn: Date | null
  /** Already committed to some request by a person. */
  comprometida: boolean
}

export type Cobertura = {
  pedidoId: string
  item: string
  familias: number
  /** Sum of the confirmed shares against this request. */
  cubierto: number
  candidatas: OfertaCandidata[]
}

/**
 * Offers that could go towards this request, and how much of it is already covered.
 *
 * Commitment is read from confirmed `emparejamientos` rather than from `ofertas.estado`:
 * the ledger of who promised what to whom is the same table the allocation is written to,
 * and a despachador cannot write `ofertas` at all (0017 keeps that with the coordinator).
 */
export async function coberturaDePedido(
  client: PoolClient,
  pedidoId: string,
): Promise<Cobertura | null> {
  const { rows: pedidos } = await client.query<{
    codigo_item: string
    familias: number
    item: string
  }>(
    `select p.codigo_item, p.familias, ci.item_label as item
       from pedidos p join catalogo_items ci on ci.codigo = p.codigo_item
      where p.id = $1`,
    [pedidoId],
  )
  const pedido = pedidos[0]
  if (!pedido) return null

  const { rows: cubiertoFilas } = await client.query<{ suma: string }>(
    `select coalesce(sum(cantidad), 0)::text as suma
       from emparejamientos
      where pedido_id = $1 and confirmado_por is not null and oferta_id is not null`,
    [pedidoId],
  )

  const { rows: candidatas } = await client.query(
    `select o.id, ct.nombre as ofrecido_por, o.texto_original, o.cantidad, o.unidad,
            o.perecedero, o.vence_en,
            exists (
              select 1 from emparejamientos e
               where e.oferta_id = o.id and e.confirmado_por is not null
                 and e.pedido_id <> $1
            ) as comprometida
       from ofertas o
       join contactos ct on ct.id = o.contacto_id
      where o.estado = 'DISPONIBLE'
        and o.codigo_item = $2
        and (o.vence_en is null or o.vence_en > now())
      order by o.perecedero desc, o.vence_en nulls last, o.cantidad desc nulls last`,
    [pedidoId, pedido.codigo_item],
  )

  return {
    pedidoId,
    item: pedido.item,
    familias: pedido.familias,
    cubierto: Number(cubiertoFilas[0]!.suma),
    candidatas: candidatas.map((o) => ({
      ofertaId: o.id,
      ofrecidoPor: o.ofrecido_por,
      textoOriginal: o.texto_original,
      cantidad: o.cantidad,
      unidad: o.unidad,
      perecedero: o.perecedero,
      venceEn: o.vence_en,
      comprometida: o.comprometida,
    })),
  }
}

export type Resultado = { ok: true; cubierto: number } | { ok: false; error: string }

/**
 * Commits a person's selection: these offers, these shares, against this request.
 *
 * Each row is confirmed on the spot, because selecting them *is* the human confirmation
 * non-negotiable 2.1 asks for — unlike a matcher proposal, nobody generated this.
 */
export async function combinarOfertas(
  client: PoolClient,
  pedidoId: string,
  selecciones: { ofertaId: string; cantidad: number }[],
  usuarioId: string,
): Promise<Resultado> {
  if (selecciones.length === 0) return { ok: false, error: 'No escogió ningún ofrecimiento.' }
  if (selecciones.some((s) => !Number.isInteger(s.cantidad) || s.cantidad <= 0)) {
    return { ok: false, error: 'Cada ofrecimiento aporta un número de familias mayor que cero.' }
  }

  try {
    await client.query('savepoint combinar')

    const { rows: nodos } = await client.query<{ nodo_id: string }>(
      // The goods still have to be gathered somewhere before they travel; the node the
      // engine already picked for this request is where the pickup run will take them.
      `select coalesce(p.nodo_sugerido, (select id from nodos where activo order by nombre limit 1)) as nodo_id
         from pedidos p where p.id = $1`,
      [pedidoId],
    )
    const nodoId = nodos[0]?.nodo_id
    if (!nodoId) {
      await client.query('rollback to savepoint combinar')
      return { ok: false, error: 'No hay centro donde reunir lo que se ofrece.' }
    }

    for (const s of selecciones) {
      const { rowCount } = await client.query(
        `insert into emparejamientos
           (pedido_id, nodo_id, oferta_id, cantidad, confirmado_por, confirmado_en)
         values ($1, $2, $3, $4, $5, now())
         on conflict (pedido_id, capacidad_id, oferta_id)
           do update set cantidad = excluded.cantidad,
                         confirmado_por = excluded.confirmado_por,
                         confirmado_en = excluded.confirmado_en`,
        [pedidoId, nodoId, s.ofertaId, s.cantidad, usuarioId],
      )
      if (rowCount === 0) {
        await client.query('rollback to savepoint combinar')
        return { ok: false, error: 'No tiene permiso para asignar ofrecimientos.' }
      }
    }

    await client.query(
      `insert into auditoria (actor_id, accion, entidad, entidad_id, despues)
       values ($1, 'pedido.ofertas_combinadas', 'pedidos', $2, $3)`,
      [usuarioId, pedidoId, JSON.stringify(selecciones)],
    )

    const { rows } = await client.query<{ suma: string }>(
      `select coalesce(sum(cantidad), 0)::text as suma
         from emparejamientos
        where pedido_id = $1 and confirmado_por is not null and oferta_id is not null`,
      [pedidoId],
    )

    await client.query('release savepoint combinar')
    return { ok: true, cubierto: Number(rows[0]!.suma) }
  } catch (error) {
    await client.query('rollback to savepoint combinar').catch(() => {})
    const mensaje = (error as { message?: string })?.message ?? ''
    return { ok: false, error: mensaje || 'No se pudo combinar los ofrecimientos.' }
  }
}
