import { boolean, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Better Auth's own storage. Typed mirror of migration 0028.
 *
 * These four tables are infrastructure, not domain, and they are the only ones in the
 * schema with English names. That is the point: `usuarios` is Convite's staff table — who
 * coordinates what, in which organisation, over which communities — and `auth_user` is a
 * list of addresses that have proved they can read their own email. Conflating the two is
 * exactly the mistake non-negotiable 2.10 exists to prevent, so they do not share a name.
 *
 * They are joined by value, not by a foreign key: `usuarios.id` is set to the `auth_user.id`
 * of the person who signed in, by `vincular_usuario_staff()`, and only when an admin had
 * already put that address on the allowlist. There is no FK because there was none before
 * either — the auth rows used to live in another database entirely — and adding one now
 * would let a delete in the identity layer cascade into the audit trail.
 */

/** Shared by all four: Better Auth writes these as ISO strings and reads them back as dates. */
const creado = () =>
  timestamp('creado_en', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
const actualizado = () =>
  timestamp('actualizado_en', { withTimezone: true, mode: 'date' }).notNull().defaultNow()

/**
 * One row per address that has ever completed a sign-in.
 *
 * `id` is text holding a uuid. Text because that is what Better Auth's adapter passes
 * around and a `uuid` column would throw on anything else; uuid-shaped because
 * `usuarios.id` is a real uuid and `auth.uid()` casts the claim to one. The CHECK
 * constraint in 0028 enforces the shape at the only place that cannot be bypassed.
 */
export const authUser = pgTable(
  'auth_user',
  {
    id: text('id').primaryKey(),
    name: text('nombre').notNull(),
    email: text('correo').notNull().unique(),
    emailVerified: boolean('correo_verificado').notNull().default(false),
    /**
     * E.164, proved by a one-time code over WhatsApp (0029).
     *
     * Not the same thing as `contactos.telefono`. That one belongs to a community member who
     * never logs in and never will (2.10); this one belongs to staff. They are separate
     * tables because they are separate kinds of person, and the same number appearing in both
     * would mean a coordinator who also reports from their own village — not a contradiction.
     */
    phoneNumber: text('telefono').unique(),
    phoneNumberVerified: boolean('telefono_verificado').notNull().default(false),
    image: text('imagen'),
    createdAt: creado(),
    updatedAt: actualizado(),
  },
  (t) => [index('auth_user_correo_idx').on(t.email)],
)

/** Live sessions. One row per signed-in browser; deleted on sign-out and on expiry. */
export const authSession = pgTable(
  'auth_session',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('vence_en', { withTimezone: true, mode: 'date' }).notNull(),
    ipAddress: text('ip'),
    userAgent: text('agente'),
    userId: text('auth_user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    createdAt: creado(),
    updatedAt: actualizado(),
  },
  (t) => [index('auth_session_usuario_idx').on(t.userId), index('auth_session_token_idx').on(t.token)],
)

/**
 * Credentials per provider. Empty in practice today — there are no passwords (Section 3)
 * and no social providers — but Better Auth expects the table to exist, and creating it
 * now means adding one later is a config change rather than a migration during an outage.
 */
export const authAccount = pgTable(
  'auth_account',
  {
    id: text('id').primaryKey(),
    accountId: text('cuenta_externa_id').notNull(),
    providerId: text('proveedor').notNull(),
    userId: text('auth_user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    accessToken: text('token_acceso'),
    refreshToken: text('token_refresco'),
    idToken: text('token_id'),
    accessTokenExpiresAt: timestamp('token_acceso_vence_en', { withTimezone: true, mode: 'date' }),
    refreshTokenExpiresAt: timestamp('token_refresco_vence_en', {
      withTimezone: true,
      mode: 'date',
    }),
    scope: text('alcance'),
    password: text('contrasena'),
    createdAt: creado(),
    updatedAt: actualizado(),
  },
  (t) => [index('auth_account_usuario_idx').on(t.userId)],
)

/**
 * Short-lived tokens. This is where a magic link actually lives between «mandarme el
 * enlace» and the click: one row, consumed on use, gone in 15 minutes either way.
 */
export const authVerification = pgTable(
  'auth_verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identificador').notNull(),
    value: text('valor').notNull(),
    expiresAt: timestamp('vence_en', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: creado(),
    updatedAt: actualizado(),
  },
  (t) => [index('auth_verification_identificador_idx').on(t.identifier)],
)

/**
 * The map handed to `drizzleAdapter`.
 *
 * The keys are Better Auth's model names and are not ours to rename — the adapter looks
 * tables up by them. Everything below the keys (table names, column names) is ours, which
 * is why the SQL can stay snake_case like the rest of the schema.
 */
export const autenticacion = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
}
