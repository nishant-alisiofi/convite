import 'dotenv/config'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { closeDb, getPool } from '@/db/client'

/**
 * Applies db/migrations/*.sql in filename order, each in its own transaction, recording
 * what ran in `_migraciones`.
 *
 * Migrations are hand-authored SQL rather than drizzle-kit output because most of this
 * schema is things drizzle-kit does not generate: PostGIS geometry columns and GiST
 * indexes, partial unique indexes, `nulls not distinct`, views, triggers, and the RLS
 * floor. The Drizzle schema in db/schema is the typed mirror used by application code;
 * `pnpm db:check` diffs the two so drift is visible.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations')

async function main() {
  const pool = getPool()

  await pool.query(`
    create table if not exists _migraciones (
      nombre      text primary key,
      hash        text not null,
      aplicada_en timestamptz not null default now()
    )
  `)

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const { rows } = await pool.query<{ nombre: string; hash: string }>(
    'select nombre, hash from _migraciones',
  )
  const applied = new Map(rows.map((r) => [r.nombre, r.hash]))

  let ran = 0
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    const hash = createHash('sha256').update(sql).digest('hex').slice(0, 16)
    const previous = applied.get(file)

    if (previous) {
      if (previous !== hash) {
        throw new Error(
          `La migración ${file} ya fue aplicada pero su contenido cambió.\n` +
            `Cree una migración nueva en vez de editar una aplicada, o corra 'pnpm db:reset' en local.`,
        )
      }
      continue
    }

    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(sql)
      await client.query('insert into _migraciones (nombre, hash) values ($1, $2)', [file, hash])
      await client.query('commit')
      console.log(`  ✓ ${file}`)
      ran += 1
    } catch (error) {
      await client.query('rollback')
      console.error(`  ✗ ${file}`)
      throw error
    } finally {
      client.release()
    }
  }

  console.log(ran === 0 ? 'Sin migraciones pendientes.' : `${ran} migración(es) aplicada(s).`)
}

main()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error)
    await closeDb()
    process.exit(1)
  })
