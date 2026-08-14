import type { PoolClient } from 'pg'

/**
 * Non-negotiable 2.15: perishables expire out of the queue automatically, and the person
 * who offered them is told it lapsed.
 *
 * Letting a lapsed offer sit as DISPONIBLE is worse than having no offer at all: a
 * coordinator plans a run around food that is already spoiled. And a donor whose offer
 * quietly vanished is a donor who does not offer again.
 *
 * The notice goes into `salidas_pendientes` rather than being sent here — the outbound
 * policy of 2.14 decides channel and timing, and this job has no business bypassing it.
 */
export async function vencerOfertas(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ id: string; contacto_id: string; texto_original: string }>(
    `update ofertas
        set estado = 'VENCIDA'
      where estado = 'DISPONIBLE'
        and perecedero
        and vence_en <= now()
     returning id, contacto_id, texto_original`,
  )

  for (const oferta of rows) {
    await client.query(
      `insert into salidas_pendientes (contacto_id, cuerpo, prioridad, canal_sugerido)
         values ($1, $2, 4, null)`,
      [
        oferta.contacto_id,
        // Useful on its own if it is the last message that gets through (2.13).
        'Convite: no alcanzamos a recoger lo que ofreció y ya se venció. ' +
          'Mil gracias de todas formas. Si tiene algo más, escríbanos.',
      ],
    )
  }

  return rows.length
}
