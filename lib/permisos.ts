import type { PoolClient } from 'pg'

/**
 * The capabilities an org admin can switch off for their own organisation (migration 0069).
 *
 * Not the same thing as a role. `convite_puede(cap)` is an AND: the caller's ROLE has to exercise
 * the capability, the organisation's admission CEILING has to grant it, and — since 0069 — the
 * admin must not have switched it off. This module is only that third layer, which is why every
 * switch here can subtract and none can add.
 *
 * That distinction is the whole reason an admin gets a matrix at all. Handing them
 * `techo_permisos` would let any organisation grant itself what admission refused; handing them a
 * denial layer lets them run tighter than they were allowed, which is a thing a careful partner
 * genuinely wants — «we do not do despatch, take it off our screen» — and can never be a
 * privilege escalation.
 */

export type Capacidad = {
  clave: string
  titulo: string
  detalle: string
}

export const CAPACIDADES: Capacidad[] = [
  {
    clave: 'direcciones_hogar',
    titulo: 'Ver direcciones de hogares',
    detalle: 'Dónde vive una familia. Lo más sensible que guarda el sistema (2.16).',
  },
  {
    clave: 'inventario_nodo',
    titulo: 'Manejar inventario de nodos',
    detalle: 'Contar y ajustar existencias en los centros de acopio.',
  },
  {
    clave: 'despacho',
    titulo: 'Despachar envíos',
    detalle: 'Armar envíos y mandarlos. Si su organización no despacha, apáguelo.',
  },
  {
    clave: 'agendamiento',
    titulo: 'Programar jornadas y citas',
    detalle: 'Crear jornadas, programas y citas en la agenda.',
  },
  {
    clave: 'evaluacion',
    titulo: 'Levantar evaluaciones',
    detalle: 'Evaluaciones de daño y de recuperación (PRD-29).',
  },
  {
    clave: 'puede_delegar',
    titulo: 'Delegar en otras organizaciones',
    detalle: 'Avalar a otra organización y compartirle alcance.',
  },
  {
    clave: 'acceso_sensible',
    titulo: 'Acceso a reportes sensibles',
    detalle: 'Violencia de género y otras revelaciones protegidas (PRD-49). Sin esto, el rol verificador_vulnerable no existe en su organización.',
  },
  {
    clave: 'datos_externos',
    titulo: 'Permitir que los datos salgan a Google Workspace',
    detalle: 'Calendario, archivos y hojas de cálculo fuera de Convite. Incluye fotos de daños y nombres. La conexión todavía no existe; esto es el permiso previo.',
  },
]

export type EstadoCapacidad = {
  clave: string
  /** Admission allows it. False means the switch is moot and shown as unavailable. */
  techo: boolean
  /** The admin has not switched it off. */
  encendida: boolean
}

export async function capacidadesDeOrganizacion(client: PoolClient): Promise<EstadoCapacidad[]> {
  const { rows } = await client.query<{ techo: unknown; admin: unknown }>(
    `select techo_permisos as techo, permisos_admin as admin
       from organizaciones where id = convite_organizacion()`,
  )
  const techo = (rows[0]?.techo ?? {}) as Record<string, unknown>
  const admin = (rows[0]?.admin ?? {}) as Record<string, unknown>

  return CAPACIDADES.map((c) => ({
    clave: c.clave,
    techo: techo[c.clave] === true,
    // Absent inherits: only an explicit false is off. Mirrors convite_puede exactly, so the
    // screen and the database can never disagree about what a blank means.
    encendida: admin[c.clave] !== false,
  }))
}

export async function fijarCapacidades(
  client: PoolClient,
  encendidas: Record<string, boolean>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await client.query(`select convite_fijar_permisos_admin($1::jsonb)`, [
      JSON.stringify(encendidas),
    ])
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudieron guardar los permisos.',
    }
  }
}
