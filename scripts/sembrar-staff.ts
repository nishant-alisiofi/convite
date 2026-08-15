import 'dotenv/config'
import { closeDb, getPool } from '@/db/client'
import { ROLES_STAFF, type RolStaff } from '@/db/schema/vocabulario'

/**
 * Puts one invitation on the allowlist for every staff role, so a deployment can be shown
 * to somebody.
 *
 *   pnpm sembrar:staff
 *   CORREO_BASE=alguien@ejemplo.org pnpm sembrar:staff
 *
 * This is `pnpm invitar` five times with addresses we control, not a new mechanism. It
 * creates **invitations, not accounts**: nobody exists until they ask for a link and click
 * it, at which point `vincular_usuario_staff()` reads the invitation and writes the
 * `usuarios` row with the role set here. That is the same path a real coordinator takes,
 * which is the point — a demo login that skipped it would be demonstrating something else.
 *
 * There is deliberately no way to sign in without the email round trip. A «log in as this
 * seeded user» shortcut is the kind of thing that gets added for a demo, guarded by an
 * environment variable, and is still there two years later; for a product holding the
 * locations of displaced families the answer is no. Retrieving the link is documented in
 * docs/despliegue.md.
 *
 * Plus-addressing keeps every one of these deliverable to a single real inbox while staying
 * distinct to Postgres, which is what lets one person hold five roles at once.
 */

/** Gmail-style plus-addressing: all five land in the same inbox, all five are distinct. */
const CORREO_BASE = process.env.CORREO_BASE ?? 'talos@downshiftit.com'

function direccionPara(rol: RolStaff): string {
  const [usuario, dominio] = CORREO_BASE.split('@')
  return `${usuario}+convite-${rol}@${dominio}`.toLowerCase()
}

/**
 * The verifier is scoped, like the seeded one: Section 11 says a `verificador` acts only
 * inside their own territory, and an unscoped one would demo a permission that does not
 * exist. The rest of the roles are not community-scoped at all.
 */
const COMUNIDADES_DEL_VERIFICADOR = ['TAG', 'MER', 'BET']

async function main() {
  if (!CORREO_BASE.includes('@')) {
    throw new Error(`CORREO_BASE no parece un correo: ${CORREO_BASE}`)
  }

  const pool = getPool()

  const { rows: orgs } = await pool.query<{ id: string; nombre: string }>(
    'select id, nombre from organizaciones where activo order by creado_en limit 1',
  )
  const org = orgs[0]
  if (!org) throw new Error("No hay ninguna organización. Corra 'pnpm db:seed' primero.")

  const puestos: { rol: RolStaff; correo: string; comunidades: number }[] = []

  for (const rol of ROLES_STAFF) {
    const correo = direccionPara(rol)

    // Idempotent on the address, like `pnpm invitar`: running this twice re-points the
    // invitation at the same role rather than colliding on the unique index.
    const { rows } = await pool.query<{ id: string }>(
      `insert into invitaciones_staff (correo, rol_staff, organizacion_id)
         values ($1, $2, $3)
       on conflict (correo) do update set rol_staff = excluded.rol_staff
       returning id`,
      [correo, rol, org.id],
    )
    const invitacion = rows[0]!.id

    let comunidades = 0
    if (rol === 'verificador') {
      const { rowCount } = await pool.query(
        `insert into invitaciones_comunidades (invitacion_id, comunidad_id)
         select $1, id from comunidades where codigo = any($2::text[])
         on conflict do nothing`,
        [invitacion, COMUNIDADES_DEL_VERIFICADOR],
      )
      comunidades = rowCount ?? 0
    }

    puestos.push({ rol, correo, comunidades })
  }

  console.log(`\nInvitaciones listas en «${org.nombre}»:\n`)
  for (const { rol, correo, comunidades } of puestos) {
    const alcance = comunidades > 0 ? `  (${comunidades} comunidades)` : ''
    console.log(`  ${rol.padEnd(12)} ${correo}${alcance}`)
  }
  console.log(
    `\nCada uno entra desde /entrar pidiendo su enlace. Todavía no existe ninguna cuenta:` +
      `\nse crean al abrir el enlace, que es el mismo camino que sigue una coordinadora real.\n`,
  )
}

main()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error)
    await closeDb()
    process.exit(1)
  })
