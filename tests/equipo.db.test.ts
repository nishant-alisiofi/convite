import { Pool } from 'pg'
import type { PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * `convite_equipo()` (0061), against the real database.
 *
 * Open sign-in (0035) means a `usuarios` row can exist with no `invitaciones_staff` row at
 * all — an uninvited admin who only proved possession of an address. `/equipo` used to list
 * `invitaciones_staff` alone, so that account had panel access and no row anywhere to
 * deactivate. This proves the fix: the uninvited row shows up next to the invited ones, is
 * scoped to its own organisation, hides platform-tier rows the same as before, and its
 * `usuarios.activo` flag — the same column the page's own «Desactivar» button flips — actually
 * changes what the listing reports.
 *
 * Everything happens inside one transaction, rolled back in `afterAll`; each case runs inside
 * a savepoint the way tests/jerarquia.db.test.ts does, so a refusal that aborts the statement
 * does not poison the next assertion.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

let pool: Pool
let client: PoolClient

const ID = {
  adminOrgA: '00000000-0000-4000-9100-0000000000a1',
  autoAdminOrgA: '00000000-0000-4000-9100-0000000000a2',
  coordinadorOrgA: '00000000-0000-4000-9100-0000000000a3',
  plataformaOrgA: '00000000-0000-4000-9100-0000000000a4',
  adminOrgB: '00000000-0000-4000-9100-0000000000b1',
  autoAdminOrgB: '00000000-0000-4000-9100-0000000000b2',
} as const

type Actor = keyof typeof ID

const ORG = { a: '', b: '' }

beforeAll(async () => {
  if (!url) return
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  })
  client = await pool.connect()
  await client.query('begin')

  const { rows } = await client.query<{ id: string }>(
    'select id from organizaciones order by creado_en limit 1',
  )
  ORG.a = rows[0]!.id

  const { rows: b } = await client.query<{ id: string }>(
    `insert into organizaciones (nombre, estado_aprobacion, activo)
       values ('Centro B (prueba equipo)', 'aprobada', true)
     returning id`,
  )
  ORG.b = b[0]!.id

  // Org A: an admin (the caller who manages the team), a coordinador (not allowed to manage
  // it), a platform admin (excluded from the per-org listing, same as before), and — the case
  // this migration exists for — an open-sign-in admin with no invitation anywhere.
  await client.query(
    `insert into usuarios (id, rol_staff, organizacion_id, es_plataforma, activo) values
       ($1, 'admin', $5, false, true),
       ($2, 'admin', $5, false, true),
       ($3, 'coordinador', $5, false, true),
       ($4, 'admin', $5, true, true)`,
    [ID.adminOrgA, ID.autoAdminOrgA, ID.coordinadorOrgA, ID.plataformaOrgA, ORG.a],
  )
  await client.query(
    `insert into auth_user (id, nombre, correo, correo_verificado) values
       ($1, 'Admin sin invitación (org A)', 'auto-orga@convite.test', true)`,
    [ID.autoAdminOrgA],
  )

  // A still-pending invitation in org A — proves the union does not drop the case
  // `invitaciones_staff` already covered.
  await client.query(
    `insert into invitaciones_staff (correo, rol_staff, organizacion_id)
       values ($1, 'verificador', $2)`,
    ['pendiente-orga@convite.test', ORG.a],
  )

  // Org B: its own admin and its own open-sign-in admin — proves the listing does not leak
  // across organisations.
  await client.query(
    `insert into usuarios (id, rol_staff, organizacion_id, es_plataforma, activo) values
       ($1, 'admin', $3, false, true),
       ($2, 'admin', $3, false, true)`,
    [ID.adminOrgB, ID.autoAdminOrgB, ORG.b],
  )
  await client.query(
    `insert into auth_user (id, nombre, correo, correo_verificado) values
       ($1, 'Admin sin invitación (org B)', 'auto-orgb@convite.test', true)`,
    [ID.autoAdminOrgB],
  )
})

afterAll(async () => {
  if (!url) return
  await client.query('rollback')
  client.release()
  await pool.end()
})

/** Runs `fn` as a signed-in session for `actor`, then unwinds to before it. */
async function como<T>(actor: Actor, fn: () => Promise<T>): Promise<T> {
  await client.query('savepoint sesion')
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: ID[actor], role: 'authenticated', email: `${actor}@convite.test` }),
  ])
  await client.query('set local role authenticated')
  try {
    return await fn()
  } finally {
    await client.query('rollback to savepoint sesion')
  }
}

type FilaEquipo = {
  id: string
  correo: string | null
  telefono: string | null
  rol_staff: string
  usado_en: Date | null
  usuario_id: string | null
  usuario_activo: boolean | null
}

async function equipo(): Promise<FilaEquipo[]> {
  const { rows } = await client.query<FilaEquipo>('select * from convite_equipo()')
  return rows
}

conBase('convite_equipo() (§29.6 offboarding surface, 0061)', () => {
  it('lista al admin sin invitación (0035) junto con los invitados de su organización', async () => {
    await como('adminOrgA', async () => {
      const filas = await equipo()
      const correos = filas.map((f) => f.correo)

      expect(correos).toContain('auto-orga@convite.test')
      expect(correos).toContain('pendiente-orga@convite.test')

      const autoAdmin = filas.find((f) => f.correo === 'auto-orga@convite.test')!
      expect(autoAdmin.usuario_id).toBe(ID.autoAdminOrgA)
      expect(autoAdmin.usuario_activo).toBe(true)
      // Nunca se le exigió a nadie que pasara por invitaciones_staff.
      expect(autoAdmin.usado_en).toBeNull()

      const pendiente = filas.find((f) => f.correo === 'pendiente-orga@convite.test')!
      expect(pendiente.usuario_id).toBeNull()
    })
  })

  it('nunca incluye el nivel plataforma (§2.5), igual que la consulta que reemplaza', async () => {
    await como('adminOrgA', async () => {
      const filas = await equipo()
      expect(filas.some((f) => f.usuario_id === ID.plataformaOrgA)).toBe(false)
    })
  })

  it('no cruza organizaciones: el admin de la org A no ve a la B ni viceversa', async () => {
    await como('adminOrgA', async () => {
      const correos = (await equipo()).map((f) => f.correo)
      expect(correos).not.toContain('auto-orgb@convite.test')
    })

    await como('adminOrgB', async () => {
      const correos = (await equipo()).map((f) => f.correo)
      expect(correos).toContain('auto-orgb@convite.test')
      expect(correos).not.toContain('auto-orga@convite.test')
      expect(correos).not.toContain('pendiente-orga@convite.test')
    })
  })

  it('un coordinador no gestiona el equipo: la función se lo niega', async () => {
    await como('coordinadorOrgA', async () => {
      await expect(equipo()).rejects.toThrow(/Solo el admin/)
    })
  })

  it('desactivar la fila usuarios del admin sin invitación se refleja en el listado', async () => {
    await como('adminOrgA', async () => {
      // La misma escritura que dispara el botón «Desactivar» de /equipo.
      await client.query('update usuarios set activo = false where id = $1', [ID.autoAdminOrgA])

      const autoAdmin = (await equipo()).find((f) => f.correo === 'auto-orga@convite.test')!
      expect(autoAdmin.usuario_activo).toBe(false)
    })

    // La desactivación no sobrevive fuera de esa sesión: cada `como()` se revierte a su
    // savepoint, así que la siguiente prueba parte de nuevo con la cuenta activa.
    await como('adminOrgA', async () => {
      const autoAdmin = (await equipo()).find((f) => f.correo === 'auto-orga@convite.test')!
      expect(autoAdmin.usuario_activo).toBe(true)
    })
  })
})
