import { randomUUID } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { magicLink } from 'better-auth/plugins/magic-link'
import { getDb, getPool } from '@/db/client'
import { autenticacion } from '@/db/schema/autenticacion'
import { enviarCorreo, plantillaEnlace } from '@/lib/correo'
import { env } from '@/lib/env'

/**
 * Identity, on our own Postgres.
 *
 * Convite used to borrow Supabase for this one job. The job never grew — no PostgREST, no
 * storage, no realtime, just «who is this person» — and the cost of the arrangement was a
 * whole second database that had to exist, be paid for and be configured before the panel
 * would answer at all. Staging spent weeks returning 503 for exactly that reason. Identity
 * now lives in the same database as everything else, so a deploy that has DATABASE_URL has
 * a working sign-in.
 *
 * What deliberately did NOT change is the security model, which is the part that matters:
 *
 *   - Signing in still only proves you own an address. It does not make you staff.
 *     `invitaciones_staff` is still the allowlist and `vincular_usuario_staff()` is still
 *     the only thing that writes a `usuarios` row (non-negotiable 2.10).
 *   - RLS is still the boundary. `conSesion()` sets `request.jwt.claims` and assumes the
 *     `authenticated` role exactly as before; the policies in 0017 never learn that the
 *     identity provider changed.
 *
 * The one thing that makes both of those keep working is the id: `usuarios.id` is a uuid
 * and `auth.uid()` casts the `sub` claim to one, so the user ids this issues must be uuids
 * too. See `generateId` below — it is load-bearing, not a preference.
 */

/** How long a sign-in link is good for. Short: it is delivered instantly and used at once. */
const MINUTOS_ENLACE = 15

/**
 * Whether identity can work at all in this process.
 *
 * Read from `process.env` rather than through `env()` because the middleware asks this
 * question on the edge and during `next build`, where a missing DATABASE_URL must be a
 * «no» and never a thrown exception.
 */
export function autenticacionConfigurada(): boolean {
  return Boolean(process.env.BETTER_AUTH_SECRET && process.env.DATABASE_URL)
}

/** The origin the auth routes answer on. Same server as the panel, so normally APP_BASE_URL. */
export function urlBase(): string {
  return env().BETTER_AUTH_URL ?? env().APP_BASE_URL
}

/**
 * Whether an admin has put this address on the staff allowlist (2.10).
 *
 * Asked twice, in two different places, on purpose — and this is the only implementation of
 * the question so the two answers cannot drift:
 *
 *   1. Before sending. Better Auth creates the user when the link is *clicked*, so without
 *      a check at send time a stranger who guesses at the form receives a real sign-in
 *      email that merely happens to fail later. Nobody uninvited should get mail from us.
 *   2. Before the row is written, in `databaseHooks.user.create.before`. That is the one
 *      that cannot be gone around: it holds even if some future caller reaches
 *      `signInMagicLink` without asking first.
 */
export async function correoInvitado(correo: string): Promise<boolean> {
  const { rows } = await getPool().query(
    'select 1 from invitaciones_staff where correo = $1 limit 1',
    [correo.trim().toLowerCase()],
  )
  return rows.length > 0
}

/**
 * Builds the instance. Not exported — call `getAuth()`.
 *
 * The return type is deliberately left to inference rather than annotated. Writing
 * `ReturnType<typeof betterAuth>` widens it to the plugin-less base type, and then
 * `auth.api.signInMagicLink` does not exist as far as TypeScript is concerned — the magic
 * link is the only way into this app, so that is the one method that must stay typed.
 */
function construir() {
  const secreto = process.env.BETTER_AUTH_SECRET
  if (!secreto) {
    // Reached only if a caller skipped `autenticacionConfigurada()`. Better a named error
    // than a server that quietly signs cookies with a default nobody chose — a shared
    // default secret means anyone who knows it can mint a session for any address.
    throw new Error(
      'Falta BETTER_AUTH_SECRET. Sin él no se puede firmar una sesión; ' +
        'genere uno con `openssl rand -hex 32`.',
    )
  }

  return betterAuth({
    database: drizzleAdapter(getDb(), { provider: 'pg', schema: autenticacion }),
    secret: secreto,
    baseURL: urlBase(),
    trustedOrigins: [urlBase()],

    /**
     * Ids are uuids because `usuarios.id` is a uuid and the RLS policies compare against
     * `auth.uid()`, which casts the `sub` claim. Better Auth's own ids are opaque strings;
     * one of those in the claim makes every policy raise «invalid input syntax for type
     * uuid» and the panel goes blank for everyone. The CHECK constraint in migration 0028
     * is the second half of this — if this line is ever removed, sign-up fails loudly at
     * the database instead of failing silently at the policies.
     */
    advanced: {
      database: { generateId: () => randomUUID() },
      /**
       * Where the caller's address comes from, behind a proxy.
       *
       * Railway terminates TLS in front of us, so the socket address is always the proxy.
       * Better Auth said so itself on the first staging boot: «Rate limiting could not
       * determine a client IP and is falling back to a single shared per-path bucket». That
       * is worse than it sounds on a sign-in endpoint — one shared bucket means one noisy
       * caller can spend everybody's allowance, and the limit stops being per-attacker.
       *
       * `x-forwarded-for` is only trustworthy because Railway sets it; nothing reaches this
       * process without passing through their proxy. It would be forgeable on a host that
       * accepts direct connections.
       */
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
    },

    /** No passwords anywhere (Section 3). The magic link below is the only door. */
    emailAndPassword: { enabled: false },

    session: {
      // A working day, refreshed as it is used. A coordinator should not be signed out
      // halfway through a shift, and should not stay signed in on a shared laptop for a week.
      expiresIn: 60 * 60 * 12,
      updateAge: 60 * 60,
      /**
       * No cookie cache, deliberately.
       *
       * Turning it on is the usual advice and it saves one query per request. What it buys
       * in exchange is a window — up to `maxAge` — in which a session that has been
       * *deleted* still validates, because the answer is read out of a signed cookie
       * instead of the table. It was set to 60 seconds here and
       * tests/autenticacion.db.test.ts caught it immediately: the row was gone and
       * `getSession` kept saying yes.
       *
       * In a browser that window is mostly theoretical — signing out clears the cookie
       * too. But «I pressed Salir» has to mean the session is dead now, on a shared laptop
       * in a field office, for a product holding the locations of displaced families. And
       * the saving is not real anyway: `sesionActual()` reads the staff row from Postgres
       * on every panel request regardless, so this removes one query out of two on a panel
       * used by a handful of people.
       */
      cookieCache: { enabled: false },
    },

    plugins: [
      magicLink({
        expiresIn: 60 * MINUTOS_ENLACE,
        disableSignUp: false,
        sendMagicLink: async ({ email, url }) => {
          const { asunto, html } = plantillaEnlace(url, MINUTOS_ENLACE)
          await enviarCorreo({ para: email, asunto, html })
        },
      }),
      /**
       * Lets `auth.api.*` set cookies from a Server Action.
       *
       * Both doors this app has — «mandarme el enlace» and «salir» — are Server Actions,
       * and without this the sign-out call would compute a cleared cookie that never
       * reaches the browser: the session would look ended and the next request would still
       * carry it. Has to stay last in the list; it works by wrapping everything before it.
       */
      nextCookies(),
    ],

    databaseHooks: {
      user: {
        create: {
          /**
           * The allowlist, enforced before a row exists.
           *
           * Section 2.10 says only an address an admin invited may become staff, and
           * `vincular_usuario_staff()` already refuses to create a `usuarios` row without
           * an invitation. This is the same rule one step earlier: without it, anybody who
           * can type an email address gets an `auth_user` row and a valid session — no
           * access to any data, because RLS holds, but an unbounded table of strangers and
           * a sign-in that appears to succeed.
           *
           * Returns `false` rather than throwing: Better Auth reads that as «do not create
           * this row» and the magic-link handler turns it into a redirect the sign-in page
           * already knows how to render, whereas a thrown error surfaces as a 500 on a link
           * somebody was told to click.
           *
           * The sign-in page shows the same «we sent you a link» either way. Whether an
           * address belongs to staff is not something an unauthenticated form gets to tell
           * you.
           */
          before: async (usuario) => correoInvitado(usuario.email),
        },
      },
    },
  })
}

type Auth = ReturnType<typeof construir>

let instancia: Auth | null = null

/**
 * The auth instance, built on first use and never at import time.
 *
 * Lazy on purpose. `next build` runs with no DATABASE_URL and no secret (that is what
 * `pnpm build:limpio` rehearses, and tests/construccion.test.ts guards), so anything that
 * reached for a connection pool while a page was being collected would take the build down
 * — the exact failure the public page already taught us once.
 */
export function getAuth(): Auth {
  instancia ??= construir()
  return instancia
}
