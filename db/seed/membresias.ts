/**
 * PRD-16 / PRD-35 «Membresías y admisión» — a concrete multi-org, differentiated-role example plus
 * one vouched organisation, so the permissions story is legible on staging. STAGING ONLY. Consumed
 * only by scripts/seed.ts, which keeps everything within each organisation's ceiling.
 *
 * A person's HOME-org membership is created automatically by the 0047 trigger when the usuario is
 * seeded, at the role they hold there. This adds the SECOND membership — the same person in a second
 * organisation, at a DIFFERENT role — which is the whole point of §29.5: effective permissions are
 * the union of active memberships, each clipped to its org's ceiling.
 *
 * `comunidadesAlcance` is left empty («not scoped by community»), which is always within any ceiling.
 *
 * Idempotent: the membership on its (usuario, org, rol) natural key; the vouch applied only when the
 * org is not already `avalada`.
 */

export type MembresiaSemilla = {
  /** The person, by their seed phone (resolved to the usuario/contacto id). */
  usuarioTelefono: string
  /** The organisation to add them to, by fixed registry id. */
  organizacionId: string
  rol: 'coordinador' | 'verificador' | 'despachador' | 'admin' | 'lectura'
  /** Who granted it, by seed phone. */
  otorgadoPorTelefono: string
}

export type AvalOrganizacionSemilla = {
  /** The org being vouched in, by fixed registry id. */
  organizacionId: string
  /** The anchor org doing the vouching, by fixed registry id. */
  avaladoPorId: string
  motivo: string
}

const ASOREDIPARCHOCO = '22222222-0000-0000-0000-000000000001'
const HERENCIA = '22222222-0000-0000-0000-000000000002'

export const MEMBRESIAS_DEMO: MembresiaSemilla[] = [
  {
    // Yeison coordinates ASOREDIPARCHOCÓ (his home org, auto-membership) and reads at Herencia.
    usuarioTelefono: '+573000000006',
    organizacionId: HERENCIA,
    rol: 'lectura',
    otorgadoPorTelefono: '+573000000009',
  },
]

export const AVALES_ORGANIZACION_DEMO: AvalOrganizacionSemilla[] = [
  {
    organizacionId: HERENCIA,
    avaladoPorId: ASOREDIPARCHOCO,
    motivo: 'Avalada por ASOREDIPARCHOCÓ, la red ancla del Chocó.',
  },
]
