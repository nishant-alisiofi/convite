import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from '@/app/api/webhooks/whatsapp/route'
import { CABECERA_FIRMA, firmar } from '@/lib/canales'
import { WEBHOOK_TEXTO } from './fixtures/whatsapp'

/**
 * The webhook route itself.
 *
 * The rejection paths are the ones worth asserting here: the URL is public, Meta sends no
 * bearer token, and everything downstream trusts that whatever got past this file was signed
 * by someone holding the app secret. None of these cases touches the database — the route
 * refuses before it enqueues — so this runs without one.
 */

const SECRETO = 'un-app-secret-de-prueba'
const TOKEN = 'un-verify-token'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function peticion(cuerpo: string, firma: string | null): Request {
  return new Request('https://convite.test/api/webhooks/whatsapp', {
    method: 'POST',
    body: cuerpo,
    headers: firma ? { [CABECERA_FIRMA]: firma } : {},
  })
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
})
