import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/webhooks/whatsapp/route'
import { CABECERA_FIRMA, firmar, LIMITE_CUERPO_BYTES } from '@/lib/canales'
import { WEBHOOK_TEXTO } from './fixtures/whatsapp'

/**
 * The webhook route itself.
 *
 * The rejection paths are the ones worth asserting here: the URL is public, Meta sends no
 * bearer token, and everything downstream trusts that whatever got past this file was signed
 * by someone holding the app secret. None of these cases touches the database — the route
 * refuses before it enqueues, and the one case that does get that far has the queue stubbed
 * — so this runs without one.
 */

const encolar = vi.hoisted(() => vi.fn(async () => 'job-de-prueba'))

// The accepted case has to prove the payload reaches the queue, and that is the whole of
// what the route does with it. Stubbed rather than run against a database, because every
// other case in this file is a refusal that never gets near one.
vi.mock('@/lib/jobs/cola', () => ({ encolar }))
vi.mock('@/db/client', () => ({ getPool: () => ({}) }))

const SECRETO = 'un-app-secret-de-prueba'
const TOKEN = 'un-verify-token'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  encolar.mockClear()
})

function peticion(cuerpo: string, firma: string | null): Request {
  return new Request('https://convite.test/api/webhooks/whatsapp', {
    method: 'POST',
    body: cuerpo,
    headers: firma ? { [CABECERA_FIRMA]: firma } : {},
  })
}

/**
 * A body that reports how much of itself was actually pulled.
 *
 * The point of the size rules is not the status code — it is that we stop reading. A test
 * that only asserted the 413 would still pass on a route that buffered a gigabyte first.
 */
function cuerpoContado(trozos: number, tamano: number) {
  let entregados = 0
  const flujo = new ReadableStream<Uint8Array>(
    {
      pull(controlador) {
        if (entregados >= trozos) {
          controlador.close()
          return
        }
        entregados += 1
        controlador.enqueue(new Uint8Array(tamano))
      },
    },
    // highWaterMark 0, so a chunk is produced only when somebody asks for one. The default
    // strategy fills the queue on construction, which would count a chunk nobody read.
    { highWaterMark: 0 },
  )
  return { flujo, leidos: () => entregados * tamano }
}

function peticionEnStream(
  flujo: ReadableStream<Uint8Array>,
  cabeceras: Record<string, string>,
): Request {
  return new Request('https://convite.test/api/webhooks/whatsapp', {
    method: 'POST',
    body: flujo,
    headers: cabeceras,
    // Node needs this to accept a streaming request body; it is not in the DOM lib's types.
    duplex: 'half',
  } as RequestInit)
}

describe('la verificación del webhook (GET)', () => {
  it('devuelve el desafío en texto plano cuando el token coincide', async () => {
    vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', TOKEN)
    const respuesta = await GET(
      new Request(
        `https://convite.test/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${TOKEN}&hub.challenge=1158201444`,
      ),
    )

    expect(respuesta.status).toBe(200)
    // Meta wants the bare challenge, not JSON. Wrapping it fails the subscription.
    expect(await respuesta.text()).toBe('1158201444')
    expect(respuesta.headers.get('content-type')).toContain('text/plain')
  })

  it('rechaza un token que no es el nuestro', async () => {
    vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', TOKEN)
    const respuesta = await GET(
      new Request(
        'https://convite.test/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=adivinado&hub.challenge=1',
      ),
    )
    expect(respuesta.status).toBe(403)
  })

  it('no se deja verificar si no hay token configurado', async () => {
    vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', '')
    const respuesta = await GET(
      new Request(
        'https://convite.test/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=&hub.challenge=1',
      ),
    )
    expect(respuesta.status).toBe(503)
  })
})

describe('la entrada del webhook (POST)', () => {
  it('rechaza y deja constancia de una firma inválida', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', SECRETO)
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cuerpo = JSON.stringify(WEBHOOK_TEXTO)

    const respuesta = await POST(peticion(cuerpo, 'sha256=0000'))

    expect(respuesta.status).toBe(401)
    // A run of these is somebody probing the endpoint, which is worth being able to see.
    expect(aviso).toHaveBeenCalledOnce()
    expect(String(aviso.mock.calls[0]![0])).toContain('firma rechazada')
  })

  it('rechaza un cuerpo alterado después de firmar', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', SECRETO)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const original = JSON.stringify(WEBHOOK_TEXTO)
    const firma = firmar(original, SECRETO)

    const respuesta = await POST(peticion(original.replace('12 familias', '400 familias'), firma))
    expect(respuesta.status).toBe(401)
  })

  it('rechaza cuando no hay cabecera de firma', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', SECRETO)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await POST(peticion(JSON.stringify(WEBHOOK_TEXTO), null))).status).toBe(401)
  })

  it('falla cerrado si no hay app secret configurado', async () => {
    // Without this the endpoint would be an open write path into a humanitarian response.
    vi.stubEnv('WHATSAPP_APP_SECRET', '')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cuerpo = JSON.stringify(WEBHOOK_TEXTO)
    expect((await POST(peticion(cuerpo, firmar(cuerpo, SECRETO)))).status).toBe(401)
  })

  it('acepta un cuerpo firmado que no es JSON, y no lo reintenta', async () => {
    // Signed but unreadable: retrying will not fix it, so take the 200 rather than invite
    // the same payload back every minute.
    vi.stubEnv('WHATSAPP_APP_SECRET', SECRETO)
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const respuesta = await POST(peticion('esto no es json', firmar('esto no es json', SECRETO)))

    expect(respuesta.status).toBe(200)
    expect(await respuesta.json()).toEqual({ recibido: true, encolado: false })
  })

  it('encola un webhook bien firmado, con el payload intacto', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', SECRETO)
    const cuerpo = JSON.stringify(WEBHOOK_TEXTO)

    const respuesta = await POST(peticion(cuerpo, firmar(cuerpo, SECRETO)))

    expect(respuesta.status).toBe(200)
    expect(await respuesta.json()).toEqual({ recibido: true, encolado: true })
    // Contract §3: the route parks it and answers; the worker does intake.
    expect(encolar).toHaveBeenCalledOnce()
    const [, tipo, payload] = encolar.mock.calls[0]! as unknown as [unknown, string, { webhook: unknown }]
    expect(tipo).toBe('procesar_webhook_whatsapp')
    expect(payload.webhook).toEqual(WEBHOOK_TEXTO)
  })

  it('sigue firmando sobre los bytes crudos, con acentos y todo', async () => {
    // The body is read as bytes now rather than as text. A digest computed over a decoded
    // and re-encoded string would still match for ASCII and start failing on «Tagachí» —
    // which is most of what the basin writes.
    vi.stubEnv('WHATSAPP_APP_SECRET', SECRETO)
    const cuerpo = JSON.stringify({ nota: 'Bellavista, Tagachí, Pacurita — ñ, á, í' })

    const respuesta = await POST(peticion(cuerpo, firmar(cuerpo, SECRETO)))

    expect(respuesta.status).toBe(200)
    expect(encolar).toHaveBeenCalledOnce()
  })
})

describe('el tamaño del cuerpo, que llega sin autenticar', () => {
  it('no lee nada de un cuerpo sin firma', async () => {
    // The reason this file exists. Anyone can POST here; buffering megabytes before
    // noticing there was no signature hands a stranger the intake's memory.
    vi.stubEnv('WHATSAPP_APP_SECRET', SECRETO)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { flujo, leidos } = cuerpoContado(64, 64 * 1024)

    const respuesta = await POST(peticionEnStream(flujo, {}))

    expect(respuesta.status).toBe(401)
    expect(leidos()).toBe(0)
    expect(encolar).not.toHaveBeenCalled()
  })

  it('rechaza por content-length sin leer un byte', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', SECRETO)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { flujo, leidos } = cuerpoContado(64, 64 * 1024)

    const respuesta = await POST(
      peticionEnStream(flujo, {
        [CABECERA_FIRMA]: `sha256=${'0'.repeat(64)}`,
        'content-length': String(4 * 1024 * 1024),
      }),
    )

    expect(respuesta.status).toBe(413)
    expect(leidos()).toBe(0)
  })

  it('corta un cuerpo enorme que no declara tamaño, en vez de tragárselo entero', async () => {
    // A chunked POST declares nothing. Cancelling the stream at the cap is the only thing
    // between this endpoint and an unbounded upload.
    vi.stubEnv('WHATSAPP_APP_SECRET', SECRETO)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const trozo = 64 * 1024
    const { flujo, leidos } = cuerpoContado(256, trozo) // 16 MB if nobody stops it

    const respuesta = await POST(
      peticionEnStream(flujo, { [CABECERA_FIRMA]: `sha256=${'0'.repeat(64)}` }),
    )

    expect(respuesta.status).toBe(413)
    // One chunk of slack: the cap is noticed on the read that crosses it.
    expect(leidos()).toBeLessThanOrEqual(LIMITE_CUERPO_BYTES + trozo)
    expect(encolar).not.toHaveBeenCalled()
  })

  it('deja pasar un lote grande pero razonable', async () => {
    // The cap has to be generous enough for a real batch: Meta batches messages, and a
    // webhook that 413s on a busy afternoon loses reports.
    vi.stubEnv('WHATSAPP_APP_SECRET', SECRETO)
    const relleno = 'a'.repeat(100 * 1024)
    const cuerpo = JSON.stringify({ entry: [], relleno })
    expect(Buffer.byteLength(cuerpo)).toBeLessThan(LIMITE_CUERPO_BYTES)

    const respuesta = await POST(peticion(cuerpo, firmar(cuerpo, SECRETO)))

    expect(respuesta.status).toBe(200)
    expect(encolar).toHaveBeenCalledOnce()
  })
})
