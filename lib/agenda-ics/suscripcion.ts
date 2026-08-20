import type { PoolClient } from 'pg'

/**
 * The membership-facing half of the Agenda feed — PRD-34 §28.1's «show/copy the subscribe URL»
 * affordance, still missing as of the Codex review that reopened this slice (aa02969): the
 * token and the feed have existed since the first cut, but nothing in the panel ever showed a
 * person their own link. `lib/agenda-ics/token.ts` mints the secret and `feed.ts` reads what it
 * unlocks; this is the read the new /agenda screen makes to know WHICH membership(s) the
 * signed-in person may mint a link for.
 *
 * Read under RLS, like every screen: `membresias_propias` (0047) is `usuario_id = auth.uid()`,
 * so this can never surface anyone else's membership — no admin escalation path, no
 * cross-person lookup. A person with memberships in more than one organisation (§29.5) gets one
 * row, one link, per membership: each link only ever unlocks that one membership's own feed
 * (`membresiaActivaParaFeed` re-checks `activa` on every request, so this list and the feed can
 * never drift apart).
 */
export type MembresiaPropia = {
  id: string
  organizacionId: string
  /** Null when the org read is out of reach under RLS (`organizaciones_lectura`, 0017) — the
   * link still works, this is display-only. */
  organizacionNombre: string | null
  rol: string
}

/** This session's own ACTIVE memberships — the set `/agenda` offers a subscribe link for. */
export async function misMembresiasActivas(
  client: PoolClient,
  usuarioId: string,
): Promise<MembresiaPropia[]> {
  const { rows } = await client.query<{
    id: string
    organizacion_id: string
    organizacion_nombre: string | null
    rol: string
  }>(
    `select m.id, m.organizacion_id, o.nombre as organizacion_nombre, m.rol
       from membresias m
       left join organizaciones o on o.id = m.organizacion_id
      where m.usuario_id = $1
        and m.estado = 'activa'
        and (m.vence_en is null or m.vence_en > now())
      order by m.creado_en`,
    [usuarioId],
  )
  return rows.map((r) => ({
    id: r.id,
    organizacionId: r.organizacion_id,
    organizacionNombre: r.organizacion_nombre,
    rol: r.rol,
  }))
}
