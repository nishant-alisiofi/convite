import { describe, expect, it } from 'vitest'
import { plantillaEnlace } from '@/lib/correo'

/**
 * The sign-in email, which had no test at all until it shipped a bug.
 *
 * `tests/autenticacion.db.test.ts` mocks `plantillaEnlace` — it cares about the link being
 * generated and consumed, not about the message around it — so the real template was never
 * once rendered by the suite. That is how it went out with no `<head>` and therefore no
 * charset: every accent in a Spanish email mojibaked in any client that did not guess UTF-8
 * («Coordinación» → «CoordinaciÃ³n»), on the first thing a new coordinator ever sees from us.
 *
 * So this covers the things that are *functional* — the ones that make the email arrive
 * legible and usable. It deliberately asserts nothing about colour, spacing or wording: the
 * template's appearance is the design studio's to change without asking a test's permission.
 */

const ENLACE = 'https://convite.example/api/auth/magic-link/verify?token=abc123'

describe('el correo de ingreso', () => {
  it('declara UTF-8, porque va lleno de acentos', () => {
    const { html, asunto } = plantillaEnlace(ENLACE, 15)

    expect(html).toMatch(/<meta\s+charset=["']utf-8["']/i)
    // The half that makes the charset matter. If the copy is ever rewritten without
    // accents this assertion stops meaning anything, so it checks the text really has them.
    expect(html).toMatch(/[áéíóúñ¿¡]/i)
    expect(asunto.length).toBeGreaterThan(0)
  })

  it('lleva el enlace dos veces: en el botón y en texto plano', () => {
    const { html } = plantillaEnlace(ENLACE, 15)

    // The fallback line is not decoration. A client that strips the anchor, or a person
    // reading on a phone that will not open the button, still has to be able to get in.
    expect(html).toContain(`href="${ENLACE}"`)
    expect(html.split(ENLACE).length - 1).toBeGreaterThanOrEqual(2)
  })

  it('dice cuántos minutos dura, con el número que se le pasa', () => {
    // Hard-coding «15» in the copy while `lib/auth.ts` expires the token on its own constant
    // is a lie that only shows up when somebody changes one of them.
    expect(plantillaEnlace(ENLACE, 15).html).toContain('15 minutos')
    expect(plantillaEnlace(ENLACE, 5).html).toContain('5 minutos')
  })

  it('no pide nada a la red para poder leerse', () => {
    const { html } = plantillaEnlace(ENLACE, 15)

    // Section 10's bar, applied to email: these people are on bad connections, and an
    // email client that blocks remote content by default — most of them — would render a
    // broken box instead. Styles stay inline because clients discard a stylesheet anyway.
    expect(html).not.toMatch(/<img\b/i)
    expect(html).not.toMatch(/<link\b/i)
    expect(html).not.toMatch(/<script\b/i)
  })
})
