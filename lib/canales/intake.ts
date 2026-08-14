import type { PoolClient } from 'pg'
import { encolar } from '@/lib/jobs/cola'
import { type Catalogo, cargarCatalogo } from '@/lib/normalizador'
import { registrarEntrante } from './bitacora'
import {
  confirmarConCodigo,
  COPIA_CONFIRMACION,
  fallosRecientes,
  pareceCodigo,
} from './confirmacion'
import { despachar, entregarPendientes } from './despachador'
import { anotarActividad, recalcularEnlace } from './enlace'
import {
  esConfiable,
  type NormalizadorPort,
  normalizadorLexico,
  type PropuestaNormalizador,
} from './normalizador'
import { COPIA } from './salidas'
import type { SobreEntrante } from './tipos'

/**
 * What happens when a message lands.
 *
 * The order is the milestone. Non-negotiable 2.13: **the record is created on receipt, never
 * on confirmation.** The exchange that follows is a courtesy and a correction opportunity —
 * it is never a gate. Someone who sends a voice note from a coverage point and walks home
 * has reported; whether they are still reachable ten minutes later changes nothing about
 * whether their need exists.
 *
 * So: log the message (which is also the idempotency check, 2.7), resolve the person, write
 * the reporte, queue the media, and only then decide what to say back.
 *
 * Two exchanges, never more, and never a menu (2.11, PRD §2):
 *   receive → normalize → confirm
 * When the answer to a clarification arrives it does not become a second report — it is
 * merged into the one it answers, and the original text is never overwritten.
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
  /** Injected by tests; otherwise read from `catalogo_items`, which is data (2.8). */
  catalogo?: Catalogo
  ahora?: Date
}

type Registrado = {
  estado: 'registrado'
  mensajeId: string
  reporteId: string
  folio: number
  contactoId: string
  tipo: string
  preguntoAclaracion: boolean
  confirmoFolio: boolean
  mediaEncolada: number
  /** How many queued messages rode out on this inbound, as one digest (2.14). */
  entregadas: number
}

type Fusionado = {
  estado: 'fusionado'
  mensajeId: string
  /** The report this answer belongs to. No second report is created. */
  reporteId: string
  contactoId: string
  tipo: string
  /** True when the merged text finally cleared the threshold. */
  resuelto: boolean
  mediaEncolada: number
  /** How many queued messages rode out on this inbound, as one digest (2.14). */
  entregadas: number
}

type Confirmacion = {
  estado: 'confirmacion'
  mensajeId: string
  contactoId: string
  /** What the code did: closed a delivery, repeated one, or matched nothing. */
  resultado: 'confirmada' | 'ya_confirmada' | 'sin_coincidencia' | 'ambigua'
  entregaId: string | null
  /** Wrong codes from this person in the last day — a run of them is a phone call. */
  fallosRecientes: number
}

export type ResultadoIntake =
  | { estado: 'duplicado' }
  | Registrado
  | Fusionado
  | Confirmacion

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

/** The outstanding clarification for this contact, if any. Days, never minutes (2.13). */
async function aclaracionViva(
  client: PoolClient,
  contactoId: string,
  ahora: Date,
): Promise<{ reporteId: string | null } | null> {
  const { rows } = await client.query<{ payload_parcial: { reporteId?: string } }>(
    `select payload_parcial from conversaciones
      where contacto_id = $1 and flujo = $2 and paso = $3 and expira_en > $4`,
    [contactoId, FLUJO_INTAKE, PASO_ACLARACION, ahora],
  )
  const fila = rows[0]
  if (!fila) return null
  return { reporteId: fila.payload_parcial?.reporteId ?? null }
}

/**
 * The catalogue applies its own rules (contract §4), not the extractor.
 *
 * `urgencia_min` is why «traslado médico» is urgency 3 — because the catalogue says so, and
 * a coordinator can change it from the Catálogo screen without a deploy. The extractor only
 * ever proposes urgency it read in the words, so this is a floor, not a second guess.
 */
function urgenciaFinal(propuesta: PropuestaNormalizador, catalogo: Catalogo): number | null {
  const item = propuesta.codigoItem ? catalogo.get(propuesta.codigoItem) : undefined
  if (!item) return propuesta.urgencia
  return Math.max(propuesta.urgencia ?? 1, item.urgenciaMin)
}

async function encolarMedia(
  client: PoolClient,
  sobre: SobreEntrante,
  reporteId: string,
): Promise<number> {
  let n = 0
  for (const media of sobre.contenido.media) {
    await encolar(
      client,
      'descargar_media',
      {
        reporteId,
        ref: media.refProveedor,
        tipo: media.tipo,
        mime: media.mime ?? null,
        duracionSeg: media.duracionSeg ?? null,
      },
      undefined,
      MAX_INTENTOS_MEDIA,
    )
    n += 1
  }
  return n
}

/**
 * Everything that happens because this person just proved they are reachable.
 *
 * An inbound message is the only reliable signal we get: it says the phone is on, there is
 * signal right now, and at this hour. So it updates the telemetry (2.14 — link quality is
 * measured, not declared) and then flushes whatever we owe them as ONE digest, which is the
 * piggyback the queue exists for. Never five messages fired at once when somebody surfaces.
 */
async function alReaparecer(
  client: PoolClient,
  contactoId: string,
  canalEntrada: SobreEntrante['canal'],
  recibidoEn: Date,
  ahora: Date,
): Promise<number> {
  await anotarActividad(client, contactoId, recibidoEn)
  await recalcularEnlace(client, contactoId, ahora)
  const digesto = await entregarPendientes(client, contactoId, canalEntrada, ahora)
  return digesto?.incluidas ?? 0
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
  const catalogo = deps.catalogo ?? (await cargarCatalogo(client))
  const normalizador = deps.normalizador ?? normalizadorLexico(catalogo)

  // 2.7, first and before anything else. A retried webhook stops here.
  const registro = await registrarEntrante(client, sobre, organizacionId)
  if (registro.estado === 'duplicado') return { estado: 'duplicado' }

  const contacto = sobre.telefono
    ? await resolverContacto(client, sobre.telefono, sobre.recibidoEn)
    : null

  const pendiente = contacto ? await aclaracionViva(client, contacto.id, ahora) : null

  // ── Four digits: somebody confirming a delivery ────────────────────────────────────────
  // Checked before anything else a message could be, because «4721» is not a need, an
  // answer, or free text — it is the last step of a delivery, arriving from wherever this
  // person found signal (Section 9.7).
  const codigo = pareceCodigo(sobre.contenido.texto)
  if (contacto && codigo) {
    const confirmacion = await confirmarConCodigo(client, {
      codigo,
      contactoId: contacto.id,
      canal: sobre.canal,
      ahora,
    })
    const contextoVentana = { ultimoEntranteEn: sobre.recibidoEn, ahora }

    await client.query('update mensajes set contacto_id = $2 where id = $1', [
      registro.mensajeId,
      contacto.id,
    ])

    const respuesta =
      confirmacion.estado === 'confirmada'
        ? COPIA_CONFIRMACION.gracias(confirmacion.folio)
        : confirmacion.estado === 'ya_confirmada'
          ? COPIA_CONFIRMACION.yaEstaba
          : COPIA_CONFIRMACION.noCoincide

    await despachar(
      client,
      {
        contactoId: contacto.id,
        cuerpo: respuesta,
        cuerpoCorto:
          confirmacion.estado === 'confirmada'
            ? COPIA_CONFIRMACION.graciasSms
            : confirmacion.estado === 'ya_confirmada'
              ? COPIA_CONFIRMACION.yaEstaba
              : COPIA_CONFIRMACION.noCoincideSms,
        canalEntrada: sobre.canal,
      },
      contextoVentana,
    )

    const fallos =
      confirmacion.estado === 'confirmada' || confirmacion.estado === 'ya_confirmada'
        ? 0
        : await fallosRecientes(client, contacto.id, ahora)

    await alReaparecer(client, contacto.id, sobre.canal, sobre.recibidoEn, ahora)

    return {
      estado: 'confirmacion',
      mensajeId: registro.mensajeId,
      contactoId: contacto.id,
      resultado: confirmacion.estado,
      entregaId:
        confirmacion.estado === 'confirmada' || confirmacion.estado === 'ya_confirmada'
          ? confirmacion.entregaId
          : null,
      fallosRecientes: fallos,
    }
  }

  // ── The answer to a question we asked ──────────────────────────────────────────────────
  if (contacto && pendiente?.reporteId && sobre.contenido.texto) {
    const fusion = await fusionarAclaracion(client, {
      sobre,
      contactoId: contacto.id,
      reporteId: pendiente.reporteId,
      mensajeId: registro.mensajeId,
      normalizador,
      catalogo,
      ahora,
    })
    if (fusion) return fusion
    // The report it referred to is gone; fall through and treat this as a fresh one.
  }

  // The normalizer proposes; it never fixes (2.12). Below threshold nothing is written onto
  // the reporte and the row stays honestly unclassified.
  const propuesta = await normalizador.proponer({ texto: sobre.contenido.texto, ahora })
  const confiable = esConfiable(propuesta)

  // Some channels state the type structurally rather than in words: an IVR caller who
  // pressed «1 pedir ayuda» has declared it, exactly as the printed card's code does. That
  // is not a guess and it is not the normalizer's to override — but a confident reading of
  // actual words is more specific, because it comes with the catalogue item, so it wins.
  const tipoDelCanal = sobre.tipo === 'necesidad' || sobre.tipo === 'dano' ? sobre.tipo : null
  const tipo = confiable ? (propuesta.tipo ?? 'necesidad') : (tipoDelCanal ?? 'sin_clasificar')

  const { rows: filasReporte } = await client.query<{ id: string; folio: number }>(
    `insert into reportes
       (organizacion_id, tipo, canal, contacto_id, comunidad_id, codigo_item, familias, urgencia,
        severidad, detalle_libre, ubicacion, ubicacion_fuente, ubicacion_precision_m, payload_crudo)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       case when $11::double precision is null then null
            else st_setsrid(st_makepoint($12::double precision, $11::double precision), 4326) end,
       $13, $14, $15)
     returning id, folio`,
    [
      organizacionId,
      tipo,
      sobre.canal,
      contacto?.id ?? null,
      contacto?.comunidadId ?? null,
      confiable ? propuesta.codigoItem : null,
      // A count of households is a fact the person stated; it does not depend on our having
      // understood which item they need.
      propuesta.familias,
      confiable ? urgenciaFinal(propuesta, catalogo) : propuesta.urgencia,
      // Only ever set on a daño, and only from the printed card's second number.
      confiable ? propuesta.severidad : null,
      // texto_original: written once, never overwritten (PRD §4 M4). Transcripts and
      // clarifications land elsewhere.
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
  const mediaEncolada = await encolarMedia(client, sobre, reporte.id)

  // ── The second exchange ────────────────────────────────────────────────────────────────
  // Everything above already happened. Nothing below can undo it.

  let preguntoAclaracion = false
  let confirmoFolio = false

  if (contacto) {
    // The window is open by definition: they just wrote to us. Still routed through the rule
    // rather than around it, so the one code path is the one production uses.
    const contextoVentana = { ultimoEntranteEn: sobre.recibidoEn, ahora }

    // Audio with no words yet is not an unclear message — it is a message nobody has
    // listened to. Asking «¿me cuenta qué necesita?» of someone who just recorded two
    // minutes explaining exactly that is the channel insulting them, and it is what the
    // clarification branch would otherwise do to every voice note and every IVR call. The
    // report waits for a transcript (D8) or for the audio inbox (M7), and meanwhile they
    // get their folio like anyone else.
    const esperaTranscripcion =
      !sobre.contenido.texto && sobre.contenido.media.some((m) => m.tipo === 'audio')

    if (esperaTranscripcion) {
      await despachar(
        client,
        {
          contactoId: contacto.id,
          cuerpo: COPIA.folio(reporte.folio),
          cuerpoCorto: COPIA.folioSms(reporte.folio),
          plantilla: 'reporte_recibido',
          canalEntrada: sobre.canal,
        },
        contextoVentana,
      )
      confirmoFolio = true
    } else if (confiable && propuesta.requiereDetalle.length === 0) {
      await cerrarAclaracion(client, contacto.id)
      await despachar(
        client,
        {
          contactoId: contacto.id,
          cuerpo: COPIA.folio(reporte.folio),
          cuerpoCorto: COPIA.folioSms(reporte.folio),
          plantilla: 'reporte_recibido',
          canalEntrada: sobre.canal,
        },
        contextoVentana,
      )
      confirmoFolio = true
    } else if (!pendiente) {
      // Exactly one question — including when we understood the category but the catalogue
      // says it needs detail («díganos cuál», «díganos la talla»). A second message while
      // the first is unanswered adds to what a coordinator reads; it does not earn another
      // round trip, because every one costs this person battery and money (Section 6.5).
      await abrirAclaracion(client, contacto.id, reporte.id)
      await despachar(
        client,
        {
          contactoId: contacto.id,
          cuerpo: COPIA.aclaracion,
          cuerpoCorto: COPIA.aclaracionSms,
          canalEntrada: sobre.canal,
        },
        contextoVentana,
      )
      preguntoAclaracion = true
    }
  }

  const entregadas = contacto
    ? await alReaparecer(client, contacto.id, sobre.canal, sobre.recibidoEn, ahora)
    : 0

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
    entregadas,
  }
}

/**
 * Folds a clarification answer into the report it answers.
 *
 * The second pass runs over the original text AND the answer together, because neither is
 * enough alone: «Manden algo para los pelaos» plus «pañales talla 3» only means something
 * read as one message.
 *
 * `detalle_libre` — the original — is never touched. The answer goes to `descripcion`, so
 * the two are always separable and a parser change can be re-run against what the person
 * actually wrote. Nothing here verifies anything: a verificador promotes (M7), and this only
 * ever fills in what was missing.
 */
async function fusionarAclaracion(
  client: PoolClient,
  args: {
    sobre: SobreEntrante
    contactoId: string
    reporteId: string
    mensajeId: string
    normalizador: NormalizadorPort
    catalogo: Catalogo
    ahora: Date
  },
): Promise<Fusionado | null> {
  const { rows } = await client.query<{
    id: string
    detalle_libre: string | null
    descripcion: string | null
    estado: string
  }>('select id, detalle_libre, descripcion, estado from reportes where id = $1', [args.reporteId])
  const original = rows[0]
  if (!original) return null

  const respuesta = args.sobre.contenido.texto ?? ''

  // The answer is read on its own first, and only combined with the original if it needs the
  // context. Order matters: «Muchas cosas!! De todo!!!» carries vagueness markers that
  // deliberately suppress any category (2.12), and gluing them back onto a perfectly clear
  // answer would re-poison it — the person has now told us exactly what they need. The
  // combined pass is for the other shape, «algo para los pelaos» → «talla 3», where neither
  // half means anything alone.
  const soloRespuesta = await args.normalizador.proponer({ texto: respuesta, ahora: args.ahora })
  const propuesta = esConfiable(soloRespuesta)
    ? soloRespuesta
    : await args.normalizador.proponer({
        texto: [original.detalle_libre, respuesta].filter(Boolean).join('. '),
        ahora: args.ahora,
      })
  const confiable = esConfiable(propuesta)
  const resuelto = confiable && propuesta.requiereDetalle.length === 0

  await client.query(
    `update reportes
        set tipo = case when $2 then coalesce($3, tipo) else tipo end,
            codigo_item = case when $2 then $4 else codigo_item end,
            familias = coalesce($5, familias),
            urgencia = case when $2 then $6 else urgencia end,
            severidad = case when $2 then coalesce($7, severidad) else severidad end,
            descripcion = trim(both ' ' from coalesce(descripcion || ' ', '') || $8)
      where id = $1`,
    [
      args.reporteId,
      confiable,
      confiable ? propuesta.tipo : null,
      confiable ? propuesta.codigoItem : null,
      propuesta.familias,
      confiable ? urgenciaFinal(propuesta, args.catalogo) : null,
      confiable ? propuesta.severidad : null,
      respuesta,
    ],
  )

  await client.query('update mensajes set contacto_id = $2, reporte_id = $3 where id = $1', [
    args.mensajeId,
    args.contactoId,
    args.reporteId,
  ])

  const mediaEncolada = await encolarMedia(client, args.sobre, args.reporteId)

  if (resuelto) {
    await cerrarAclaracion(client, args.contactoId)
    const { rows: folios } = await client.query<{ folio: number }>(
      'select folio from reportes where id = $1',
      [args.reporteId],
    )
    await despachar(
      client,
      {
        contactoId: args.contactoId,
        cuerpo: COPIA.folio(folios[0]!.folio),
        cuerpoCorto: COPIA.folioSms(folios[0]!.folio),
        plantilla: 'reporte_recibido',
        canalEntrada: args.sobre.canal,
      },
      { ultimoEntranteEn: args.sobre.recibidoEn, ahora: args.ahora },
    )
  }
  // Still unclear after the answer: we do NOT ask again. It goes to a human, which is the
  // whole point of the clarification queue (Section 9.4).

  const entregadas = await alReaparecer(
    client,
    args.contactoId,
    args.sobre.canal,
    args.sobre.recibidoEn,
    args.ahora,
  )

  return {
    estado: 'fusionado',
    mensajeId: args.mensajeId,
    reporteId: args.reporteId,
    contactoId: args.contactoId,
    tipo: confiable ? (propuesta.tipo ?? 'sin_clasificar') : 'sin_clasificar',
    resuelto,
    mediaEncolada,
    entregadas,
  }
}

async function abrirAclaracion(
  client: PoolClient,
  contactoId: string,
  reporteId: string,
): Promise<void> {
  await client.query(
    `insert into conversaciones (contacto_id, flujo, paso, payload_parcial)
     values ($1, $2, $3, $4::jsonb)
     on conflict (contacto_id) do update
       set flujo = excluded.flujo,
           paso = excluded.paso,
           payload_parcial = excluded.payload_parcial`,
    [contactoId, FLUJO_INTAKE, PASO_ACLARACION, JSON.stringify({ reporteId })],
  )
}

async function cerrarAclaracion(client: PoolClient, contactoId: string): Promise<void> {
  await client.query(
    `delete from conversaciones where contacto_id = $1 and flujo = $2 and paso = $3`,
    [contactoId, FLUJO_INTAKE, PASO_ACLARACION],
  )
}
