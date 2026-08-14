import type { PoolClient } from 'pg'
import { encolar } from '@/lib/jobs/cola'
import { registrarEntrante } from './bitacora'
import { esConfiable, type NormalizadorPort, normalizadorPendiente } from './normalizador'
import { COPIA, encolarSalida } from './salidas'
import type { SobreEntrante } from './tipos'

/**
 * What happens when a message lands.
 *
 * The order is the milestone. Non-negotiable 2.13: **the record is created on receipt, never
 * on confirmation.** The confirmation exchange that follows is a courtesy and a correction
 * opportunity — it is never a gate. Someone who sends a voice note from a coverage point and
 * walks home has reported; whether they are still reachable ten minutes later when we reply
 * changes nothing about whether their need exists.
 *
 * So: log the message (which is also the idempotency check, 2.7), resolve the person, write
 * the reporte, queue the media, and only then decide what to say back.
 *
 * Two exchanges, never more, and never a menu (2.11, PRD §2):
 *   receive → normalize → confirm
 * The normalizer is M4 and does not exist, so `normalizadorPendiente` returns nothing above
 * threshold and every intake takes the clarification branch. That is the intended default,
 * not a degraded mode — see lib/canales/normalizador.ts.
 */

export const FLUJO_INTAKE = 'intake'
export const PASO_ACLARACION = 'esperando_aclaracion'

/**
 * Ten attempts on the shared ladder (1, 5, 15, 60, then 240 minutes) spans roughly 29 hours,
 * which covers PRD §4 M5's «retry a failed provider download with backoff for 24 hours».
 * The message record is kept either way: losing the audio must never lose the report.
 */
export const MAX_INTENTOS_MEDIA = 10

export type DepsIntake = {
  normalizador?: NormalizadorPort
  ahora?: Date
}

export type ResultadoIntake =
  | { estado: 'duplicado' }
  | {
      estado: 'registrado'
      mensajeId: string
      reporteId: string
      folio: number
      contactoId: string
      /** The reporte's tipo: 'sin_clasificar' whenever the normalizer stayed below threshold. */
      tipo: string
      /** True when this intake asked the one clarification question. */
      preguntoAclaracion: boolean
      /** True when the folio confirmation was queued instead. */
      confirmoFolio: boolean
      mediaEncolada: number
    }

/**
 * Which partner organisation a webhook belongs to.
 *
 * 0008 routes by the `phone_number_id` Meta puts in the payload. That column is nullable on
 * purpose — we do not yet know whose WABA we will operate under (D3) — so when it is unset
 * and there is exactly one active organisation, that is unambiguously the one. With two, we
 * refuse rather than guess: routing a community's report to the wrong partner is worse than
 * a failed webhook.
 */
export async function resolverOrganizacion(
  client: PoolClient,
  phoneNumberId: string | null,
): Promise<string> {
  if (phoneNumberId) {
    const { rows } = await client.query<{ id: string }>(
      'select id from organizaciones where waba_phone_number_id = $1 and activo',
      [phoneNumberId],
    )
    if (rows[0]) return rows[0].id
  }

  const { rows } = await client.query<{ id: string }>(
    'select id from organizaciones where activo order by creado_en limit 2',
  )
  if (rows.length === 1) return rows[0]!.id
  throw new Error(
    phoneNumberId
      ? `Ningún organizacion tiene waba_phone_number_id = ${phoneNumberId}.`
      : 'El webhook no trae phone_number_id y hay más de una organización activa.',
  )
}

/** The person, by phone number. They never log in (2.10) — the number is the whole identity. */
async function resolverContacto(
  client: PoolClient,
  telefono: string,
  ahora: Date,
): Promise<{ id: string; comunidadId: string | null }> {
  const { rows } = await client.query<{ id: string; comunidad_id: string | null }>(
    `insert into contactos (telefono, ultimo_contacto_en)
     values ($1, $2)
     on conflict (telefono) do update
       set ultimo_contacto_en = greatest(
             coalesce(contactos.ultimo_contacto_en, excluded.ultimo_contacto_en),
             excluded.ultimo_contacto_en)
     returning id, comunidad_id`,
    [telefono, ahora],
  )
  return { id: rows[0]!.id, comunidadId: rows[0]!.comunidad_id }
}

/** Is a clarification question already outstanding? `expira_en` is days, never minutes (2.13). */
async function aclaracionViva(
  client: PoolClient,
  contactoId: string,
  ahora: Date,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `select 1 from conversaciones
      where contacto_id = $1 and flujo = $2 and paso = $3 and expira_en > $4`,
    [contactoId, FLUJO_INTAKE, PASO_ACLARACION, ahora],
  )
  return (rowCount ?? 0) > 0
}

/**
 * Runs one envelope all the way through. Caller supplies the transaction: a webhook that
 * half-committed is worse than one that returned 500 and got retried.
 */
export async function recibirSobre(
  client: PoolClient,
  sobre: SobreEntrante,
  organizacionId: string,
  deps: DepsIntake = {},
): Promise<ResultadoIntake> {
  const ahora = deps.ahora ?? new Date()
  const normalizador = deps.normalizador ?? normalizadorPendiente

  // 2.7, first and before anything else. A retried webhook stops here.
  const registro = await registrarEntrante(client, sobre, organizacionId)
  if (registro.estado === 'duplicado') return { estado: 'duplicado' }

  const contacto = sobre.telefono
    ? await resolverContacto(client, sobre.telefono, sobre.recibidoEn)
    : null

  // The normalizer proposes; it never fixes (2.12). Below threshold nothing is written onto
  // the reporte and the row stays honestly unclassified.
  const propuesta = await normalizador.proponer({ texto: sobre.contenido.texto })
  const confiable = esConfiable(propuesta)
  const tipo = confiable ? (propuesta.tipo ?? 'necesidad') : 'sin_clasificar'

  const { rows: filasReporte } = await client.query<{ id: string; folio: number }>(
    `insert into reportes
       (organizacion_id, tipo, canal, contacto_id, comunidad_id, codigo_item, detalle_libre,
        ubicacion, ubicacion_fuente, ubicacion_precision_m, payload_crudo)
     values ($1, $2, $3, $4, $5, $6, $7,
       case when $8::double precision is null then null
            else st_setsrid(st_makepoint($9::double precision, $8::double precision), 4326) end,
       $10, $11, $12)
     returning id, folio`,
    [
      organizacionId,
      tipo,
      sobre.canal,
      contacto?.id ?? null,
      contacto?.comunidadId ?? null,
      confiable ? propuesta.codigoItem : null,
      // The original is never overwritten (PRD §4 M4). A transcript lands on the adjunto.
      sobre.contenido.texto,
      sobre.ubicacion?.lat ?? null,
      sobre.ubicacion?.lon ?? null,
      sobre.ubicacion?.fuente ?? null,
      sobre.ubicacion?.precisionM ?? null,
      JSON.stringify(sobre.payloadCrudo),
    ],
  )
  const reporte = filasReporte[0]!

  await client.query('update mensajes set contacto_id = $2, reporte_id = $3 where id = $1', [
    registro.mensajeId,
    contacto?.id ?? null,
    reporte.id,
  ])

  // Media is downloaded by a job, not here: the provider ref expires in minutes but the
  // webhook has to return 200 in seconds, and a slow download must never cost us the report.
  let mediaEncolada = 0
  for (const media of sobre.contenido.media) {
    await encolar(
      client,
      'descargar_media',
      {
        reporteId: reporte.id,
        ref: media.refProveedor,
        tipo: media.tipo,
        mime: media.mime ?? null,
        duracionSeg: media.duracionSeg ?? null,
      },
      undefined,
      MAX_INTENTOS_MEDIA,
    )
    mediaEncolada += 1
  }

  // ── The second exchange ────────────────────────────────────────────────────────────────
  // Everything above already happened. Nothing below can undo it.

  let preguntoAclaracion = false
  let confirmoFolio = false

  if (contacto) {
    // The window is open by definition: they just wrote to us. Still routed through the rule
    // rather than around it, so the one code path is the one production uses.
    const contextoVentana = { ultimoEntranteEn: sobre.recibidoEn, ahora }

    if (confiable) {
      await client.query(
        `delete from conversaciones where contacto_id = $1 and flujo = $2 and paso = $3`,
        [contacto.id, FLUJO_INTAKE, PASO_ACLARACION],
      )
      await encolarSalida(
        client,
        {
          contactoId: contacto.id,
          cuerpo: COPIA.folio(reporte.folio),
          plantilla: 'reporte_recibido',
          canalSugerido: sobre.canal,
        },
        contextoVentana,
      )
      confirmoFolio = true
    } else if (!(await aclaracionViva(client, contacto.id, ahora))) {
      // Exactly one question. A second message while the first is still unanswered adds to
      // the pile of things a coordinator will read; it does not earn another round trip,
      // because every round trip costs this person battery and money (Section 6.5).
      await client.query(
        `insert into conversaciones (contacto_id, flujo, paso, payload_parcial)
         values ($1, $2, $3, $4::jsonb)
         on conflict (contacto_id) do update
           set flujo = excluded.flujo,
               paso = excluded.paso,
               payload_parcial = excluded.payload_parcial`,
        [contacto.id, FLUJO_INTAKE, PASO_ACLARACION, JSON.stringify({ reporteId: reporte.id })],
      )
      await encolarSalida(
        client,
        {
          contactoId: contacto.id,
          cuerpo: COPIA.aclaracion,
          canalSugerido: sobre.canal,
        },
        contextoVentana,
      )
      preguntoAclaracion = true
    }
  }

  return {
    estado: 'registrado',
    mensajeId: registro.mensajeId,
    reporteId: reporte.id,
    folio: reporte.folio,
    contactoId: contacto?.id ?? '',
    tipo,
    preguntoAclaracion,
    confirmoFolio,
    mediaEncolada,
  }
}
