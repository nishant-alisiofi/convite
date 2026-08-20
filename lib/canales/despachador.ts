import type { Pool, PoolClient } from 'pg'
import type { Canal } from '@/db/schema/vocabulario'
import { encolar } from '../jobs/cola'
import { comoConfirmar, type PerfilContacto } from './politica'
import { recortarAUnSegmento, segmentar } from './sms/segmentos'
import { type EstadoPresupuesto, revisarTopes } from './topes'
import type { ProveedorVoz } from './voz/driver'
import { ESPERA_CONFIRMAR_CALLBACK_SEG } from './voz/reintento'
import { type ContextoVentana, decidirSalida, type DecisionVentana, type Plantilla } from './ventana'

/**
 * The only place anything is ever queued to go out.
 *
 * PRD §4 M6: **no code path sends unconditionally.** That is a structural claim, not a
 * habit, so there is exactly one function that writes to `salidas_pendientes` and it always
 * runs the policy and — on WhatsApp — the 24-hour rule first. If a second writer appears,
 * the rules become advisory, and the first thing anyone will notice is a message that
 * silently never arrived.
 *
 * Nothing here talks to a network either. There is no aggregator yet (D2) and no WABA (D3);
 * the queue is the destination, and M6's job is to make sure what lands in it is something
 * that could actually be delivered.
 */

export type SalidaSolicitada = {
  contactoId: string
  cuerpo: string
  /**
   * A shorter body for when the policy routes this to SMS. Not an optimisation: the full
   * WhatsApp wording does not fit one segment, and the SMS variant also drops the offer of a
   * voice note, which would be the wrong thing to ask of a weak link anyway.
   */
  cuerpoCorto?: string
  plantilla?: Plantilla | null
  prioridad?: number
  /** The channel the person reached us on. The reply does not have to use it. */
  canalEntrada: Canal
}

export type ResultadoDespacho = {
  id: string
  canal: Canal
  cuerpo: string
  decision: DecisionVentana
  segmentos: number
  motivoPolitica: string
}

export async function cargarPerfil(
  ejecutor: Pool | PoolClient,
  contactoId: string,
): Promise<PerfilContacto> {
  const { rows } = await ejecutor.query<{
    calidad_enlace: string | null
    media_exitosa: boolean | null
    canal_preferido: string
    tier_conectividad: number | null
  }>(
    `select c.calidad_enlace, c.media_exitosa, c.canal_preferido, co.tier_conectividad
       from contactos c
       left join comunidades co on co.id = c.comunidad_id
      where c.id = $1`,
    [contactoId],
  )
  const fila = rows[0]
  if (!fila) throw new Error(`No existe el contacto ${contactoId}.`)

  return {
    contactoId,
    calidadEnlace: fila.calidad_enlace === null ? null : Number(fila.calidad_enlace),
    mediaExitosa: fila.media_exitosa,
    canalPreferido: fila.canal_preferido as Canal,
    tierComunidad: fila.tier_conectividad,
  }
}

/**
 * Decides how this message would have to go out, and queues it.
 *
 * A refusal from the 24-hour rule is not a discard: the row stays queued and rides out with
 * the person's next inbound message (2.14). Dropping it would lose a folio somebody is
 * waiting on.
 */
export async function despachar(
  ejecutor: Pool | PoolClient,
  salida: SalidaSolicitada,
  contexto: ContextoVentana,
): Promise<ResultadoDespacho> {
  const perfil = await cargarPerfil(ejecutor, salida.contactoId)
  const plan = comoConfirmar(perfil, salida.canalEntrada)

  const cuerpo = plan.unSoloSegmento ? (salida.cuerpoCorto ?? salida.cuerpo) : salida.cuerpo
  const medida = segmentar(cuerpo)

  if (plan.unSoloSegmento && !medida.cabeEnUno) {
    // A single message that does not fit is a copy bug, not a runtime condition — and the
    // one that silently triples the bill. Loud here beats invisible on the invoice.
    throw new Error(
      `Un SMS debe caber en un segmento: ${medida.unidades} unidades en ${medida.alfabeto}` +
        (medida.culpables.length > 0 ? ` (fuera de GSM-7: ${medida.culpables.join(' ')})` : '') +
        `. Cuerpo: «${cuerpo}»`,
    )
  }

  // The window only exists on WhatsApp. SMS has no equivalent, and pretending otherwise
  // would queue a message behind a rule that does not apply to it.
  const decision: DecisionVentana =
    plan.canal === 'whatsapp'
      ? decidirSalida({ cuerpo, plantilla: salida.plantilla ?? null }, contexto)
      : { permitido: true, modo: 'libre' }

  const { rows } = await ejecutor.query<{ id: string }>(
    `insert into salidas_pendientes (contacto_id, cuerpo, prioridad, canal_sugerido, plantilla)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [
      salida.contactoId,
      cuerpo,
      salida.prioridad ?? 5,
      plan.canal,
      // Recorded so a send after the window closed knows which template it needs (0022).
      salida.plantilla ?? null,
    ],
  )

  return {
    id: rows[0]!.id,
    canal: plan.canal,
    cuerpo,
    decision,
    segmentos: medida.segmentos,
    motivoPolitica: plan.motivo,
  }
}

export type Digesto = {
  mensajeId: string
  cuerpo: string
  canal: Canal
  /** How many queued rows went out in this one message. */
  incluidas: number
  /** How many stayed queued because they did not fit. */
  pendientes: number
}

/**
 * Everything we owe this person, as ONE message, when they reappear.
 *
 * 2.14, verbatim: never five messages fired at once when somebody surfaces. Someone who has
 * been out of coverage for a week and finally gets a bar should not have their battery spent
 * on five notifications — and on a metered prepaid plan, five inbound messages cost them
 * money to receive.
 *
 * Each queued row is written to stand alone (2.13), so joining them needs no connective
 * text. On a channel capped at one segment we take as many as fit and leave the rest queued
 * rather than truncating mid-sentence.
 */
export async function entregarPendientes(
  ejecutor: Pool | PoolClient,
  contactoId: string,
  canalEntrada: Canal,
  ahora: Date = new Date(),
): Promise<Digesto | null> {
  const { rows: pendientes } = await ejecutor.query<{ id: string; cuerpo: string }>(
    `select id, cuerpo from salidas_pendientes
      where contacto_id = $1 and enviado_en is null and enviar_despues_de <= $2
      order by prioridad, creado_en`,
    [contactoId, ahora],
  )
  if (pendientes.length === 0) return null

  const perfil = await cargarPerfil(ejecutor, contactoId)
  const plan = comoConfirmar(perfil, canalEntrada)

  const incluidas: string[] = []
  const lineas: string[] = []
  for (const fila of pendientes) {
    const tentativa = [...lineas, fila.cuerpo].join('\n')
    if (plan.unSoloSegmento && lineas.length > 0 && !segmentar(tentativa).cabeEnUno) break
    lineas.push(fila.cuerpo)
    incluidas.push(fila.id)
  }

  // A first line that alone exceeds a segment can still not be dropped; it is trimmed with a
  // marker so the person at least learns there is something waiting for them.
  let cuerpo = lineas.join('\n')
  if (plan.unSoloSegmento && !segmentar(cuerpo).cabeEnUno) cuerpo = recortarAUnSegmento(cuerpo)

  const { rows: mensajes } = await ejecutor.query<{ id: string }>(
    `insert into mensajes (organizacion_id, proveedor, direccion, canal, contacto_id, cuerpo, estado, telefono)
     select o.id, $2, 'saliente', $3, c.id, $4, 'encolado', c.telefono
       from contactos c
       join organizaciones o on o.activo
      where c.id = $1
      limit 1
     returning id`,
    [contactoId, plan.canal === 'sms' ? 'sms_simulador' : 'whatsapp_cloud', plan.canal, cuerpo],
  )

  await ejecutor.query(
    `update salidas_pendientes
        set enviado_en = $2, intentos = intentos + 1
      where id = any($1::uuid[])`,
    [incluidas, ahora],
  )

  return {
    mensajeId: mensajes[0]!.id,
    cuerpo,
    canal: plan.canal,
    incluidas: incluidas.length,
    pendientes: pendientes.length - incluidas.length,
  }
}

export type ResultadoLlamada =
  | { estado: 'marcando'; llamadaId: string; idExterno: string; presupuesto: EstadoPresupuesto }
  | { estado: 'bloqueada'; llamadaId: string; motivo: string; presupuesto: EstadoPresupuesto }

/**
 * Rings somebody back — the only place in the codebase that dials.
 *
 * Same rule as the message queue, for a sharper reason: this is the one channel where a bug
 * spends money by itself. The caps are checked here, before the provider is touched, so
 * there is no path from a webhook to a phone call that skips them.
 *
 * A refusal writes a `llamadas` row with the reason. A cap that silently declines to call
 * someone back is indistinguishable from an outage, and the person waiting by the phone
 * cannot tell the difference either.
 *
 * Every placed callback also schedules its own `revisar_llamada_marcando` job
 * (`ESPERA_CONFIRMAR_CALLBACK_SEG` out, voz/reintento.ts) — the Adaptive Retry Protocol's
 * (§6.1) entry point. `llamadaOrigenId`, when the caller has it, links the callback to the
 * `perdida` row it answers, which is what the retry's 2-hour TTL measures against.
 */
export async function llamarDeVuelta(
  ejecutor: Pool | PoolClient,
  destino: {
    telefono: string
    organizacionId: string
    contactoId?: string | null
    llamadaOrigenId?: string | null
  },
  deps: { proveedor: ProveedorVoz },
  ahora: Date = new Date(),
): Promise<ResultadoLlamada> {
  const veredicto = await revisarTopes(ejecutor, destino.telefono, ahora)

  if (!veredicto.permitido) {
    const { rows } = await ejecutor.query<{ id: string }>(
      `insert into llamadas
         (organizacion_id, proveedor, contacto_id, telefono, tipo, estado, motivo_bloqueo, iniciada_en)
       values ($1, $2, $3, $4, 'devolucion', 'bloqueada', $5, $6)
       returning id`,
      [
        destino.organizacionId,
        deps.proveedor.nombre,
        destino.contactoId ?? null,
        destino.telefono,
        veredicto.motivo,
        ahora,
      ],
    )
    return {
      estado: 'bloqueada',
      llamadaId: rows[0]!.id,
      motivo: veredicto.motivo,
      presupuesto: veredicto.presupuesto,
    }
  }

  const salida = await deps.proveedor.llamar(destino.telefono)

  const { rows } = await ejecutor.query<{ id: string }>(
    `insert into llamadas
       (organizacion_id, proveedor, proveedor_llamada_id, contacto_id, telefono, tipo, estado,
        iniciada_en, llamada_origen_id)
     values ($1, $2, $3, $4, $5, 'devolucion', 'marcando', $6, $7)
     returning id`,
    [
      destino.organizacionId,
      deps.proveedor.nombre,
      salida.idExterno,
      destino.contactoId ?? null,
      destino.telefono,
      ahora,
      destino.llamadaOrigenId ?? null,
    ],
  )
  const llamadaId = rows[0]!.id

  // §6.1: the only trigger for "did this callback fail" that needs no provider-specific
  // webhook shape — see voz/reintento.ts's header for why a timeout is the honest choice here.
  await encolar(
    ejecutor,
    'revisar_llamada_marcando',
    { llamadaId },
    new Date(ahora.getTime() + ESPERA_CONFIRMAR_CALLBACK_SEG * 1_000),
  )

  return {
    estado: 'marcando',
    llamadaId,
    idExterno: salida.idExterno,
    presupuesto: veredicto.presupuesto,
  }
}
