import 'dotenv/config'
import { closeDb, getPool } from '@/db/client'
import { ROLES_STAFF } from '@/db/schema/vocabulario'
import { aE164 } from '@/lib/canales'

/**
 * Puts an address or a WhatsApp number on the staff allowlist so that person can sign in.
 *
 *   pnpm invitar rosa@example.org coordinador
 *   pnpm invitar +573001112233 coordinador
 *   pnpm invitar nubia@example.org verificador TAG,MER,BET
 *
 * Either identifier works, and which one you give decides which door that person uses. In the
 * basin the number is usually the better answer: WhatsApp works where email does not, and it
 * is the channel the rest of this product already runs on.
 *
 * This is the bootstrap path: the first admin has to be created from a terminal, because
 * there is nobody logged in yet to invite them. Everyone after that gets invited from the
 * Comunidades/Usuarios screen once it exists.
 */

/** Decides which column the identifier belongs in. An address has an @; a number does not. */
function clasificar(valor: string): { correo: string | null; telefono: string | null } {
  if (valor.includes('@')) return { correo: valor.trim().toLowerCase(), telefono: null }
  const telefono = aE164(valor)
  return /^\+[1-9][0-9]{7,14}$/.test(telefono)
    ? { correo: null, telefono }
    : { correo: null, telefono: null }
}

async function main() {
  const [identificador, rol, comunidades] = process.argv.slice(2)
  const { correo, telefono } = clasificar(identificador ?? '')

  if ((!correo && !telefono) || !rol) {
    console.error('Uso: pnpm invitar <correo|telefono> <rol> [CODIGOS,DE,COMUNIDAD]')
    console.error('  pnpm invitar rosa@example.org coordinador')
    console.error('  pnpm invitar +573001112233 coordinador')
    console.error(`Roles: ${ROLES_STAFF.join(' · ')}`)
    process.exit(1)
  }
  if (!(ROLES_STAFF as readonly string[]).includes(rol)) {
    console.error(`Rol desconocido: ${rol}. Use uno de: ${ROLES_STAFF.join(' · ')}`)
    process.exit(1)
  }

  const pool = getPool()
  const { rows: orgs } = await pool.query<{ id: string; nombre: string }>(
    'select id, nombre from organizaciones where activo order by creado_en limit 1',
  )
  const org = orgs[0]
  if (!org) throw new Error("No hay ninguna organización. Corra 'pnpm db:seed' primero.")

  // Two partial unique indexes since 0029 (one per identifier, each `where … is not null`),
  // so the conflict target has to name the one this invitation actually uses.
  const { rows } = await pool.query<{ id: string }>(
    correo
      ? `insert into invitaciones_staff (correo, rol_staff, organizacion_id)
           values ($1, $2, $3)
         on conflict (correo) where correo is not null
           do update set rol_staff = excluded.rol_staff
         returning id`
      : `insert into invitaciones_staff (telefono, rol_staff, organizacion_id)
           values ($1, $2, $3)
         on conflict (telefono) where telefono is not null
           do update set rol_staff = excluded.rol_staff
         returning id`,
    [correo ?? telefono, rol, org.id],
  )
  const invitacionId = rows[0]!.id

  if (comunidades) {
    const codigos = comunidades.split(',').map((c) => c.trim().toUpperCase())
    const { rowCount } = await pool.query(
      `insert into invitaciones_comunidades (invitacion_id, comunidad_id)
       select $1, id from comunidades where codigo = any($2::text[])
       on conflict do nothing`,
      [invitacionId, codigos],
    )
    console.log(`  ${rowCount} comunidad(es) asignada(s): ${codigos.join(', ')}`)
  }

  console.log(`\n${correo ?? telefono} queda habilitado como ${rol} en «${org.nombre}».`)
  console.log(
    correo
      ? 'Ya puede entrar con el enlace mágico desde /entrar.\n'
      : 'Ya puede entrar pidiendo un código por WhatsApp desde /entrar.\n',
  )
}

main()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error)
    await closeDb()
    process.exit(1)
  })
