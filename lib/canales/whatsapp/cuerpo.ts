/**
 * Reading the body of a request nobody has authenticated yet.
 *
 * The webhook URL is public and takes unauthenticated POSTs, so whoever is on the other end
 * decides how much we read. `request.text()` gives them the whole decision: it buffers
 * everything that arrives and only then hands it over, so by the time the size could be
 * measured it has already been paid for — and a chunked request declares no size at all.
 * One long POST is then enough to spend the intake's memory, on the endpoint the basin's
 * reports arrive through.
 *
 * So the read is capped. A declared `content-length` over the cap is refused without reading
 * a byte, and everything else is pulled a chunk at a time and cancelled the moment the total
 * goes over — which makes a lie in `content-length`, or its absence, uninteresting.
 *
 * Bytes, not text: the HMAC is over what arrived (see ./firma.ts), and decoding before
 * verifying is the same mistake as parsing before verifying.
 */

/**
 * The most body we will hold for a request nobody has authenticated yet.
 *
 * Meta's webhooks are small — a message is on the order of a kilobyte, and a batch is a batch
 * of messages, not of media, because media arrives as a reference we download later (2.6).
 * 256 KB is hundreds of messages in one POST, well past anything Meta sends, and still an
 * amount of memory we are content to lose to a stranger.
 */
export const LIMITE_CUERPO_BYTES = 256 * 1024

export type Lectura = { ok: true; cuerpo: Buffer } | { ok: false; motivo: string }

export async function leerAcotado(
  request: Request,
  limite: number = LIMITE_CUERPO_BYTES,
): Promise<Lectura> {
  const declarado = request.headers.get('content-length')
  if (declarado !== null) {
    const bytes = Number(declarado)
    if (!Number.isInteger(bytes) || bytes < 0) {
      return { ok: false, motivo: `content-length ilegible: «${declarado}».` }
    }
    if (bytes > limite) {
      return { ok: false, motivo: `content-length ${bytes} supera ${limite} bytes.` }
    }
  }

  if (!request.body) return { ok: true, cuerpo: Buffer.alloc(0) }

  const lector = request.body.getReader()
  const trozos: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await lector.read()
      if (done) break
      total += value.byteLength
      if (total > limite) {
        // The rest of an oversized body is not ours to buffer.
        await lector.cancel().catch(() => undefined)
        return { ok: false, motivo: `El cuerpo supera ${limite} bytes.` }
      }
      trozos.push(Buffer.from(value))
    }
  } finally {
    lector.releaseLock()
  }

  return { ok: true, cuerpo: Buffer.concat(trozos) }
}
