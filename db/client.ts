import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '@/lib/env'
import * as schema from './schema'

let pool: Pool | null = null

/**
 * Whether to negotiate TLS for a given connection string.
 *
 * Hostname-guessing got us as far as "Supabase yes, docker no" and no further. Railway's
 * private network is the case that breaks it: `postgres.railway.internal` is not localhost,
 * it does not offer TLS at all, and the connection dies on «The server does not support SSL
 * connections» — during the release migration, before anything is up to report it.
 *
 * So an explicit `sslmode=disable` in the URL wins over any guess. Whoever wrote the
 * connection string knows what is at the other end of it; this function does not.
 *
 * Everything else keeps `rejectUnauthorized: false`, which is what Supabase and Neon need
 * and is not a decision this change is making.
 */
export function sslPara(url: string): false | { rejectUnauthorized: boolean } {
  if (/[?&]sslmode=disable(&|$)/.test(url)) return false
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(url)) return false
  return { rejectUnauthorized: false }
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: env().DATABASE_URL,
      ssl: sslPara(env().DATABASE_URL),
      max: 5,
    })
  }
  return pool
}

export function getDb() {
  return drizzle(getPool(), { schema })
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

export { schema }
