import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '@/lib/env'
import * as schema from './schema'

let pool: Pool | null = null

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: env().DATABASE_URL,
      // Supabase/Neon require TLS; local docker does not offer it.
      ssl: env().DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
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
