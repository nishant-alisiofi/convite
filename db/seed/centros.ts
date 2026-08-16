/**
 * §2.4 / §4 — one centre waiting for platform approval, for the /centros screen. STAGING ONLY.
 *
 * The Centros screen (platform tier) lists organisations with `estado_aprobacion = 'pendiente'`
 * and offers Aprobar / Rechazar on each. Until a real request arrives it shows only the seeded,
 * already-approved centre, so there is nothing to decide. This is a DISTINCT organisation — a
 * community council asking to operate — with a pending center-admin invitation and the audit
 * trail a self-registration leaves, so the screen has a real "waiting for approval" card whose
 * Aprobar/Rechazar buttons actually move it through `convite_decidir_centro`.
 *
 * It is created AFTER the seeded partner org, so the partner stays the earliest-created active
 * organisation where the seeded staff land — this row has no staff of its own, only the pending
 * invitation. The name is marked [DATO DE PRUEBA] by scripts/seed.ts (it is the card title and
 * shows in "Todas las organizaciones"); the admin email is an obvious `.example` test address.
 */
export const CENTRO_PENDIENTE_DEMO = {
  nombre: 'Consejo Comunitario del Bajo Baudó',
  /** Pending center-admin invitation. Lowercase with an @, per invitaciones_correo_check. */
  adminCorreo: 'consejo.bajobaudo+prueba@convite.example',
  /** Shown on the card via the `centro.solicitado` audit row the screen reads. */
  solicitante: 'Nilson Mosquera, representante legal',
  contacto: 'consejo.bajobaudo+prueba@convite.example',
  detalle: 'Litoral del Bajo Baudó — seis veredas sin centro de acopio',
}
