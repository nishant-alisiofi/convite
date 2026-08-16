import type { PoolClient } from 'pg'
import { TEMPORADAS, TEMPORADAS_OPERATIVAS } from '@/db/schema/vocabulario'
import type { TemporadaActual } from '@/lib/matching/tipos'

/**
 * Which season the basin is in.
 *
 * This is the single most consequential value in the system that nothing validates for you.
 * `rutas.temporada` filters the reachability graph, so the answer here decides which
 * communities the engine believes can be reached at all: Winandó has no route row in
 * `seca`, and the Atrato trunk is slower and dearer in every leg. Set it wrong and nothing
 * fails — the plans simply come out wrong, and the only visible symptom is a community
 * quietly dropping out of the board.
 *
 * It lived in `CONVITE_TEMPORADA` until M8. It now lives in `configuracion`, where changing
 * it is an admin action with an `auditoria` row naming whoever flipped it (migration 0020).
 * The environment variable survives as the fallback, so a fresh clone, a migration that has
 * not run yet, or a stray deploy still resolves to something sane instead of throwing.
 */

export const CLAVE_TEMPORADA = 'temporada'

/**
 * Human labels for the season enum. The stored values are code (`todo_el_ano`, `lluvias`,
 * `seca`); a coordinator should never see the raw enum in a control or a list (PRD v3 D4).
 */
export const ETIQUETA_TEMPORADA: Record<(typeof TEMPORADAS)[number], string> = {
  todo_el_ano: 'Todo el año',
  lluvias: 'Lluvias',
  seca: 'Seca',
}

/** «Todo el año» for `todo_el_ano`, etc.; falls back to the raw value rather than crashing. */
export function etiquetaTemporada(valor: string): string {
  return ETIQUETA_TEMPORADA[valor as (typeof TEMPORADAS)[number]] ?? valor
}

function esTemporada(valor: string | undefined): valor is TemporadaActual {
  return TEMPORADAS_OPERATIVAS.includes(valor as TemporadaActual)
}

/**
 * The fallback. Chocó is one of the wettest places on earth, so `lluvias` is the normal
 * state and the safe default — assuming `seca` would close river legs that are in fact open.
 */
export function temporadaDeEntorno(): TemporadaActual {
  return esTemporada(process.env.CONVITE_TEMPORADA) ? process.env.CONVITE_TEMPORADA : 'lluvias'
}

/**
 * The season the engine should resolve for: the stored setting, or the environment when no
 * row exists yet. An unrecognised stored value falls back rather than propagating — the
 * check constraint in 0020 should make that impossible, and if it ever happens the engine
 * planning against `lluvias` beats it planning against nonsense.
 */
export async function temporadaVigente(client: PoolClient): Promise<TemporadaActual> {
  const { rows } = await client.query<{ valor: string }>(
    'select valor from configuracion where clave = $1',
    [CLAVE_TEMPORADA],
  )
  const valor = rows[0]?.valor
  return esTemporada(valor) ? valor : temporadaDeEntorno()
}

/**
 * Records the change. The `auditoria` row is written by a trigger, not here, so a season
 * flipped from a script or a psql session is logged the same way as one flipped on screen.
 *
 * Must run inside a session that has assumed the caller's identity (`conSesion`): the RLS
 * policy requires `actualizado_por = auth.uid()`, so an admin can only sign their own name.
 */
export async function fijarTemporada(
  client: PoolClient,
  temporada: TemporadaActual,
  usuarioId: string,
): Promise<void> {
  await client.query(
    `update configuracion set valor = $2, actualizado_por = $3 where clave = $1`,
    [CLAVE_TEMPORADA, temporada, usuarioId],
  )
}
