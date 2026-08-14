import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit is used for `studio` and for drift checking (`pnpm db:check`), not as the
 * migration applier — the applied migrations are the hand-authored SQL in db/migrations
 * (see scripts/migrate.ts for why). Any file drizzle-kit writes into ./drizzle is scratch
 * output and is gitignored.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  casing: 'snake_case',
  verbose: true,
  strict: true,
})
