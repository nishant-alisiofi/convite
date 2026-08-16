import { z } from 'zod'

/**
 * Boundary validation for process.env (Section 3: Zod for all boundary validation).
 *
 * Only DATABASE_URL is required to run migrations, seeds and tests. Everything else is
 * optional at this milestone and becomes required as the integration that needs it lands,
 * so a fresh clone can get a queryable basin without any third-party credential.
 */
const schema = z.object({
  DATABASE_URL: z.string().url(),

  /**
   * Signs the session cookie. Without it there is no sign-in — the middleware says so
   * rather than letting requests through, and `lib/auth.ts` refuses to build a config.
   * Generate with `openssl rand -hex 32`.
   */
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  /**
   * Public origin the auth routes answer on. Defaults to APP_BASE_URL because in this app
   * they are the same server — the panel and `/api/auth/*` are one Next deployment, which
   * is what spares us the cross-origin cookie problem entirely.
   */
  BETTER_AUTH_URL: z.string().url().optional(),

  /** Sends the sign-in link. Absent locally: the link goes to the server console instead. */
  RESEND_API_KEY: z.string().min(1).optional(),
  /**
   * Whom the sign-in link comes from. Has to be a domain *verified in Resend* — an
   * unverified one is not a soft failure, it is a 422 on every single send, so a wrong
   * value here looks exactly like «the email never arrived».
   *
   * The default is the shared internal domain, which is verified today and is what makes a
   * staging demo work without waiting on DNS. Convite has no domain of its own yet; when it
   * gets one, verify `mail.<dominio>` in Resend and set this. Never the apex — that is the
   * one that is never verified by default.
   */
  EMAIL_FROM: z.string().min(1).default('Convite <no-responder@dev.downshiftit.com>'),

  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1).optional(),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().min(1).optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1).optional(),
  WHATSAPP_APP_SECRET: z.string().min(1).optional(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().min(1).optional(),

  GOOGLE_MAPS_SERVER_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY: z.string().min(1).optional(),

  OPENAI_API_KEY: z.string().min(1).optional(),

  /** Root for downloaded media. Falls back to ./.data; never inside the repo in production. */
  DATA_DIR: z.string().min(1).optional(),

  /**
   * Where the offline PMTiles basemap archive is served from (PRD-13 / §26), e.g.
   * `/mapa/choco.pmtiles`. Absent: the map uses the online OSM raster and there is no offline
   * basemap. Set it once a bundle is built (`scripts/construir-pmtiles.sh`) and placed under
   * `public/mapa/`. `NEXT_PUBLIC_` because the map reads it in the browser; the archive is a
   * public static file with no key, so exposing the path is fine.
   */
  NEXT_PUBLIC_PMTILES_URL: z.string().min(1).optional(),

  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
})

export type Env = z.infer<typeof schema>

let cached: Env | null = null

export function env(): Env {
  if (cached) return cached
  // `.env` files carry placeholder keys as empty strings. An empty value means "not
  // configured yet", exactly like an absent one — otherwise a fresh clone cannot run a
  // migration until it has a WhatsApp token it does not need.
  const crudo = Object.fromEntries(
    Object.entries(process.env).filter(([, valor]) => valor !== undefined && valor !== ''),
  )
  const parsed = schema.safeParse(crudo)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Configuración inválida en las variables de entorno:\n${detail}`)
  }
  cached = parsed.data
  return cached
}
