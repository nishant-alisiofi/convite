import { describe, expect, it } from 'vitest'
import {
  aE164,
  dictarFolio,
  MENU,
  opcionDe,
  PROMPTS,
  proveedorVozSimulador,
  tipoDeIntencion,
} from '@/lib/canales'

/**
 * The voice channel's words and shapes, with no database and no provider.
 *
 * PRD §4 M10 puts IVR deliberately ahead of the public view: voice is the most robust
 * channel under weak signal, and a community that cannot sustain a WhatsApp upload can still
 * finish a phone call.
 */

describe('el menú', () => {
  it('tiene un solo nivel y cuatro opciones', () => {
    // A person on a borrowed phone with one bar is not going to walk a tree. Everything they
    // can do is on the first screen or it does not exist.
    expect(MENU).toHaveLength(4)
    expect(MENU.map((o) => o.tecla)).toEqual(['1', '2', '3', '0'])
  })

  it('deja llegar a una persona desde cualquier parte', () => {
    expect(opcionDe('0')?.intencion).toBe('persona')
    // And from silence: pressing nothing is the menu failing, not the caller.
    expect(opcionDe(null)).toBeNull()
    expect(PROMPTS.sinRespuesta).toContain('persona')
  })

  it('dice la opción antes de la tecla', () => {
    // Easier to follow when you are only half listening, which is the normal case here.
    expect(PROMPTS.menu).toMatch(/pedir ayuda, marque 1/)
    expect(PROMPTS.menu).toMatch(/hablar con una persona, marque 0/)
  })

  it('no cobra la llamada entrante, y lo dice', () => {
    expect(PROMPTS.bienvenida).toContain('no le cueste nada')
  })

  it('una tecla sí puede fijar el tipo, pero nunca el ítem', () => {
    // A keypress is structural channel knowledge, like the printed card's code. Choosing
    // WHAT they need still waits for a transcript.
    expect(tipoDeIntencion('necesidad')).toBe('necesidad')
    expect(tipoDeIntencion('dano')).toBe('dano')
    expect(tipoDeIntencion('confirmacion_entrega')).toBe('confirmacion_entrega')
    expect(tipoDeIntencion('persona')).toBe('texto_libre')
  })

  it('ignora una tecla que no está en el menú', () => {
    expect(opcionDe('7')).toBeNull()
    expect(opcionDe('')).toBeNull()
  })
})

describe('el folio dictado', () => {
  it('va dígito por dígito, y se repite', () => {
    // «472» said as one number is heard once and lost. Digit by digit is what somebody
    // writes on the back of their hand while standing in the rain.
    const dictado = dictarFolio(472)
    expect(dictado).toContain('4. 7. 2')
    expect(dictado).toContain('Repito')
    expect(dictado).not.toMatch(/\b472\b/)
  })

  it('funciona con folios de cualquier largo', () => {
    expect(dictarFolio(7)).toContain('7')
    expect(dictarFolio(10345)).toContain('1. 0. 3. 4. 5')
  })
})

describe('el driver de voz', () => {
  it('completa el indicativo de un móvil colombiano', () => {
    expect(aE164('3000000001')).toBe('+573000000001')
    expect(aE164('+573000000001')).toBe('+573000000001')
  })

  it('cuelga sin contestar, que es lo que hace gratis la llamada', () => {
    // A provider adapter that answers first to be polite charges a person with no balance
    // for asking for help. The simulator keeps the two apart so that cannot pass unnoticed.
    const proveedor = proveedorVozSimulador()
    return proveedor.rechazar('llamada-1').then(() => {
      expect(proveedor.rechazadas).toEqual(['llamada-1'])
      expect(proveedor.llamadas).toEqual([])
    })
  })

  it('registra la devolución aparte', async () => {
    const proveedor = proveedorVozSimulador()
    const salida = await proveedor.llamar('+573000000001')
    expect(proveedor.llamadas).toEqual([{ a: '+573000000001', idExterno: salida.idExterno }])
    expect(proveedor.rechazadas).toEqual([])
  })
})
