import { redirect } from 'next/navigation'
import { cargarManifiesto, croquisDe } from '@/lib/despacho/manifiesto'
import HojaManifiesto from './hoja'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * The sheet that goes on the boat.
 *
 * HTML with a print stylesheet rather than a generated PDF: no dependency, no font
 * embedding, and the browser's own print dialogue already produces a PDF when somebody needs
 * to send one over WhatsApp. It has to survive being folded, rained on and read by
 * torchlight, so it is black on white, large type, and everything not on the trip is hidden
 * when printing.
 */

export default async function Manifiesto({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { id } = await params
  const manifiesto = await conSesion(sesion, (client) => cargarManifiesto(client, id))
  if (!manifiesto) redirect('/envios')

  const croquis = croquisDe(manifiesto)

  return <HojaManifiesto manifiesto={manifiesto} croquis={croquis} enlaceVolver={`/envios/${id}`} />
}
