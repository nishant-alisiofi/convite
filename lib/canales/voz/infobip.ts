import type { MediaDescargada, ProveedorMedia } from '../media'
import {
  aE164,
  type LlamadaSaliente,
  type ProveedorVoz,
  proveedorVozSimulador,
  TOPE_GRABACION_SEG,
} from './driver'

/**
 * The real voice provider (PRD v3 §4.1.6): Infobip, chosen specifically because its Calls API
 * supports **early media** — an announcement audible during ringing, before answer
 * supervision — which is what makes «lo llamamos ya» possible without ever billing the
 * caller. Twilio's `<Reject>` cannot do this; it is the whole reason for the pick.
 *
 * Written against the confirmed slice of Infobip's Calls API reference
 * (https://www.infobip.com/docs/api/channels/voice/calls, version pinned below):
 *
 *   - `POST /calls/1/calls`                — create an outbound call (`llamar`)
 *   - `POST /calls/1/calls/{callId}/hangup` — end a call; `errorCode: "BUSY"` on the inbound
 *     leg before answer supervision is Infobip's documented pre-answer rejection, which is
 *     what makes `rechazar` free for the caller
 *   - `POST /calls/1/calls/{callId}/pre-answer` — establishes early media *before* full
 *     answer supervision (confirmed: "handle early media... before full answer supervision
 *     is established")
 *   - `POST /calls/1/calls/{callId}/say` — text-to-speech playback
 *   - `POST /calls/1/calls/{callId}/record` — start recording the answered leg, capped at
 *     `TOPE_GRABACION_SEG` (§6.2, v4 supplement). Built against the same
 *     `/calls/1/calls/{callId}/<action>` sub-resource convention `hangup`/`pre-answer`/`say`
 *     already confirm, with `maxDuration` as the parameter name Infobip's own docs use
 *     elsewhere for capping recording length — verify both against the account's own OpenAPI
 *     spec before this drives anything live (same caveat SMS's status-object parsing already
 *     holds itself to, see sms/infobip.ts).
 *   - `GET /calls/1/recordings/files/{fileId}` — download a finished recording as a raw
 *     bytestream (`descargarGrabacionInfobip`). **v4 corrects v3 here**: v3 §4.1.7 drafted
 *     the singular `/calls/1/recording/file/:file-id`; v4 §1.1/§1.2 gives the plural path
 *     above, which matches Infobip's actual REST convention. v4 wins — this is the plural
 *     path, and nothing in this codebase ever shipped the singular one.
 *   - `DELETE /calls/1/recordings/files/{fileId}` — removes the copy from the provider once
 *     we hold our own (PRD v3 §4.1.7's non-relaxable rule: audio never sits on a vendor
 *     platform once we have it).
 *
 * What is NOT in this file: driving the live IVR once the callback is answered (menu
 * prompt, DTMF capture, correlating a finished-recording event back to a `llamadas` row).
 * §4.1.6 is explicit that "recordings/dialogs/media streaming must be activated by an
 * account manager", and the webhook event shapes for DTMF_CAPTURED / CALL_RECORDING_READY
 * are not published in enough detail to implement against with confidence — see
 * lib/canales/voz/trabajos.ts for exactly where that tail picks up once the account has that
 * turned on and the live event shapes can be pinned against the account's own OpenAPI spec
 * instead of guessed at here. `grabar` and `descargarGrabacionInfobip` below are the pieces
 * that ARE confirmed (or, for `grabar`, confirmed enough to build against per the same
 * convention as the other actions) — they exist ready for that wiring, not as part of it yet.
 */

/** The API version this was written against. Pinned: Infobip's own docs warn endpoints move. */
const RUTA_CALLS = '/calls/1/calls'

/**
 * The recording-download/delete endpoint (v4 §1.1/§1.2, plural — see the header comment for
 * the v3-vs-v4 correction this pins). Kept as its own constant, distinct from `RUTA_CALLS`,
 * because it is not a `{callId}` sub-resource — recordings are addressed by `fileId`. Exported
 * so tests/voz.test.ts can pin the plural path directly rather than only through behaviour.
 */
export const RUTA_GRABACIONES = '/calls/1/recordings/files'

/**
 * §6.4 (v4 supplement) — MNO traffic classification. Claro/Tigo/WOM flag high-volume,
 * short-duration outbound callbacks as marketing spam and can block the virtual number
 * outright, with no in-app symptom until numbers start silently failing. This is a
 * provisioning/account-setup requirement, not application code: **register every Colombian
 * virtual number Infobip issues us under their Emergency Humanitarian Transactional Traffic
 * Classifier** (or the closest equivalent they offer), raised in the same account-manager
 * conversation as early media, recordings and Colombian termination rates (§4.1.6). Nothing
 * in this file calls an API for this, and it has no live effect until an account exists —
 * this constant exists so the requirement is tracked next to the code it protects rather
 * than only in the PRD.
 */
export const REQUISITO_CLASIFICADOR_TRAFICO_INFOBIP =
  'Registrar cada número virtual colombiano de Infobip bajo su Emergency Humanitarian ' +
  'Transactional Traffic Classifier (o el equivalente más cercano que ofrezcan), junto con ' +
  'early media, grabaciones y tarifas de terminación colombianas (§4.1.6).'

export const PROVEEDOR_VOZ_INFOBIP = 'infobip_voz'

export type ConfigVozInfobip = {
  /** The account's personalised base URL, e.g. `https://xxxxxxxx.api.infobip.com`. No trailing slash. */
  baseUrl: string
  apiKey: string
  /** Our purchased Colombian voice number — the `from` on every callback. */
  numeroSaliente: string
  /** `platform.applicationId` on Create call — required by Infobip, not optional in practice. */
  applicationId: string
  /** Optional: the regulatory/quality profile tied to the purchased number. */
  callsConfigurationId?: string
  connectTimeoutSeg?: number
  /**
   * The «lo llamamos ya» text, played via pre-answer + say before the inbound leg is hung
   * up. Left undefined until §4.1.6's account-manager activation is confirmed — see
   * `rechazar` below for why an unconfirmed attempt here must never delay the hangup.
   */
  anuncioPrevio?: string
}

function sinMas(numero: string): string {
  return numero.replace(/^\+/, '')
}

type CuerpoError = { requestError?: { serviceException?: { text?: string; messageId?: string } } }

async function pedirInfobip(
  config: ConfigVozInfobip,
  ruta: string,
  cuerpo: Record<string, unknown>,
  timeoutMs = 15_000,
): Promise<unknown> {
  const respuesta = await fetch(`${config.baseUrl}${ruta}`, {
    method: 'POST',
    headers: {
      authorization: `App ${config.apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(timeoutMs),
  })

  const texto = await respuesta.text().catch(() => '')
  if (!respuesta.ok) {
    // Infobip's error bodies name the problem (`requestError.serviceException.text`).
    // Worth surfacing verbatim, the same discipline as whatsapp/envio.ts.
    let detalle = texto.slice(0, 500)
    try {
      const parsed = JSON.parse(texto) as CuerpoError
      detalle = parsed.requestError?.serviceException?.text ?? detalle
    } catch {
      // Not JSON; the raw text is all there is.
    }
    throw new Error(`Infobip Calls respondió ${respuesta.status} en ${ruta}: ${detalle}`)
  }
  return texto ? JSON.parse(texto) : {}
}

/**
 * Best-effort early media, never load-bearing.
 *
 * Every second the inbound leg stays up is a second the network may decide to answer it for
 * us — flujo.ts's own comment on `recibirLlamadaPerdida` says as much. So this is opt-in
 * (only when `config.anuncioPrevio` is set, i.e. only once Infobip's account team has
 * confirmed early media is live — §4.1.6), short-timeout, and swallowed on any failure: the
 * one guarantee that may never slip is the hangup that follows it, not the announcement.
 */
async function intentarAnuncioPrevio(config: ConfigVozInfobip, idLlamada: string): Promise<void> {
  if (!config.anuncioPrevio) return
  try {
    await pedirInfobip(config, `${RUTA_CALLS}/${idLlamada}/pre-answer`, { ringing: true }, 4_000)
    await pedirInfobip(
      config,
      `${RUTA_CALLS}/${idLlamada}/say`,
      { text: config.anuncioPrevio, language: 'es' },
      4_000,
    )
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error)
    console.warn(`[voz] anuncio previo no se pudo reproducir en ${idLlamada}: ${mensaje}`)
  }
}

export function proveedorVozInfobip(config: ConfigVozInfobip): ProveedorVoz {
  return {
    nombre: PROVEEDOR_VOZ_INFOBIP,

    async rechazar(idLlamada) {
      await intentarAnuncioPrevio(config, idLlamada)

      // BUSY before answer supervision: Infobip's documented pre-answer rejection. The
      // caller's network sees a busy signal, the leg never completes, and nobody is billed.
      try {
        await pedirInfobip(config, `${RUTA_CALLS}/${idLlamada}/hangup`, { errorCode: 'BUSY' })
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : String(error)
        // A 404 here means the caller already hung up or the network already dropped the
        // leg — the outcome we wanted (nobody billed) already holds, so this is not fatal.
        // Anything else is surfaced: a hangup that silently fails is a call left ringing.
        if (!/\b404\b/.test(mensaje)) throw error
        console.info(`[voz] ${idLlamada} ya no estaba activa al rechazarla (${mensaje}).`)
      }
    },

    async llamar(a): Promise<LlamadaSaliente> {
      const cuerpo: Record<string, unknown> = {
        endpoint: { type: 'PHONE', phoneNumber: sinMas(aE164(a)) },
        from: sinMas(config.numeroSaliente),
        connectTimeout: config.connectTimeoutSeg ?? 30,
        platform: { applicationId: config.applicationId },
      }
      if (config.callsConfigurationId) cuerpo.callsConfigurationId = config.callsConfigurationId

      const respuesta = (await pedirInfobip(config, RUTA_CALLS, cuerpo)) as { id?: string }
      if (!respuesta.id) throw new Error(`Infobip Calls no devolvió un id de llamada para ${a}.`)

      return { idExterno: respuesta.id }
    },

    async grabar(idLlamada) {
      // §6.2: the cap travels on every request, never left to whatever the account's
      // default happens to be — so a config drift on Infobip's side cannot silently produce
      // a longer recording than the pipeline was sized for.
      await pedirInfobip(config, `${RUTA_CALLS}/${idLlamada}/record`, {
        maxDuration: TOPE_GRABACION_SEG,
      })
    },
  }
}

/**
 * Downloads a finished recording as a raw bytestream, then deletes it from the provider.
 *
 * Order matters and is not negotiable (PRD v3 §4.1.7's two non-relaxable rules): we hold our
 * own bytes before we ask Infobip to forget theirs, and provider-side transcription stays
 * off, so this is the only path a recording's audio ever leaves Infobip's infrastructure by.
 * The delete is best-effort — once we hold the bytes, a failed delete costs Infobip storage
 * hygiene, never the report itself, so it is logged rather than thrown.
 */
export async function descargarGrabacionInfobip(
  config: ConfigVozInfobip,
  fileId: string,
): Promise<{ bytes: Buffer; mime: string | null }> {
  const respuesta = await fetch(`${config.baseUrl}${RUTA_GRABACIONES}/${fileId}`, {
    headers: { authorization: `App ${config.apiKey}` },
    signal: AbortSignal.timeout(30_000),
  })
  if (!respuesta.ok) {
    const texto = await respuesta.text().catch(() => '')
    throw new Error(
      `Infobip no devolvió la grabación ${fileId}: HTTP ${respuesta.status} ${texto.slice(0, 500)}`,
    )
  }

  const bytes = Buffer.from(await respuesta.arrayBuffer())
  const mime = respuesta.headers.get('content-type')

  try {
    const borrado = await fetch(`${config.baseUrl}${RUTA_GRABACIONES}/${fileId}`, {
      method: 'DELETE',
      headers: { authorization: `App ${config.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (!borrado.ok) {
      console.warn(`[voz] Infobip respondió ${borrado.status} al borrar la grabación ${fileId}.`)
    }
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error)
    console.warn(`[voz] no se pudo borrar la grabación ${fileId} en Infobip: ${mensaje}`)
  }

  return { bytes, mime }
}

/**
 * `descargarGrabacionInfobip` behind the same `ProveedorMedia` port a WhatsApp voice note
 * downloads through (lib/canales/media.ts) — so once the live IVR is driven, a recording
 * reaches storage through `procesarMedia()` exactly like every other attachment, `ref` being
 * the recording's `fileId` instead of a WhatsApp media id.
 */
export function proveedorMediaVozInfobip(config: ConfigVozInfobip): ProveedorMedia {
  return {
    async descargar(fileId): Promise<MediaDescargada> {
      const { bytes, mime } = await descargarGrabacionInfobip(config, fileId)
      return { bytes, mime }
    },
  }
}

/**
 * Whether a real send is possible — both halves needed, same contract as
 * `envioWhatsAppConfigurado()` in lib/codigo-whatsapp.ts. Half-configured has to read as "no",
 * not as a runtime error the first time a call actually needs to go out.
 */
export function envioVozInfobipConfigurado(): boolean {
  return Boolean(
    process.env.INFOBIP_API_KEY &&
      process.env.INFOBIP_BASE_URL &&
      process.env.INFOBIP_VOICE_NUMBER &&
      process.env.INFOBIP_VOICE_APPLICATION_ID,
  )
}

let proveedor: ProveedorVoz | null = null

/**
 * The provider selection (PRD-15 build item 6): real Infobip when credentials are present,
 * the simulator otherwise. Memoised like `elProveedor()` in lib/codigo-whatsapp.ts, with the
 * same `olvidarProveedorVoz` test escape hatch so an env change takes effect.
 */
export function proveedorVozActivo(): ProveedorVoz {
  if (proveedor) return proveedor
  proveedor = envioVozInfobipConfigurado()
    ? proveedorVozInfobip({
        baseUrl: process.env.INFOBIP_BASE_URL!.replace(/\/$/, ''),
        apiKey: process.env.INFOBIP_API_KEY!,
        numeroSaliente: process.env.INFOBIP_VOICE_NUMBER!,
        applicationId: process.env.INFOBIP_VOICE_APPLICATION_ID!,
        callsConfigurationId: process.env.INFOBIP_VOICE_CALLS_CONFIG_ID,
        anuncioPrevio: process.env.INFOBIP_VOICE_ANUNCIO_PREVIO,
      })
    : proveedorVozSimulador()
  return proveedor
}

/** Only for tests: forget which provider was chosen, so env changes take effect. */
export function olvidarProveedorVoz(): void {
  proveedor = null
}
