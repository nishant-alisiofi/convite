import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { recibirSms } from '@/lib/canales'
import { recibirSobre } from '@/lib/canales/intake'

/**
 * PRD-49 Scope §1 (the automated half) — against a real database, same harness as
 * tests/confirmacion.db.test.ts (also a direct `recibirSobre` caller).
 *
 * The claim under test: a term match at intake never lets the identifying text land on the
 * `reportes` row, even for an instant — it goes straight to `reportes_contenido_protegido`, the
 * base row is flagged and its columns are NULL from the moment it is first readable, and an
 * escalation signal is written in the same transaction. And, symmetrically: an EMPTY term list
 * (the real default — this is partner data nobody has supplied yet) never flags anything, so
 * intake's ordinary behaviour is provably unchanged when `terminos_riesgo` has zero rows.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

let pool: Pool
let client: PoolClient
let organizacion: string

const AHORA = new Date('2026-08-17T15:00:00Z')

beforeAll(async () => {
  if (!url) return
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  })
  client = await pool.connect()
  await client.query('begin')

  const { rows: orgs } = await client.query<{ id: string }>('select id from organizaciones limit 1')
  organizacion = orgs[0]!.id

  await client.query('savepoint caso')
})

afterAll(async () => {
  if (!url) return
  await client.query('rollback')
  client.release()
  await pool.end()
})

beforeEach(async () => {
  if (!url) return
  await client.query('rollback to savepoint caso')
})

let n = 0
function smsDe(texto: string) {
  n += 1
  return recibirSms({ id: `sms-prd49-${n}`, de: '+573001112233', texto }, AHORA)
}

conBase('PRD-49 — el matcher de términos de riesgo en la ingesta', () => {
  it('con la lista vacía (el default real) nada se marca sensible', async () => {
    const sobre = smsDe('necesito ayuda con mercados para mi familia')
    const resultado = await recibirSobre(client, sobre, organizacion, {
      ahora: AHORA,
      terminosRiesgo: [],
    })
    expect(resultado.estado).toBe('registrado')
    if (resultado.estado !== 'registrado') return

    const { rows } = await client.query<{ sensible: boolean; detalle_libre: string | null }>(
      `select sensible, detalle_libre from reportes where id = $1`,
      [resultado.reporteId],
    )
    expect(rows[0]!.sensible).toBe(false)
    expect(rows[0]!.detalle_libre).toContain('mercados')
  })

  it('un término configurado marca el reporte, mueve el contenido, y escala — atómicamente', async () => {
    const sobre = smsDe('me está golpeando y no sé a quién más contarle')

    const resultado = await recibirSobre(client, sobre, organizacion, {
      ahora: AHORA,
      terminosRiesgo: ['golpeando'],
    })
    expect(resultado.estado).toBe('registrado')
    if (resultado.estado !== 'registrado') return

    const { rows: reporte } = await client.query<{
      sensible: boolean
      sensible_motivo: string
      detalle_libre: string | null
      ubicacion: unknown
      contacto_id: string | null
    }>(
      `select sensible, sensible_motivo, detalle_libre, ubicacion, contacto_id
         from reportes where id = $1`,
      [resultado.reporteId],
    )
    expect(reporte[0]!.sensible).toBe(true)
    expect(reporte[0]!.sensible_motivo).toBe('termino_detectado')
    // The identifying text was NEVER on this row — not written then nulled, never written.
    expect(reporte[0]!.detalle_libre).toBeNull()
    expect(reporte[0]!.contacto_id).toBeNull()

    const { rows: protegido } = await client.query<{ detalle_libre: string }>(
      `select detalle_libre from reportes_contenido_protegido where reporte_id = $1`,
      [resultado.reporteId],
    )
    expect(protegido).toHaveLength(1)
    expect(protegido[0]!.detalle_libre).toContain('golpeando')

    const { rows: auditoria } = await client.query<{ n: string }>(
      `select count(*)::text as n from auditoria
        where entidad = 'reportes' and entidad_id = $1
          and accion = 'reporte.marcado_sensible' and actor_id is null`,
      [resultado.reporteId],
    )
    expect(Number(auditoria[0]!.n)).toBe(1)
  })

  it('sin contactos_proteccion activos, el reporte igual queda marcado (cero alertas, no un error)', async () => {
    const sobre = smsDe('me amenaza y tengo miedo')
    const resultado = await recibirSobre(client, sobre, organizacion, {
      ahora: AHORA,
      terminosRiesgo: ['amenaza'],
    })
    expect(resultado.estado).toBe('registrado')
    if (resultado.estado !== 'registrado') return

    const { rows: reporte } = await client.query<{ sensible: boolean }>(
      `select sensible from reportes where id = $1`,
      [resultado.reporteId],
    )
    expect(reporte[0]!.sensible).toBe(true)

    const { rows: alertas } = await client.query<{ n: string }>(
      `select count(*)::text as n from alertas_proteccion where reporte_id = $1`,
      [resultado.reporteId],
    )
    // No contactos_proteccion row exists for this org in this fixture — zero alerts, not a
    // failure. The report is still flagged and still bypasses the ordinary cadence.
    expect(Number(alertas[0]!.n)).toBe(0)
  })

  it('coincide de palabra completa: "el" no dispara contra "abuelo"', async () => {
    const sobre = smsDe('mi abuelo necesita medicinas')
    const resultado = await recibirSobre(client, sobre, organizacion, {
      ahora: AHORA,
      terminosRiesgo: ['el'],
    })
    expect(resultado.estado).toBe('registrado')
    if (resultado.estado !== 'registrado') return

    const { rows } = await client.query<{ sensible: boolean }>(
      `select sensible from reportes where id = $1`,
      [resultado.reporteId],
    )
    expect(rows[0]!.sensible).toBe(false)
  })
})
