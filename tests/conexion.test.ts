import { describe, expect, it } from 'vitest'
import { sslPara } from '@/db/client'

/**
 * Which connection strings get TLS.
 *
 * This existed as an inline `url.includes('localhost')` and it was right for exactly the two
 * cases we had seen. Railway's private network is the third: `postgres.railway.internal` is
 * not localhost, offers no TLS at all, and the connection dies on «The server does not
 * support SSL connections» — during the release migration, so the deploy fails before
 * anything is up to explain why.
 *
 * The lesson is in the shape of the fix rather than the fix: hostname-guessing works until
 * it silently does not, and the connection string already carries the answer.
 */

describe('sslPara', () => {
  it('honra sslmode=disable, venga de donde venga', () => {
    // The explicit case. Whoever wrote the URL knows what is at the other end of it.
    expect(sslPara('postgresql://u:p@postgres.railway.internal:5432/railway?sslmode=disable')).toBe(
      false,
    )
    expect(sslPara('postgresql://u:p@algo.interno:5432/db?pool=5&sslmode=disable')).toBe(false)
  })

  it('sigue sin TLS contra la base local', () => {
    expect(sslPara('postgresql://convite:convite@localhost:5433/convite')).toBe(false)
    expect(sslPara('postgresql://convite:convite@127.0.0.1:5433/convite')).toBe(false)
  })

  it('mantiene TLS relajado para todo lo demás', () => {
    // Supabase and Neon need this, and this change is not the place to revisit it.
    expect(sslPara('postgresql://u:p@db.kjwkvulmsjffzhuchwpy.supabase.co:5432/postgres')).toEqual({
      rejectUnauthorized: false,
    })
    expect(sslPara('postgresql://u:p@ep-cool-name.eu-central-1.aws.neon.tech/db')).toEqual({
      rejectUnauthorized: false,
    })
  })

  it('no se deja apagar el TLS con trucos de cadena', () => {
    /*
     * Both found by an adversarial review, both reproduced against the old regex version, and
     * both fail in the worst way available: the connection succeeds, unencrypted, against a
     * production database, and raises nothing anywhere. The only way to notice is to be
     * watching the wire.
     *
     * The lesson generalises past these two strings — a connection string is a structure, and
     * a hostname can appear in several places in it without being the hostname. So the fix is
     * to parse, and these are the regression cases proving it stays parsed.
     */

    // `@localhost:` is in the userinfo. The real host is remote and must keep TLS.
    expect(
      sslPara('postgresql://user@localhost:pass@db.produccion.com:5432/convite'),
    ).toEqual({ rejectUnauthorized: false })

    // `?sslmode=disable` is in the fragment, which the server never sees.
    expect(
      sslPara('postgresql://u:p@db.produccion.com:5432/convite#?sslmode=disable'),
    ).toEqual({ rejectUnauthorized: false })

    // The same word in a password, a database name, or a path is not a parameter either.
    expect(sslPara('postgresql://u:sslmode=disable@db.produccion.com:5432/convite')).toEqual({
      rejectUnauthorized: false,
    })
    expect(sslPara('postgresql://u:p@db.produccion.com:5432/localhost')).toEqual({
      rejectUnauthorized: false,
    })
  })

  it('ante una cadena ilegible deja el TLS puesto', () => {
    // Failing closed. An unreadable connection string is not evidence that the other end is
    // local, and guessing «local» there is how the two cases above became possible.
    expect(sslPara('no-es-una-url')).toEqual({ rejectUnauthorized: false })
    expect(sslPara('')).toEqual({ rejectUnauthorized: false })
  })

  it('no confunde sslmode=disable con otros modos', () => {
    // `disable` is the only value that turns TLS off. `require`, `prefer` and a database
    // that merely contains the word must not.
    for (const url of [
      'postgresql://u:p@host:5432/db?sslmode=require',
      'postgresql://u:p@host:5432/db?sslmode=prefer',
      'postgresql://u:p@host:5432/db?sslmode=verify-full',
      'postgresql://u:p@host:5432/sslmode_disable_notes',
    ]) {
      expect(sslPara(url), url).toEqual({ rejectUnauthorized: false })
    }
  })

  it('un host remoto llamado «localhost-algo» no cuenta como local', () => {
    // The old check was a substring match on the whole URL, so a database named
    // «localhost-backup» on a real host would have silently dropped TLS.
    expect(sslPara('postgresql://u:p@db.ejemplo.com:5432/localhost-backup')).toEqual({
      rejectUnauthorized: false,
    })
  })
})
