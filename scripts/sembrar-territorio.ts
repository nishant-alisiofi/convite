import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { closeDb, getPool } from '@/db/client'

/**
 * Carga el registro real del territorio desde db/seed/territorio.sql: regiones,
 * las organizaciones socias (ASOREDIPARCHOCÓ, Fundación Herencia de Timbiquí), el
 * catálogo de respuesta, las comunidades (todas con verificado_en = NULL), nodos,
 * rutas estacionales y las jornadas históricas de Herencia.
 *
 *   pnpm sembrar:territorio
 *
 * Son DATOS DE REFERENCIA, no de prueba: el registro del territorio va TANTO en
 * staging COMO en producción, igual que un catálogo o una tabla de consulta. Es
 * distinto de `pnpm db:seed`, que fabrica reportes/pedidos/ofertas demo marcados
 * «[DATO DE PRUEBA]» y que es SOLO de staging (nunca toca producción).
 *
 * El SQL es idempotente (UUIDs fijos + `on conflict` sobre la clave natural de
 * cada tabla), así que es seguro correrlo en cada arranque y no duplica el
 * registro. Orden recomendado en el arranque:
 *
 *   Producción:  db:migrate → sembrar:plataforma → sembrar:territorio → start
 *   Staging:     db:migrate → sembrar:territorio → db:seed → sembrar:staff → start
 *
 * En staging `sembrar:territorio` corre ANTES del `db:seed` demo, que aterriza su
 * actividad de prueba sobre la organización activa más antigua — ASOREDIPARCHOCÓ,
 * el ancla del Chocó (ver scripts/seed.ts `sembrarOrganizacion`).
 */

const ARCHIVO = join(process.cwd(), 'db', 'seed', 'territorio.sql')

async function main() {
  const pool = getPool()
  const sql = readFileSync(ARCHIVO, 'utf8')

  // Un único simple-query multi-sentencia: Postgres lo corre como una sola
  // transacción implícita, así que un error a mitad no deja el registro a medias.
  await pool.query(sql)

  const { rows } = await pool.query<{ tabla: string; filas: string }>(`
    select 'regiones' as tabla,        count(*)::text as filas from regiones
    union all select 'organizaciones',        count(*)::text from organizaciones
    union all select 'catalogo_items',        count(*)::text from catalogo_items
    union all select 'comunidades',           count(*)::text from comunidades
    union all select 'comunidades sin verif', count(*)::text from comunidades where verificado_en is null
    union all select 'nodos',                 count(*)::text from nodos
    union all select 'rutas',                 count(*)::text from rutas
    union all select 'jornadas',              count(*)::text from jornadas
    union all select 'jornada_paradas',       count(*)::text from jornada_paradas
  `)

  console.log('\nRegistro de territorio cargado:')
  for (const r of rows) console.log(`  ${r.tabla.padEnd(24)} ${r.filas}`)
  console.log()
}

main()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error)
    await closeDb()
    process.exit(1)
  })
