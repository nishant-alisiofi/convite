import { CATALOGO_SEMILLA, UNIDADES_SEMILLA } from '@/db/seed/catalogo'
import { COMUNIDADES_SEMILLA } from '@/db/seed/comunidades'
import {
  CAPACIDADES_SEMILLA,
  CONTACTOS_SEMILLA,
  EXISTENCIAS_SEMILLA,
  NODOS_SEMILLA,
  OFERTAS_SEMILLA,
} from '@/db/seed/operacion'
import { RUTAS_SEMILLA } from '@/db/seed/rutas'
import type {
  CapacidadGrafo,
  ContextoEmparejamiento,
  ExistenciaGrafo,
  OfertaGrafo,
  PedidoAResolver,
  RutaGrafo,
  TemporadaActual,
} from '@/lib/matching/tipos'
import {
  DIAS_PARA_CONTEO_VIEJO,
  HORIZONTE_DIAS_POR_DEFECTO,
  RADIO_RECOGIDA_M,
} from '@/lib/matching/tipos'

const NOMBRE_POR_TELEFONO: Record<string, string> = Object.fromEntries(
  CONTACTOS_SEMILLA.map((c) => [c.telefono, c.nombre]),
)

/**
 * Builds a matching context from the real M1 seed, so the tests exercise the basin the
 * product actually ships with rather than a toy graph that happens to prove the point.
 *
 * Ids are the seed's own codes — 'QBD', 'BOD-QBD' — because the resolver treats them as
 * opaque strings and a failing assertion should read like a place, not a uuid.
 */

export const AHORA = new Date('2026-08-13T12:00:00Z')

const DIA = 86_400_000

export function haceDias(dias: number, desde: Date = AHORA): Date {
  return new Date(desde.getTime() - dias * DIA)
}

export function enDias(dias: number, desde: Date = AHORA): Date {
  return new Date(desde.getTime() + dias * DIA)
}

export type Cuenca = {
  ctx: ContextoEmparejamiento
  /** Builds a request for a community and catalogue code. */
  pedido: (comunidad: string, codigoItem: string, familias: number, urgencia?: number) => PedidoAResolver
  /** Closes a directed leg in every season, the way a coordinator would after a landslide. */
  cerrarTramo: (origen: string, destino: string) => void
  /** Replaces the stock of one item at one node. */
  ponerExistencia: (nodo: string, codigoItem: string, cantidad: number, diasDesdeConteo?: number) => void
  /** Removes every offered capacity, leaving the thin side empty. */
  sinCapacidades: () => void
  /** Empties every warehouse of one item — the "node inventory is stale" case. */
  vaciarBodegas: (codigoItem: string) => void
  /** Removes every individual offer. */
  sinOfertas: () => void
  agregarOferta: (oferta: Partial<OfertaGrafo> & { codigoItem: string }) => OfertaGrafo
  agregarCapacidad: (capacidad: Partial<CapacidadGrafo> & { origenNodoId: string; hastaComunidadId: string }) => CapacidadGrafo
}

export function construirCuenca(
  temporada: TemporadaActual = 'lluvias',
  ahora: Date = AHORA,
): Cuenca {
  const rutas: RutaGrafo[] = RUTAS_SEMILLA.map((r, i) => ({
    id: `r${i}`,
    origenId: r.origen,
    destinoId: r.destino,
    modo: r.modo,
    minutos: r.minutos,
    temporada: r.temporada,
    activa: r.activa,
  }))

  const nodos = NODOS_SEMILLA.map((n) => ({
    id: n.clave,
    nombre: n.nombre,
    comunidadId: n.comunidad,
    activo: true,
    lat: n.lat,
    lon: n.lon,
  }))

  const ofertas: OfertaGrafo[] = OFERTAS_SEMILLA.map((o, i) => ({
    id: `of${i}`,
    ofrecidoPor: NOMBRE_POR_TELEFONO[o.telefono] ?? null,
    codigoItem: o.codigoItem,
    cantidad: o.cantidad,
    estado: o.estado,
    perecedero: o.perecedero ?? false,
    venceEn: o.venceEnHoras ? new Date(ahora.getTime() + o.venceEnHoras * 3_600_000) : null,
    lat: o.lat ?? null,
    lon: o.lon ?? null,
    comunidadId: 'QBD',
    necesitaRecogida: o.necesitaRecogida ?? true,
  }))

  const existencias: ExistenciaGrafo[] = EXISTENCIAS_SEMILLA.flatMap((bloque) =>
    Object.entries(bloque.items).map(([codigoItem, cantidad]) => ({
      nodoId: bloque.nodo,
      codigoItem,
      cantidad,
      contadoEn: haceDias(bloque.diasDesdeConteo, ahora),
    })),
  )

  const capacidades: CapacidadGrafo[] = CAPACIDADES_SEMILLA.map((c, i) => ({
    id: `cap${i}`,
    contactoNombre: 'Aníbal Córdoba',
    modo: c.modo,
    origenNodoId: c.origenNodo,
    hastaComunidadId: c.hastaComunidad,
    saleEn: enDias(c.enDias, ahora),
    cupoFamilias: c.cupoFamilias,
    estado: 'OFRECIDA',
  }))

  const ctx: ContextoEmparejamiento = {
    temporada,
    ahora,
    horizonteDias: HORIZONTE_DIAS_POR_DEFECTO,
    diasParaConteoViejo: DIAS_PARA_CONTEO_VIEJO,
    radioRecogidaM: RADIO_RECOGIDA_M,
    rutas,
    nodos,
    existencias,
    ofertas,
    capacidades,
    nombresComunidad: new Map(COMUNIDADES_SEMILLA.map((c) => [c.codigo, c.nombre])),
  }

  return {
    ctx,

    pedido(comunidad, codigoItem, familias, urgencia = 2) {
      const item = CATALOGO_SEMILLA.find((i) => i.codigo === codigoItem)
      if (!item) throw new Error(`Código de catálogo desconocido: ${codigoItem}`)
      const unidades = UNIDADES_SEMILLA[codigoItem]
      return {
        id: `p-${comunidad}-${codigoItem}`,
        comunidadId: comunidad,
        codigoItem,
        itemLabel: item.itemLabel,
        unidadSingular: unidades?.[0] ?? null,
        unidadPlural: unidades?.[1] ?? null,
        entregable: item.entregable ?? true,
        familias,
        urgencia,
      }
    },

    cerrarTramo(origen, destino) {
      for (const ruta of ctx.rutas) {
        if (ruta.origenId === origen && ruta.destinoId === destino) ruta.activa = false
      }
    },

    ponerExistencia(nodo, codigoItem, cantidad, diasDesdeConteo = 1) {
      const existente = ctx.existencias.find(
        (e) => e.nodoId === nodo && e.codigoItem === codigoItem,
      )
      if (existente) {
        existente.cantidad = cantidad
        existente.contadoEn = haceDias(diasDesdeConteo, ahora)
      } else {
        ctx.existencias.push({
          nodoId: nodo,
          codigoItem,
          cantidad,
          contadoEn: haceDias(diasDesdeConteo, ahora),
        })
      }
    },

    sinCapacidades() {
      ctx.capacidades.length = 0
    },

    vaciarBodegas(codigoItem) {
      for (const existencia of ctx.existencias) {
        if (existencia.codigoItem === codigoItem) existencia.cantidad = 0
      }
    },

    sinOfertas() {
      ctx.ofertas.length = 0
    },

    agregarOferta(parcial) {
      const oferta: OfertaGrafo = {
        id: parcial.id ?? `of-${ctx.ofertas.length}`,
        ofrecidoPor: parcial.ofrecidoPor ?? 'Emperatriz Mosquera',
        codigoItem: parcial.codigoItem,
        cantidad: parcial.cantidad ?? null,
        estado: parcial.estado ?? 'DISPONIBLE',
        perecedero: parcial.perecedero ?? false,
        venceEn: parcial.venceEn ?? null,
        lat: parcial.lat ?? 5.6921,
        lon: parcial.lon ?? -76.6558,
        comunidadId: parcial.comunidadId ?? 'QBD',
        necesitaRecogida: parcial.necesitaRecogida ?? true,
      }
      ctx.ofertas.push(oferta)
      return oferta
    },

    agregarCapacidad(parcial) {
      const capacidad: CapacidadGrafo = {
        id: parcial.id ?? `cap-${ctx.capacidades.length}`,
        contactoNombre: parcial.contactoNombre ?? 'Aníbal Córdoba',
        modo: parcial.modo ?? 'lancha',
        origenNodoId: parcial.origenNodoId,
        hastaComunidadId: parcial.hastaComunidadId,
        saleEn: parcial.saleEn ?? enDias(3, ahora),
        cupoFamilias: parcial.cupoFamilias ?? 40,
        estado: parcial.estado ?? 'OFRECIDA',
      }
      ctx.capacidades.push(capacidad)
      return capacidad
    },
  }
}
