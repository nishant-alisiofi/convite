import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import Inicio from '@/app/page'

/**
 * The landing copy the pilot demo shows first (PRD v3 D8). Pure render, no database: the
 * page is `force-static` and its claims are load-bearing to «asking for help never costs
 * money», so overstating them is the defect this pins shut.
 */
describe('la página de inicio (D8)', () => {
  const marcado = renderToStaticMarkup(<Inicio />)

  it('el zero-rating queda calificado, no absoluto', () => {
    expect(marcado).toContain('los mensajes de WhatsApp no consumen datos')
    expect(marcado).toContain('la llamada perdida siempre funciona')
    // La afirmación demasiado fuerte que D8 retira.
    expect(marcado).not.toContain('no consume saldo')
  })

  it('la llamada perdida dice «solo marque», no «marque y cuelgue» (§4.1.1)', () => {
    expect(marcado).toContain('solo marca')
    expect(marcado).not.toContain('marca y cuelga')
  })
})
