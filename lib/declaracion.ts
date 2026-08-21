import type {
  FaseRespuesta,
  HerramientaOrganizacion,
  IntencionOrganizacion,
} from '@/db/schema/vocabulario'
import type { PoolClient } from 'pg'
import type { SesionStaff } from '@/lib/sesion'

/**
 * The onboarding declaration: what an organisation says about itself before it reaches the panel.
 *
 * Until now an organisation arrived through /solicitar-centro with a name and a contact, was
 * approved by a platform admin, and landed on /tablero — a cargo-dispatch board — knowing
 * nothing about it beyond those two fields. Every question the product needed answered was
 * either inferred later or asked of nobody: what they are here to do, what they already work
 * in, which phase of a response they are in, whether they need to reach communities off the
 * road network.
 *
 * This module owns that declaration and, more importantly, the rule about **who is asked**.
 * That rule is pure and lives in `debeDeclarar`, so it can be tested without a database — which
 * matters, because getting it wrong strands somebody outside the panel with no way back in.
 */

export type Declaracion = {
  intenciones: IntencionOrganizacion[]
  herramientas: HerramientaOrganizacion[]
  fase: FaseRespuesta | null
  alcanceRural: boolean | null
}

/**
 * Whether this session must complete the declaration before the panel opens.
 *
 * Four exemptions, each of which would otherwise strand somebody:
 *
 * 1. **Platform admins.** They approve organisations; their own is incidental, and gating them
 *    behind a declaration about it would lock the approval queue behind the thing it approves.
 * 2. **Unapproved organisations.** `panelBloqueado` already sends them to the «awaiting
 *    approval» screen. Asking an organisation to declare a phase before anyone has agreed it
 *    exists is asking it to invest in an outcome we may refuse — and two gates competing for
 *    the same redirect is how loops are born.
 * 3. **`aportante` organisations.** A self-registered transporter (FR-18) gets their own
 *    one-person org, `aprobada` on creation. They are an occasional user with a boat, not an
 *    organisation running a response, and asking them which disaster phase they are in is
 *    incoherent. This is the exemption most likely to be dropped by accident.
 * 4. **Anyone who is not an admin.** Only an admin can answer — the SQL function refuses
 *    everyone else — so gating a verificador on it would trap them behind a form that rejects
 *    them. They get a hint on the panel instead, which is PRD-36's existing shape.
 */
export function debeDeclarar(
  sesion: Pick<
    SesionStaff,
    'esPlataforma' | 'estadoOrganizacion' | 'nivelAdmision' | 'rolStaff' | 'organizacionDeclarada'
  >,
): boolean {
  if (sesion.organizacionDeclarada) return false
  if (sesion.esPlataforma) return false
  if (sesion.estadoOrganizacion !== 'aprobada') return false
  if (sesion.nivelAdmision === 'aportante') return false
  return sesion.rolStaff === 'admin'
}

/**
 * Whether to show the rest of the organisation a «somebody still has to do this» note.
 *
 * The mirror of `debeDeclarar`: the people who are *not* gated but whose organisation is
 * nonetheless undeclared. Silence here would be worse than a note — a verificador would have no
 * idea why the panel behaves generically, and no idea who to ask.
 */
export function faltaDeclaracionAjena(
  sesion: Pick<
    SesionStaff,
    'esPlataforma' | 'estadoOrganizacion' | 'nivelAdmision' | 'rolStaff' | 'organizacionDeclarada'
  >,
): boolean {
  if (sesion.organizacionDeclarada) return false
  if (sesion.esPlataforma) return false
  if (sesion.estadoOrganizacion !== 'aprobada') return false
  if (sesion.nivelAdmision === 'aportante') return false
  return sesion.rolStaff !== 'admin'
}

/** The organisation's current answers, for pre-filling the form when it is run again. */
export async function leerDeclaracion(client: PoolClient): Promise<Declaracion> {
  const { rows } = await client.query<{
    intenciones: string[] | null
    herramientas: string[] | null
    fase: string | null
    alcance_rural: boolean | null
  }>(
    `select intenciones, herramientas, fase, alcance_rural
       from organizaciones
      where id = convite_organizacion()`,
  )
  const fila = rows[0]
  return {
    intenciones: (fila?.intenciones ?? []) as IntencionOrganizacion[],
    herramientas: (fila?.herramientas ?? []) as HerramientaOrganizacion[],
    fase: (fila?.fase ?? null) as FaseRespuesta | null,
    alcanceRural: fila?.alcance_rural ?? null,
  }
}

/**
 * Record the declaration.
 *
 * Goes through `convite_declarar_organizacion` rather than an UPDATE from here, for the same
 * reason the season change and the vouching setters do: the admin check, the «at least one
 * intention» rule and the audit row belong next to the write, inside one transaction, where no
 * future caller can route around them.
 */
export async function guardarDeclaracion(
  client: PoolClient,
  d: Declaracion,
): Promise<void> {
  await client.query(`select convite_declarar_organizacion($1::text[], $2::text[], $3, $4)`, [
    d.intenciones,
    d.herramientas,
    d.fase,
    d.alcanceRural,
  ])
}
