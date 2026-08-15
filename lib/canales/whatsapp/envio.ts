/**
 * Sending a WhatsApp message. The first outbound path in this codebase.
 *
 * Everything under `lib/canales/whatsapp/` until now was inbound: a webhook arrives, gets its
 * signature checked, gets parsed into an envelope. Outbound went into `salidas_pendientes` and
 * stopped there, because there is no WABA yet (D3) and a queue with no drain is an honest
 * placeholder for one.
 *
 * This adds the drain for exactly one kind of message: the sign-in code. It is deliberately
 * narrow. A code has to arrive in seconds or it is useless, so it does not go through
 * `despachar` — that queues, batches into a digest with unrelated messages, and is built for
 * replies to somebody who just wrote to us. None of that is right for a one-time code, and
 * `salidas_pendientes` is watched by the health check, so parking OTPs there would read as a
 * stalled queue.
 *
 * The provider interface mirrors `ProveedorSms` in ../sms/driver.ts, for the same reason it is
 * one method there: adapters differ in auth and in the shape of a receipt, and in nothing else
 * we care about.
 */

export const PROVEEDOR_WHATSAPP_SIMULADOR = 'whatsapp_simulador'

/** The Cloud API version this was written against. Pinned: Meta breaks these on a schedule. */
const VERSION_GRAFO = 'v21.0'

export type MensajeWhatsApp = {
  /** E.164, with the plus. Meta wants it without; the driver strips it. */
  para: string
  /** The approved template's name, as registered with Meta. */
  plantilla: string
  /** Body placeholders in order: `{{1}}`, `{{2}}`, … */
  parametros: string[]
  /** Language the template was approved in. */
  idioma?: string
}

export type EnvioWhatsApp = {
  /** Meta's `wamid`, so a delivery receipt can be matched to this later. */
  idExterno: string
}

export interface ProveedorWhatsApp {
  enviar(mensaje: MensajeWhatsApp): Promise<EnvioWhatsApp>
}

/**
 * The simulator. No account, no network, no credentials — the same bar tests/whatsapp.test.ts
 * already holds the inbound side to.
 *
 * `enviados` is how a test retrieves what was «sent», mirroring `proveedorSmsSimulador`. And
 * like that one, it refuses what the real provider would refuse rather than accepting
 * everything: a template send with the wrong number of parameters is a 132000 from Meta, and
 * finding that out here is cheaper than finding it out on the day the WABA arrives.
 */
export function proveedorWhatsAppSimulador(
  esperados: Record<string, number> = {},
): ProveedorWhatsApp & { enviados: (MensajeWhatsApp & EnvioWhatsApp)[] } {
  const enviados: (MensajeWhatsApp & EnvioWhatsApp)[] = []
  let n = 0

  return {
    enviados,
    async enviar(mensaje) {
      if (!/^\+[1-9][0-9]{7,14}$/.test(mensaje.para)) {
        throw new Error(`El simulador rechaza «${mensaje.para}»: no es E.164.`)
      }

      const esperado = esperados[mensaje.plantilla]
      if (esperado !== undefined && mensaje.parametros.length !== esperado) {
        throw new Error(
          `La plantilla «${mensaje.plantilla}» lleva ${esperado} parámetro(s) y se le pasaron ` +
            `${mensaje.parametros.length}. Meta responde 132000 a eso.`,
        )
      }

      n += 1
      const envio = { ...mensaje, idExterno: `sim-wa-${mensaje.para.slice(-4)}-${n}` }
      enviados.push(envio)
      return envio
    },
  }
}

/**
 * The real one. Not reachable without a WABA, and deliberately not called anywhere yet.
 *
 * Written now so that the day D3 lands the change is a credential and not a design. Kept in
 * the same shape as `proveedorMediaWhatsApp` in ../media.ts, which is the only other place
 * that talks to Meta.
 */
export function proveedorWhatsAppCloud(config: {
  idNumero: string
  token: string
}): ProveedorWhatsApp {
  return {
    async enviar(mensaje) {
      const url = `https://graph.facebook.com/${VERSION_GRAFO}/${config.idNumero}/messages`

      const respuesta = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          // Meta wants the number without the leading plus.
          to: mensaje.para.replace(/^\+/, ''),
          type: 'template',
          template: {
            name: mensaje.plantilla,
            language: { code: mensaje.idioma ?? 'es' },
            components: mensaje.parametros.length
              ? [
                  {
                    type: 'body',
                    parameters: mensaje.parametros.map((text) => ({ type: 'text', text })),
                  },
                ]
              : [],
          },
        }),
        signal: AbortSignal.timeout(15_000),
      })

      if (!respuesta.ok) {
        // Meta's error bodies name the problem precisely (132000 wrong parameter count, 131047
        // outside the window, 470 template paused). Worth keeping verbatim.
        const detalle = await respuesta.text().catch(() => '')
        throw new Error(`WhatsApp respondió ${respuesta.status}: ${detalle.slice(0, 500)}`)
      }

      const cuerpo = (await respuesta.json().catch(() => ({}))) as {
        messages?: { id?: string }[]
      }
      return { idExterno: cuerpo.messages?.[0]?.id ?? 'sin-id' }
    },
  }
}
