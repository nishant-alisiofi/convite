import 'dotenv/config'
import { closeDb, getPool } from '@/db/client'
import { ROLES_STAFF } from '@/db/schema/vocabulario'

/**
 * Puts an address on the staff allowlist so that person can sign in.
 *
 *   pnpm invitar rosa@example.org coordinador
 *   pnpm invitar nubia@example.org verificador TAG,MER,BET
 *
 * This is the bootstrap path: the first admin has to be created from a terminal, because
 * there is nobody logged in yet to invite them. Everyone after that gets invited from the
 * Comunidades/Usuarios screen once it exists.
 */
async function main() {
  const [correoCrudo, rol, comunidades] = process.argv.slice(2)
  const correo = correoCrudo?.trim().toLowerCase()

  if (!correo || !correo.includes('@') || !rol) {
    console.error('Uso: pnpm invitar <correo> <rol> [CODIGOS,DE,COMUNIDAD]')
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

  const { rows } = await pool.query<{ id: string }>(
    `insert into invitaciones_staff (correo, rol_staff, organizacion_id)
       values ($1, $2, $3)
     on conflict (correo) do update set rol_staff = excluded.rol_staff
     returning id`,
    [correo, rol, org.id],
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

  console.log(`\n${correo} queda habilitado como ${rol} en «${org.nombre}».`)
  console.log('Ya puede entrar con el enlace mágico desde /entrar.\n')
}

main()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error)
    await closeDb()
    process.exit(1)
  })
