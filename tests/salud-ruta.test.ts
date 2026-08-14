import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/salud/route'

/**
 * The two levels of the health route.
 *
 * The public one is the only route in the system that answers a stranger with something other
 * than an aggregate, so what it does NOT say is the part worth pinning. A passer-by learning
 * that forty reports are waiting and nobody has verified one in three days has learned
 * something about how the response is going in a basin with armed actor presence — which is
 * exactly what 2.4 exists to prevent.
 */

const SECRETO = 'un-cron-secret-de-prueba'

afterEach(() => {
  vi.unstubAllEnvs()
})

const pedir = (url: string, cabeceras: Record<string, string> = {}) =>
  GET(new Request(url, { headers: cabeceras }))

describe('la ruta de salud', () => {
  it('responde el liveness sin sesión, y solo cuenta las alertas', async () => {
    const respuesta = await pedir('https://convite.test/api/salud')
    const cuerpo = (await respuesta.json()) as Record<string, unknown>

    expect([200, 503]).toContain(respuesta.status)
    expect(cuerpo.base).toBeTruthy()
    // A number, never the list: enough for a monitor to page somebody, not enough to read.
    expect(typeof cuerpo.alertas).toBe('number')
    expect(cuerpo.jobs).toBeUndefined()
    expect(cuerpo.verificacion).toBeUndefined()
    expect(cuerpo.salidas).toBeUndefined()
    expect(cuerpo.voz).toBeUndefined()
  })

  it('no entrega el detalle a quien no trae el secreto', async () => {
    vi.stubEnv('CRON_SECRET', SECRETO)

    expect((await pedir('https://convite.test/api/salud?detalle=1')).status).toBe(401)
    expect(
      (await pedir('https://convite.test/api/salud?detalle=1', { authorization: 'Bearer nope' }))
        .status,
    ).toBe(401)
  })

  it('falla cerrado si no hay secreto configurado', async () => {
    // Otherwise the detail is served to anybody who guessed the query string.
    vi.stubEnv('CRON_SECRET', '')
    const respuesta = await pedir('https://convite.test/api/salud?detalle=1', {
      authorization: `Bearer ${SECRETO}`,
    })
    expect(respuesta.status).toBe(503)
  })

  it('con el secreto correcto sí entrega el estado completo', async () => {
    vi.stubEnv('CRON_SECRET', SECRETO)
    const respuesta = await pedir('https://convite.test/api/salud?detalle=1', {
      authorization: `Bearer ${SECRETO}`,
    })
    const cuerpo = (await respuesta.json()) as Record<string, unknown>

    expect([200, 503]).toContain(respuesta.status)
    expect(cuerpo.jobs).toBeTruthy()
    expect(cuerpo.verificacion).toBeTruthy()
    expect(cuerpo.voz).toBeTruthy()
    expect(Array.isArray(cuerpo.alertas)).toBe(true)
  })

  it('ni siquiera el detalle dice quién es nadie', async () => {
    vi.stubEnv('CRON_SECRET', SECRETO)
    const respuesta = await pedir('https://convite.test/api/salud?detalle=1', {
      authorization: `Bearer ${SECRETO}`,
    })
    const texto = JSON.stringify(await respuesta.json())

    for (const fragmento of ['+5730', 'telefono', 'nombre', 'ubicacion', 'folio']) {
      expect(texto, fragmento).not.toContain(fragmento)
    }
  })
})
