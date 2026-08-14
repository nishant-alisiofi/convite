import type { PoolClient } from 'pg'
import { alcanzables, cargarCuenca, grafoDe } from '@/lib/alcance'
import type { TemporadaActual } from '@/lib/matching/tipos'

/**
 * Planning a shipment.
 *
 * «Automatizar la aritmética, no el juicio». The engine has already worked out which
 * requests have supply within reach and who is travelling; what it cannot do is decide who
 * waits when the boat is smaller than the queue. So everything here proposes, and a person
 * commits — and the moment the plan shorts somebody, the database will not let it leave
 * until that decision is written down with a name on it (migration 0025).
 */

export type CapacidadOfrecida = {
  id: string
  modo: string
  transportista: string | null
  origenNodoId: string
  origenNodo: string
  hastaComunidadId: string
  hastaComunidad: string
  saleEn: Date
  cupoFamilias: number
  notas: string | null
  envioId: string | null
}

/** Boats and trucks on offer, soonest first. The thin side of the marketplace. */
export async function capacidadesOfrecidas(client: PoolClient): Promise<CapacidadOfrecida[]> {
  const { rows } = await client.query(
    `select c.id, c.modo, ct.nombre as transportista,
            c.origen_nodo_id, n.nombre as origen_nodo,
            c.hasta_comunidad_id, com.nombre as hasta_comunidad,
            c.sale_en, c.cupo_familias, c.notas,
            (select e.id from envios e
               where e.responsable_id = c.contacto_id
                 and e.origen_nodo_id = c.origen_nodo_id
                 and e.salida_programada = c.sale_en
                 and e.estado <> 'CANCELADO'
               limit 1) as envio_id
       from capacidades c
       join contactos ct on ct.id = c.contacto_id
       join nodos n on n.id = c.origen_nodo_id
       join comunidades com on com.id = c.hasta_comunidad_id
      where c.estado in ('OFRECIDA', 'COMPROMETIDA')
      order by c.sale_en`,
  )

  return rows.map((r) => ({
    id: r.id,
    modo: r.modo,
    transportista: r.transportista,
    origenNodoId: r.origen_nodo_id,
    origenNodo: r.origen_nodo,
    hastaComunidadId: r.hasta_comunidad_id,
    hastaComunidad: r.hasta_comunidad,
    saleEn: r.sale_en,
    cupoFamilias: r.cupo_familias,
    notas: r.notas,
    envioId: r.envio_id,
  }))
}

export type Candidato = {
  pedidoId: string
  comunidadId: string
  comunidad: string
  item: string
  codigoItem: string
  familias: number
  urgencia: number
  dias: number
  estado: string
  motivo: string | null
  /** Minutes from the trip's origin, for ordering the stops sensibly. */
  minutos: number | null
  /** Set when the plan sources this from somebody's offer rather than counted stock. */
  ofertaId: string | null
  venceEn: Date | null
  /**
   * True when the goods backing this request spoil before the boat leaves.
   *
   * 2.15, and the bug the first live run produced: the engine cheerfully proposed shipping
   * Saturday's cooked lunches on Sunday's lancha. Filtering what has expired *now* is not
   * enough — it has to survive until departure.
   */
  venceAntesDeSalir: boolean
  /** Already committed to some shipment. */
  yaAsignado: boolean
}

/**
 * Requests this particular trip could serve.
 *
 * Reachability is the trip's, not the basin's: a community counts if it is where the boat is
 * going, or if it sits on the way there (`sirveDePaso`, which is an on-the-path test — the
 * river graph is strongly connected, so "reaches and is reached" would claim a lancha bound
 * for Tagachí can serve Bellavista, ninety minutes past the destination and back).
 */
export async function candidatosParaEnvio(
  client: PoolClient,
  capacidadId: string,
  temporada: TemporadaActual,
): Promise<Candidato[]> {
  const { rows: caps } = await client.query<{
    origen_nodo_id: string
    origen_comunidad_id: string
    hasta_comunidad_id: string
    sale_en: Date
  }>(
    `select c.origen_nodo_id, n.comunidad_id as origen_comunidad_id,
            c.hasta_comunidad_id, c.sale_en
       from capacidades c join nodos n on n.id = c.origen_nodo_id
      where c.id = $1`,
    [capacidadId],
  )
  const cap = caps[0]
  if (!cap) return []

  const cuenca = await cargarCuenca(client)
  const grafo = grafoDe(cuenca, temporada)

  const { rows } = await client.query(
    `select p.id as pedido_id, p.comunidad_id, com.nombre as comunidad,
            ci.item_label as item, p.codigo_item, p.familias, p.urgencia, p.estado, p.motivo,
            extract(day from now() - p.creado_en)::int as dias,
            p.oferta_sugerida,
            (select o.vence_en from ofertas o where o.id = p.oferta_sugerida) as vence_en,
            exists (
              select 1 from envio_items ei join envios e on e.id = ei.envio_id
               where ei.pedido_id = p.id and e.estado <> 'CANCELADO'
            ) as ya_asignado
       from pedidos p
       join comunidades com on com.id = p.comunidad_id
       join catalogo_items ci on ci.codigo = p.codigo_item
      where p.estado in ('LISTO', 'SIN_CAPACIDAD')
        and ci.entregable
      order by p.urgencia desc, p.creado_en`,
  )

  const alcance = alcanzables(cuenca, temporada)

  return rows
    .filter((r) => {
      if (!alcance.has(r.comunidad_id)) return false
      if (r.comunidad_id === cap.hasta_comunidad_id) return true
      return grafo.sirveDePaso(cap.origen_comunidad_id, r.comunidad_id, cap.hasta_comunidad_id)
    })
    .map((r) => ({
      pedidoId: r.pedido_id,
      comunidadId: r.comunidad_id,
      comunidad: r.comunidad,
      item: r.item,
      codigoItem: r.codigo_item,
      familias: r.familias,
      urgencia: r.urgencia,
      dias: r.dias,
      estado: r.estado,
      motivo: r.motivo,
      minutos: grafo.minutosEntre(cap.origen_comunidad_id, r.comunidad_id),
      ofertaId: r.oferta_sugerida,
      venceEn: r.vence_en,
      venceAntesDeSalir: r.vence_en !== null && new Date(r.vence_en) <= new Date(cap.sale_en),
      yaAsignado: r.ya_asignado,
    }))
}

export type Resultado = { ok: true; id?: string } | { ok: false; error: string }

function traducir(error: unknown): string {
  const mensaje = (error as { message?: string })?.message ?? ''
  const restriccion = (error as { constraint?: string })?.constraint

  if (mensaje.includes('decisión de asignación')) return mensaje
  if (mensaje.includes('cupo es')) return mensaje
  if (mensaje.includes('envío vacío')) return mensaje
  if (restriccion === 'envios_despacho_check') {
    return 'Un envío despachado lleva el nombre de quien lo despachó y la hora.'
  }
  if (restriccion === 'envio_items_key') return 'Ese pedido ya está en el envío.'
  if (restriccion === 'envios_codigo_key') return 'Ese código de envío ya existe.'
  return 'No se pudo guardar el cambio.'
}

/** `E-260814-3`: short enough to say over a bad phone line. */
async function siguienteCodigo(client: PoolClient): Promise<string> {
  const hoy = new Date()
  const dia = `${String(hoy.getUTCFullYear()).slice(2)}${String(hoy.getUTCMonth() + 1).padStart(2, '0')}${String(hoy.getUTCDate()).padStart(2, '0')}`
  const { rows } = await client.query<{ n: string }>(
    `select count(*)::text as n from envios where codigo like $1`,
    [`E-${dia}-%`],
  )
  return `E-${dia}-${Number(rows[0]!.n) + 1}`
}

/** Opens a plan against an offered trip. Nothing is committed by creating one. */
export async function crearEnvio(
  client: PoolClient,
  capacidadId: string,
  usuarioId: string,
): Promise<Resultado> {
  try {
    const { rows } = await client.query<{ id: string }>(
      `insert into envios (codigo, modo, responsable_id, origen_nodo_id,
                           salida_programada, cupo_familias, estado)
       select $2, c.modo, c.contacto_id, c.origen_nodo_id, c.sale_en, c.cupo_familias, 'PLANEADO'
         from capacidades c where c.id = $1
       returning id`,
      [capacidadId, await siguienteCodigo(client)],
    )
    const id = rows[0]?.id
    if (!id) return { ok: false, error: 'No se pudo abrir el envío para esa capacidad.' }

    await auditar(client, usuarioId, 'envio.creado', id, { capacidadId })
    return { ok: true, id }
  } catch (error) {
    return { ok: false, error: traducir(error) }
  }
}

/** Adds or updates a stop. `familias` below what was asked is rationing, and is allowed. */
export async function ponerParada(
  client: PoolClient,
  envioId: string,
  pedidoId: string,
  familias: number,
): Promise<Resultado> {
  if (!Number.isInteger(familias) || familias <= 0) {
    return { ok: false, error: 'Diga a cuántas familias les llega.' }
  }

  try {
    const { rowCount } = await client.query(
      `insert into envio_items (envio_id, pedido_id, familias_asignadas, orden_parada)
       values ($1, $2, $3,
               coalesce((select max(orden_parada) + 1 from envio_items where envio_id = $1), 1))
       on conflict (envio_id, pedido_id)
         do update set familias_asignadas = excluded.familias_asignadas`,
      [envioId, pedidoId, familias],
    )
    if (rowCount === 0) return { ok: false, error: 'No tiene permiso para armar este envío.' }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: traducir(error) }
  }
}

export async function quitarParada(
  client: PoolClient,
  envioId: string,
  pedidoId: string,
): Promise<Resultado> {
  const { rowCount } = await client.query(
    `delete from envio_items where envio_id = $1 and pedido_id = $2`,
    [envioId, pedidoId],
  )
  return rowCount === 0 ? { ok: false, error: 'Esa parada ya no estaba.' } : { ok: true }
}

/** Orders the stops as the trip will actually make them. */
export async function ordenarParadas(
  client: PoolClient,
  envioId: string,
  pedidoIdsEnOrden: string[],
): Promise<Resultado> {
  for (const [i, pedidoId] of pedidoIdsEnOrden.entries()) {
    await client.query(
      `update envio_items set orden_parada = $3 where envio_id = $1 and pedido_id = $2`,
      [envioId, pedidoId, i + 1],
    )
  }
  return { ok: true }
}

/**
 * Puts the stops in the order the boat will reach them: nearest to the origin first.
 *
 * Stops arrive in the order somebody added them, which is the order the queue suggested —
 * urgency first. On paper that reads as a route, and it is not one: Las Mercedes sits
 * between Quibdó and Tagachí, so a manifest listing Tagachí first sends the boat past Las
 * Mercedes, on upriver, and back down again. Urgency decides *who is on the boat*; geography
 * decides the order they are visited in.
 */
export async function ordenarPorRecorrido(
  client: PoolClient,
  envioId: string,
  temporada: TemporadaActual,
): Promise<Resultado> {
  const { rows: origenes } = await client.query<{ origen_comunidad_id: string }>(
    `select n.comunidad_id as origen_comunidad_id
       from envios e join nodos n on n.id = e.origen_nodo_id
      where e.id = $1`,
    [envioId],
  )
  const origen = origenes[0]?.origen_comunidad_id
  if (!origen) return { ok: false, error: 'El envío no tiene origen ubicado.' }

  const cuenca = await cargarCuenca(client)
  const grafo = grafoDe(cuenca, temporada)

  const { rows: paradas } = await client.query<{ pedido_id: string; comunidad_id: string }>(
    `select ei.pedido_id, p.comunidad_id
       from envio_items ei join pedidos p on p.id = ei.pedido_id
      where ei.envio_id = $1`,
    [envioId],
  )

  const enOrden = paradas
    .map((p) => ({
      pedidoId: p.pedido_id,
      // Unreachable-but-assigned sorts last rather than first, which is what a null would do.
      costo: grafo.costoCrudo(origen, p.comunidad_id) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.costo - b.costo)
    .map((p) => p.pedidoId)

  return ordenarParadas(client, envioId, enOrden)
}

/**
 * The rationing record (2.9).
 *
 * Written by the person who made the call, in their own name — RLS refuses any other name —
 * and never editable afterwards, because `decisiones_asignacion` has no UPDATE or DELETE
 * policy. A deferred community with nobody to argue with is how the reporter network dies.
 */
export async function registrarDecision(
  client: PoolClient,
  envioId: string,
  decision: { regla: string; nota?: string | null },
  usuarioId: string,
): Promise<Resultado> {
  if (decision.regla.trim().length === 0) {
    return { ok: false, error: 'Diga con qué criterio repartió.' }
  }

  try {
    // Who got served and who was deferred is read from the plan itself rather than typed
    // again: the two must not be able to disagree.
    const { rows: atendidos } = await client.query<{ folio: number; comunidad: string; asignadas: number; pedidas: number }>(
      `select r.folio, c.nombre as comunidad, ei.familias_asignadas as asignadas, p.familias as pedidas
         from envio_items ei
         join pedidos p on p.id = ei.pedido_id
         join reportes r on r.id = p.reporte_id
         join comunidades c on c.id = p.comunidad_id
        where ei.envio_id = $1
        order by ei.orden_parada`,
      [envioId],
    )

    const { rows: postergados } = await client.query<{ folio: number; comunidad: string; pedidas: number }>(
      `select r.folio, c.nombre as comunidad, p.familias as pedidas
         from pedidos p
         join reportes r on r.id = p.reporte_id
         join comunidades c on c.id = p.comunidad_id
        where p.estado in ('LISTO', 'SIN_CAPACIDAD')
          and not exists (
            select 1 from envio_items ei join envios e on e.id = ei.envio_id
             where ei.pedido_id = p.id and e.estado <> 'CANCELADO'
          )
        order by p.urgencia desc, p.creado_en`,
    )

    const { rows } = await client.query<{ id: string }>(
      `insert into decisiones_asignacion
         (envio_id, regla_aplicada, confirmado_por, pedidos_atendidos, pedidos_postergados, nota)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [
        envioId,
        decision.regla.trim(),
        usuarioId,
        JSON.stringify(atendidos),
        JSON.stringify(postergados),
        decision.nota?.trim() || null,
      ],
    )
    if (!rows[0]) return { ok: false, error: 'No tiene permiso para registrar la decisión.' }
    return { ok: true, id: rows[0].id }
  } catch (error) {
    return { ok: false, error: traducir(error) }
  }
}

/**
 * Sends it.
 *
 * Sets the name and the hour on the shipment, then writes one delivery per stop with the
 * four digits the receiving leader will read back. The database checks the rationing rule
 * on the way through, so this cannot succeed on a plan that shorts somebody silently.
 */
export async function despachar(
  client: PoolClient,
  envioId: string,
  usuarioId: string,
): Promise<Resultado> {
  try {
    await client.query('savepoint despachar')

    const { rowCount } = await client.query(
      `update envios
          set estado = 'DESPACHADO', despachado_por = $2, despachado_en = now(),
              salida_real = coalesce(salida_real, now())
        where id = $1 and estado = 'PLANEADO'`,
      [envioId, usuarioId],
    )
    if (rowCount === 0) {
      await client.query('rollback to savepoint despachar')
      return { ok: false, error: 'Ese envío ya salió, o no tiene permiso.' }
    }

    await crearEntregas(client, envioId)
    await auditar(client, usuarioId, 'envio.despachado', envioId, null)

    // The requests are on their way; the matcher must not drag them back into the queue.
    await client.query(
      `update pedidos set estado = 'EN_CAMINO'
        where id in (select pedido_id from envio_items where envio_id = $1)`,
      [envioId],
    )

    await client.query('release savepoint despachar')
    return { ok: true }
  } catch (error) {
    await client.query('rollback to savepoint despachar').catch(() => {})
    return { ok: false, error: traducir(error) }
  }
}

/**
 * One delivery per stop, each with four digits.
 *
 * Unique within the shipment and not globally: four digits are for a person to dictate over
 * a bad line, not for security. Drawn rather than sequential so a driver cannot guess the
 * next community's code and close a delivery they never made.
 */
async function crearEntregas(client: PoolClient, envioId: string): Promise<void> {
  const { rows: paradas } = await client.query<{ pedido_id: string }>(
    `select pedido_id from envio_items where envio_id = $1 order by orden_parada`,
    [envioId],
  )

  const usados = new Set<string>()
  for (const parada of paradas) {
    let codigo = ''
    do {
      codigo = String(Math.floor(Math.random() * 10_000)).padStart(4, '0')
    } while (usados.has(codigo))
    usados.add(codigo)

    await client.query(
      `insert into entregas (envio_id, pedido_id, codigo_confirmacion)
       values ($1, $2, $3)
       on conflict (envio_id, pedido_id) do nothing`,
      [envioId, parada.pedido_id, codigo],
    )
  }
}

async function auditar(
  client: PoolClient,
  actorId: string,
  accion: string,
  entidadId: string,
  despues: unknown,
): Promise<void> {
  await client.query(
    `insert into auditoria (actor_id, accion, entidad, entidad_id, despues)
     values ($1, $2, 'envios', $3, $4)`,
    [actorId, accion, entidadId, despues ? JSON.stringify(despues) : null],
  )
}
