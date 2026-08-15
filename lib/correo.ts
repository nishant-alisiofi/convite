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
 * The shared shell both transactional emails are poured into.
 *
 * One visual system for the clients these coordinators actually use — Gmail on a cheap
 * Android, Outlook at a partner NGO — so it is table-based, inline-styled, image-free and
 * font-free. Every rule in the whole document is inline because clients discard a stylesheet;
 * the layout is nested tables because most of them never learned flexbox.
 *
 * The brand mark is *drawn in type*, never fetched. A selva header band carries the «Convite»
 * wordmark and a river accent (`≈`, echoing the app's Waves glyph) — a remote logo would
 * render as a blocked-image box, and an inline SVG is stripped by Gmail and Outlook alike.
 *
 * Colours are the exact Chocó tokens from `app/globals.css`, kept literal because an email
 * cannot read the theme: paper `barro-50` behind a white card with a `barro-200` hairline,
 * `selva-700` for the band and the one button, a `barro-950` serif headline for the single
 * action, and muted `barro-600`/`barro-500` for the security copy and footer.
 *
 * The CTA is a bulletproof button: a padded, background-coloured anchor for every modern
 * client, with a VML `roundrect` fallback so Outlook renders a real filled button instead of
 * blue underlined text. The link is always repeated as selectable plain text below.
 */
function cascara(opciones: {
  preheader: string
  titulo: string
  intro: string
  etiquetaBoton: string
  anchoBotonMso: number
  url: string
  vigencia: string
  tranquilidad: string
}): string {
  const { preheader, titulo, intro, etiquetaBoton, anchoBotonMso, url, vigencia, tranquilidad } =
    opciones
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="format-detection" content="telephone=no" />
  </head>
  <body style="margin:0;padding:0;background:#faf9f7;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#2a2622;line-height:1.6;-webkit-font-smoothing:antialiased">
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#faf9f7;opacity:0">${preheader}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf9f7">
      <tr>
        <td align="center" style="padding:32px 16px">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e7e3dd;border-radius:14px;overflow:hidden">
            <tr>
              <td align="center" bgcolor="#1f5c4a" style="background:#1f5c4a;padding:30px 32px 26px">
                <div style="font-size:26px;font-weight:600;letter-spacing:-0.01em;line-height:1;color:#ffffff">
                  <span style="color:#a9d3bf;font-weight:700">≈</span>&nbsp;Convite
                </div>
                <div style="margin-top:10px;font-size:13px;line-height:1.5;color:#d4e9df">
                  Coordinación de ayuda en el Chocó y el Pacífico colombiano.
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:34px 32px 32px">
                <h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:23px;font-weight:700;line-height:1.25;color:#1c1917">${titulo}</h1>
                <p style="margin:0 0 26px;font-size:15px;color:#2a2622">${intro}</p>

                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px">
                  <tr>
                    <td align="center" bgcolor="#1f5c4a" style="border-radius:9px">
                      <!--[if mso]>
                      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:48px;v-text-anchor:middle;width:${anchoBotonMso}px;" arcsize="19%" strokecolor="#1f5c4a" fillcolor="#1f5c4a">
                        <w:anchorlock/>
                        <center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:600;">${etiquetaBoton}</center>
                      </v:roundrect>
                      <![endif]-->
                      <!--[if !mso]><!-- -->
                      <a href="${url}" style="display:inline-block;background:#1f5c4a;color:#ffffff;font-size:16px;font-weight:600;line-height:1;text-decoration:none;padding:15px 32px;border-radius:9px">${etiquetaBoton}</a>
                      <!--<![endif]-->
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 14px;font-size:14px;color:#6f675e">${vigencia}</p>
                <p style="margin:0;font-size:14px;color:#6f675e">${tranquilidad}</p>

                <div style="margin:28px 0 0;border-top:1px solid #e7e3dd"></div>
                <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#877e72;word-break:break-all">
                  ¿No funciona el botón? Copie esta dirección en su navegador:<br />${url}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

/**
 * The sign-in email.
 *
 * Short and honest: it says the two things a coordinator needs before clicking — the link
 * dies quickly and works once — inside the shared branded shell (see `cascara`). The subject
 * and every line of security copy are unchanged; only the presentation is the studio's.
 */
export function plantillaEnlace(url: string, minutos: number): { asunto: string; html: string } {
  return {
    asunto: 'Su enlace para entrar a Convite',
    html: cascara({
      preheader: `Su enlace para entrar — vence en ${minutos} minutos y sirve una sola vez.`,
      titulo: 'Su enlace para entrar',
      intro: 'Alguien pidió un enlace para entrar con este correo. Si fue usted, entre aquí:',
      etiquetaBoton: 'Entrar a Convite',
      anchoBotonMso: 220,
      url,
      vigencia: `El enlace vence en ${minutos} minutos y sirve una sola vez. Ábralo desde este mismo equipo.`,
      tranquilidad: 'Si no lo pidió, no tiene que hacer nada: sin abrir el enlace, nadie entra.',
    }),
  }
}

/**
 * The password-reset email.
 *
 * Same shell and the same constraints as the sign-in link — it reaches the same people on the
 * same connections. It says plainly that ignoring it changes nothing: the honest reassurance
 * is also the true one, so the old password keeps working until this link is opened.
 */
export function plantillaRestablecer(
  url: string,
  minutos: number,
): { asunto: string; html: string } {
  return {
    asunto: 'Cambiar su contraseña de Convite',
    html: cascara({
      preheader: `Su enlace para cambiar la contraseña — vence en ${minutos} minutos y sirve una sola vez. Su contraseña actual sigue funcionando.`,
      titulo: 'Cambiar su contraseña',
      intro: 'Alguien pidió cambiar la contraseña de esta cuenta. Si fue usted, hágalo aquí:',
      etiquetaBoton: 'Poner una contraseña nueva',
      anchoBotonMso: 300,
      url,
      vigencia: `El enlace vence en ${minutos} minutos y sirve una sola vez.`,
      tranquilidad:
        'Si no lo pidió, no tiene que hacer nada: su contraseña actual sigue funcionando y nadie ' +
        'entra sin abrir este enlace. Puede seguir entrando con el enlace mágico o con el código ' +
        'de WhatsApp como siempre.',
    }),
  }
}
