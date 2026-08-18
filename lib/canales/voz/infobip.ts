import { aE164, type LlamadaSaliente, type ProveedorVoz, proveedorVozSimulador } from './driver'

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
 *
 * What is NOT in this file: driving the live IVR once the callback is answered (menu
 * prompt, DTMF capture, recording). §4.1.6 is explicit that "recordings/dialogs/media
 * streaming must be activated by an account manager", and the webhook event shapes for
 * DTMF_CAPTURED / CALL_RECORDING_READY are not published in enough detail to implement
 * against with confidence — see lib/canales/voz/trabajos.ts for exactly where that tail
 * picks up once the account has that turned on and the live event shapes can be pinned
 * against the account's own OpenAPI spec instead of guessed at here.
 */

/** The API version this was written against. Pinned: Infobip's own docs warn endpoints move. */
const RUTA_CALLS = '/calls/1/calls'

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
