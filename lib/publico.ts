import type { PoolClient } from 'pg'
import { getPool } from '@/db/client'

/**
 * The public surface.
 *
 * Section 3: we do not expose PostgREST, so the public page is served from our own route.
 * That was chosen for caching and rate limiting, and it has a second consequence worth
 * being deliberate about — nothing forces this code to be `anon`. It could read the base
 * tables with the owner role and nobody would notice until a coordinate appeared on a
 * public page.
 *
 * So it assumes `anon` explicitly. The boundary an unauthenticated visitor hits is the same
 * boundary the RLS tests assert: if a future edit adds `select nombre from comunidades` to
 * this page, it returns nothing rather than publishing a village's name. The policy is the
 * boundary; this function just refuses to stand outside it.
 */
export async function conAnon<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('begin')
    // No JWT claims at all: this is a caller with no identity, which is what anon means.
    await client.query('set local role anon')
    const resultado = await fn(client)
    await client.query('rollback')
    return resultado
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

export type FilaPublica = {
  municipio: string
  familiaLabel: string
  pendientes: number
  atendidos: number
}

/**
 * Everything the public is allowed to know, which is four columns of counts.
 *
 * `mapa_publico` is the only object granted to `anon` in the whole database. Municipalities
 * holding fewer than three communities are folded into one basin-wide bucket, because a
 * municipality that is one village is that village (migration 0027).
 */
export async function cargarMapaPublico(): Promise<FilaPublica[]> {
  return conAnon(async (client) => {
    const { rows } = await client.query<{
      municipio: string
      familia_label: string
      pendientes: string
      atendidos: string
    }>(
      `select municipio, familia_label, pendientes, atendidos
         from mapa_publico
        order by municipio, familia_label`,
    )
    return rows.map((r) => ({
      municipio: r.municipio,
      familiaLabel: r.familia_label,
      pendientes: Number(r.pendientes),
      atendidos: Number(r.atendidos),
    }))
  })
}
