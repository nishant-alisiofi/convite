import { describe, expect, it } from 'vitest'
import { panelBloqueado } from '@/lib/organizacion'

/**
 * The centre approval gate (§2.4 / §4), as a pure decision.
 *
 * The panel layout uses this to decide whether to draw the shell or a «pending approval»
 * screen, so getting it right is what keeps a not-yet-approved centre from operating. Tested
 * here without a database or a browser because the rule itself has none — it is three fields and
 * a boolean, and it is load-bearing enough to deserve a test that says exactly what it does.
 */

describe('el acceso al panel depende de la aprobación del centro', () => {
  it('bloquea a un miembro de un centro que sigue pendiente', () => {
    expect(panelBloqueado({ esPlataforma: false, estadoOrganizacion: 'pendiente' })).toBe(true)
  })

  it('bloquea a un miembro de un centro rechazado', () => {
    expect(panelBloqueado({ esPlataforma: false, estadoOrganizacion: 'rechazada' })).toBe(true)
  })

  it('deja entrar a un miembro de un centro aprobado', () => {
    expect(panelBloqueado({ esPlataforma: false, estadoOrganizacion: 'aprobada' })).toBe(false)
  })

  it('nunca bloquea a un admin de plataforma, aunque su propio centro no esté aprobado', () => {
    // The platform tier approves centres; locking them out because their own organisation is in
    // some non-approved state would be a deadlock they could not resolve.
    expect(panelBloqueado({ esPlataforma: true, estadoOrganizacion: 'pendiente' })).toBe(false)
    expect(panelBloqueado({ esPlataforma: true, estadoOrganizacion: 'rechazada' })).toBe(false)
    expect(panelBloqueado({ esPlataforma: true, estadoOrganizacion: 'aprobada' })).toBe(false)
  })
})
