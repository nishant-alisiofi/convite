import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join as unir } from 'node:path'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { COMUNIDADES_SEMILLA } from '@/db/seed/comunidades'
import { esRutaPublica } from '@/middleware'

/**
 * M12 acceptance, PRD verbatim: «an unauthenticated request cannot obtain any coordinate,
 * community name or phone number *by any route, including direct API calls*».
 *
 * Two things make this a surface test rather than a page test.
 *
 * It runs over HTTP against a real `next start`, because "any route" means what a stranger
 * with curl can reach — middleware, redirects, error bodies and all. Calling route handlers
 * as functions would skip the only layer that decides who gets in.
 *
 * And the route list is read off the filesystem, not typed here. A hardcoded list rots: the
 * route somebody adds next month is exactly the one nobody remembers to check. Every route
 * found must appear in POLITICA below, and an unclassified one fails the suite with a
 * message telling whoever added it to decide what it is.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

/**
 * What each route is *supposed* to be. Adding a route means adding a line here — that is
 * the point, and the test refuses to guess on your behalf.
 */
const POLITICA: Record<string, 'publica' | 'autenticada'> = {
  '/': 'publica',
  '/respuesta': 'publica',
  '/entrar': 'publica',
  // §4: the vetted door for running a centre. Public by necessity — somebody who is not yet
  // staff asks here — and safe because it creates only a `pendiente` organisation and a pending
  // invitation, with nothing operable behind either until the platform approves.
  '/solicitar-centro': 'publica',
  // FR-18: the transporter self-signup (offer capacity) and its possession callback. Public by
  // necessity — a driver who is not yet staff proves possession here — and safe: signed out it
  // shows only the sign-in doors, and the aportante it creates has a `lectura` role + empty ceiling,
  // so RLS never hands it a household address. The leak-pattern assertions below cover both.
  '/transportar': 'publica',
  '/transportar/registro': 'publica',
  '/auth/callback': 'publica',
  // Where a password-reset link lands. Public by necessity — somebody who cannot sign in has
  // to reach it — and safe for the same reason the magic link is: getting here with a usable
  // token means having read mail sent to an invited address.
  '/entrar/nueva-clave': 'publica',
  // Better Auth's own endpoints. Public by necessity — they are how somebody with no
  // session gets one — and they answer about sessions and nothing else, so there is no
  // basin data behind them to leak.
  '/api/auth/[...all]': 'publica',
  '/api/salud': 'publica',
  '/api/webhooks/whatsapp': 'publica',
  // PRD-15: the Infobip Calls webhook. Public by necessity — Infobip carries no session
  // cookie — and safe the same way the WhatsApp one is: it is authenticated by a shared
  // secret checked in constant time (lib/canales/voz/firma.ts), not by the session layer.
  '/api/webhooks/voz': 'publica',
  '/api/jobs/correr': 'publica',
  // §28.1 (PRD-34): the per-membership .ics Agenda feed. Reachable without a session (a calendar
  // app holds no cookie) but authenticated by the token in the URL — a stranger with no valid
  // token gets a 404, never a calendar. An authenticated surface, not a public one.
  '/api/agenda/[token]': 'autenticada',
  '/tablero': 'autenticada',
  // Setting a password. Behind a session on purpose: that is the whole mechanism.
  '/clave': 'autenticada',
  '/mapa': 'autenticada',
  // PRD-13 offline basemap. Behind a session like every other panel screen; pre-existing gap in
  // this list (the route shipped before this suite's classification was added to it), closed
  // here only because it was left blocking `pnpm test` for every unrelated change since.
  '/mapa-offline': 'autenticada',
  // The three panel read views: demand-vs-stock, the community registry, and the item
  // catalogue. All behind a session; RLS is the boundary, and each refuses the wrong role
  // with a legible note rather than a leak.
  '/inventario': 'autenticada',
  '/comunidades': 'autenticada',
  '/catalogo': 'autenticada',
  // FR-42: person search and its detail page. Behind a session like Comunidades; RLS on
  // `contactos`/`comunidades` (0017) is the boundary, and a stranger gets the same redirect
  // every other panel screen gives, never a rendered name or number.
  '/personas': 'autenticada',
  '/personas/[id]': 'autenticada',
  // The centre-admin team screen (§2.4) and the platform approval screen (§2.5). Both behind a
  // session; RLS is the boundary, and each also refuses the wrong role with a legible note.
  '/equipo': 'autenticada',
  '/centros': 'autenticada',
  '/rutas': 'autenticada',
  '/recogidas': 'autenticada',
  // §5.9 connection points (PRD-10) and the earmarked-sponsorship desk (PRD-12). Both behind a
  // session; each refuses the wrong role rather than leaking, like the rest of the panel.
  '/conexion': 'autenticada',
  // PRD-11 radio ingestion: attestation management and the manual relay intake. Behind a
  // session; radio is off per community until a coordinator attests, and RLS is the boundary.
  '/radio': 'autenticada',
  // PRD-35 (§29.3b) the three deferred pieces. The manual zeroth channel (keying in reports
  // before any channel exists), the shared-gazetteer correction desk, and the aggregate
  // coordination read layer. All behind a session; each writes through a gated SECURITY DEFINER
  // door or reads aggregate-only facts, and RLS is the boundary like the rest of the panel.
  '/manual': 'autenticada',
  '/registro': 'autenticada',
  '/coordinacion': 'autenticada',
  // PRD-8 transport of people + PRD-9 funded local purchase. Behind a session; RLS is the
  // boundary (traslados carries PII behind the floor; local purchase is a traceability chain).
  '/traslados': 'autenticada',
  '/compra-local': 'autenticada',
  // Agenda scheduling (PRD-30/31): programas + jornadas. Behind a session; RLS-scoped.
  '/programas': 'autenticada',
  '/jornadas': 'autenticada',
  '/apadrinar': 'autenticada',
  // PRD-29 assessments & recovery (levels 2–4, coverage, bill of materials). Behind a session;
  // RLS is the boundary, and it refuses the wrong role with a legible note like the rest of the panel.
  '/evaluaciones': 'autenticada',
  '/ajustes': 'autenticada',
  '/estado': 'autenticada',
  // PRD-36 staged onboarding. Behind a session; derives setup progress from data.
  '/configuracion-inicial': 'autenticada',
  '/verificacion': 'autenticada',
  '/verificacion/audio/[id]': 'autenticada',
  '/envios': 'autenticada',
  '/envios/[id]': 'autenticada',
  '/envios/[id]/manifiesto': 'autenticada',
  // PRD-13 offline basemap. Behind a session like the rest of the panel; the archive itself is a
  // public static file with no key, but the screen that points at it is not.
  '/mapa-offline': 'autenticada',
  // PRD-47 the vetted lanchero relay: registering a lanchero and keying in what they relayed.
  // Behind a session; each write goes through RLS or the registrar_reporte_relevo gated door.
  '/relevo': 'autenticada',
}

/** Concrete values for the dynamic segments, so a real request can be made. */
const EJEMPLOS: Record<string, string> = {
  '[id]': '00000000-0000-4000-8000-000000000001',
  // A real Better Auth endpoint rather than a made-up segment, so the request exercises the
  // handler instead of bouncing off its 404.
  '[...all]': 'get-session',
}

function rutasDeLaApp(dir = 'app', prefijo = ''): string[] {
  const encontradas: string[] = []

  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada)

    if (statSync(ruta).isDirectory()) {
      // (panel) and friends are route groups: they organise files, not URLs.
      const segmento = entrada.startsWith('(') && entrada.endsWith(')') ? '' : `/${entrada}`
      encontradas.push(...rutasDeLaApp(ruta, prefijo + segmento))
      continue
    }

    if (entrada === 'page.tsx' || entrada === 'route.ts') {
      encontradas.push(prefijo === '' ? '/' : prefijo)
    }
  }

  return encontradas
}

function concreta(ruta: string): string {
  return ruta.replace(/\[[^\]]+\]/g, (seg) => EJEMPLOS[seg] ?? 'x')
}

/** Anything that looks like a place, a person, or a way to reach them. */
const PATRONES_PROHIBIDOS: { nombre: string; patron: RegExp }[] = [
  // Chocó sits around 4–8 N, 75–78 W. Any decimal pair in that box is a real coordinate.
  { nombre: 'coordenada de la cuenca', patron: /\b[4-8]\.\d{3,}\s*,?\s*-7[5-8]\.\d{3,}/ },
  { nombre: 'longitud del Chocó', patron: /-7[5-8]\.\d{4,}/ },
  { nombre: 'teléfono E.164', patron: /\+57\d{10}/ },
  { nombre: 'WKB/GeoJSON de un punto', patron: /"type"\s*:\s*"Point"|0101000020E6100000/i },
]

const NOMBRES_SEMBRADOS = COMUNIDADES_SEMILLA.map((c) => c.nombre)

/** Municipality names are published on purpose; a community name never is. */
const SOLO_COMUNIDADES = NOMBRES_SEMBRADOS.filter(
  (n) => !['Quibdó', 'Yuto', 'Bellavista', 'Beté', 'Paimadó'].includes(n),
)

let servidor: ChildProcess | null = null
let base = ''

async function puertoLibre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, () => {
      const dir = s.address()
      const puerto = typeof dir === 'object' && dir ? dir.port : 0
      s.close(() => resolve(puerto))
    })
  })
}

function correr(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'ignore' })
    p.on('exit', (codigo) => (codigo === 0 ? resolve() : reject(new Error(`${cmd} salió ${codigo}`))))
    p.on('error', reject)
  })
}

/** Newest mtime under a directory, ignoring build output and dependencies. */
function masReciente(dir: string): number {
  let ultimo = 0
  for (const entrada of readdirSync(dir)) {
    if (entrada === 'node_modules' || entrada === '.next') continue
    const ruta = unir(dir, entrada)
    const info = statSync(ruta)
    ultimo = Math.max(ultimo, info.isDirectory() ? masReciente(ruta) : info.mtimeMs)
  }
  return ultimo
}

const FUENTES = ['app', 'lib', 'db', 'middleware.ts', 'next.config.ts']
const HUELLA = '.next/convite-huella.json'

/**
 * What the bundle on disk was built FROM, not when.
 *
 * The first version of this guard compared source mtimes against `.next/BUILD_ID`, and that
 * has a blind spot a rebase walks straight into: `git rebase` can leave a file whose content
 * changed with an mtime older than a bundle built before that content existed. The guard then
 * calls a stale bundle current — which is exactly the failure it was written to stop, wearing
 * a different hat. It fired for real on lane 1's tree, on the rate limiter, twice.
 *
 * So the bundle records the commit it came from. A rebase moves HEAD even when it does not
 * move a single mtime, and the mismatch is unambiguous. mtime stays as the second gate,
 * because uncommitted edits do not move HEAD at all.
 */
function identidadDelArbol(): { head: string; sucio: boolean } {
  const git = (args: string[]) =>
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  try {
    return { head: git(['rev-parse', 'HEAD']), sucio: git(['status', '--porcelain']).length > 0 }
  } catch {
    // No git (a tarball, a container). Fall back to mtime alone rather than never rebuilding.
    return { head: 'sin-git', sucio: true }
  }
}

function construccionVieja(): boolean {
  if (!existsSync('.next/BUILD_ID')) return true
  if (!existsSync(HUELLA)) return true

  const huella = JSON.parse(readFileSync(HUELLA, 'utf8')) as {
    head: string
    sucio: boolean
    mtime: number
  }
  const ahora = identidadDelArbol()

  // Different commit, or a tree that was clean at build and is not now: rebuild.
  if (huella.head !== ahora.head) return true
  if (huella.sucio !== ahora.sucio) return true

  const mtimeActual = Math.max(
    ...FUENTES.filter((f) => existsSync(f)).map((f) =>
      statSync(f).isDirectory() ? masReciente(f) : statSync(f).mtimeMs,
    ),
  )
  return mtimeActual > huella.mtime
}

function anotarHuella(): void {
  const mtime = Math.max(
    ...FUENTES.filter((f) => existsSync(f)).map((f) =>
      statSync(f).isDirectory() ? masReciente(f) : statSync(f).mtimeMs,
    ),
  )
  writeFileSync(HUELLA, JSON.stringify({ ...identidadDelArbol(), mtime }))
}

beforeAll(async () => {
  if (!url) return

  // Build when there is nothing to serve, or when what is there is out of date. Deliberately
  // never skipped: a security test that quietly does not run — or that runs against last
  // week's bundle — is worse than no security test.
  if (construccionVieja()) {
    await correr('npx', ['next', 'build'])
    anotarHuella()
  }

  const puerto = await puertoLibre()
  base = `http://127.0.0.1:${puerto}`
  servidor = spawn('npx', ['next', 'start', '-p', String(puerto)], {
    stdio: 'ignore',
    env: { ...process.env },
  })

  const limite = Date.now() + 60_000
  for (;;) {
    try {
      await fetch(`${base}/`, { redirect: 'manual' })
      break
    } catch {
      if (Date.now() > limite) throw new Error('El servidor no arrancó.')
      await new Promise((r) => setTimeout(r, 300))
    }
  }
}, 180_000)

afterAll(() => {
  servidor?.kill('SIGTERM')
})

conBase('toda la superficie, no solo la página', () => {
  it('la página pública está declarada pública en el middleware', () => {
    /*
     * Sin esto la prueba pasa por la razón equivocada: una página que no figura como
     * pública responde 307 al inicio de sesión, y «no hay coordenadas en la respuesta»
     * se cumple contra la pantalla de login sin decir nada de la página. Verde por el
     * motivo contrario al que se buscaba, justo en la prueba que existe para el límite.
     */
    expect(esRutaPublica('/')).toBe(true)
    // The response page moved off the root; its leak-safety below only means anything if the
    // middleware still lets a stranger reach it instead of bouncing them to the login.
    expect(esRutaPublica('/respuesta')).toBe(true)
    expect(esRutaPublica('/tablero')).toBe(false)
  })

  it('conoce todas las rutas de la app, sin lista escrita a mano', () => {
    const rutas = rutasDeLaApp()
    expect(rutas.length).toBeGreaterThan(10)

    const sinClasificar = rutas.filter((r) => !(r in POLITICA))
    // Si esto falla es porque alguien añadió una ruta: decida qué es y anótela arriba.
    expect(sinClasificar, `rutas nuevas sin clasificar: ${sinClasificar.join(', ')}`).toEqual([])
  })

  it('ninguna ruta autenticada entrega datos a un desconocido', async () => {
    const autenticadas = rutasDeLaApp().filter((r) => POLITICA[r] === 'autenticada')
    expect(autenticadas.length).toBeGreaterThan(5)

    for (const ruta of autenticadas) {
      const respuesta = await fetch(`${base}${concreta(ruta)}`, { redirect: 'manual' })
      const cuerpo = await respuesta.text()

      /*
       * Un desconocido puede ser rechazado de tres formas legítimas, y ninguna es 200:
       * lo mandan al login (3xx) cuando hay identidad configurada, se lo niegan (401/403),
       * o le dicen que la identidad no está configurada (503). Lo que nunca puede pasar es
       * que la página se dibuje.
       */
      expect(
        [301, 302, 303, 307, 308, 401, 403, 404, 503].includes(respuesta.status),
        `${ruta} devolvió ${respuesta.status} a un desconocido`,
      ).toBe(true)

      for (const { nombre, patron } of PATRONES_PROHIBIDOS) {
        expect(patron.test(cuerpo), `${ruta} filtró ${nombre}`).toBe(false)
      }
      for (const comunidad of SOLO_COMUNIDADES) {
        expect(cuerpo.includes(comunidad), `${ruta} nombró a ${comunidad}`).toBe(false)
      }
    }
  })

  it('las rutas públicas no filtran coordenadas, nombres de comunidad ni teléfonos', async () => {
    const publicas = rutasDeLaApp().filter((r) => POLITICA[r] === 'publica')

    for (const ruta of publicas) {
      const respuesta = await fetch(`${base}${concreta(ruta)}`, { redirect: 'manual' })
      const cuerpo = await respuesta.text()

      for (const { nombre, patron } of PATRONES_PROHIBIDOS) {
        expect(patron.test(cuerpo), `${ruta} filtró ${nombre}`).toBe(false)
      }
      for (const comunidad of SOLO_COMUNIDADES) {
        expect(cuerpo.includes(comunidad), `${ruta} nombró a ${comunidad}`).toBe(false)
      }
    }
  })

  it('la página pública muestra conteos y nada más', async () => {
    const respuesta = await fetch(`${base}/respuesta`)
    expect(respuesta.status).toBe(200)
    const cuerpo = await respuesta.text()

    expect(cuerpo).toContain('Convite')
    // Los municipios de una sola comunidad se pliegan: la fila no habla de un pueblo.
    expect(cuerpo).not.toContain('Bojayá')
    expect(cuerpo).not.toContain('Medio Atrato')
    expect(cuerpo).not.toContain('Río Quito')
  })

  it('la página pública se puede cachear; el panel nunca', async () => {
    const publica = await fetch(`${base}/respuesta`)
    const cabecera = publica.headers.get('cache-control') ?? ''
    // `s-maxage` is the shared-cache directive; Next emits it from `revalidate` without the
    // literal `public` token. What matters is that a cache may hold it and that nothing
    // marks it private.
    expect(cabecera).toMatch(/s-maxage=\d+|public/)
    expect(cabecera).not.toMatch(/private|no-store/)

    const panel = await fetch(`${base}/tablero`, { redirect: 'manual' })
    expect(panel.headers.get('cache-control') ?? '').not.toMatch(/\bpublic\b/)
  })

  it('el límite por IP responde 429 antes de reventar la base', async () => {
    // La ventana es de 60 por minuto; se piden bastantes más de golpe.
    const respuestas = await Promise.all(
      Array.from({ length: 90 }, () => fetch(`${base}/respuesta`, { redirect: 'manual' })),
    )
    const codigos = respuestas.map((r) => r.status)
    expect(codigos).toContain(429)
  })
})

conBase('lo que responden las rutas que sí son públicas', () => {
  it('el webhook falla cerrado y sin contar por qué', async () => {
    const respuesta = await fetch(`${base}/api/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intento: 'sin firma' }),
    })

    // Cerrado, y sin haber procesado nada.
    expect(respuesta.status).toBeGreaterThanOrEqual(400)
    expect(respuesta.status).toBeLessThan(500)

    const cuerpo = (await respuesta.text()).toLowerCase()

    /*
     * Que diga «firma inválida» se revisó y se deja pasar: el esquema de firma de Meta es
     * público y documentado, así que nombrarlo no le enseña nada a nadie. Lo que sí sería
     * un problema es que el error se lleve por delante algo de adentro — el secreto, un
     * digest calculado, una variable de entorno, una traza — porque eso sí es material para
     * seguir intentando.
     */
    for (const filtracion of [
      'whatsapp_app_secret',
      'process.env',
      'at async',
      'node_modules',
      '/users/',
      'sha256=',
    ]) {
      expect(cuerpo.includes(filtracion), `el webhook filtró «${filtracion}»`).toBe(false)
    }

    // Y nunca datos de la cuenca, que es lo que M12 exige de verdad.
    for (const { nombre, patron } of PATRONES_PROHIBIDOS) {
      expect(patron.test(cuerpo), `el webhook filtró ${nombre}`).toBe(false)
    }
  })

  it('salud responde conteos, sin datos de nadie', async () => {
    const respuesta = await fetch(`${base}/api/salud`, { redirect: 'manual' })
    const cuerpo = await respuesta.text()

    for (const { nombre, patron } of PATRONES_PROHIBIDOS) {
      expect(patron.test(cuerpo), `salud filtró ${nombre}`).toBe(false)
    }
    for (const comunidad of SOLO_COMUNIDADES) {
      expect(cuerpo.includes(comunidad), `salud nombró a ${comunidad}`).toBe(false)
    }
  })
})
