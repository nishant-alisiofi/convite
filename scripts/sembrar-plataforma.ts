import 'dotenv/config'
import { closeDb, getPool } from '@/db/client'
import { administradores } from '@/scripts/lib/administradores'

/**
 * Production bootstrap: the real platform tier (§2.5), and nothing else.
 *
 *   pnpm sembrar:plataforma
 *   CORREOS_STAFF=ana@alisio.org,beto@alisio.org pnpm sembrar:plataforma
 *
 * Safe to run on every production boot. Unlike `pnpm sembrar:staff` — which seeds plus-addressed
 * demo rigs into a shared inbox so a deployment can be shown — this creates ONLY real, non-test
 * state: one real platform organisation, and the Alisio team invited as platform admins. No demo
 * roles, no plus-addressed rigs, no WhatsApp demo door, no `db:seed` data.
 *
 * It creates INVITATIONS, not accounts. Nobody exists until they ask for a link/code and prove
 * they control the address: `vincular_usuario_staff()` then writes the `usuarios` row carrying
 * `es_plataforma`. There is deliberately no sign-in shortcut — the same invariant as
 * `sembrar-staff.ts` and §4 of docs/tipos-de-usuario-y-accesos.md.
 */

/** Name for the platform organisation, only used when no organisation exists yet. */
const ORG_PLATAFORMA = process.env.ORG_PLATAFORMA ?? 'Alisio'

type Org = { id: string; nombre: string }

/**
 * The platform organisation. Reuse the earliest-created active organisation if one exists;
 * only create when there is none at all, so this never stands up a second organisation on a
 * live database.
 */
async function organizacionDePlataforma(): Promise<Org> {
  const pool = getPool()

  const { rows: activas } = await pool.query<Org>(
    'select id, nombre from organizaciones where activo order by creado_en limit 1',
  )
  if (activas[0]) return activas[0]

  // No active organisation. Only create one when there is truly none — an inactive-but-present
  // organisation is a state to fix, not a reason to create a second.
  const { rows: total } = await pool.query<{ n: number }>(
    'select count(*)::int as n from organizaciones',
  )
  if (Number(total[0]!.n) > 0) {
    throw new Error(
      'Existen organizaciones pero ninguna activa; no creo una segunda. Reactive una en organizaciones.activo.',
    )
  }

  const { rows: creada } = await pool.query<Org>(
    `insert into organizaciones (nombre, estado_aprobacion, activo)
       values ($1, 'aprobada', true)
     on conflict (nombre) do nothing
     returning id, nombre`,
    [ORG_PLATAFORMA],
  )
  if (creada[0]) return creada[0]

  // Lost a race to another boot; read back the row it wrote.
  const { rows } = await pool.query<Org>('select id, nombre from organizaciones where nombre = $1', [
    ORG_PLATAFORMA,
  ])
  if (rows[0]) return rows[0]
  throw new Error('No se pudo crear ni encontrar la organización de plataforma.')
}

async function main() {
  const pool = getPool()

  const org = await organizacionDePlataforma()

  // The Alisio team, invited as platform admins. Idempotent on the address, keeping the platform
  // tier set — re-running leaves each person exactly as they were (`vincular_usuario_staff()`
  // answers 'ya_existe' once they have signed in). This is the whole of what production needs.
  const admins = administradores()
  for (const correo of admins) {
    await pool.query(
      `insert into invitaciones_staff (correo, rol_staff, organizacion_id, es_plataforma)
         values ($1, 'admin', $2, true)
       on conflict (correo) where correo is not null
         do update set rol_staff = excluded.rol_staff, es_plataforma = excluded.es_plataforma`,
      [correo, org.id],
    )
  }

  console.log(`\nPlataforma lista en «${org.nombre}»:\n`)
  for (const correo of admins) {
    console.log(`  ${'plataforma'.padEnd(12)} ${correo}  (admin de plataforma)`)
  }
  console.log(
    `\nSon invitaciones, no cuentas: cada persona entra desde /entrar pidiendo un enlace y queda` +
      `\ncreada al abrirlo — el mismo camino que sigue una coordinadora real. No hay atajo de` +
      `\ninicio de sesión.\n`,
  )
}

main()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error)
    await closeDb()
    process.exit(1)
  })
