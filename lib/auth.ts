import { randomUUID } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { magicLink } from 'better-auth/plugins/magic-link'
import { phoneNumber } from 'better-auth/plugins/phone-number'
import { getDb, getPool } from '@/db/client'
import { autenticacion } from '@/db/schema/autenticacion'
import { enviarCodigo } from '@/lib/codigo-whatsapp'
import { enviarCorreo, plantillaEnlace, plantillaRestablecer } from '@/lib/correo'
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

/**
 * How long a sign-in link is good for. Still single-use; only the window moved.
 *
 * Fifteen minutes assumed the mail arrives instantly, and that assumption is wrong in the
 * place this product is for. A coordinator asks for a link on a connection that drops, the
 * mail lands twenty minutes later, the link is already dead, and they start again — on a bad
 * connection, which is exactly when they could least afford the round trip.
 *
 * Sixty minutes costs very little. The link is one-use and dies on first click, so the extra
 * window only matters to somebody who can already read the inbox — and somebody who can read
 * the inbox can simply request a fresh link. It widens no door that was closed.
 *
 * This is a comfort change, not the fix for sign-in friction. That is the session length
 * below: sign in once, stay in.
 */
const MINUTOS_ENLACE = 60

/**
 * How long a WhatsApp code is good for, and how many guesses it takes.
 *
 * Shorter than the emailed link because it is six digits rather than a signed token: a
 * million possibilities is not many if you are allowed to sit on them. Five minutes and three
 * attempts is Better Auth's own default and is the right order of magnitude — a code that is
 * read off a phone and typed into a laptop takes seconds.
 */
const MINUTOS_CODIGO = 5
const INTENTOS_CODIGO = 3

/** How long a password-reset link lives. Longer than a sign-in link: it is read, then acted on. */
const MINUTOS_RESTABLECER = 60

/**
 * Six digits, and the length is load-bearing rather than cosmetic.
 *
 * `pareceCodigo` in lib/canales/confirmacion.ts treats **any** bare four-digit message from a
 * known contact as a delivery confirmation, and it runs before everything else in the inbound
 * pipeline (lib/canales/intake.ts). A four-digit sign-in code that somebody replied with on
 * WhatsApp — which people will do — would be swallowed by that branch, answered with «no
 * encontramos ese código», and counted against their failed-confirmation tally. Six digits
 * cannot match `^\d{4}$`, so the two systems cannot be confused for each other. It is also
 * what Meta's authentication templates are shaped for.
 */
const DIGITOS_CODIGO = 6

/**
 * The placeholder address a phone-only sign-in gets.
 *
 * Better Auth requires an email on every user and `auth_user.correo` is NOT NULL, so a
 * coordinator who only has WhatsApp still needs one. `.invalid` is reserved by RFC 2606 and
 * can never resolve, which is the point: it must be impossible to mistake this for somewhere
 * mail could be sent, and impossible for it to collide with a real invited address.
 */
function correoMarcador(telefono: string): string {
  return `${telefono.replace(/^\+/, '')}@wa.convite.invalid`
}

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

/** The same question for the other door. E.164, exactly as the allowlist stores it. */
export async function telefonoInvitado(telefono: string): Promise<boolean> {
  const { rows } = await getPool().query(
    'select 1 from invitaciones_staff where telefono = $1 limit 1',
    [telefono.trim()],
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
       * Which hops in `x-forwarded-for` are infrastructure rather than the caller.
       *
       * Better Auth said on the first staging boot that it «could not determine a client IP
       * and is falling back to a single shared per-path bucket». On a sign-in endpoint that
       * matters: one bucket for everybody means one noisy caller spends the whole allowance
       * and the limit stops being per-attacker.
       *
       * Naming the header does nothing — `x-forwarded-for` is already Better Auth's default
       * (`DEFAULT_IP_HEADERS` in @better-auth/core). The actual refusal is in
       * `getIPFromHeader`: «without valid trusted proxies a multi-hop chain is
       * unresolvable», so any chain with more than one entry returns null and fails closed.
       * Railway's proxy adds a hop, so the chain is always longer than one.
       *
       * Trusting the RFC1918 ranges resolves it without opening a spoofing hole. The parser
       * walks the chain from the right and returns the first hop that is NOT trusted: a
       * private hop is infrastructure and gets skipped, and the first public address is the
       * caller. A client that injects its own `x-forwarded-for` lands to the *left* of the
       * address the proxy appends, so the forged value is never the one chosen. Private
       * ranges only — never trust a public CIDR here, that is what would make it forgeable.
       */
      ipAddress: {
        trustedProxies: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
      },
    },

    /**
     * A password, but never as a way *in* for the first time.
     *
     * This is the door that can quietly break the rule the other two enforce, so it is worth
     * being explicit about the rule first: an account is usable only if the address was
     * invited **and** somebody proved they control it. An allowlist alone is not enough —
     * plenty of people know a colleague's work address, and a list of invited addresses is
     * exactly the sort of thing that gets forwarded.
     *
     * So a password cannot create anything. Two structural guarantees, not one:
     *
     *   1. `disableSignUp` — there is no HTTP path that turns an address and a chosen
     *      password into an account. Accounts come into existence only through the magic
     *      link or the WhatsApp code, both of which require receiving something first.
     *   2. Better Auth's `setPassword` is `serverOnly` — it is not mounted as a route at
     *      all. The only caller is our own Server Action in app/(panel)/clave, which already
     *      requires a live session. A password can therefore only ever be attached to an
     *      account whose owner has already proved ownership and is signed in.
     *
     * The alternative — let somebody sign up with a password and gate it behind an email
     * verification link — was rejected. It has a real pre-hijacking attack: whoever knows an
     * invited address registers it first with a password of their choosing, the genuine
     * person receives a verification mail they did not ask for, and if they click it (people
     * click) the attacker's credential goes live on their account. The shape above cannot
     * express that attack.
     *
     * Password reset stays safe for the same reason the magic link is safe: it requires
     * reading mail sent to the address.
     */
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      // The portfolio floor is 12. A coordinator types this rarely — the magic link is still
      // the default door — so length is the cheapest strength to ask for.
      minPasswordLength: 12,
      maxPasswordLength: 128,
      // A reset is how somebody recovers from a password they think is compromised, so it
      // has to actually end the other sessions rather than leave them running.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        const { asunto, html } = plantillaRestablecer(url, MINUTOS_RESTABLECER)
        await enviarCorreo({ para: user.email, asunto, html })
      },
      resetPasswordTokenExpiresIn: 60 * MINUTOS_RESTABLECER,
    },

    session: {
      /**
       * You stay signed in until you press «Salir». Founder decision, and the right one for
       * where this runs.
       *
       * A coordinator opens the panel on a laptop in a field office over a connection that
       * may not be there when they come back. Being logged out is not a small friction for
       * them: it means waiting on an email that may take twenty minutes to arrive, on the
       * morning they are trying to get a boat out. The previous twelve hours meant signing in
       * again roughly every day.
       *
       * A year, rolled forward on use: any request more than a day old refreshes the expiry,
       * so somebody who opens the panel even once a year never reaches it. In practice the
       * session ends when they end it.
       *
       * That is only defensible because ending it actually works, and three separate things
       * have to keep being true — this is the list to check before touching any of them:
       *
       *   1. «Salir» deletes the session row server-side, not just the cookie. Tested in
       *      tests/autenticacion.db.test.ts; that test is now load-bearing rather than
       *      belt-and-braces.
       *   2. No cookie cache (see below). With a twelve-hour session a stale cache was a
       *      small window; against a year it would be the difference between revoked and
       *      revoked-eventually.
       *   3. Access is re-read from Postgres on every request. `sesionActual()` selects the
       *      staff row `where activo`, so deactivating somebody locks them out on their next
       *      click no matter how long their session had left. A long session extends
       *      convenience, not authorisation — that is the property that makes the length
       *      safe, and there is a test for it.
       *
       * The real cost is a shared laptop somebody walks away from. Nothing here fixes that;
       * it is why «Salir» sits in the header on every screen rather than behind a menu.
       */
      expiresIn: 60 * 60 * 24 * 365,
      updateAge: 60 * 60 * 24,
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
       *
       * Since sessions became year-long this stopped being a preference. A cache that keeps
       * answering «yes» after the row is gone is a bounded annoyance against a twelve-hour
       * session and a real hole against this one.
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
       * The second door: a six-digit code over WhatsApp.
       *
       * Same allowlist, same `usuarios` row, same RLS. What changes is only how somebody
       * proves they are reachable — and in the Atrato that matters, because a coordinator has
       * WhatsApp working before they have email working. It is the channel the entire intake
       * side of this product already runs on.
       *
       * The emailed link is untouched and stays the fallback: it is what an admin falls back
       * to when a phone is lost or a number changes.
       */
      phoneNumber({
        otpLength: DIGITOS_CODIGO,
        expiresIn: 60 * MINUTOS_CODIGO,
        allowedAttempts: INTENTOS_CODIGO,

        /** E.164 only, the same shape `contactos` is constrained to and the allowlist stores. */
        phoneNumberValidator: (telefono) => /^\+[1-9][0-9]{7,14}$/.test(telefono),

        sendOTP: async ({ phoneNumber: telefono, code }) => {
          await enviarCodigo(telefono, code)
        },

        /**
         * A first sign-in creates the identity, exactly as the magic link does.
         *
         * The allowlist still decides who gets one — `databaseHooks.user.create.before` below
         * runs on this path too, and Better Auth passes the phone number into `createUser`,
         * so the hook can see it and refuse. Without that, this option would be an open
         * signup door standing next to a closed one.
         */
        signUpOnVerification: {
          getTempEmail: correoMarcador,
          getTempName: (telefono) => telefono,
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
           *
           * Both doors come through here. A WhatsApp sign-in arrives carrying a placeholder
           * address (see `correoMarcador`) that is deliberately in nobody's allowlist, so the
           * number is what has to be checked — and Better Auth does pass it into `createUser`
           * on the phone path, which is the only reason this can be one hook instead of two.
           */
          before: async (usuario) => {
            const telefono = (usuario as { phoneNumber?: unknown }).phoneNumber
            if (typeof telefono === 'string' && telefono.length > 0) {
              return telefonoInvitado(telefono)
            }
            return correoInvitado(usuario.email)
          },
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
