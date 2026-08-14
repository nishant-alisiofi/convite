import type { PoolClient } from 'pg'
import { llamarDeVuelta } from '../despachador'
import { type DepsIntake, recibirSobre } from '../intake'
import { COPIA } from '../salidas'
import { despachar } from '../despachador'
import { esquemaSobreEntrante, type SobreEntrante, VERSION_CONTRATO } from '../tipos'
import {
  aE164,
  esquemaLlamadaEntrante,
  type LlamadaEntrante,
  PROVEEDOR_VOZ_SIMULADOR,
  type ProveedorVoz,
} from './driver'
import { dictarFolio, opcionDe, PROMPTS, tipoDeIntencion } from './menu'

/**
 * Intake by missed call, end to end.
 *
 * PRD §4 M10's acceptance is one sentence and it is the whole design: «a caller with zero
 * balance and one bar of signal completes a report end to end with no data session.» Every
 * decision here follows from it — we reject without answering so the ring costs them
 * nothing, we ring back on our own account, the menu is one level deep, and the folio is
 * dictated digit by digit because they are writing it on their hand.
 *
 * Deliberately ahead of the public view in the milestone order: voice is the most robust
 * channel under weak signal, and a community that cannot sustain a WhatsApp upload can still
 * finish a phone call.
 */

export type ResultadoPerdida = {
  llamadaId: string
  telefono: string
  /** True when the provider re-delivered a call webhook we had already handled (2.7). */
  duplicada: boolean
}

/**
 * They rang; we hang up without answering.
 *
 * The rejection happens before anything is written, because it is the part that has to be
 * fast: every second we leave it ringing is a second the network may decide to connect and
 * bill them for.
 */
export async function recibirLlamadaPerdida(
  client: PoolClient,
  payload: LlamadaEntrante,
  organizacionId: string,
  deps: { proveedor: ProveedorVoz },
  ahora: Date = new Date(),
): Promise<ResultadoPerdida> {
  const p = esquemaLlamadaEntrante.parse(payload)
  const telefono = aE164(p.de)

  await deps.proveedor.rechazar(p.id)

  const { rows } = await client.query<{ id: string }>(
    `insert into llamadas
       (organizacion_id, proveedor, proveedor_llamada_id, telefono, tipo, estado, iniciada_en,
        contacto_id)
     values ($1, $2, $3, $4, 'perdida', 'rechazada', $5,
             (select id from contactos where telefono = $4))
     on conflict (proveedor, proveedor_llamada_id)
       where proveedor_llamada_id is not null
       do nothing
     returning id`,
    [
      organizacionId,
      PROVEEDOR_VOZ_SIMULADOR,
      p.id,
      telefono,
      p.recibidaEn ? new Date(p.recibidaEn) : ahora,
    ],
  )

  if (rows[0]) return { llamadaId: rows[0].id, telefono, duplicada: false }

  const { rows: previas } = await client.query<{ id: string }>(
    'select id from llamadas where proveedor = $1 and proveedor_llamada_id = $2',
    [PROVEEDOR_VOZ_SIMULADOR, p.id],
  )
  return { llamadaId: previas[0]!.id, telefono, duplicada: true }
}

/**
 * What the caller did once we rang back.
 *
 * In production these arrive as a series of provider webhooks; here they are handed over as
 * data, which is what makes the whole flow testable without an account (same bet as the
 * recorded Meta payloads in M5).
 */
export type Interaccion = {
  /** The key they pressed. Null means they pressed nothing. */
  tecla: string | null
  /** The provider's ref for the recording. Null when they asked for a person. */
  grabacionRef: string | null
  duracionSeg: number
}

export type ResultadoDevolucion =
  | { estado: 'bloqueada'; llamadaId: string; motivo: string }
  | { estado: 'a_persona'; llamadaId: string; guion: string[] }
  | {
      estado: 'grabada'
      llamadaId: string
      reporteId: string
      folio: number
      /** What the caller heard, in order. The last line is the dictated folio. */
      guion: string[]
    }

/**
 * Rings back, walks the menu, takes the recording, files the report.
 *
 * The recording goes through exactly the same path as a WhatsApp voice note: the media job
 * downloads it, the transcription port declines to transcribe it (D8), and it waits in the
 * audio inbox for a human. So the report is honestly `sin_clasificar` — but it exists, with
 * a folio, from the moment the person hung up (2.13).
 */
export async function devolverLlamada(
  client: PoolClient,
  destino: { telefono: string; organizacionId: string },
  interaccion: Interaccion,
  deps: { proveedor: ProveedorVoz } & DepsIntake,
  ahora: Date = new Date(),
): Promise<ResultadoDevolucion> {
  const llamada = await llamarDeVuelta(client, destino, deps, ahora)
  if (llamada.estado === 'bloqueada') {
    return { estado: 'bloqueada', llamadaId: llamada.llamadaId, motivo: llamada.motivo }
  }

  const guion = [PROMPTS.bienvenida, PROMPTS.menu]
  const opcion = opcionDe(interaccion.tecla)

  // No key, or `0`, both go to a person. Someone who pressed nothing is not lost — they are
  // someone the menu failed, and hanging up on them is the one unacceptable outcome.
  if (!opcion || opcion.intencion === 'persona') {
    guion.push(opcion ? PROMPTS.persona : PROMPTS.sinRespuesta)
    await client.query(
      `update llamadas
          set estado = 'a_persona', ruta_tecleada = $2, duracion_seg = $3, finalizada_en = $4
        where id = $1`,
      [llamada.llamadaId, interaccion.tecla ?? '', interaccion.duracionSeg, ahora],
    )
    return { estado: 'a_persona', llamadaId: llamada.llamadaId, guion }
  }

  guion.push(PROMPTS.grabar)

  const sobre: SobreEntrante = esquemaSobreEntrante.parse({
    version: VERSION_CONTRATO,
    proveedor: PROVEEDOR_VOZ_SIMULADOR,
    canal: 'ivr',
    // A keypress is structural channel knowledge, like the printed card's code — so it may
    // set the type. It still does not choose an item: that waits for a transcript.
    tipo: tipoDeIntencion(opcion.intencion),
    idExterno: llamada.idExterno,
    recibidoEn: ahora,
    telefono: destino.telefono,
    comunidadCodigo: null,
    contenido: {
      texto: null,
      media: interaccion.grabacionRef
        ? [{ tipo: 'audio', refProveedor: interaccion.grabacionRef, duracionSeg: interaccion.duracionSeg }]
        : [],
    },
    ubicacion: null,
    payloadCrudo: {
      llamadaId: llamada.llamadaId,
      proveedorLlamadaId: llamada.idExterno,
      rutaTecleada: interaccion.tecla,
      duracionSeg: interaccion.duracionSeg,
    },
  })

  const intake = await recibirSobre(client, sobre, destino.organizacionId, deps)
  if (intake.estado === 'duplicado') {
    return { estado: 'bloqueada', llamadaId: llamada.llamadaId, motivo: 'llamada ya procesada' }
  }

  const folio = intake.estado === 'registrado' ? intake.folio : 0
  const reporteId = intake.reporteId

  await client.query(
    `update llamadas
        set estado = 'grabada', ruta_tecleada = $2, duracion_seg = $3, reporte_id = $4,
            finalizada_en = $5
      where id = $1`,
    [llamada.llamadaId, interaccion.tecla, interaccion.duracionSeg, reporteId, ahora],
  )

  // Dictated in the call they are already on, and queued through the despatcher so it also
  // reaches them in writing if that is what their link supports.
  const dictado = dictarFolio(folio)
  guion.push(dictado)
  await despachar(
    client,
    {
      contactoId: intake.contactoId,
      cuerpo: dictado,
      cuerpoCorto: COPIA.folioSms(folio),
      plantilla: 'reporte_recibido',
      canalEntrada: 'ivr',
    },
    { ultimoEntranteEn: ahora, ahora },
  )

  return { estado: 'grabada', llamadaId: llamada.llamadaId, reporteId, folio, guion }
}
