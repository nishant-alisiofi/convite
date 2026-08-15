import { describe, expect, it } from 'vitest'
import { PLANTILLAS } from '@/lib/canales'
import { proveedorWhatsAppSimulador } from '@/lib/canales/whatsapp/envio'

/**
 * The outbound WhatsApp adapter. No account, no network, no credentials — the same bar
 * tests/whatsapp.test.ts holds the inbound side to.
 *
 * The simulator earns its place by refusing what Meta refuses. A provider stub that accepts
 * everything proves the calling code runs; it does not prove the calling code is right, and
 * the day the WABA lands is an expensive time to find out the parameter count was wrong.
 */

const NUMERO = '+573001112233'

describe('el simulador de envío por WhatsApp', () => {
  it('registra lo que se «mandó», que es como una prueba lo recupera', async () => {
    const proveedor = proveedorWhatsAppSimulador()
    await proveedor.enviar({ para: NUMERO, plantilla: 'codigo_ingreso', parametros: ['462813'] })

    expect(proveedor.enviados).toHaveLength(1)
    expect(proveedor.enviados[0]!.para).toBe(NUMERO)
    expect(proveedor.enviados[0]!.parametros).toEqual(['462813'])
    expect(proveedor.enviados[0]!.idExterno).toMatch(/^sim-wa-/)
  })

  it('rechaza un número que no es E.164', async () => {
    const proveedor = proveedorWhatsAppSimulador()
    await expect(
      proveedor.enviar({ para: '3001112233', plantilla: 'codigo_ingreso', parametros: ['1'] }),
    ).rejects.toThrow(/E\.164/)
    expect(proveedor.enviados).toHaveLength(0)
  })

  it('rechaza el número de parámetros equivocado, como haría Meta', async () => {
    // 132000. Cheaper to discover here than on the first real send.
    const proveedor = proveedorWhatsAppSimulador({ codigo_ingreso: 1 })
    await expect(
      proveedor.enviar({ para: NUMERO, plantilla: 'codigo_ingreso', parametros: [] }),
    ).rejects.toThrow(/132000/)
    await expect(
      proveedor.enviar({ para: NUMERO, plantilla: 'codigo_ingreso', parametros: ['a', 'b'] }),
    ).rejects.toThrow(/132000/)
  })
})

describe('la plantilla del código está registrada', () => {
  it('figura en PLANTILLAS, o la ventana de 24 h la bloquearía', () => {
    /*
     * `decidirSalida` only lets a name on this list through when the window is closed, and for
     * a sign-in it is always closed — nobody writes to us first in order to be allowed to log
     * in. A code that is not on the list is a code that cannot be sent.
     */
    expect(PLANTILLAS).toContain('codigo_ingreso')
  })
})
