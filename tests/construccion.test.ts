import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The build has to succeed on a machine that has no database.
 *
 * Railway hands `DATABASE_URL` and private networking to the **runtime**. The build
 * container never has them and never will. So any page Next decides to prerender at build
 * time — anything with `revalidate`, or with neither `revalidate` nor `force-dynamic` and no
 * dynamic API in its tree — opens a connection during `next build` and takes the deploy down
 * with «Configuración inválida: DATABASE_URL: Required».
 *
 * That is exactly how staging failed: the public page had `revalidate = 60`, which looked
 * right (the counts move when the matcher sweeps, not per request) and was wrong for the one
 * reason nobody tests for locally — a developer's `.env` supplies DATABASE_URL at build, so
 * `pnpm build` passes on every laptop and fails on every deploy.
 *
 * Checking the manifest rather than re-running the build keeps this in the normal suite: it
 * is instant, and it fails the moment any new page becomes static, which is the regression
 * that matters. `pnpm build:limpio` runs the real thing in Railway's shape.
 */

const PERMITIDAS_ESTATICAS = new Set([
  // A 404 page that touches nothing. Prerendering it is free and correct.
  '/_not-found',
  // The landing page, now the site root: static marketing content, no database read.
  // Prerendering is free and correct, and it must NOT become dynamic — that would open a DB
  // connection at build. The live response moved to `/respuesta`, which stays dynamic.
  '/',
  // robots.txt: generated from a static rule set, no database. Free and correct to prerender.
  '/robots.txt',
  // The public legal pages (Ley 1581 + Meta app review): privacy policy, terms of service, and
  // data-deletion instructions. Pure static content with no database read — free and correct to
  // prerender, and they must stay that way (a DB read here would be a build-time connection).
  '/privacidad',
  '/terminos',
  '/eliminar-datos',
  // The intent router (§1, «¿Qué quiere hacer?»). Four doors and their descriptions, all of it
  // literal — it reads nothing and must keep reading nothing: this is the screen somebody meets
  // before they are anybody, so a database call here would be a build-time connection for a page
  // with no session to scope it anyway.
  '/entrada',
])

describe('la construcción sobrevive sin base de datos', () => {
  it('ninguna página se prerenderiza salvo las que no tocan nada', () => {
    const ruta = '.next/prerender-manifest.json'
    if (!existsSync(ruta)) {
      throw new Error('No hay build. Corra `pnpm build` antes de esta prueba.')
    }

    const manifiesto = JSON.parse(readFileSync(ruta, 'utf8')) as {
      routes: Record<string, unknown>
    }
    const estaticas = Object.keys(manifiesto.routes ?? {})
    const inesperadas = estaticas.filter((r) => !PERMITIDAS_ESTATICAS.has(r))

    expect(
      inesperadas,
      `estas rutas se generan en tiempo de build y por tanto necesitan la base ahí: ` +
        `${inesperadas.join(', ')}. Póngales \`export const dynamic = 'force-dynamic'\`, ` +
        `o añádalas arriba si de verdad no consultan nada.`,
    ).toEqual([])
  })

  it('la página pública se sirve por petición', () => {
    const manifiesto = JSON.parse(
      readFileSync('.next/prerender-manifest.json', 'utf8'),
    ) as { routes: Record<string, unknown> }

    // La respuesta en vivo vive en `/respuesta` y se sirve por petición — no de una cáscara
    // construida sin base: esa diría «todavía no hay solicitudes registradas», que no es un
    // número viejo sino uno falso.
    expect(Object.keys(manifiesto.routes ?? {})).not.toContain('/respuesta')
  })
})
