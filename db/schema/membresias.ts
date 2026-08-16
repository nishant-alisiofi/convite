import { sql } from 'drizzle-orm'
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { actualizadoEn, creadoEn, enLista, pk } from './_shared'
import { organizaciones, usuarios } from './core'
import { ROLES_STAFF } from './vocabulario'

/**
 * PRD-16 (§29.5) — multi-org membership. Typed mirror of migration 0047. The applied schema is
 * the hand-authored SQL there (the join table, its RLS, the SECURITY DEFINER enforcement helpers,
 * offboarding functions and the admission/vouching flow); this is the Drizzle view application
 * code reads and `pnpm db:check` diffs against.
 *
 * §29.5, in one line: a person belongs to more than one organisation, with a different role and
 * community scope in each. `usuarios.organizacion_id` stays as the person's HOME organisation (its
 * removal would rewrite every 0017/0030 policy and the session layer — a deliberate follow-up);
 * the membership layer is added alongside it. Effective permissions are the union of ACTIVE
 * memberships, each clipped to its organisation's ceiling, computed per request and never cached —
 * that computation lives in the SQL helpers (convite_puede, convite_membresia_capacidad), not
 * here.
 */

/** Membership lifecycle. `activa` is the only state that counts towards effective permissions. */
export const ESTADOS_MEMBRESIA = ['activa', 'suspendida', 'terminada'] as const
export type EstadoMembresia = (typeof ESTADOS_MEMBRESIA)[number]

/**
 * PRD-35 (§29.3b) — how an organisation was admitted. Orthogonal to `organizaciones.tipo` (what
 * kind of org it is) and `estado_aprobacion` (the approval lifecycle). The `nivel_admision` and
 * `avalado_por` columns live on `organizaciones` (core.ts); this vocabulary is the SQL check's
 * mirror.
 */
export const NIVELES_ADMISION = ['ancla', 'avalada', 'aportante', 'observadora'] as const
export type NivelAdmision = (typeof NIVELES_ADMISION)[number]

export const membresias = pgTable(
  'membresias',
  {
    id: pk(),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    /** One of ROLES_STAFF — the same controlled set as usuarios.rol_staff. */
    rol: text('rol').notNull(),
    /**
     * The membership's own territory scope, always a subset of the organisation's ceiling
     * (`techo_permisos.comunidades_alcance`) — the restrictive policy membresias_dentro_del_techo
     * enforces the clip. Empty means «not scoped by community».
     */
    comunidadesAlcance: uuid('comunidades_alcance')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    otorgadoPor: uuid('otorgado_por').references(() => usuarios.id),
    otorgadoEn: timestamp('otorgado_en', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    venceEn: timestamp('vence_en', { withTimezone: true, mode: 'date' }),
    estado: text('estado').notNull().default('activa'),
    motivoBaja: text('motivo_baja'),
    /**
     * §29.6 dormancy clock: an address-level membership idle past 45 days auto-suspends. Defaults
     * to now() so a fresh grant is not instantly dormant; bumped by
     * `convite_tocar_actividad_membresia`.
     */
    ultimaActividadEn: timestamp('ultima_actividad_en', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    // §29.5: one role per person per org.
    uniqueIndex('membresias_usuario_org_rol_key').on(t.usuarioId, t.organizacionId, t.rol),
    index('membresias_organizacion_idx').on(t.organizacionId),
    index('membresias_usuario_idx').on(t.usuarioId),
    check('membresias_rol_check', enLista('rol', ROLES_STAFF)),
    check('membresias_estado_check', enLista('estado', ESTADOS_MEMBRESIA)),
  ],
)
