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

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

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
