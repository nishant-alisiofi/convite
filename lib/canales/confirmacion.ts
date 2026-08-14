import type { PoolClient } from 'pg'
import type { Canal } from '@/db/schema/vocabulario'

/**
 * «Recibí» — the four digits that close the loop.
 *
 * Section 9.7: the person who received the load reads back a code. No app, no camera, no
 * signal at the moment of handover — the code is written on the manifest, dictated at the
 * riverbank, and confirmed later from wherever there is a bar of signal. That is why it is
 * four digits and not a QR: it has to survive being read aloud, remembered on a walk, and
 * typed by someone who has never used the system before.
 *
 * The code arrives on whatever channel reaches them. An SMS, a WhatsApp message, keys pressed
 * during an IVR callback — all the same confirmation, and confirming twice is not an error,
 * it is somebody being careful.
 *
 * Codes are unique per shipment, not globally (`entregas_envio_codigo_key`), because four
 * digits are for a person to dictate and not for security. So the code alone does not
 * identify a delivery: it is resolved against the deliveries this community is actually
 * waiting for.
 */

export type ResultadoConfirmacion =
  | { estado: 'confirmada'; entregaId: string; pedidoId: string; folio: number | null }
  | { estado: 'ya_confirmada'; entregaId: string }
  | { estado: 'sin_coincidencia' }
  | { estado: 'ambigua'; candidatas: number }

/** A bare four-digit message is a confirmation attempt and nothing else. */
export function pareceCodigo(texto: string | null): string | null {
  if (!texto) return null
  const limpio = texto.trim().replace(/[\s.-]/g, '')
  return /^\d{4}$/.test(limpio) ? limpio : null
}

/**
 * Resolves a code against what this person's community is waiting for, and confirms it.
 *
 * Idempotent by construction: the second confirmation of the same delivery reports
 * `ya_confirmada` and changes nothing. A code dictated over the phone and then also sent by
 * SMS — which is exactly what a careful person does — must not produce two confirmations, or
 * `familias_atendidas` doubles and the response looks better on paper than it was.
 */
export async function confirmarConCodigo(
  client: PoolClient,
  args: { codigo: string; contactoId: string; canal: Canal; ahora: Date },
): Promise<ResultadoConfirmacion> {
  const { rows } = await client.query<{
    id: string
    pedido_id: string
    confirmado: boolean
  }>(
    `select e.id, e.pedido_id, e.confirmado
       from entregas e
       join pedidos p on p.id = e.pedido_id
       join contactos c on c.id = $2
      where e.codigo_confirmacion = $1
        and p.comunidad_id = c.comunidad_id
      order by e.confirmado, e.creado_en desc`,
    [args.codigo, args.contactoId],
  )

  if (rows.length === 0) return { estado: 'sin_coincidencia' }

  const pendientes = rows.filter((r) => !r.confirmado)
  if (pendientes.length === 0) return { estado: 'ya_confirmada', entregaId: rows[0]!.id }
  // Two open deliveries sharing a code in the same community means a human has to look:
  // guessing which one arrived would put a delivery on the board that never happened.
  if (pendientes.length > 1) return { estado: 'ambigua', candidatas: pendientes.length }

  const entrega = pendientes[0]!

  // Conditional on `not confirmado`, so two confirmations racing in from two channels
  // resolve to one winner at the database rather than in whichever code path ran first.
  const { rowCount } = await client.query(
    `update entregas
        set confirmado = true, confirmado_por_id = $2, confirmado_canal = $3, confirmado_en = $4
      where id = $1 and not confirmado`,
    [entrega.id, args.contactoId, args.canal, args.ahora],
  )
  if ((rowCount ?? 0) === 0) return { estado: 'ya_confirmada', entregaId: entrega.id }

  const { rows: folios } = await client.query<{ folio: number | null }>(
    `select r.folio from pedidos p
       left join reportes r on r.id = p.reporte_id
      where p.id = $1`,
    [entrega.pedido_id],
  )

  return {
    estado: 'confirmada',
    entregaId: entrega.id,
    pedidoId: entrega.pedido_id,
    folio: folios[0]?.folio ?? null,
  }
}

/**
 * How many wrong codes this person has sent lately.
 *
 * Not to lock anybody out — it is four digits and people mistype. It is so that a run of them
 * is visible to a coordinator instead of being eaten one polite reply at a time: somebody
 * repeatedly failing to confirm is usually holding a manifest for a delivery that went to the
 * wrong community, and that is a phone call, not a validation error.
 */
export async function fallosRecientes(
  client: PoolClient,
  contactoId: string,
  ahora: Date,
  horas = 24,
): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    `select count(*) as n
       from mensajes
      where contacto_id = $1
        and direccion = 'entrante'
        and creado_en >= $2::timestamptz - make_interval(hours => $3)
        and cuerpo ~ '^[0-9]{4}$'
        and reporte_id is null`,
    [contactoId, ahora, horas],
  )
  return Number(rows[0]!.n)
}

export const COPIA_CONFIRMACION = {
  /** Warm, and it names what was confirmed so they know the right one landed. */
  gracias: (folio: number | null) =>
    folio === null
      ? 'Gracias, quedó confirmada la entrega. Cualquier cosa, escríbanos.'
      : `Gracias, quedó confirmada la entrega del reporte ${folio}. Cualquier cosa, escríbanos.`,

  /**
   * One segment. The folio is dropped rather than the thanks — they already know which
   * delivery they just confirmed, they are standing next to it.
   */
  graciasSms: 'Gracias, quedó confirmada la entrega.',

  /** Same for a repeat: being careful twice should never feel like an error. */
  yaEstaba: 'Esa entrega ya estaba confirmada. Gracias por avisar.',

  /**
   * A wrong code is not a syntax lesson (2.11, PRD §2). It asks for the one thing that
   * actually resolves it — the manifest number — and leaves the door open.
   */
  noCoincide:
    'No encontramos ese código. ¿Nos dice el número que aparece en el manifiesto, ' +
    'o qué le llegó? Lo revisamos con usted.',

  /** One SMS segment, and it says the same thing. */
  noCoincideSms: 'No encontramos ese código. ¿Nos cuenta qué le llegó? Lo revisamos.',
} as const
