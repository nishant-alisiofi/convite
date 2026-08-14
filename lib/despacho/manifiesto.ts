import type { PoolClient } from 'pg'
import { representacionDe } from '@/lib/mapa/precision'

/**
 * The manifest: the piece of paper that goes on the boat.
 *
 * It answers three questions and nothing else — where am I going, in what order, what do I
 * hand over at each stop, and what four digits do I get read back. It has to survive being
 * printed, folded, rained on, and read by torchlight, so it is HTML with a print stylesheet
 * rather than a generated PDF: no dependency, no font embedding, and a browser's own print
 * dialogue already makes a PDF when somebody needs to send one over WhatsApp.
 */

export type Parada = {
  orden: number
  pedidoId: string
  comunidad: string
  municipio: string
  lat: number | null
  lon: number | null
  ubicacionFuente: string | null
  ubicacionPrecisionM: number | null
  item: string
  familiasAsignadas: number
  familiasPedidas: number
  codigoConfirmacion: string | null
  minutos: number | null
}

export type Manifiesto = {
  envioId: string
  codigo: string
  modo: string
  estado: string
  transportista: string | null
  origenNodo: string
  origenComunidad: string
  origenLat: number | null
  origenLon: number | null
  salidaProgramada: Date | null
  salidaReal: Date | null
  cupoFamilias: number
  despachadoEn: Date | null
  paradas: Parada[]
  decision: {
    reglaAplicada: string
    confirmadoEn: Date
    nota: string | null
    postergados: { folio: number; comunidad: string; pedidas: number }[]
  } | null
}

export async function cargarManifiesto(
  client: PoolClient,
  envioId: string,
): Promise<Manifiesto | null> {
  const { rows: envios } = await client.query(
    `select e.id, e.codigo, e.modo, e.estado, e.salida_programada, e.salida_real,
            e.cupo_familias, e.despachado_en,
            ct.nombre as transportista,
            n.nombre as origen_nodo, com.nombre as origen_comunidad,
            st_y(coalesce(n.ubicacion, com.ubicacion)) as origen_lat,
            st_x(coalesce(n.ubicacion, com.ubicacion)) as origen_lon
       from envios e
       join contactos ct on ct.id = e.responsable_id
       join nodos n on n.id = e.origen_nodo_id
       join comunidades com on com.id = n.comunidad_id
      where e.id = $1`,
    [envioId],
  )
  const e = envios[0]
  if (!e) return null

  const { rows: paradas } = await client.query(
    `select ei.orden_parada, ei.pedido_id, ei.familias_asignadas,
            p.familias as familias_pedidas,
            c.nombre as comunidad, c.municipio,
            st_y(c.ubicacion) as lat, st_x(c.ubicacion) as lon,
            c.ubicacion_fuente, c.ubicacion_precision_m,
            ci.item_label as item,
            en.codigo_confirmacion
       from envio_items ei
       join pedidos p on p.id = ei.pedido_id
       join comunidades c on c.id = p.comunidad_id
       join catalogo_items ci on ci.codigo = p.codigo_item
       left join entregas en on en.envio_id = ei.envio_id and en.pedido_id = ei.pedido_id
      where ei.envio_id = $1
      order by ei.orden_parada`,
    [envioId],
  )

  const { rows: decisiones } = await client.query(
    `select regla_aplicada, confirmado_en, nota, pedidos_postergados
       from decisiones_asignacion where envio_id = $1 order by confirmado_en limit 1`,
    [envioId],
  )

  return {
    envioId: e.id,
    codigo: e.codigo,
    modo: e.modo,
    estado: e.estado,
    transportista: e.transportista,
    origenNodo: e.origen_nodo,
    origenComunidad: e.origen_comunidad,
    origenLat: e.origen_lat,
    origenLon: e.origen_lon,
    salidaProgramada: e.salida_programada,
    salidaReal: e.salida_real,
    cupoFamilias: e.cupo_familias,
    despachadoEn: e.despachado_en,
    paradas: paradas.map((p) => ({
      orden: p.orden_parada,
      pedidoId: p.pedido_id,
      comunidad: p.comunidad,
      municipio: p.municipio,
      lat: p.lat,
      lon: p.lon,
      ubicacionFuente: p.ubicacion_fuente,
      ubicacionPrecisionM: p.ubicacion_precision_m,
      item: p.item,
      familiasAsignadas: p.familias_asignadas,
      familiasPedidas: p.familias_pedidas,
      codigoConfirmacion: p.codigo_confirmacion,
      minutos: null,
    })),
    decision: decisiones[0]
      ? {
          reglaAplicada: decisiones[0].regla_aplicada,
          confirmadoEn: decisiones[0].confirmado_en,
          nota: decisiones[0].nota,
          postergados: decisiones[0].pedidos_postergados ?? [],
        }
      : null,
  }
}

export type PuntoCroquis = {
  x: number
  y: number
  etiqueta: string
  /** Radius in SVG units, from the stored accuracy. Zero means an exact fix. */
  radio: number
  esOrigen: boolean
}

export type Croquis = { puntos: PuntoCroquis[]; ancho: number; alto: number }

/**
 * A schematic sketch of the run, for the printed sheet.
 *
 * Equirectangular and unlabelled by distance on purpose: it shows the order of the stops and
 * roughly where they sit relative to each other, which is what a sheet of paper can honestly
 * carry. The connectors are dashed for the same reason as on the map — we hold no channel
 * geometry, and a solid line would be a claim about the route.
 *
 * Precision survives the trip to paper: a centroid is drawn as its circle here too, so a
 * driver reading this does not conclude we know the landing site to the metre.
 */
export function croquisDe(manifiesto: Manifiesto, ancho = 520, alto = 360): Croquis {
  const puntos: {
    lat: number
    lon: number
    etiqueta: string
    radioM: number
    esOrigen: boolean
  }[] = []

  if (manifiesto.origenLat !== null && manifiesto.origenLon !== null) {
    puntos.push({
      lat: manifiesto.origenLat,
      lon: manifiesto.origenLon,
      etiqueta: manifiesto.origenNodo,
      radioM: 0,
      esOrigen: true,
    })
  }

  for (const p of manifiesto.paradas) {
    const figura = representacionDe({
      lat: p.lat,
      lon: p.lon,
      fuente: (p.ubicacionFuente as 'centroide' | null) ?? null,
      precisionM: p.ubicacionPrecisionM,
    })
    if (figura.forma === 'ausente') continue

    puntos.push({
      lat: figura.lat,
      lon: figura.lon,
      etiqueta: `${p.orden}. ${p.comunidad}`,
      radioM: figura.forma === 'circulo' ? figura.radioM : 0,
      esOrigen: false,
    })
  }

  if (puntos.length === 0) return { puntos: [], ancho, alto }

  const lats = puntos.map((p) => p.lat)
  const lons = puntos.map((p) => p.lon)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLon = Math.min(...lons)
  const maxLon = Math.max(...lons)

  const margen = 48
  const spanLat = Math.max(maxLat - minLat, 0.01)
  const spanLon = Math.max(maxLon - minLon, 0.01)
  // One scale for both axes so the sketch is not stretched into a different shape.
  const escala = Math.min((ancho - margen * 2) / spanLon, (alto - margen * 2) / spanLat)
  const metrosPorGrado = 111_320

  return {
    ancho,
    alto,
    puntos: puntos.map((p) => ({
      x: margen + (p.lon - minLon) * escala,
      // SVG y grows downward; north should be up.
      y: alto - margen - (p.lat - minLat) * escala,
      etiqueta: p.etiqueta,
      radio: (p.radioM / metrosPorGrado) * escala,
      esOrigen: p.esOrigen,
    })),
  }
}
