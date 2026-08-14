import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { confirmarConCodigo, COPIA_CONFIRMACION, pareceCodigo, recibirSms } from '@/lib/canales'
import { recibirSobre } from '@/lib/canales/intake'

/**
 * «Recibí» — closing the loop from wherever there is signal.
 *
 * Section 9.7: no app, no camera, no data at the moment of handover. The code is read off the
 * manifest at the riverbank and confirmed later, on whatever channel reaches the person. So
 * the same four digits have to work by SMS, by WhatsApp and keyed into a call, and confirming
 * twice — which is what a careful person does — must never count as two deliveries.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

let pool: Pool
let client: PoolClient
let organizacion: string
let contacto: string
let pedido: string
let entrega: string

const AHORA = new Date('2026-08-14T15:00:00Z')
const CODIGO = '4721'

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

  // A real seeded request, and somebody who lives where it is going.
  const { rows: pedidos } = await client.query<{ id: string; comunidad_id: string }>(
    `select p.id, p.comunidad_id from pedidos p
       join contactos c on c.comunidad_id = p.comunidad_id
      limit 1`,
  )
  pedido = pedidos[0]!.id
  const { rows: contactos } = await client.query<{ id: string }>(
    'select id from contactos where comunidad_id = $1 limit 1',
    [pedidos[0]!.comunidad_id],
  )
  contacto = contactos[0]!.id

  const { rows: usuarios } = await client.query<{ contacto_id: string }>(
    'select contacto_id from usuarios where contacto_id is not null limit 1',
  )
  const { rows: nodos } = await client.query<{ id: string }>('select id from nodos limit 1')
  const { rows: envios } = await client.query<{ id: string }>(
    `insert into envios (codigo, modo, responsable_id, origen_nodo_id, cupo_familias)
     values ('ENV-M11', 'lancha', $1, $2, 30) returning id`,
    [usuarios[0]!.contacto_id, nodos[0]!.id],
  )
  const { rows: entregas } = await client.query<{ id: string }>(
    `insert into entregas (envio_id, pedido_id, codigo_confirmacion)
     values ($1, $2, $3) returning id`,
    [envios[0]!.id, pedido, CODIGO],
  )
  entrega = entregas[0]!.id

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

describe('reconocer un código', () => {
  it('cuatro dígitos y nada más', () => {
    expect(pareceCodigo('4721')).toBe('4721')
    expect(pareceCodigo(' 4721 ')).toBe('4721')
    // People type the code the way it is printed on the manifest.
    expect(pareceCodigo('47-21')).toBe('4721')
  })

  it('no confunde un código con un reporte', () => {
    expect(pareceCodigo('22 12 3')).toBeNull()
    expect(pareceCodigo('necesitamos mercados')).toBeNull()
    expect(pareceCodigo('472')).toBeNull()
    expect(pareceCodigo('47210')).toBeNull()
    expect(pareceCodigo(null)).toBeNull()
  })
})

conBase('confirmar una entrega', () => {
  it('el código cierra la entrega y queda quién y por dónde', async () => {
    const resultado = await confirmarConCodigo(client, {
      codigo: CODIGO,
      contactoId: contacto,
      canal: 'sms',
      ahora: AHORA,
    })

    expect(resultado.estado).toBe('confirmada')
    const { rows } = await client.query<{
      confirmado: boolean
      confirmado_canal: string
      confirmado_por_id: string
    }>('select confirmado, confirmado_canal, confirmado_por_id from entregas where id = $1', [
      entrega,
    ])
    expect(rows[0]).toMatchObject({
      confirmado: true,
      confirmado_canal: 'sms',
      confirmado_por_id: contacto,
    })
  })

  it('el mismo código por IVR y por SMS confirma UNA sola vez', async () => {
    // The acceptance case, and the realistic one: somebody dictates the code on the callback
    // and then texts it too, because they want to be sure. Counting that twice would inflate
    // familias_atendidas and make the response look better on paper than it was.
    const porIvr = await confirmarConCodigo(client, {
      codigo: CODIGO,
      contactoId: contacto,
      canal: 'ivr',
      ahora: AHORA,
    })
    const porSms = await confirmarConCodigo(client, {
      codigo: CODIGO,
      contactoId: contacto,
      canal: 'sms',
      ahora: new Date(AHORA.getTime() + 60_000),
    })

    expect(porIvr.estado).toBe('confirmada')
    expect(porSms.estado).toBe('ya_confirmada')

    // And the record keeps the first channel that actually closed it.
    const { rows } = await client.query<{ confirmado_canal: string; n: string }>(
      `select confirmado_canal, (select count(*) from entregas where confirmado) as n
         from entregas where id = $1`,
      [entrega],
    )
    expect(rows[0]!.confirmado_canal).toBe('ivr')
    expect(Number(rows[0]!.n)).toBe(1)
  })

  it('un código que no existe no confirma nada', async () => {
    const resultado = await confirmarConCodigo(client, {
      codigo: '0000',
      contactoId: contacto,
      canal: 'sms',
      ahora: AHORA,
    })
    expect(resultado.estado).toBe('sin_coincidencia')
  })

  it('no confirma la entrega de otra comunidad con el mismo código', async () => {
    // Codes are unique per shipment, not globally — four digits are for dictating, not for
    // security. Resolving them against the community is what keeps «4721» from closing
    // somebody else's delivery three hours upriver.
    const { rows: otros } = await client.query<{ id: string }>(
      `select c.id from contactos c
        where c.comunidad_id is not null and c.comunidad_id <> (
          select comunidad_id from pedidos where id = $1)
        limit 1`,
      [pedido],
    )

    const resultado = await confirmarConCodigo(client, {
      codigo: CODIGO,
      contactoId: otros[0]!.id,
      canal: 'sms',
      ahora: AHORA,
    })
    expect(resultado.estado).toBe('sin_coincidencia')

    const { rows } = await client.query<{ confirmado: boolean }>(
      'select confirmado from entregas where id = $1',
      [entrega],
    )
    expect(rows[0]!.confirmado).toBe(false)
  })
})

conBase('un código llegando como mensaje', () => {
  it('confirma sin abrir un reporte, y da las gracias', async () => {
    const { rows: telefonos } = await client.query<{ telefono: string }>(
      'select telefono from contactos where id = $1',
      [contacto],
    )
    const sobre = recibirSms(
      { id: 'sms-conf-1', de: telefonos[0]!.telefono, texto: CODIGO },
      AHORA,
    )

    const resultado = await recibirSobre(client, sobre, organizacion, { ahora: AHORA })

    expect(resultado.estado).toBe('confirmacion')
    if (resultado.estado !== 'confirmacion') return
    expect(resultado.resultado).toBe('confirmada')

    // A confirmation is not a need: nothing new lands in reportes.
    const { rows } = await client.query<{ n: string }>(
      `select count(*) as n from mensajes where proveedor_mensaje_id = $1 and reporte_id is not null`,
      ['sms-conf-1'],
    )
    expect(Number(rows[0]!.n)).toBe(0)

    const { rows: salidas } = await client.query<{ cuerpo: string }>(
      'select cuerpo from salidas_pendientes where contacto_id = $1 order by creado_en desc',
      [contacto],
    )
    expect(salidas[0]!.cuerpo).toContain('Gracias')
  })

  it('un código equivocado pregunta, nunca da una lección de sintaxis', async () => {
    const { rows: telefonos } = await client.query<{ telefono: string }>(
      'select telefono from contactos where id = $1',
      [contacto],
    )
    const sobre = recibirSms({ id: 'sms-conf-2', de: telefonos[0]!.telefono, texto: '0000' }, AHORA)

    const resultado = await recibirSobre(client, sobre, organizacion, { ahora: AHORA })

    expect(resultado.estado).toBe('confirmacion')
    if (resultado.estado !== 'confirmacion') return
    expect(resultado.resultado).toBe('sin_coincidencia')
    // Visible rather than silently eaten: a run of these is somebody holding a manifest for
    // a delivery that went to the wrong community, which is a phone call.
    expect(resultado.fallosRecientes).toBeGreaterThan(0)

    const { rows: salidas } = await client.query<{ cuerpo: string }>(
      'select cuerpo from salidas_pendientes where contacto_id = $1 order by creado_en desc',
      [contacto],
    )
    const cuerpo = salidas[0]!.cuerpo
    expect(cuerpo).toMatch(/manifiesto|qué le llegó/)
    expect(cuerpo).not.toMatch(/formato|escriba así|inválido|error/i)
    expect(cuerpo).toBe(
      cuerpo.includes('manifiesto') ? COPIA_CONFIRMACION.noCoincide : COPIA_CONFIRMACION.noCoincideSms,
    )
  })
})
