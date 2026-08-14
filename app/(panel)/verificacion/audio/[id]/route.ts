import { NextResponse } from 'next/server'
import { almacenamientoLocal } from '@/lib/canales/almacenamiento'
import { conSesion, sesionActual } from '@/lib/sesion'

/**
 * Serves a voice note to the verification screen.
 *
 * The audio never leaves through a provider URL (2.6) — it is our own object, fetched from
 * storage by its key, behind a session.
 *
 * Note the join. `adjuntos_lectura` grants any staff role the whole attachments table, but
 * `reportes_lectura` scopes a verificador to their own communities — so reading the key
 * *through* `reportes` inherits that scoping, and a verifier for the Atrato medio cannot
 * pull the audio of a report from Río Quito by guessing an id. The query does not filter;
 * the policy does.
 */

export const dynamic = 'force-dynamic'

export async function GET(_peticion: Request, { params }: { params: Promise<{ id: string }> }) {
  const sesion = await sesionActual()
  if (!sesion) return new NextResponse('No autorizado', { status: 401 })

  const { id } = await params

  const adjunto = await conSesion(sesion, async (client) => {
    const { rows } = await client.query<{ storage_key: string; mime: string | null }>(
      `select a.storage_key, a.mime
         from adjuntos a
         join reportes r on r.id = a.reporte_id
        where a.id = $1 and a.tipo = 'audio'`,
      [id],
    )
    return rows[0] ?? null
  })

  if (!adjunto) return new NextResponse('No encontrado', { status: 404 })

  let bytes: Buffer
  try {
    bytes = await almacenamientoLocal().leer(adjunto.storage_key)
  } catch {
    // The row exists and the file does not: the download failed, or storage moved. Say so
    // rather than serving an empty player that looks like silence on the recording.
    return new NextResponse('El audio no está disponible', { status: 404 })
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': adjunto.mime ?? 'application/octet-stream',
      'Content-Length': String(bytes.byteLength),
      // Never cached anywhere shared: this is a person's voice describing where they live.
      'Cache-Control': 'private, no-store',
    },
  })
}
