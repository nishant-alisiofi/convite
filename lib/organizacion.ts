import type { SesionStaff } from '@/lib/sesion'

/**
 * The centre approval gate, as one decision the panel and its tests can share.
 *
 * §2.4 / §4: a centre operates only once the platform has approved it. Until then its members
 * can sign in — they have proved they own the address or the number, and they have a staff row
 * in a `pendiente` organisation — but the panel is not theirs to use yet. That is not a 500 and
 * not a redirect loop; it is a legible «your centre is awaiting approval» screen.
 *
 * A platform admin is never gated here. They are the ones who approve centres, and their own
 * organisation being anything other than approved must not lock them out of doing so.
 *
 * Pure on purpose: the layout calls it to decide what to render, and a unit test calls it to
 * prove a non-approved centre's members are blocked without standing up a browser.
 */
export function panelBloqueado(sesion: Pick<SesionStaff, 'esPlataforma' | 'estadoOrganizacion'>): boolean {
  if (sesion.esPlataforma) return false
  return sesion.estadoOrganizacion !== 'aprobada'
}
