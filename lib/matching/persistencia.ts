import type { PoolClient } from 'pg'
import { Grafo } from './grafo'
import { resolver } from './resolver'
import {
  DIAS_PARA_CONTEO_VIEJO,
  ESTADOS_QUE_EL_EMPAREJADOR_RESUELVE,
  HORIZONTE_DIAS_POR_DEFECTO,
  RADIO_RECOGIDA_M,
  type ContextoEmparejamiento,
  type PedidoAResolver,
  type TemporadaActual,
} from './tipos'

/**
 * The thin impure shell around the pure resolver: read a snapshot, classify, write back.
 *
 * What it writes is deliberately narrow — `pedidos.estado`, `motivo`, `nodo_sugerido`, and
 * *proposed* rows in `emparejamientos`. It never decrements stock, never commits capacity,
 * never touches a route (non-negotiable 2.1, Section 8).
 */

export type ResumenEmparejamiento = {
  evaluados: number
  cambiados: number
  porEstado: Record<string, number>
}

export async function cargarContexto(
  client: PoolClient,
  temporada: TemporadaActual,
  ahora: Date,
): Promise<ContextoEmparejamiento> {
  // One query at a time: a node-postgres client is not concurrent, and issuing these
  // together on the same client is deprecated and unsafe.
  // PRD-33 §24: a route carries its cold-chain aptitude (absent row = not apt, fail-closed), so
  // the matcher can exclude legs that cannot preserve a cold-chain item.
  const rutas = await client.query(
    `select r.id, r.origen_id, r.destino_id, r.modo, r.minutos, r.temporada, r.activa,
            coalesce(rcf.apta_cadena_frio, false) as apta_cadena_frio
       from rutas r
       left join rutas_restriccion_cadena_frio rcf on rcf.ruta_id = r.id`,
  )
  // PRD-33 §24: a node carries whether it can hold cold chain (absent row = cannot).
  const nodos = await client.query(
    `select n.id, n.nombre, n.comunidad_id, n.activo,
            st_y(n.ubicacion) as lat, st_x(n.ubicacion) as lon,
            coalesce(naf.apta_cadena_frio, false) as apta_cadena_frio
       from nodos n
       left join nodos_almacenamiento_frio naf on naf.nodo_id = n.id`,
  )
  const existencias = await client.query(
    `select nodo_id, codigo_item, cantidad, contado_en from existencias`,
  )
  // Section 8: never report SIN_EXISTENCIA without having looked here.
  const ofertas = await client.query(
    `select o.id, o.codigo_item, o.cantidad, o.estado, o.perecedero, o.vence_en,
            o.necesita_recogida,
            st_y(o.ubicacion) as lat, st_x(o.ubicacion) as lon,
            ct.nombre as ofrecido_por, ct.comunidad_id
       from ofertas o
       join contactos ct on ct.id = o.contacto_id
      where o.estado = 'DISPONIBLE'`,
  )
  const capacidades = await client.query(
    `select c.id, c.modo, c.origen_nodo_id, c.hasta_comunidad_id, c.sale_en,
            c.cupo_familias, c.estado, ct.nombre as contacto_nombre
       from capacidades c
       join contactos ct on ct.id = c.contacto_id
      where c.estado = 'OFRECIDA'`,
  )
  const comunidades = await client.query(`select id, nombre from comunidades`)

  return {
    temporada,
    ahora,
    horizonteDias: HORIZONTE_DIAS_POR_DEFECTO,
    diasParaConteoViejo: DIAS_PARA_CONTEO_VIEJO,
    radioRecogidaM: RADIO_RECOGIDA_M,
    rutas: rutas.rows.map((r) => ({
      id: r.id,
      origenId: r.origen_id,
      destinoId: r.destino_id,
      modo: r.modo,
      minutos: r.minutos,
      temporada: r.temporada,
      activa: r.activa,
      aptaCadenaFrio: r.apta_cadena_frio,
    })),
    nodos: nodos.rows.map((n) => ({
      id: n.id,
      nombre: n.nombre,
      comunidadId: n.comunidad_id,
      activo: n.activo,
      lat: n.lat,
      lon: n.lon,
      aptaCadenaFrio: n.apta_cadena_frio,
    })),
    existencias: existencias.rows.map((e) => ({
      nodoId: e.nodo_id,
      codigoItem: e.codigo_item,
      cantidad: e.cantidad,
      contadoEn: e.contado_en,
    })),
    ofertas: ofertas.rows.map((o) => ({
      id: o.id,
      ofrecidoPor: o.ofrecido_por,
      codigoItem: o.codigo_item,
      cantidad: o.cantidad,
      estado: o.estado,
      perecedero: o.perecedero,
      venceEn: o.vence_en,
      lat: o.lat,
      lon: o.lon,
      comunidadId: o.comunidad_id,
      necesitaRecogida: o.necesita_recogida,
    })),
    capacidades: capacidades.rows.map((c) => ({
      id: c.id,
      contactoNombre: c.contacto_nombre,
      modo: c.modo,
      origenNodoId: c.origen_nodo_id,
      hastaComunidadId: c.hasta_comunidad_id,
      saleEn: c.sale_en,
      cupoFamilias: c.cupo_familias,
      estado: c.estado,
    })),
    nombresComunidad: new Map(comunidades.rows.map((c) => [c.id, c.nombre])),
  }
}

async function pedidosAbiertos(client: PoolClient, soloPedidoId?: string) {
  const { rows } = await client.query(
    `select p.id, p.comunidad_id, p.codigo_item, p.familias, p.urgencia, p.estado,
            p.motivo, p.nodo_sugerido, p.oferta_sugerida,
            ci.item_label, ci.unidad_singular, ci.unidad_plural, ci.entregable,
            cra.cadena_frio, cra.sensible_luz, cra.max_minutos_transito
       from pedidos p
       join catalogo_items ci on ci.codigo = p.codigo_item
       -- PRD-33 §24: the item's storage requirement, when it has one (left join: most items do not).
       left join catalogo_requisitos_almacenamiento cra on cra.codigo_item = p.codigo_item
      where p.estado = any($1::text[])
        and ($2::uuid is null or p.id = $2::uuid)
        -- A human has already committed to this one; the matcher does not get to
        -- second-guess that on the next sweep (2.1).
        and not exists (
          select 1 from emparejamientos e
           where e.pedido_id = p.id and e.confirmado_por is not null
        )
      order by p.urgencia desc, p.creado_en`,
    [ESTADOS_QUE_EL_EMPAREJADOR_RESUELVE as unknown as string[], soloPedidoId ?? null],
  )
  return rows
}

export async function emparejar(
  client: PoolClient,
  opciones: { temporada: TemporadaActual; ahora?: Date; pedidoId?: string },
): Promise<ResumenEmparejamiento> {
  const ahora = opciones.ahora ?? new Date()
  const contexto = await cargarContexto(client, opciones.temporada, ahora)
  // Memoised once for the whole sweep: one traversal per supply node, not per request.
  const grafo = new Grafo(contexto.rutas, contexto.temporada)

  const filas = await pedidosAbiertos(client, opciones.pedidoId)
  const resumen: ResumenEmparejamiento = { evaluados: 0, cambiados: 0, porEstado: {} }

  for (const fila of filas) {
    const pedido: PedidoAResolver = {
      id: fila.id,
      comunidadId: fila.comunidad_id,
      codigoItem: fila.codigo_item,
      itemLabel: fila.item_label,
      unidadSingular: fila.unidad_singular,
      unidadPlural: fila.unidad_plural,
      entregable: fila.entregable,
      familias: fila.familias,
      urgencia: fila.urgencia,
      // PRD-33 §24: null when the item has no storage constraint (no requisitos row).
      requisitoAlmacenamiento:
        fila.cadena_frio === null || fila.cadena_frio === undefined
          ? null
          : {
              cadenaFrio: fila.cadena_frio,
              sensibleLuz: fila.sensible_luz,
              maxMinutosTransito: fila.max_minutos_transito,
            },
    }

    const veredicto = resolver(pedido, contexto, grafo)
    resumen.evaluados += 1
    resumen.porEstado[veredicto.estado] = (resumen.porEstado[veredicto.estado] ?? 0) + 1

    const cambio =
      fila.estado !== veredicto.estado ||
      fila.motivo !== veredicto.motivo ||
      (fila.nodo_sugerido ?? null) !== (veredicto.nodoId ?? null) ||
      (fila.oferta_sugerida ?? null) !== (veredicto.ofertaId ?? null)

    await client.query(
      `update pedidos
          set estado = $2, motivo = $3, nodo_sugerido = $4, oferta_sugerida = $5
        where id = $1`,
      [
        pedido.id,
        veredicto.estado,
        veredicto.motivo,
        veredicto.nodoId ?? null,
        veredicto.ofertaId ?? null,
      ],
    )

    // Unconfirmed proposals are disposable by definition; confirmed ones are a human
    // decision and are never touched here.
    await client.query(
      `delete from emparejamientos where pedido_id = $1 and confirmado_por is null`,
      [pedido.id],
    )

    if (veredicto.estado === 'LISTO' && veredicto.nodoId && veredicto.capacidadId) {
      await client.query(
        `insert into emparejamientos (pedido_id, nodo_id, oferta_id, capacidad_id, cantidad)
           values ($1, $2, $3, $4, $5)
         on conflict do nothing`,
        [
          pedido.id,
          veredicto.nodoId,
          veredicto.ofertaId ?? null,
          veredicto.capacidadId,
          pedido.familias,
        ],
      )
    }

    if (cambio) {
      resumen.cambiados += 1
      // actor_id stays null: this was the engine, not a person. Every row that *is* a
      // person's decision carries their id (Section 11).
      await client.query(
        `insert into auditoria (actor_id, accion, entidad, entidad_id, antes, despues)
           values (null, 'emparejador.reclasifico', 'pedidos', $1, $2, $3)`,
        [
          pedido.id,
          JSON.stringify({ estado: fila.estado, motivo: fila.motivo }),
          JSON.stringify({ estado: veredicto.estado, motivo: veredicto.motivo }),
        ],
      )
    }
  }

  return resumen
}
