import { env } from '@/lib/env'

/**
 * Outbound email. Today it carries exactly one thing: the sign-in link.
 *
 * Written against Resend's HTTP API rather than its SDK. The only call we make is «post one
 * message», the SDK would be a dependency in the server bundle for that one call, and a raw
 * fetch is also what makes the dry-run branch below honest — there is no client to construct
 * when the key is absent, so a developer without credentials runs the real code path.
 */

const RESEND_URL = 'https://api.resend.com/emails'

/** Resend refuses to wait forever, and neither should a sign-in form. */
const TIEMPO_LIMITE_MS = 15_000

export type ResultadoCorreo =
  | { enviado: true; id: string }
  | { enviado: false; motivo: string }

/**
 * Sends one message, or says why it could not.
 *
 * Never throws. A sign-in form that 500s because an email provider is having a bad morning
 * tells the coordinator nothing they can act on; the caller decides what to show, and the
 * failure is logged with enough detail to find it afterwards.
 *
 * With no `RESEND_API_KEY` this logs the message instead of sending it and reports success.
 * That is deliberate: a fresh clone has no credential, and the whole local sign-in flow has
 * to work anyway — the link is printed to the server console and can be pasted into the
 * browser. Section 3's «a fresh clone gets a working basin with no third-party account».
 */
export async function enviarCorreo(mensaje: {
  para: string
  asunto: string
  html: string
}): Promise<ResultadoCorreo> {
  const clave = env().RESEND_API_KEY

  if (!clave) {
    // Not an error. See the note above — and the link itself goes to the console so the
    // flow is completable without a mail provider.
    console.info(
      `[correo] RESEND_API_KEY sin configurar. No se envió nada.\n` +
        `  para:   ${mensaje.para}\n  asunto: ${mensaje.asunto}\n${mensaje.html}`,
    )
    return { enviado: true, id: 'sin-envio' }
  }

  try {
    const respuesta = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${clave}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: env().EMAIL_FROM,
        to: mensaje.para,
        subject: mensaje.asunto,
        html: mensaje.html,
      }),
      signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
    })

    if (!respuesta.ok) {
      // Resend answers 422 for the mistake everyone makes exactly once: sending from a
      // domain it has not verified. The body says which, so it goes in the log verbatim.
      const detalle = await respuesta.text().catch(() => '')
      const motivo = `Resend respondió ${respuesta.status}: ${detalle.slice(0, 500)}`
      console.error(`[correo] ${motivo}`)
      return { enviado: false, motivo }
    }

    const cuerpo = (await respuesta.json().catch(() => ({}))) as { id?: string }
    return { enviado: true, id: cuerpo.id ?? 'sin-id' }
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    console.error(`[correo] No se pudo enviar: ${motivo}`)
    return { enviado: false, motivo }
  }
}

/**
 * The sign-in email.
 *
 * Plain, short, and it says the two things a coordinator needs to know before clicking:
 * that the link dies quickly and that it works once. Inline styles because email clients
 * discard a stylesheet, and no images because the people using this are on bad connections.
 */
export function plantillaEnlace(url: string, minutos: number): { asunto: string; html: string } {
  return {
    asunto: 'Su enlace para entrar a Convite',
    html: `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#faf8f5;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#2b2620;line-height:1.5">
    <div style="max-width:32rem;margin:0 auto;background:#ffffff;border:1px solid #e7e0d7;border-radius:12px;padding:28px">
      <p style="margin:0 0 4px;font-size:20px;font-weight:600;color:#1c1917">Convite</p>
      <p style="margin:0 0 20px;color:#6b6157">Coordinación de ayuda en la cuenca del Atrato.</p>

      <p style="margin:0 0 20px">Alguien pidió un enlace para entrar con este correo. Si fue usted, entre aquí:</p>

      <p style="margin:0 0 20px">
        <a href="${url}" style="display:inline-block;background:#2f5d3f;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500">Entrar a Convite</a>
      </p>

      <p style="margin:0 0 20px;color:#6b6157;font-size:14px">
        El enlace vence en ${minutos} minutos y sirve una sola vez. Ábralo desde este mismo equipo.
      </p>

      <p style="margin:0;color:#6b6157;font-size:14px">
        Si no lo pidió, no tiene que hacer nada: sin abrir el enlace, nadie entra.
      </p>

      <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e7e0d7;color:#9a8f82;font-size:12px;word-break:break-all">
        ¿No funciona el botón? Copie esta dirección en su navegador:<br />${url}
      </p>
    </div>
  </body>
</html>`,
  }
}
