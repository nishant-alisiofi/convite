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
  /*
   * Parsed, never pattern-matched. The first version of this read the raw string, and a
   * connection string is not a string — it is a structure with places a hostname can appear
   * without being the hostname. Two ways that turned into «TLS silently off against a remote
   * database», both found by an adversarial review and both reproduced:
   *
   *   postgresql://user@localhost:pass@db.produccion.com/convite
   *     `@localhost:` matched, but it is in the *userinfo*. The real host is remote. The
   *     WHATWG parser splits on the LAST `@` and answers `db.produccion.com`.
   *
   *   postgresql://u:p@db.produccion.com/convite#?sslmode=disable
   *     `?sslmode=disable` matched, but it is in the *fragment*, which the server never sees
   *     and which is not a parameter at all. `searchParams` ignores it, correctly.
   *
   * Neither raises anything. The connection succeeds, in the clear, and the only way to find
   * out is to be looking at the wire.
   */
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // Unparseable. Keep TLS on: an unreadable connection string is not evidence that the
    // other end is local, and this is the direction to be wrong in.
    return { rejectUnauthorized: false }
  }

  /*
   * Explicit `sslmode=disable`, and only as a real query parameter. Railway's private network
   * is the case that needs it: `postgres.railway.internal` is not localhost, offers no TLS at
   * all, and the connection dies on «The server does not support SSL connections» during the
   * release migration, before anything is up to report it. Whoever wrote the string knows
   * what is at the other end; this function does not.
   */
  if (parsed.searchParams.get('sslmode') === 'disable') return false

  // A real local host, from the parsed hostname rather than from anywhere the word may appear.
  const host = parsed.hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
    return false
  }

  /*
   * Everything else negotiates TLS — but without verifying the certificate chain, which is
   * what Supabase and Neon need and what Railway's proxy has always been given here. It stops
   * a passive listener and does NOT stop an active machine-in-the-middle, since any
   * certificate is accepted. Pinning the provider CA is the real answer and is a change with
   * its own rollout; it is deliberately not being smuggled into a bug fix about string
   * parsing. Written down so the next person finds a known gap rather than an assumption.
   */
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
