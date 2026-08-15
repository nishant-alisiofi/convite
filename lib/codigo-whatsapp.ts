import {
  proveedorWhatsAppCloud,
  proveedorWhatsAppSimulador,
  type ProveedorWhatsApp,
} from '@/lib/canales/whatsapp/envio'
import { env } from '@/lib/env'

/**
 * Delivering the sign-in code over WhatsApp.
 *
 * The counterpart of lib/correo.ts, and it behaves the same way when it has no credentials:
 * it prints the code to the server console and reports success, so a fresh clone can complete
 * the whole sign-in without an account anywhere. That is not a convenience — it is the only
 * way this feature is testable at all right now, because there is no WABA (D3).
 */

/** The approved template's name at Meta. AUTHENTICATION category — see docs/plantillas-whatsapp.md. */
export const PLANTILLA_CODIGO = 'codigo_ingreso'

/** Six digits, not four. See the note in `lib/auth.ts` — four collides with the delivery codes. */
const PARAMETROS_ESPERADOS = { [PLANTILLA_CODIGO]: 1 }

/**
 * Whether a real send is possible.
 *
 * Both halves are needed: the number the message is sent *from*, and the token to send it
 * with. Neither has a usable default, and half-configured has to read as «no» rather than as
 * a runtime error on somebody's sign-in.
 */
export function envioWhatsAppConfigurado(): boolean {
  return Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN)
}

/**
 * The simulator used when there are no credentials.
 *
 * Module-level so a test can read what was «sent» without threading a provider through the
 * auth config. It is also what makes the local demo work: the code goes to the console, and
 * `enviados` holds it for an in-process test.
 */
export const simuladorIngreso = proveedorWhatsAppSimulador(PARAMETROS_ESPERADOS)

let proveedor: ProveedorWhatsApp | null = null

function elProveedor(): ProveedorWhatsApp {
  if (proveedor) return proveedor
  proveedor = envioWhatsAppConfigurado()
    ? proveedorWhatsAppCloud({
        idNumero: env().WHATSAPP_PHONE_NUMBER_ID!,
        token: env().WHATSAPP_ACCESS_TOKEN!,
      })
    : simuladorIngreso
  return proveedor
}

/** Only for tests: forget which provider was chosen, so env changes take effect. */
export function olvidarProveedor(): void {
  proveedor = null
}

export type ResultadoCodigo =
  | { enviado: true; id: string }
  | { enviado: false; motivo: string }

/**
 * Sends one sign-in code, or says why it could not.
 *
 * Never throws, for the same reason `enviarCorreo` never throws: a sign-in form that 500s
 * because a provider is having a bad morning tells a coordinator nothing they can act on.
 *
 * The code goes out as an **authentication template**, not as free text. That is not a style
 * choice — a sign-in is by definition unsolicited, so the 24-hour service window
 * (`lib/canales/ventana.ts`) is closed, and Meta refuses free text outside it. An
 * AUTHENTICATION-category template is the only shape of message that is allowed to arrive
 * cold, which is exactly what a sign-in code has to do.
 */
export async function enviarCodigo(
  telefono: string,
  codigo: string,
): Promise<ResultadoCodigo> {
  if (!envioWhatsAppConfigurado()) {
    // Not an error. Same contract as lib/correo.ts without RESEND_API_KEY: the flow has to be
    // completable on a laptop, so the code goes where a developer can read it.
    console.info(
      `[whatsapp] Sin credenciales de WABA (D3). No se envió nada.\n` +
        `  para:   ${telefono}\n  código: ${codigo}\n` +
        `  Péguelo en /entrar para continuar.`,
    )
    // Still recorded in the simulator so a test can assert on it.
    await simuladorIngreso
      .enviar({ para: telefono, plantilla: PLANTILLA_CODIGO, parametros: [codigo] })
      .catch(() => undefined)
    return { enviado: true, id: 'sin-envio' }
  }

  try {
    const { idExterno } = await elProveedor().enviar({
      para: telefono,
      plantilla: PLANTILLA_CODIGO,
      parametros: [codigo],
      idioma: 'es',
    })
    return { enviado: true, id: idExterno }
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    // Never the code itself: this line ends up in a log aggregator.
    console.error(`[whatsapp] No se pudo enviar el código a ${telefono}: ${motivo}`)
    return { enviado: false, motivo }
  }
}
