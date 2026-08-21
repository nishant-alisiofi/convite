import { getPool } from '@/db/client'

/**
 * The self-service donor path (docs/tipos-de-usuario-y-accesos.md §2.2).
 *
 * That document has called this «Nuevo» since it was written, and `ofertas` rows have only ever
 * been created by the seed: both its policies are staff-only, so an offer could exist only once a
 * coordinator had been told about it by some other means and typed it in. Giving was the one
 * thing a stranger arrived wanting to do and the one thing they could not do.
 *
 * Runs on the owner pool rather than a session, because a donor has no session — that is the
 * point of the persona. The whole surface is one SECURITY DEFINER function (migration 0068) that
 * creates or reuses a `donante` contact and writes a single offer; it grants no read, no session
 * and no panel. Invariant 2.10 holds: a number on an offer opens nothing.
 */

export type OrganizacionQueRecibe = { id: string; nombre: string; municipio: string | null }

/**
 * Who a donor may offer to.
 *
 * Approved and not an `aportante` — those are the one-person organisations FR-18 mints for a
 * self-registered transporter, which have no desk to receive anything. This list is deliberately
 * the only thing this module reads: it is public, so it must expose nothing but a name.
 */
export async function organizacionesQueReciben(): Promise<OrganizacionQueRecibe[]> {
  const { rows } = await getPool().query<OrganizacionQueRecibe>(
    `select o.id, o.nombre, c.municipio
       from organizaciones o
       left join lateral (
         select municipio from comunidades
          where organizacion_id = o.id and activa
          order by municipio limit 1
       ) c on true
      where o.estado_aprobacion = 'aprobada'
        and o.activo
        and coalesce(o.nivel_admision, '') <> 'aportante'
      order by o.nombre`,
  )
  return rows
}

export async function registrarOfertaDonante(args: {
  organizacionId: string
  nombre: string
  telefono: string
  texto: string
  codigoItem?: string | null
  cantidad?: number | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await getPool().query(
      `select registrar_oferta_donante($1, $2, $3, $4, $5, $6, null)`,
      [
        args.organizacionId,
        args.nombre,
        args.telefono,
        args.texto,
        args.codigoItem?.trim() || null,
        args.cantidad ?? null,
      ],
    )
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudo registrar el aporte.',
    }
  }
}
