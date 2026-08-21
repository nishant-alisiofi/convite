import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

/**
 * Signing in over WhatsApp, end to end, against the real database and a simulated WABA.
 *
 * The same seam tests/autenticacion.db.test.ts covers for the emailed link, walked for the
 * other door: code issued → delivered to the simulator → verified → session → staff row → a
 * real read under RLS. It matters for the same reason: Better Auth issues the id,
 * `vincular_usuario_staff()` matches it against an invitation, and the policies in 0017 cast
 * it — each can be individually right while the join is wrong, and the failure is a blank
 * panel with no error anywhere.
 *
 * Nothing here touches Meta. There is no WABA (D3), so the send is a simulator by the same
 * convention `proveedorSmsSimulador` established: no account, no network, no credentials.
 * **This proves the flow, not the delivery.** Whether Meta actually puts the message on a
 * coordinator's phone is unproven until a WABA exists, exactly like M5's live-number check.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

process.env.BETTER_AUTH_SECRET ??= 'x'.repeat(64)
process.env.APP_BASE_URL ??= 'http://localhost:3000'

const { getAuth } = await import('@/lib/auth')
const { simuladorIngreso, PLANTILLA_CODIGO } = await import('@/lib/codigo-whatsapp')
const { conSesion, vincularStaff } = await import('@/lib/sesion')

/** Deliberately not a number in the seeded `contactos`: staff and community are not the same list. */
const INVITADA = '+573001112233'
const DESCONOCIDA = '+573009998877'

let pool: Pool

/** «I typed my number» → «I typed the code», and what the server did about it. */
async function entrarPorWhatsApp(telefono: string) {
  const antes = simuladorIngreso.enviados.length
  await getAuth().api.sendPhoneNumberOTP({ body: { phoneNumber: telefono } })

  const enviado = simuladorIngreso.enviados[antes]
  expect(enviado, 'no se «envió» ningún código').toBeDefined()
  expect(enviado!.plantilla).toBe(PLANTILLA_CODIGO)

  const codigo = enviado!.parametros[0]!
  return {
    codigo,
    verificar: () =>
      getAuth().api.verifyPhoneNumber({ body: { phoneNumber: telefono, code: codigo } }),
  }
}

async function idDeAuth(telefono: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    'select id from auth_user where telefono = $1',
    [telefono],
  )
  return rows[0]?.id ?? null
}

beforeAll(async () => {
  if (!url) return
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  })

  const { rows } = await pool.query<{ id: string }>('select id from organizaciones limit 1')
  await pool.query(
    `insert into invitaciones_staff (telefono, rol_staff, organizacion_id)
       values ($1, 'coordinador', $2)
     on conflict (telefono) where telefono is not null
       do update set rol_staff = excluded.rol_staff`,
    [INVITADA, rows[0]!.id],
  )
})

afterEach(async () => {
  if (!url) return
  simuladorIngreso.enviados.length = 0
  for (const telefono of [INVITADA, DESCONOCIDA]) {
    const { rows } = await pool.query<{ id: string }>(
      'select id from auth_user where telefono = $1',
      [telefono],
    )
    const authId = rows[0]?.id
    if (authId) {
      await pool.query(
        'update invitaciones_staff set usado_en = null, usuario_id = null where usuario_id = $1::uuid',
        [authId],
      )
      await pool.query('delete from auditoria where actor_id = $1::uuid', [authId])
      await pool.query('delete from usuarios where id = $1::uuid', [authId])
    }
    await pool.query('delete from auth_user where telefono = $1', [telefono])
  }
})

afterAll(async () => {
  if (!url) return
  await pool.query('delete from invitaciones_staff where telefono = any($1)', [
    [INVITADA, DESCONOCIDA],
  ])
  await pool.end()
})

conBase('ingreso abierto — el código prueba el número, y la posesión basta (0035)', () => {
  it('a una invitada le llega el código y entra', async () => {
    const { codigo, verificar } = await entrarPorWhatsApp(INVITADA)

    // Seis dígitos, no cuatro: cuatro los intercepta `pareceCodigo` en la bandeja de entrada.
    expect(codigo).toMatch(/^\d{6}$/)

    const resultado = await verificar()
    expect(resultado.status).toBe(true)
    expect(await idDeAuth(INVITADA)).not.toBeNull()
  })

  it('a un número desconocido TAMBIÉN se le crea identidad si verifica el código', async () => {
    // Ya no hay guardián de lista: cualquiera que pruebe posesión del número obtiene una
    // identidad. Verificar el código la crea, igual que para una invitada.
    const { verificar } = await entrarPorWhatsApp(DESCONOCIDA)

    const resultado = await verificar()
    expect(resultado.status).toBe(true)
    expect(await idDeAuth(DESCONOCIDA)).not.toBeNull()
  })

  it('un código equivocado no entra', async () => {
    await getAuth().api.sendPhoneNumberOTP({ body: { phoneNumber: INVITADA } })
    await expect(
      getAuth().api.verifyPhoneNumber({ body: { phoneNumber: INVITADA, code: '000000' } }),
    ).rejects.toThrow()
    expect(await idDeAuth(INVITADA)).toBeNull()
  })

  it('el número no queda en `contactos`: el staff y la comunidad son listas distintas', async () => {
    // Non-negotiable 2.10. Un coordinador que entra por WhatsApp no se convierte por eso en
    // alguien que reporta, ni al revés.
    const { verificar } = await entrarPorWhatsApp(INVITADA)
    await verificar()

    const { rows } = await pool.query('select 1 from contactos where telefono = $1', [INVITADA])
    expect(rows.length).toBe(0)
  })
})

conBase('de código a permiso, y hasta las políticas', () => {
  it('vincula con el rol que puso el admin y llega hasta una lectura real bajo RLS', async () => {
    const { verificar } = await entrarPorWhatsApp(INVITADA)
    await verificar()
    const authId = (await idDeAuth(INVITADA))!

    // El id tiene que ser uuid por lo mismo que en el camino del correo: `usuarios.id` lo es
    // y `auth.uid()` lo castea.
    expect(authId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)

    // El correo de una sesión por WhatsApp es un marcador que no casa con ninguna invitación:
    // por eso se busca por número. Si la vinculación se hiciera por correo, no hallaría la
    // invitación y caería al rol por defecto del ingreso abierto ('admin') en vez del que puso
    // el admin ('coordinador'); casar por número es lo que preserva el rol invitado.
    expect(await vincularStaff({ authId, correo: 'x@wa.convite.invalid', telefono: INVITADA }))
      .toBe('creado')

    const sesion = {
      authId,
      correo: 'x@wa.convite.invalid',
      telefono: INVITADA,
      rolStaff: 'coordinador',
      organizacionId: '',
      esPlataforma: false,
      estadoOrganizacion: 'aprobada',
      nivelAdmision: 'ancla',
      organizacionDeclarada: true,
    }

    const visto = await conSesion(sesion, async (client) => {
      const { rows } = await client.query<{ uid: string; rol: string }>(
        'select auth.uid()::text as uid, convite_rol() as rol',
      )
      return rows[0]!
    })
    expect(visto.uid).toBe(authId)
    expect(visto.rol).toBe('coordinador')

    const inventario = await conSesion(sesion, async (client) => {
      const { rows } = await client.query<{ n: string }>(
        'select count(*)::text as n from existencias',
      )
      return Number(rows[0]!.n)
    })
    expect(inventario).toBeGreaterThan(0)
  })

  it('una invitación se gasta una sola vez, aunque tenga las dos puertas', async () => {
    /*
     * El caso que produce dos identidades para una persona. Una invitación con correo y
     * teléfono puede alcanzarse por los dos lados, y Better Auth emite un id distinto en cada
     * uno; sin la guarda de 0029, la segunda entrada escribiría una segunda fila en `usuarios`
     * — dos expedientes de staff, dos rastros de auditoría, una sola coordinadora.
     */
    const { rows: orgs } = await pool.query<{ id: string }>('select id from organizaciones limit 1')
    await pool.query('update invitaciones_staff set correo = $1 where telefono = $2', [
      'doble.puerta@convite.test',
      INVITADA,
    ])

    const { verificar } = await entrarPorWhatsApp(INVITADA)
    await verificar()
    const porWhatsApp = (await idDeAuth(INVITADA))!
    expect(
      await vincularStaff({ authId: porWhatsApp, correo: 'x@wa.convite.invalid', telefono: INVITADA }),
    ).toBe('creado')

    // Ahora la misma persona entra por correo: id distinto, misma invitación.
    const { randomUUID } = await import('node:crypto')
    const porCorreo = randomUUID()
    expect(await vincularStaff({ authId: porCorreo, correo: 'doble.puerta@convite.test' })).toBe(
      'ya_vinculada',
    )

    const { rows } = await pool.query<{ n: string }>(
      'select count(*)::text as n from usuarios where organizacion_id = $1 and id in ($2::uuid, $3::uuid)',
      [orgs[0]!.id, porWhatsApp, porCorreo],
    )
    expect(Number(rows[0]!.n), 'una persona, un expediente').toBe(1)

    await pool.query('update invitaciones_staff set correo = null where telefono = $1', [INVITADA])
  })
})
