import 'dotenv/config'
import { closeDb, getPool } from '@/db/client'

/**
 * Drops and recreates the public schema. Local development only — it refuses to run
 * against anything that is not obviously a local database.
 */
async function main() {
  const url = process.env.DATABASE_URL ?? ''
  const esLocal = /@(localhost|127\.0\.0\.1|db)[:/]/.test(url)
  if (!esLocal && process.env.CONVITE_PERMITIR_RESET_REMOTO !== 'si') {
    throw new Error(
      'db:reset solo corre contra una base local. Para forzarlo, exporte CONVITE_PERMITIR_RESET_REMOTO=si.',
    )
  }

  const pool = getPool()
  await pool.query('drop schema if exists public cascade')
  await pool.query('create schema public')
  // The roles are cluster-level and survive the drop, but on a brand-new cluster 0000 has
  // not created them yet.
  await pool.query(`
    do $$
    declare r text;
    begin
      foreach r in array array['anon', 'authenticated', 'service_role'] loop
        if exists (select 1 from pg_roles where rolname = r) then
          execute format('grant usage on schema public to %I', r);
        end if;
      end loop;
    end
    $$;
  `)
  console.log('Esquema public recreado.')
}

main()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error)
    await closeDb()
    process.exit(1)
  })
