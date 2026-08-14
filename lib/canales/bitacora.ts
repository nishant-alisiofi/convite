import type { Pool, PoolClient } from 'pg'
import type { SobreEntrante } from './tipos'

/**
 * The message log, and the idempotency check that guards everything behind it.
 *
 * Non-negotiable 2.7: every provider retries — on a slow response, on a non-200, sometimes
 * for no visible reason at all. So the insert *is* the check. We write the envelope to
 * `mensajes` before anything downstream runs, and a duplicate loses the race against the
 * partial unique index `mensajes_proveedor_id_key` rather than against a SELECT we did a
 * moment earlier.
 *
 * The index is on `(proveedor, proveedor_mensaje_id)`, which is why the envelope carries a
 * `proveedor` the draft contract does not have. `docs/contrato-evento-canonico.md` §3 says
 * `(canal, id_externo)`; the database disagrees and the database is what enforces it.
 *
 * This writes the bitácora row and nothing else. Resolving the contact and the community,
 * applying catalogue rules and creating the `reporte` all belong to the core (contract §4),
 * and classification belongs to the normalizer, which is M4 and does not exist yet.
 */

export type ResultadoRegistro =
  | { estado: 'registrado'; mensajeId: string }
  | { estado: 'duplicado' }

export async function registrarEntrante(
  ejecutor: Pool | PoolClient,
  sobre: SobreEntrante,
  organizacionId: string,
): Promise<ResultadoRegistro> {
  const { rows } = await ejecutor.query<{ id: string }>(
    `insert into mensajes
       (organizacion_id, proveedor, proveedor_mensaje_id, direccion, canal,
        telefono, cuerpo, estado, payload, creado_en)
     values ($1, $2, $3, 'entrante', $4, $5, $6, 'recibido', $7, $8)
     on conflict (proveedor, proveedor_mensaje_id)
       where proveedor_mensaje_id is not null
       do nothing
     returning id`,
    [
      organizacionId,
      sobre.proveedor,
      sobre.idExterno,
      sobre.canal,
      sobre.telefono,
      sobre.contenido.texto,
      JSON.stringify(sobre.payloadCrudo),
      sobre.recibidoEn,
    ],
  )

  const id = rows[0]?.id
  // No row back means the index refused it: we have seen this message before. The provider
  // gets a 200 either way — anything else buys us the same payload again in a minute.
  return id ? { estado: 'registrado', mensajeId: id } : { estado: 'duplicado' }
}
