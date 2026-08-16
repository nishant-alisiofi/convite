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
 * Small-cell threshold for the public breakdown (PRD v3 D7, §4.8, §17).
 *
 * A single zone×category count — «Bajo Baudó · Salud · 1 en espera» — approaches identifying a
 * household in a sparsely populated municipality, in a territory with armed-actor presence. So
 * any published count below this is never shown exactly: the category cell is rolled into an
 * «Otras» row, and a residual sub-threshold total is coarsened to «menos de k». One documented
 * constant so it can be tuned per territory. `mapa_publico` already folds municipalities with
 * fewer than three communities (migration 0027); this guards the category split within a zone,
 * which that fold does not.
 */
export const K_MINIMO_PUBLICO = 4

/** A zone×category cell as it is safe to publish. */
export type CeldaPublica = {
  familiaLabel: string
  /** True for the rolled-up bucket of suppressed small cells. */
  esOtras: boolean
  pendientes: number
  atendidos: number
  /** «3», «0», or «menos de 4» — never an exact sub-threshold count. */
  pendientesTexto: string
  atendidosTexto: string
}

export type ZonaPublica = {
  municipio: string
  items: CeldaPublica[]
  pendientes: number
  atendidos: number
}

export type AgregadoPublico = {
  zonas: ZonaPublica[]
  totalPendientes: number
  totalAtendidos: number
}

/** «3», «0», or «menos de k» — an exact count only when it cannot identify a household. */
function textoConteo(n: number, k: number): string {
  return n > 0 && n < k ? `menos de ${k}` : String(n)
}

/**
 * The public breakdown, with small-cell disclosure suppressed (PRD v3 D7).
 *
 * Per zone: any category whose «en espera» count is a small nonzero number is pulled out and
 * summed into a single «Otras» row, so no zone×category pending count below `k` is ever shown —
 * and the category itself is hidden, which is what makes «zone + category» stop narrowing to a
 * household. Any residual count still below `k` (a lone suppressed cell, or a small «Otras»
 * total) is rendered coarsely as «menos de k» rather than as the raw number. Totals are the
 * true sums — an aggregate over the whole territory identifies nobody.
 */
export function agregarPublico(filas: FilaPublica[], k = K_MINIMO_PUBLICO): AgregadoPublico {
  const conDatos = filas.filter((f) => f.pendientes > 0 || f.atendidos > 0)
  const totalPendientes = conDatos.reduce((n, f) => n + f.pendientes, 0)
  const totalAtendidos = conDatos.reduce((n, f) => n + f.atendidos, 0)

  const porMunicipio = new Map<string, FilaPublica[]>()
  for (const f of conDatos) {
    const lista = porMunicipio.get(f.municipio) ?? []
    lista.push(f)
    porMunicipio.set(f.municipio, lista)
  }

  const zonas: ZonaPublica[] = []
  for (const [municipio, celdas] of porMunicipio) {
    // A cell is safe to show on its own only when its pending count cannot point at a
    // household: zero, or at least k. Everything else is rolled into «Otras».
    const visibles = celdas.filter((c) => c.pendientes === 0 || c.pendientes >= k)
    const suprimidas = celdas.filter((c) => c.pendientes > 0 && c.pendientes < k)

    const items: CeldaPublica[] = visibles.map((c) => ({
      familiaLabel: c.familiaLabel,
      esOtras: false,
      pendientes: c.pendientes,
      atendidos: c.atendidos,
      pendientesTexto: textoConteo(c.pendientes, k),
      atendidosTexto: textoConteo(c.atendidos, k),
    }))

    if (suprimidas.length > 0) {
      const pendientes = suprimidas.reduce((n, c) => n + c.pendientes, 0)
      const atendidos = suprimidas.reduce((n, c) => n + c.atendidos, 0)
      items.push({
        familiaLabel: 'Otras',
        esOtras: true,
        pendientes,
        atendidos,
        pendientesTexto: textoConteo(pendientes, k),
        atendidosTexto: textoConteo(atendidos, k),
      })
    }

    zonas.push({
      municipio,
      items,
      pendientes: celdas.reduce((n, c) => n + c.pendientes, 0),
      atendidos: celdas.reduce((n, c) => n + c.atendidos, 0),
    })
  }

  return { zonas, totalPendientes, totalAtendidos }
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
