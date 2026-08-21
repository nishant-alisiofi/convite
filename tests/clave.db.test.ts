import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * The password door, and the one property that makes it safe to have.
 *
 * Open sign-in (0035) means anyone who proves possession of an address or number gets an
 * account — but a password is not proof of possession, it is a secret somebody chose. So the
 * rule this file keeps is narrower and unchanged by the open-sign-in switch: **a password can
 * never be the FIRST proof.** An account comes into existence only after its owner proved they
 * can receive something (the magic link or the WhatsApp code); a password is only ever a faster
 * return trip for an account that already exists.
 *
 * The mechanism is two structural guarantees rather than a check that could be forgotten:
 * `disableSignUp` means no HTTP route turns an address plus a chosen password into an account,
 * and Better Auth's `setPassword` is `serverOnly` so it is not routable at all. The tests
 * below assert the *behaviour* those produce, so they keep meaning something if the mechanism
 * is ever swapped for another one.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

process.env.BETTER_AUTH_SECRET ??= 'x'.repeat(64)
process.env.APP_BASE_URL ??= 'http://localhost:3000'

const enviado = vi.hoisted(() => ({ para: '', url: '' }))

vi.mock('@/lib/correo', () => ({
  enviarCorreo: async ({ para, html }: { para: string; html: string }) => {
    enviado.para = para
    enviado.url = /href="([^"]+)"/.exec(html)?.[1] ?? ''
    return { enviado: true, id: 'prueba' }
  },
  plantillaEnlace: (u: string) => ({ asunto: 'x', html: `<a href="${u}">x</a>` }),
  plantillaRestablecer: (u: string) => ({ asunto: 'x', html: `<a href="${u}">x</a>` }),
}))

const { getAuth } = await import('@/lib/auth')
const { conSesion, vincularStaff } = await import('@/lib/sesion')

const INVITADA = 'coordinadora.clave@convite.test'
const CLAVE = 'la lancha sale a las cinco'

let pool: Pool

/** Comes in the honest way — the emailed link — which is the only way an account is born. */
async function entrarPorEnlace(correo: string): Promise<string> {
  enviado.url = ''
  await getAuth().api.signInMagicLink({
    headers: new Headers(),
    body: { email: correo, callbackURL: '/auth/callback' },
  })
  await getAuth().handler(new Request(enviado.url, { redirect: 'manual' }))

  const { rows } = await pool.query<{ id: string }>('select id from auth_user where correo = $1', [
    correo,
  ])
  return rows[0]!.id
}

/** The Set-Cookie a browser would hold, so `setPassword` sees a real session. */
async function galletaDe(correo: string): Promise<string> {
  enviado.url = ''
  await getAuth().api.signInMagicLink({
    headers: new Headers(),
    body: { email: correo, callbackURL: '/auth/callback' },
  })
  const r = await getAuth().handler(new Request(enviado.url, { redirect: 'manual' }))
  return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
}

async function existeCuenta(correo: string): Promise<boolean> {
  const { rows } = await pool.query('select 1 from auth_user where correo = $1', [correo])
  return rows.length > 0
}

async function tieneClave(correo: string): Promise<boolean> {
  const { rows } = await pool.query(
    `select 1 from auth_account a join auth_user u on u.id = a.auth_user_id
      where u.correo = $1 and a.contrasena is not null`,
    [correo],
  )
  return rows.length > 0
}

beforeAll(async () => {
  if (!url) return
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  })
  const { rows } = await pool.query<{ id: string }>('select id from organizaciones limit 1')
  await pool.query(
    `insert into invitaciones_staff (correo, rol_staff, organizacion_id)
       values ($1, 'coordinador', $2)
     on conflict (correo) where correo is not null
       do update set rol_staff = excluded.rol_staff`,
    [INVITADA, rows[0]!.id],
  )
})

afterEach(async () => {
  if (!url) return
  const { rows } = await pool.query<{ id: string }>('select id from auth_user where correo = $1', [
    INVITADA,
  ])
  const authId = rows[0]?.id
  if (authId) {
    await pool.query(
      'update invitaciones_staff set usado_en = null, usuario_id = null where usuario_id = $1::uuid',
      [authId],
    )
    await pool.query('delete from auditoria where actor_id = $1::uuid', [authId])
    await pool.query('delete from usuarios where id = $1::uuid', [authId])
  }
  await pool.query('delete from auth_user where correo = $1', [INVITADA])
})

afterAll(async () => {
  if (!url) return
  await pool.query('delete from invitaciones_staff where correo = $1', [INVITADA])
  await pool.end()
})

conBase('la invariante: una contraseña nunca es la primera prueba de nada', () => {
  it('una contraseña elegida NO crea cuenta, ni siquiera para una dirección con invitación', async () => {
    /*
     * The attack this closes. The address even has an invitation waiting — but choosing a
     * password is not proving you can read its mail, and open sign-in still never lets a
     * password be the first proof. Sign-up has to refuse, and no account may exist afterwards.
     */
    await expect(
      getAuth().api.signUpEmail({
        headers: new Headers(),
        body: { email: INVITADA, password: 'la que yo quiera 123', name: 'Intrusa' },
      }),
    ).rejects.toThrow()

    expect(await existeCuenta(INVITADA), 'no debía crearse ninguna cuenta').toBe(false)
  })

  it('tampoco alcanza para una dirección que ni siquiera está invitada', async () => {
    await expect(
      getAuth().api.signUpEmail({
        headers: new Headers(),
        body: { email: 'nadie@convite.test', password: 'la que yo quiera 123', name: 'Nadie' },
      }),
    ).rejects.toThrow()
    expect(await existeCuenta('nadie@convite.test')).toBe(false)
  })

  it('no se puede entrar con contraseña a una cuenta que no puso ninguna', async () => {
    // The account exists and was ownership-proven, but has no credential. Guessing is not a
    // way in, and neither is «no password set» being treated as an empty password.
    await entrarPorEnlace(INVITADA)
    await expect(
      getAuth().api.signInEmail({
        headers: new Headers(),
        body: { email: INVITADA, password: 'lo que sea que escriba' },
      }),
    ).rejects.toThrow()
  })

  it('poner una contraseña exige una sesión viva', async () => {
    await entrarPorEnlace(INVITADA)
    // No cookie: this is the shape of the request an outsider could make.
    await expect(
      getAuth().api.setPassword({ headers: new Headers(), body: { newPassword: CLAVE } }),
    ).rejects.toThrow()
    expect(await tieneClave(INVITADA)).toBe(false)
  })
})

conBase('el recorrido real: poner, salir, volver a entrar', () => {
  it('la pone estando adentro y después sirve para entrar', async () => {
    const galleta = await galletaDe(INVITADA)

    await getAuth().api.setPassword({
      headers: new Headers({ cookie: galleta }),
      body: { newPassword: CLAVE },
    })
    expect(await tieneClave(INVITADA)).toBe(true)

    // Salir.
    await getAuth().api.signOut({ headers: new Headers({ cookie: galleta }) })
    expect(await getAuth().api.getSession({ headers: new Headers({ cookie: galleta }) })).toBeNull()

    // Volver a entrar, ahora con la contraseña.
    const vuelta = await getAuth().api.signInEmail({
      headers: new Headers(),
      body: { email: INVITADA, password: CLAVE },
    })
    expect(vuelta.user.email).toBe(INVITADA)

    // Y una contraseña equivocada sigue sin servir.
    await expect(
      getAuth().api.signInEmail({
        headers: new Headers(),
        body: { email: INVITADA, password: 'otra cosa completamente' },
      }),
    ).rejects.toThrow()
  })

  it('es la MISMA persona: un solo expediente, no uno por puerta', async () => {
    /*
     * The property the WhatsApp door needed a database guard for, and that this door gets for
     * free: a password attaches to the account that already exists, so there is never a second
     * Better Auth identity and never a second `usuarios` row.
     */
    const galleta = await galletaDe(INVITADA)
    const porEnlace = (await getAuth().api.getSession({ headers: new Headers({ cookie: galleta }) }))!
      .user.id

    await getAuth().api.setPassword({
      headers: new Headers({ cookie: galleta }),
      body: { newPassword: CLAVE },
    })
    const conClave = await getAuth().api.signInEmail({
      headers: new Headers(),
      body: { email: INVITADA, password: CLAVE },
    })

    expect(conClave.user.id).toBe(porEnlace)

    const { rows } = await pool.query<{ n: string }>(
      'select count(*)::text as n from auth_user where correo = $1',
      [INVITADA],
    )
    expect(Number(rows[0]!.n)).toBe(1)
  })

  it('y llega hasta una lectura real bajo RLS, con el rol que puso el admin', async () => {
    const galleta = await galletaDe(INVITADA)
    await getAuth().api.setPassword({
      headers: new Headers({ cookie: galleta }),
      body: { newPassword: CLAVE },
    })
    await getAuth().api.signOut({ headers: new Headers({ cookie: galleta }) })

    const vuelta = await getAuth().api.signInEmail({
      headers: new Headers(),
      body: { email: INVITADA, password: CLAVE },
    })
    expect(await vincularStaff({ authId: vuelta.user.id, correo: INVITADA })).toBe('creado')

    const sesion = {
      authId: vuelta.user.id,
      correo: INVITADA,
      telefono: null,
      rolStaff: 'coordinador',
      organizacionId: '',
      esPlataforma: false,
      estadoOrganizacion: 'aprobada',
      nivelAdmision: 'ancla',
      organizacionDeclarada: true,
      faseOrganizacion: 'emergencia',
    }

    const visto = await conSesion(sesion, async (client) => {
      const { rows } = await client.query<{ uid: string; rol: string }>(
        'select auth.uid()::text as uid, convite_rol() as rol',
      )
      return rows[0]!
    })
    expect(visto.uid).toBe(vuelta.user.id)
    expect(visto.rol).toBe('coordinador')
  })
})

conBase('restablecer', () => {
  it('manda el enlace y la contraseña nueva sirve', async () => {
    const galleta = await galletaDe(INVITADA)
    await getAuth().api.setPassword({
      headers: new Headers({ cookie: galleta }),
      body: { newPassword: CLAVE },
    })

    enviado.url = ''
    await getAuth().api.requestPasswordReset({
      headers: new Headers(),
      body: { email: INVITADA, redirectTo: '/entrar/nueva-clave' },
    })
    expect(enviado.para).toBe(INVITADA)

    /*
     * The link in the mail is not the page — it points at Better Auth's own
     * `/api/auth/reset-password/:token`, which checks the token and then bounces to our page
     * with it as a query parameter. Following that hop is the point: it is what a browser
     * does, and it is where a mismatch between the two shapes would show up.
     */
    const salto = await getAuth().handler(new Request(enviado.url, { redirect: 'manual' }))
    const destino = new URL(salto.headers.get('location')!, 'http://localhost:3000')
    expect(destino.pathname).toBe('/entrar/nueva-clave')

    const token = destino.searchParams.get('token')
    expect(token, 'el correo tiene que traer un token').toBeTruthy()

    const NUEVA = 'el rio esta alto esta semana'
    await getAuth().api.resetPassword({
      headers: new Headers(),
      body: { newPassword: NUEVA, token: token! },
    })

    const vuelta = await getAuth().api.signInEmail({
      headers: new Headers(),
      body: { email: INVITADA, password: NUEVA },
    })
    expect(vuelta.user.email).toBe(INVITADA)

    // La vieja deja de servir, que es el punto de restablecer.
    await expect(
      getAuth().api.signInEmail({ headers: new Headers(), body: { email: INVITADA, password: CLAVE } }),
    ).rejects.toThrow()
  })
})
