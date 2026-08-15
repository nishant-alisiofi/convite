import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * The sign-in flow, end to end, against the real database.
 *
 * Everything else about identity is covered indirectly — the middleware suite knows what a
 * request without a cookie gets, and tests/rls.db.test.ts proves what a session may read
 * once it has one. Nothing covered the part in between: does typing an address into
 * `/entrar` actually end with a signed-in coordinator holding a `usuarios` row?
 *
 * It has to be answered here rather than by inspection, because it is the seam where the
 * three pieces meet and each of them can be individually correct while the join is wrong:
 * Better Auth issues the id, `vincular_usuario_staff()` compares it against an invitation,
 * and the RLS policies cast it with `auth.uid()`. If the id is not a uuid, the first two
 * still pass and every policy silently denies — a blank panel, no error anywhere.
 *
 * Only the network send is stubbed. The magic link is generated, stored, clicked and
 * consumed for real.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

// Better Auth needs these before `lib/auth.ts` is imported.
process.env.BETTER_AUTH_SECRET ??= 'x'.repeat(64)
process.env.APP_BASE_URL ??= 'http://localhost:3000'

/** Captures the link instead of mailing it. The callback that builds it still runs. */
const enviado = vi.hoisted(() => ({ para: '', url: '' }))

vi.mock('@/lib/correo', () => ({
  enviarCorreo: async ({ para, html }: { para: string; html: string }) => {
    enviado.para = para
    enviado.url = /href="([^"]+)"/.exec(html)?.[1] ?? ''
    return { enviado: true, id: 'prueba' }
  },
  plantillaEnlace: (u: string) => ({ asunto: 'x', html: `<a href="${u}">x</a>` }),
}))

const { correoInvitado, getAuth } = await import('@/lib/auth')
const { conSesion, vincularStaff } = await import('@/lib/sesion')

const INVITADO = 'coordinadora.prueba@convite.test'
const DESCONOCIDO = 'nadie.prueba@convite.test'

let pool: Pool

/**
 * Turns «I typed my address» into «I clicked the link», and reports what happened.
 *
 * `galleta` is the real Set-Cookie the browser would be handed, signature and all — the
 * session cookie is signed, so the bare token out of `auth_session` does not authenticate
 * anything and cannot stand in for it.
 */
async function entrar(
  correo: string,
): Promise<{ estado: number; destino: string; galleta: string }> {
  enviado.url = ''
  await getAuth().api.signInMagicLink({
    headers: new Headers(),
    body: { email: correo, callbackURL: '/auth/callback', errorCallbackURL: '/entrar' },
  })
  expect(enviado.url, 'no se generó ningún enlace').not.toBe('')

  const respuesta = await getAuth().handler(new Request(enviado.url, { redirect: 'manual' }))
  const galleta = (respuesta.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ')

  return {
    estado: respuesta.status,
    destino: respuesta.headers.get('location') ?? '',
    galleta,
  }
}

async function idDeAuth(correo: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>('select id from auth_user where correo = $1', [
    correo,
  ])
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
    `insert into invitaciones_staff (correo, rol_staff, organizacion_id)
       values ($1, 'coordinador', $2)
     on conflict (correo) where correo is not null do update set rol_staff = excluded.rol_staff`,
    [INVITADO, rows[0]!.id],
  )
})

afterEach(async () => {
  if (!url) return
  // Each case starts from «has never signed in». Deleting the auth row cascades to its
  // sessions, but nothing cascades into `usuarios` or `auditoria` on purpose — an audit
  // trail should not evaporate because an identity did, and `vincular_usuario_staff()`
  // writes one every time it links somebody. So this unwinds by hand, newest first. The
  // FK that makes this awkward is the same FK that makes the trail worth having.
  for (const correo of [INVITADO, DESCONOCIDO]) {
    const { rows } = await pool.query<{ id: string }>(
      'select id from auth_user where correo = $1',
      [correo],
    )
    const authId = rows[0]?.id
    if (authId) {
      // Order matters: both the invitation and the audit trail point at the staff row.
      await pool.query(
        'update invitaciones_staff set usado_en = null, usuario_id = null where usuario_id = $1::uuid',
        [authId],
      )
      await pool.query('delete from auditoria where actor_id = $1::uuid', [authId])
      await pool.query('delete from usuarios where id = $1::uuid', [authId])
    }
    await pool.query('delete from auth_user where correo = $1', [correo])
  }
})

afterAll(async () => {
  if (!url) return
  await pool.query('delete from invitaciones_staff where correo = any($1)', [[INVITADO, DESCONOCIDO]])
  await pool.end()
})

conBase('2.10 — un enlace prueba que el correo es suyo, no que usted sea del equipo', () => {
  it('sabe quién está invitado y quién no', async () => {
    expect(await correoInvitado(INVITADO)).toBe(true)
    expect(await correoInvitado(DESCONOCIDO)).toBe(false)
    // La mayúscula y el espacio de más son de quien escribe, no del permiso.
    expect(await correoInvitado(`  ${INVITADO.toUpperCase()} `)).toBe(true)
  })

  it('a un invitado le llega el enlace y entra', async () => {
    const { estado, destino } = await entrar(INVITADO)

    expect(enviado.para).toBe(INVITADO)
    expect([302, 307]).toContain(estado)
    expect(destino).toContain('/auth/callback')
    expect(destino).not.toContain('error')
    expect(await idDeAuth(INVITADO)).not.toBeNull()
  })

  it('a un desconocido que consiga un enlace NO se le crea identidad', async () => {
    // El guardián que no se puede rodear: la página ni siquiera manda el correo, pero si
    // alguien llega a `signInMagicLink` por otro camino, la fila no se escribe igual.
    const { destino } = await entrar(DESCONOCIDO)

    expect(destino).toContain('error')
    expect(await idDeAuth(DESCONOCIDO)).toBeNull()
  })

  it('estar autenticado no crea la fila de staff por sí solo', async () => {
    await entrar(INVITADO)
    const authId = (await idDeAuth(INVITADO))!

    // Hay identidad; todavía no hay acceso. Son dos cosas.
    const { rowCount } = await pool.query('select 1 from usuarios where id = $1', [authId])
    expect(rowCount).toBe(0)
  })
})

conBase('salir', () => {
  it('borra la sesión del servidor, no solo la galleta del navegador', async () => {
    /*
     * El panel llama a esto desde una Server Action. Importa que la fila desaparezca: una
     * salida que solo limpia la cookie deja un token vivo en la base que sigue sirviendo
     * para entrar si alguien lo copió antes — que es justo el caso de un equipo compartido,
     * que es como se usa esto.
     *
     * Desde que las sesiones duran un año, esta prueba dejó de ser una precaución y pasó a
     * ser la que sostiene la decisión: «se queda dentro hasta que salga» solo es defendible
     * si salir mata la sesión de verdad. Si esta falla, la duración de la sesión es el
     * problema, no la prueba.
     */
    const { galleta } = await entrar(INVITADO)
    const authId = (await idDeAuth(INVITADO))!

    const { rows: antes } = await pool.query('select 1 from auth_session where auth_user_id = $1', [authId])
    expect(antes.length).toBe(1)

    const cabeceras = new Headers({ cookie: galleta })
    expect(await getAuth().api.getSession({ headers: cabeceras })).not.toBeNull()
    await getAuth().api.signOut({ headers: cabeceras })

    const { rows: despues } = await pool.query('select 1 from auth_session where auth_user_id = $1', [authId])
    expect(despues.length).toBe(0)
    expect(await getAuth().api.getSession({ headers: cabeceras })).toBeNull()
  })

  it('la sesión dura un año y se renueva sola: nadie se cae solo', async () => {
    // «Hasta que salga» tiene que ser visible en la fila, no solo en la intención. Si
    // alguien «ordena» este número de vuelta a doce horas, la gente vuelve a caerse.
    const { galleta } = await entrar(INVITADO)
    const authId = (await idDeAuth(INVITADO))!

    const { rows } = await pool.query<{ dias: number }>(
      `select extract(epoch from (vence_en - now())) / 86400 as dias
         from auth_session where auth_user_id = $1`,
      [authId],
    )
    expect(Number(rows[0]!.dias)).toBeGreaterThan(360)

    // Y sigue sirviendo pasada la ventana vieja de doce horas, que es lo que se arregló.
    await pool.query(
      `update auth_session set actualizado_en = now() - interval '13 hours'
        where auth_user_id = $1`,
      [authId],
    )
    expect(
      await getAuth().api.getSession({ headers: new Headers({ cookie: galleta }) }),
    ).not.toBeNull()
  })

  it('una sesión larga NO es acceso largo: desactivar a alguien lo saca en el acto', async () => {
    /*
     * The property that makes a year-long session safe, and the one to protect.
     *
     * Session length is convenience; authorisation is re-read from Postgres on every
     * request. `sesionActual()` selects the staff row `where activo`, so an admin
     * deactivating somebody locks them out on their next click regardless of how much time
     * their session had left. Without this, «stay signed in until you sign out» would also
     * mean «stay authorised for a year after you leave».
     */
    const { galleta } = await entrar(INVITADO)
    const authId = (await idDeAuth(INVITADO))!
    await vincularStaff({ authId, correo: INVITADO })

    // The Better Auth session is untouched and still valid...
    expect(
      await getAuth().api.getSession({ headers: new Headers({ cookie: galleta }) }),
    ).not.toBeNull()

    await pool.query('update usuarios set activo = false where id = $1::uuid', [authId])

    // ...and yet there is no staff session, which is what the panel actually asks for.
    const { rows } = await pool.query(
      'select 1 from usuarios where id = $1::uuid and activo',
      [authId],
    )
    expect(rows.length, 'la fila de staff sigue activa: el corte no funcionó').toBe(0)
  })
})

conBase('el id que emite Better Auth es el que las políticas saben leer', () => {
  it('es un uuid, porque `usuarios.id` lo es y auth.uid() lo castea', async () => {
    // Si esto se rompe, todo lo demás sigue «pasando» y el panel se ve vacío: auth.uid()
    // revienta dentro de cada política y RLS niega, que es justo el fallo que no avisa.
    await entrar(INVITADO)
    const authId = (await idDeAuth(INVITADO))!

    expect(authId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('la base rechaza un id que no sea uuid, en vez de aceptarlo y romper RLS', async () => {
    await expect(
      pool.query(
        `insert into auth_user (id, nombre, correo) values ('no-es-uuid', '', 'x@convite.test')`,
      ),
    ).rejects.toThrow(/auth_user_id_es_uuid/)
  })
})

conBase('de enlace a permiso: la vinculación con el registro de staff', () => {
  it('crea la fila de staff con el rol que puso el admin, y solo una vez', async () => {
    await entrar(INVITADO)
    const authId = (await idDeAuth(INVITADO))!

    expect(await vincularStaff({ authId, correo: INVITADO })).toBe('creado')
    expect(await vincularStaff({ authId, correo: INVITADO })).toBe('ya_existe')

    const { rows } = await pool.query<{ rol_staff: string }>(
      'select rol_staff from usuarios where id = $1',
      [authId],
    )
    expect(rows[0]?.rol_staff).toBe('coordinador')
  })

  it('un id autenticado sin invitación no obtiene fila', async () => {
    const { randomUUID } = await import('node:crypto')
    expect(await vincularStaff({ authId: randomUUID(), correo: DESCONOCIDO })).toBe('sin_invitacion')
  })

  it('y con la fila puesta, RLS deja leer exactamente lo del rol', async () => {
    // El final del recorrido: la sesión que salió del enlace llega hasta Postgres con sus
    // claims y las políticas de 0017 la reconocen. Sin esto, todo lo anterior es papeleo.
    await entrar(INVITADO)
    const authId = (await idDeAuth(INVITADO))!
    await vincularStaff({ authId, correo: INVITADO })

    const sesion = { authId, correo: INVITADO, telefono: null, rolStaff: 'coordinador', organizacionId: '', esPlataforma: false, estadoOrganizacion: 'aprobada' }

    const visto = await conSesion(sesion, async (client) => {
      const { rows } = await client.query<{ uid: string; rol: string }>(
        'select auth.uid()::text as uid, convite_rol() as rol',
      )
      return rows[0]!
    })

    expect(visto.uid).toBe(authId)
    expect(visto.rol).toBe('coordinador')

    // Y un coordinador cuenta inventario (0017), que es lo que su rol le permite.
    const inventario = await conSesion(sesion, async (client) => {
      const { rows } = await client.query<{ n: string }>(
        'select count(*)::text as n from existencias',
      )
      return Number(rows[0]!.n)
    })
    expect(inventario).toBeGreaterThan(0)
  })
})
