import 'dotenv/config'
import { closeDb, getPool } from '@/db/client'
import { ROLES_STAFF, type RolStaff } from '@/db/schema/vocabulario'
import { administradores } from '@/scripts/lib/administradores'

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

/** Gmail-style plus-addressing: every rig lands in the same inbox, and every one is distinct. */
const CORREO_BASE = process.env.CORREO_BASE ?? 'talos@downshiftit.com'

/** talos+convite-<sufijo>@… — one address per rig, all reaching one inbox, CORREO_BASE overrides. */
function direccionCon(sufijo: string): string {
  const [usuario, dominio] = CORREO_BASE.split('@')
  return `${usuario}+convite-${sufijo}@${dominio}`.toLowerCase()
}

function direccionPara(rol: RolStaff): string {
  return direccionCon(rol)
}

/**
 * The verifier is scoped, like the seeded one: Section 11 says a `verificador` acts only
 * inside their own territory, and an unscoped one would demo a permission that does not
 * exist. The rest of the roles are not community-scoped at all.
 */
// PRD-39: registry codes (db/seed/territorio.sql), not the old demo short codes —
// Tagachí, Las Mercedes, Beté. The community set is now the real registry alone.
const COMUNIDADES_DEL_VERIFICADOR = ['CH-QUI-TAG', 'CH-QUI-MER', 'CH-MAT']

/**
 * One extra invitation, by number instead of address, so the WhatsApp door is demonstrable too.
 *
 * Deliberately a separate person rather than a phone added to one of the five above: an
 * invitation links to exactly one staff record (0029), so giving a seeded role both identifiers
 * would mean whichever door got used first won and the other answered «ya vinculada» — a
 * confusing thing to hit in a demo. `WHATSAPP_DEMO` overrides it with a number you can actually
 * receive on; the default is in Colombia's reserved test range and will never reach a handset.
 */
const TELEFONO_DEMO = process.env.WHATSAPP_DEMO ?? '+573000000100'

/**
 * Real people, as platform admins (§2.5), live in scripts/lib/administradores.ts — the same set
 * the production bootstrap (sembrar-plataforma.ts) invites. Different in kind from the rigs
 * above: those are plus-addressed and exist so a demo can show each role, all landing in one
 * shared inbox; these are addresses somebody actually reads. Staging only ever gets invitations
 * through this script, so an address not on that list cannot sign in here, however senior.
 */

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
       on conflict (correo) where correo is not null
         do update set rol_staff = excluded.rol_staff
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

  // The WhatsApp door, as a sixth invitation identified by number instead of address.
  await pool.query(
    `insert into invitaciones_staff (telefono, rol_staff, organizacion_id)
       values ($1, 'coordinador', $2)
     on conflict (telefono) where telefono is not null
       do update set rol_staff = excluded.rol_staff`,
    [TELEFONO_DEMO, org.id],
  )

  // A demo platform admin, so the platform tier (§2.5) is demonstrable from the talos inbox.
  // The only real platform admin is a personal address whose inbox we cannot read, so without
  // this the approve-centres flow cannot be shown from staging. Plus-addressed and idempotent
  // like the rigs above, but carrying the platform tier: es_plataforma = true, which
  // vincular_usuario_staff() copies onto the staff row. CORREO_BASE overrides it too.
  const correoPlataformaDemo = direccionCon('plataforma')
  await pool.query(
    `insert into invitaciones_staff (correo, rol_staff, organizacion_id, es_plataforma)
       values ($1, 'admin', $2, true)
     on conflict (correo) where correo is not null
       do update set rol_staff = excluded.rol_staff, es_plataforma = excluded.es_plataforma`,
    [correoPlataformaDemo, org.id],
  )

  // Real people. Same mechanism as everything above — an invitation, not an account. They
  // still have to ask for a link and open it, and re-running this leaves them exactly as
  // they were: `vincular_usuario_staff()` answers 'ya_existe' once they have signed in.
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

  console.log(`\nInvitaciones listas en «${org.nombre}»:\n`)
  for (const { rol, correo, comunidades } of puestos) {
    const alcance = comunidades > 0 ? `  (${comunidades} comunidades)` : ''
    console.log(`  ${rol.padEnd(12)} ${correo}${alcance}`)
  }
  console.log(`  ${'coordinador'.padEnd(12)} ${TELEFONO_DEMO}  (WhatsApp)`)
  console.log(`  ${'plataforma'.padEnd(12)} ${correoPlataformaDemo}  (demo, admin de plataforma)`)
  for (const correo of admins) {
    console.log(`  ${'plataforma'.padEnd(12)} ${correo}  (persona real, admin de plataforma)`)
  }

  console.log(
    `\nCada uno entra desde /entrar: los correos piden un enlace, el número pide un código.` +
      `\nTodavía no existe ninguna cuenta — se crean al usar el enlace o el código, que es el` +
      `\nmismo camino que sigue una coordinadora real.` +
      `\n\nSin WABA (D3) el código NO se manda: sale en el log del servidor. Para un número que` +
      `\nde verdad reciba, ponga WHATSAPP_DEMO y las credenciales de la WABA.\n`,
  )
}

main()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error)
    await closeDb()
    process.exit(1)
  })
