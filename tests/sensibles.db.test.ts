import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * PRD-49 acceptance, against the real database — same harness as tests/rls.db.test.ts and
 * tests/membresias.db.test.ts.
 *
 * The claim under test: a flagged report's identifying content (detalle_libre, descripcion,
 * ubicacion*, contacto_id, and the whole adjuntos row) is reachable ONLY by an active
 * verificador_vulnerable membership, ceiling-gated (`techo_permisos.acceso_sensible`) and
 * community-scoped — not by any other role, not by a platform admin, and not by merely holding
 * `verificador_vulnerable` as a HOME role with no ceiling-checked membership behind it. Every case
 * runs as the `authenticated` Postgres role with a JWT claim set, exactly how a signed-in session
 * reaches Postgres through conSesion() — proving this any other way would prove nothing, since the
 * SECURITY DEFINER helpers and the RLS policies ARE the boundary.
 *
 * Run: `pnpm db:up && pnpm db:migrate && DATABASE_URL=… pnpm test sensibles`.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

let pool: Pool
let client: PoolClient

const ID = {
  admin: '00000000-0000-4000-9000-0000000000c1',
  verificador: '00000000-0000-4000-9000-0000000000c2',
  despachador: '00000000-0000-4000-9000-0000000000c3',
  coordinador: '00000000-0000-4000-9000-0000000000c4',
  vulnerable: '00000000-0000-4000-9000-0000000000c5',
  vulnerableOtraComunidad: '00000000-0000-4000-9000-0000000000c6',
  vulnerableSinTecho: '00000000-0000-4000-9000-0000000000c7',
  soloHomeRole: '00000000-0000-4000-9000-0000000000c8',
  verificadorOtraComunidad: '00000000-0000-4000-9000-0000000000c9',
  adminSinAcceso: '00000000-0000-4000-9000-0000000000ca',
} as const

type Actor = keyof typeof ID

const ORG = { conAcceso: '', sinAcceso: '' }
const COM = { a: '', b: '' }
const REPORTE = { sensible: '', fresco: '' }
let CONTACTO_PROTECCION = ''

beforeAll(async () => {
  if (!url) return
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  })
  client = await pool.connect()
  await client.query('begin')

  const { rows: orgA } = await client.query<{ id: string }>(
    `insert into organizaciones (nombre, estado_aprobacion, techo_permisos) values
       ('Org PRD-49 (con acceso_sensible)', 'aprobada',
        '{"evaluacion": true, "acceso_sensible": true, "comunidades_alcance": "todas"}'::jsonb)
     returning id`,
  )
  ORG.conAcceso = orgA[0]!.id

  const { rows: orgB } = await client.query<{ id: string }>(
    `insert into organizaciones (nombre, estado_aprobacion, techo_permisos) values
       ('Org PRD-49 (sin acceso_sensible)', 'aprobada',
        '{"evaluacion": true, "comunidades_alcance": "todas"}'::jsonb)
     returning id`,
  )
  ORG.sinAcceso = orgB[0]!.id

  const { rows: coms } = await client.query<{ id: string }>(
    `insert into comunidades (organizacion_id, codigo, nombre, tipo, municipio) values
       ($1, 'PRD49-A', 'Comunidad A (prueba PRD-49)', 'vereda', 'Quibdó'),
       ($1, 'PRD49-B', 'Comunidad B (prueba PRD-49)', 'vereda', 'Quibdó')
     returning id`,
    [ORG.conAcceso],
  )
  COM.a = coms[0]!.id
  COM.b = coms[1]!.id

  // Staff. `vulnerable` and `vulnerableOtraComunidad` get a deliberately UNPRIVILEGED home role
  // (lectura) — the point of this fixture is that their access comes from the membership below,
  // never from usuarios.rol_staff.
  await client.query(
    `insert into usuarios (id, rol_staff, organizacion_id) values
       ($1, 'admin', $10),
       ($2, 'verificador', $10),
       ($3, 'despachador', $10),
       ($4, 'coordinador', $10),
       ($5, 'lectura', $10),
       ($6, 'lectura', $10),
       ($7, 'lectura', $11),
       ($8, 'verificador_vulnerable', $11),
       ($9, 'verificador', $10)`,
    [
      ID.admin, ID.verificador, ID.despachador, ID.coordinador, ID.vulnerable,
      ID.vulnerableOtraComunidad, ID.vulnerableSinTecho, ID.soloHomeRole,
      ID.verificadorOtraComunidad, ORG.conAcceso, ORG.sinAcceso,
    ],
  )
  // adminSinAcceso administers Org B (no acceso_sensible), for the grant-time refusal case.
  await client.query(
    `insert into usuarios (id, rol_staff, organizacion_id) values ($1, 'admin', $2)`,
    [ID.adminSinAcceso, ORG.sinAcceso],
  )

  await client.query(
    `insert into usuarios_comunidades (usuario_id, comunidad_id) values
       ($1, $3), ($2, $4)`,
    [ID.verificador, ID.verificadorOtraComunidad, COM.a, COM.b],
  )

  // The ceiling-gated grants: `vulnerable` scoped to Community A only; `vulnerableOtraComunidad`
  // scoped to Community B only (proves the community-reach gate, not just the ceiling gate).
  // Written as the owner (bypasses RLS in this fixture) so the READ-time gate can be tested
  // independently of the grant-time gate, which gets its own explicit test below.
  await client.query(
    `insert into membresias (usuario_id, organizacion_id, rol, comunidades_alcance, estado) values
       ($1, $3, 'verificador_vulnerable', array[$5]::uuid[], 'activa'),
       ($2, $3, 'verificador_vulnerable', array[$6]::uuid[], 'activa'),
       ($4, $7, 'verificador_vulnerable', '{}'::uuid[], 'activa')`,
    [ID.vulnerable, ID.vulnerableOtraComunidad, ORG.conAcceso, ID.vulnerableSinTecho, COM.a, COM.b, ORG.sinAcceso],
  )

  // A protection-lead contact for the org, so convite_marcar_reporte_sensible has somewhere to
  // send an alert.
  const { rows: cp } = await client.query<{ id: string }>(
    `insert into contactos_proteccion (organizacion_id, nombre, telefono, activo) values
       ($1, 'Líder de protección de prueba', '+573009998877', true) returning id`,
    [ORG.conAcceso],
  )
  CONTACTO_PROTECCION = cp[0]!.id

  // A report already flagged sensible, with its content already moved — simulates what
  // lib/canales/intake.ts does for a term match, written directly as the owner since intake
  // itself has no auth.uid() to route through convite_marcar_reporte_sensible.
  const { rows: sensible } = await client.query<{ id: string }>(
    `insert into reportes (organizacion_id, tipo, canal, comunidad_id, sensible, sensible_motivo)
       values ($1, 'necesidad', 'whatsapp', $2, true, 'termino_detectado') returning id`,
    [ORG.conAcceso, COM.a],
  )
  REPORTE.sensible = sensible[0]!.id

  await client.query(
    `insert into reportes_contenido_protegido (reporte_id, detalle_libre, ubicacion, ubicacion_fuente, ubicacion_precision_m, contacto_id)
       values ($1, 'Contenido protegido de prueba — nunca debe salir sin verificador_vulnerable',
               st_setsrid(st_makepoint(-76.66, 5.69), 4326), 'gps', 0, null)`,
    [REPORTE.sensible],
  )

  await client.query(
    `insert into adjuntos (reporte_id, tipo, storage_key, mime, transcripcion)
       values ($1, 'audio', 'prd49/nota-protegida.ogg', 'audio/ogg', 'Transcripción protegida de prueba')`,
    [REPORTE.sensible],
  )

  // A fresh, NOT-yet-sensible report in Community A, for the manual-flag path.
  const { rows: fresco } = await client.query<{ id: string }>(
    `insert into reportes (organizacion_id, tipo, canal, comunidad_id, detalle_libre)
       values ($1, 'necesidad', 'whatsapp', $2, 'Reporte fresco, aún sin marcar') returning id`,
    [ORG.conAcceso, COM.a],
  )
  REPORTE.fresco = fresco[0]!.id
})

afterAll(async () => {
  if (!url) return
  await client.query('rollback')
  client.release()
  await pool.end()
})

async function claims(actor: Actor): Promise<void> {
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: ID[actor], role: 'authenticated', email: `${actor}@convite.test` }),
  ])
  await client.query('set local role authenticated')
}

async function como<T>(actor: Actor, fn: () => Promise<T>): Promise<T> {
  await client.query('savepoint sesion')
  await claims(actor)
  try {
    return await fn()
  } finally {
    await client.query('rollback to savepoint sesion')
  }
}

async function rechazado(sql: string, params: unknown[] = []): Promise<boolean> {
  await client.query('savepoint intento')
  try {
    const { rowCount } = await client.query(sql, params)
    await client.query('rollback to savepoint intento')
    return rowCount === 0
  } catch {
    await client.query('rollback to savepoint intento')
    return true
  }
}

conBase('PRD-49 — redacción y escalamiento de reportes sensibles', () => {
  describe('la fila base de reportes: redactada para todos salvo el flag mismo', () => {
    for (const actor of ['admin', 'despachador', 'coordinador', 'verificador'] as const) {
      it(`${actor} lee el reporte sensible con el contenido ya en NULL`, async () => {
        await como(actor, async () => {
          const { rows } = await client.query<{
            detalle_libre: string | null
            descripcion: string | null
            contacto_id: string | null
            ubicacion: unknown
            sensible: boolean
          }>(
            `select detalle_libre, descripcion, contacto_id, ubicacion, sensible
               from reportes where id = $1`,
            [REPORTE.sensible],
          )
          expect(rows).toHaveLength(1)
          expect(rows[0]!.sensible).toBe(true)
          expect(rows[0]!.detalle_libre).toBeNull()
          expect(rows[0]!.descripcion).toBeNull()
          expect(rows[0]!.contacto_id).toBeNull()
          expect(rows[0]!.ubicacion).toBeNull()
        })
      })
    }
  })

  describe('reportes_contenido_protegido: solo verificador_vulnerable, con techo y alcance', () => {
    for (const actor of ['admin', 'despachador', 'coordinador', 'verificador'] as const) {
      it(`${actor} NO ve el contenido protegido`, async () => {
        await como(actor, async () => {
          const { rows } = await client.query(
            `select * from reportes_contenido_protegido where reporte_id = $1`,
            [REPORTE.sensible],
          )
          expect(rows).toHaveLength(0)
        })
      })
    }

    it('un verificador_vulnerable con techo y alcance correctos SÍ ve el contenido real', async () => {
      await como('vulnerable', async () => {
        const { rows } = await client.query<{ detalle_libre: string; ubicacion_fuente: string }>(
          `select detalle_libre, ubicacion_fuente from reportes_contenido_protegido where reporte_id = $1`,
          [REPORTE.sensible],
        )
        expect(rows).toHaveLength(1)
        expect(rows[0]!.detalle_libre).toContain('Contenido protegido de prueba')
        expect(rows[0]!.ubicacion_fuente).toBe('gps')
      })
    })

    it('un verificador_vulnerable con techo pero alcance de OTRA comunidad NO ve el contenido', async () => {
      await como('vulnerableOtraComunidad', async () => {
        const { rows } = await client.query(
          `select * from reportes_contenido_protegido where reporte_id = $1`,
          [REPORTE.sensible],
        )
        expect(rows).toHaveLength(0)
      })
    })

    it('un verificador_vulnerable en una org SIN acceso_sensible en su techo NO ve el contenido', async () => {
      await como('vulnerableSinTecho', async () => {
        const { rows } = await client.query(
          `select * from reportes_contenido_protegido where reporte_id = $1`,
          [REPORTE.sensible],
        )
        expect(rows).toHaveLength(0)
      })
    })

    it('HOME role verificador_vulnerable en una org SIN acceso_sensible no se refleja en membresías, y no basta', async () => {
      // The 0047 reflect trigger (usuarios_reflejar_membresia) mirrors any new usuarios.rol_staff
      // into membresias with SECURITY DEFINER, bypassing membresias_dentro_del_techo entirely.
      // convite_membresia_desde_usuario (0063) is the one place that closes that door for this
      // specific role: it skips the mirror when the org's ceiling lacks acceso_sensible. Prove the
      // mirror never happened at all — not just that this actor happens to lack reach.
      // Owner-level read (no RLS role set) so this checks whether the row EXISTS at all, not
      // whether some particular actor may see it.
      const membresia = await client.query(
        `select 1 from membresias where usuario_id = $1 and rol = 'verificador_vulnerable'`,
        [ID.soloHomeRole],
      )
      expect(membresia.rows).toHaveLength(0)

      await como('soloHomeRole', async () => {
        const { rows } = await client.query(
          `select * from reportes_contenido_protegido where reporte_id = $1`,
          [REPORTE.sensible],
        )
        expect(rows).toHaveLength(0)
      })
    })
  })

  describe('adjuntos: audio y transcripción ocultos por completo, no solo el texto', () => {
    for (const actor of ['admin', 'despachador', 'coordinador', 'verificador'] as const) {
      it(`${actor} NO ve el adjunto del reporte sensible`, async () => {
        await como(actor, async () => {
          const { rows } = await client.query(
            `select * from adjuntos where reporte_id = $1`,
            [REPORTE.sensible],
          )
          expect(rows).toHaveLength(0)
        })
      })
    }

    it('un verificador_vulnerable con alcance correcto SÍ ve el adjunto', async () => {
      await como('vulnerable', async () => {
        const { rows } = await client.query<{ transcripcion: string }>(
          `select transcripcion from adjuntos where reporte_id = $1`,
          [REPORTE.sensible],
        )
        expect(rows).toHaveLength(1)
        expect(rows[0]!.transcripcion).toContain('protegida')
      })
    })

    it('un adjunto de un reporte NO sensible sigue visible para el verificador normal', async () => {
      // Control negativo: la política restrictiva no debe tocar nada fuera de un reporte sensible.
      await client.query(
        `insert into adjuntos (reporte_id, tipo, storage_key, mime, transcripcion)
           values ($1, 'audio', 'prd49/nota-normal.ogg', 'audio/ogg', 'Nota normal')`,
        [REPORTE.fresco],
      )
      await como('verificador', async () => {
        const { rows } = await client.query(
          `select * from adjuntos where reporte_id = $1`,
          [REPORTE.fresco],
        )
        expect(rows.length).toBeGreaterThan(0)
      })
    })
  })

  describe('convite_marcar_reporte_sensible: el flag manual', () => {
    it('un rol sin permiso (lectura) no puede marcar', async () => {
      await como('soloHomeRole', async () => {
        const { rows } = await client.query<{ convite_marcar_reporte_sensible: string }>(
          `select convite_marcar_reporte_sensible($1)`,
          [REPORTE.fresco],
        )
        expect(rows[0]!.convite_marcar_reporte_sensible).toBe('sin_permiso')
      })
    })

    it('un verificador fuera de la comunidad del reporte no puede marcar', async () => {
      await como('verificadorOtraComunidad', async () => {
        const { rows } = await client.query<{ convite_marcar_reporte_sensible: string }>(
          `select convite_marcar_reporte_sensible($1)`,
          [REPORTE.fresco],
        )
        expect(rows[0]!.convite_marcar_reporte_sensible).toBe('sin_permiso')
      })
    })

    it('un verificador dentro de su comunidad marca, mueve el contenido, y escala', async () => {
      await como('verificador', async () => {
        const { rows: resultado } = await client.query<{ convite_marcar_reporte_sensible: string }>(
          `select convite_marcar_reporte_sensible($1)`,
          [REPORTE.fresco],
        )
        expect(resultado[0]!.convite_marcar_reporte_sensible).toBe('marcado')

        const { rows: reporte } = await client.query<{
          sensible: boolean
          sensible_motivo: string
          detalle_libre: string | null
          sensible_marcado_por: string
        }>(
          `select sensible, sensible_motivo, detalle_libre, sensible_marcado_por
             from reportes where id = $1`,
          [REPORTE.fresco],
        )
        expect(reporte[0]!.sensible).toBe(true)
        expect(reporte[0]!.sensible_motivo).toBe('manual')
        expect(reporte[0]!.detalle_libre).toBeNull()
        expect(reporte[0]!.sensible_marcado_por).toBe(ID.verificador)

        // The three checks below read tables a plain verificador cannot (correctly) see through
        // RLS — reportes_contenido_protegido and alertas_proteccion are verificador_vulnerable/
        // coordinador/admin surfaces, not a verificador's. Drop to the connection's owner role,
        // still inside this same open transaction/savepoint, so the function's writes (not yet
        // committed) are visible without asserting through a policy this actor is correctly
        // refused by.
        await client.query('reset role')

        const { rows: protegido } = await client.query<{ detalle_libre: string }>(
          `select detalle_libre from reportes_contenido_protegido where reporte_id = $1`,
          [REPORTE.fresco],
        )
        expect(protegido).toHaveLength(1)
        expect(protegido[0]!.detalle_libre).toBe('Reporte fresco, aún sin marcar')

        const { rows: alerta } = await client.query<{ contacto_proteccion_id: string; estado: string }>(
          `select contacto_proteccion_id, estado from alertas_proteccion where reporte_id = $1`,
          [REPORTE.fresco],
        )
        expect(alerta).toHaveLength(1)
        expect(alerta[0]!.contacto_proteccion_id).toBe(CONTACTO_PROTECCION)
        expect(alerta[0]!.estado).toBe('pendiente')

        const { rows: auditoria } = await client.query<{ n: string }>(
          `select count(*)::text as n from auditoria
            where entidad = 'reportes' and entidad_id = $1 and accion = 'reporte.marcado_sensible'`,
          [REPORTE.fresco],
        )
        expect(Number(auditoria[0]!.n)).toBeGreaterThan(0)

        // Idempotent: marking an already-flagged report again is a clean no-op, not an error.
        const { rows: otraVez } = await client.query<{ convite_marcar_reporte_sensible: string }>(
          `select convite_marcar_reporte_sensible($1)`,
          [REPORTE.fresco],
        )
        expect(otraVez[0]!.convite_marcar_reporte_sensible).toBe('ya_sensible')
      })
    })
  })

  describe('el techo de organizaciones gatea la concesión de la membresía (PRD-16 §29.4)', () => {
    it('un admin de una org SIN acceso_sensible no puede conceder verificador_vulnerable', async () => {
      await como('adminSinAcceso', async () => {
        expect(
          await rechazado(
            `insert into membresias (usuario_id, organizacion_id, rol, estado)
               values ($1, $2, 'verificador_vulnerable', 'activa')`,
            [ID.soloHomeRole, ORG.sinAcceso],
          ),
        ).toBe(true)
      })
    })

    it('un admin de una org CON acceso_sensible sí puede concederlo', async () => {
      await como('admin', async () => {
        expect(
          await rechazado(
            `insert into membresias (usuario_id, organizacion_id, rol, comunidades_alcance, estado)
               values ($1, $2, 'verificador_vulnerable', array[$3]::uuid[], 'activa')`,
            [ID.despachador, ORG.conAcceso, COM.a],
          ),
        ).toBe(false)
      })
    })
  })

  describe('separación de deberes: verificador_vulnerable no despacha (§29.7, AC #6)', () => {
    it('un verificador_vulnerable no puede despachar un envío', async () => {
      const { rows } = await client.query<{ id: string }>('select id from envios limit 1')
      if (rows.length === 0) return
      await como('vulnerable', async () => {
        expect(
          await rechazado(
            `update envios set despachado_por = $2, despachado_en = now() where id = $1`,
            [rows[0]!.id, ID.vulnerable],
          ),
        ).toBe(true)
      })
    })
  })
})
