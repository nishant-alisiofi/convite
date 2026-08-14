import type { Fuente } from './fuentes'
import type { PedidoAResolver } from './tipos'

/**
 * The `motivo` sentences.
 *
 * These are not log lines. Section 8: the string appears verbatim in the coordinator UI,
 * and Section 15 sets the register — warm, plain, usted, short, never technical. A bucket
 * labelled "SIN_CAPACIDAD: 8" tells nobody anything; «Hay 180 mercados en Bodega Central
 * Quibdó, pero nadie va para Bellavista» is a phone call to a specific boat owner.
 *
 * Each state composes one phrase describing where the goods are with one describing what
 * is missing, so adding a supply type does not multiply the sentences.
 */

const numero = new Intl.NumberFormat('es-CO')

const partesFecha = new Intl.DateTimeFormat('es-CO', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

/** «jueves 16 de agosto» — no comma, the way a person writes it. */
export function fechaLarga(fecha: Date): string {
  const partes = partesFecha.formatToParts(fecha)
  const buscar = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? ''
  return `${buscar('weekday')} ${buscar('day')} de ${buscar('month')}`
}

export function diasDesde(fecha: Date, ahora: Date): number {
  return Math.max(0, Math.floor((ahora.getTime() - fecha.getTime()) / 86_400_000))
}

/**
 * «18 mercados», «1 mercado». Falls back to the catalogue label when an item has no unit
 * words — items added later from the Catálogo screen should be asked for both forms.
 */
export function cantidad(n: number, pedido: PedidoAResolver): string {
  const unidad = n === 1 ? pedido.unidadSingular : pedido.unidadPlural
  if (unidad) return `${numero.format(n)} ${unidad}`
  return `${numero.format(n)} ${pedido.itemLabel.toLocaleLowerCase('es-CO')}`
}

/** Non-negotiable 2.3: a figure we are quoting has to say how old it is. */
function caveatConteo(contadoEn: Date, ahora: Date, diasParaViejo: number): string {
  const dias = diasDesde(contadoEn, ahora)
  if (dias < diasParaViejo) return ''
  if (dias === 1) return ' (contado ayer)'
  return ` (contado hace ${numero.format(dias)} días)`
}

export type ContextoFrase = {
  pedido: PedidoAResolver
  comunidad: string
  ahora: Date
  diasParaConteoViejo: number
}

/**
 * What is sitting there, as a noun phrase. Used when the sentence is about a shortage —
 * the coordinator needs to know how much exists and, for counted stock, how old the figure
 * is. An offer names the person, because that is who they have to ring.
 */
export function describirDisponible(fuente: Fuente, ctx: ContextoFrase): string {
  if (fuente.tipo === 'nodo') {
    return (
      `${cantidad(fuente.existencia.cantidad, ctx.pedido)} en ${fuente.nodo.nombre}` +
      caveatConteo(fuente.existencia.contadoEn, ctx.ahora, ctx.diasParaConteoViejo)
    )
  }

  const quien = fuente.oferta.ofrecidoPor ?? 'alguien'
  if (fuente.oferta.cantidad === null) {
    // 2.12: say plainly that nobody stated a quantity, rather than quietly implying one.
    return (
      `un ofrecimiento de ${ctx.pedido.itemLabel.toLocaleLowerCase('es-CO')} de ${quien}, ` +
      `sin cantidad confirmada`
    )
  }
  return `${cantidad(fuente.oferta.cantidad, ctx.pedido)} que ofrece ${quien}`
}

/**
 * What would actually travel. Used when the plan is ready: the coordinator is about to load
 * a boat, so the useful number is what goes on it, not what stays in the warehouse.
 */
export function describirEnvio(fuente: Fuente, ctx: ContextoFrase): string {
  if (fuente.tipo === 'nodo') {
    return `${cantidad(ctx.pedido.familias, ctx.pedido)} desde ${fuente.nodo.nombre}`
  }

  const quien = fuente.oferta.ofrecidoPor ?? 'alguien'
  if (fuente.oferta.cantidad === null) {
    return `lo que ofrece ${quien}, sin cantidad confirmada`
  }
  return `${cantidad(ctx.pedido.familias, ctx.pedido)} de los que ofrece ${quien}`
}

/** Non-negotiable 2.15: if it spoils, the sentence has to say when. */
function avisoVencimiento(fuente: Fuente): string {
  if (fuente.tipo !== 'oferta' || !fuente.oferta.perecedero || !fuente.oferta.venceEn) return ''
  return ` Se vence el ${fechaLarga(fuente.oferta.venceEn)}: hay que moverlo primero.`
}

/** An offer has to be collected before it can be shipped. Say so, once. */
function avisoRecogida(fuente: Fuente): string {
  if (fuente.tipo !== 'oferta' || !fuente.oferta.necesitaRecogida) return ''
  return ` Hay que recogerlo y llevarlo a ${fuente.nodo.nombre}.`
}

export function motivoNoEsCarga(pedido: PedidoAResolver, comunidad: string): string {
  return (
    `${pedido.itemLabel} no se resuelve mandando carga: alguien tiene que viajar hasta ` +
    `${comunidad}. Coordine una visita.`
  )
}

export function motivoSinRuta(comunidad: string, temporada: 'lluvias' | 'seca'): string {
  const cuando = temporada === 'seca' ? 'en verano' : 'en temporada de lluvias'
  return (
    `${comunidad} está incomunicada: ${cuando} no hay ninguna ruta abierta desde las bodegas. ` +
    `Mientras no se abra un paso, no hay cómo mandar nada.`
  )
}

/**
 * Cut off *and* the goods exist. A different sentence because it is a different phone call:
 * somebody has to open a way through, not find a donor.
 */
export function motivoSinRutaConExistencia(fuente: Fuente, ctx: ContextoFrase): string {
  return (
    `Hay ${describirDisponible(fuente, ctx)}, pero ahora mismo no hay cómo llegar a ` +
    `${ctx.comunidad}. Hay que abrir un paso o buscar otra ruta.`
  )
}

/**
 * Nothing anywhere — and the sentence says both halves were checked, because a coordinator
 * who has been burned by "nobody has stock" appearing above a list of eight donors needs to
 * know this one means it.
 */
export function motivoSinExistencia(
  ctx: ContextoFrase,
  mejorEnBodega: { nombreNodo: string; cantidad: number; contadoEn: Date } | null,
): string {
  const item = ctx.pedido.itemLabel.toLocaleLowerCase('es-CO')
  if (!mejorEnBodega || mejorEnBodega.cantidad === 0) {
    return (
      `No hay ${item} en ninguna bodega que llegue hasta ${ctx.comunidad}, y nadie lo está ` +
      `ofreciendo. Hay que conseguir donación.`
    )
  }
  return (
    `Se necesitan ${cantidad(ctx.pedido.familias, ctx.pedido)} para ${ctx.comunidad} y solo ` +
    `hay ${numero.format(mejorEnBodega.cantidad)} en ${mejorEnBodega.nombreNodo}` +
    `${caveatConteo(mejorEnBodega.contadoEn, ctx.ahora, ctx.diasParaConteoViejo)}. ` +
    `Nadie más lo está ofreciendo: falta conseguir el resto.`
  )
}

export function motivoSinCapacidad(
  fuente: Fuente,
  ctx: ContextoFrase,
  horizonteDias: number,
): string {
  return (
    `Hay ${describirDisponible(fuente, ctx)}, pero nadie va para ${ctx.comunidad} en los ` +
    `próximos ${numero.format(horizonteDias)} días.` +
    avisoVencimiento(fuente)
  )
}

export function motivoListo(
  fuente: Fuente,
  ctx: ContextoFrase,
  transportista: string | null,
  saleEn: Date,
  esDePaso: boolean,
): string {
  const quien = transportista ? ` con ${transportista}` : ''
  const paso = esDePaso ? `, que pasa por ${ctx.comunidad}` : ''
  const confirmar =
    fuente.tipo === 'oferta' && fuente.oferta.cantidad === null
      ? ' Llame para confirmar la cantidad antes de despachar.'
      : ' Confirme para despachar.'

  return (
    `Listo: ${describirEnvio(fuente, ctx)}.` +
    avisoRecogida(fuente) +
    ` Sale el ${fechaLarga(saleEn)}${quien}${paso}.` +
    avisoVencimiento(fuente) +
    confirmar
  )
}
