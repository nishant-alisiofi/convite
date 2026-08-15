import { describe, expect, it } from 'vitest'
import {
  decidirSalida,
  NOMBRES_PLANTILLA,
  PLANTILLAS,
  PROVEEDOR_SIMULADOR,
  recibirSimulado,
  ventanaAbierta,
  VERSION_CONTRATO,
} from '@/lib/canales'
import { NOTA_DE_VOZ, TEXTO_LIBRE, UBICACION_FIJADA } from './fixtures/mensajes-entrantes'

/**
 * The channel port, with no database and no credential (PRD §3).
 *
 * Two properties are worth more than the rest: the envelope refuses a coordinate whose
 * precision nobody declared (2.2), and the 24-hour rule sits above the driver, so the
 * simulator cannot let through what production would reject.
 */

const AHORA = new Date('2026-08-13T21:00:00Z')
const HORA = 3_600_000

describe('el sobre normalizado', () => {
  it('traduce texto libre sin clasificarlo', () => {
    const sobre = recibirSimulado(TEXTO_LIBRE)

    expect(sobre.version).toBe(VERSION_CONTRATO)
    expect(sobre.proveedor).toBe(PROVEEDOR_SIMULADOR)
    expect(sobre.canal).toBe('whatsapp')
    expect(sobre.idExterno).toBe('sim-tag-0001')
    expect(sobre.telefono).toBe('+573000000001')
    expect(sobre.comunidadCodigo).toBe('TAG')
    expect(sobre.contenido.texto).toContain('mercados')
    expect(sobre.contenido.media).toEqual([])
    expect(sobre.ubicacion).toBeNull()
  })

  it('deja el tipo en texto_libre: el adaptador no clasifica', () => {
    // Contract §4, and 2.12. «Manden mercados» reads like a `necesidad` to a human, and
    // turning that reading into a field is the normalizer's job (M4), not the driver's.
    expect(recibirSimulado(TEXTO_LIBRE).tipo).toBe('texto_libre')
  })

  it('lleva la nota de voz como referencia del proveedor, no como archivo nuestro', () => {
    const sobre = recibirSimulado(NOTA_DE_VOZ)

    expect(sobre.contenido.texto).toBeNull()
    expect(sobre.contenido.media).toHaveLength(1)
    expect(sobre.contenido.media[0]).toMatchObject({
      tipo: 'audio',
      refProveedor: 'media-id-8f21c4',
      duracionSeg: 34,
    })
    // 2.6: the provider ref expires in minutes and is never a storage key. M5 downloads it.
    expect(sobre.contenido.media[0]).not.toHaveProperty('storageKey')
  })

  it('conserva el momento de recepción, no el de procesamiento', () => {
    expect(recibirSimulado(TEXTO_LIBRE).recibidoEn.toISOString()).toBe('2026-08-13T19:02:11.000Z')
  })

  it('guarda el payload tal cual llegó', () => {
    // A parser bug has to be recoverable from this and nothing else.
    expect(recibirSimulado(NOTA_DE_VOZ).payloadCrudo).toEqual(NOTA_DE_VOZ)
  })

  it('rechaza un mensaje sin id: sin él no hay idempotencia', () => {
    expect(() => recibirSimulado({ ...TEXTO_LIBRE, id: '' })).toThrow()
  })

  it('rechaza un teléfono que no es E.164', () => {
    expect(() => recibirSimulado({ ...TEXTO_LIBRE, de: '300 123 4567' })).toThrow()
  })

  it('rechaza un canal que no existe', () => {
    expect(() => recibirSimulado({ ...TEXTO_LIBRE, canal: 'telegram' })).toThrow()
  })
})

describe('2.2 — nunca inventar una coordenada', () => {
  it('acepta un pin con radio 0', () => {
    const sobre = recibirSimulado(UBICACION_FIJADA)
    expect(sobre.ubicacion).toMatchObject({ fuente: 'gps', precisionM: 0 })
  })

  it('rechaza un punto sin fuente declarada', () => {
    expect(() =>
      recibirSimulado({ ...TEXTO_LIBRE, ubicacion: { lat: 5.6444, lon: -76.6089 } }),
    ).toThrow()
  })

  it('rechaza un pin que se atribuye un radio', () => {
    // Mirrors reportes_gps_exacto_check: a pin with a radius is not a pin.
    expect(() =>
      recibirSimulado({
        ...UBICACION_FIJADA,
        ubicacion: { lat: 5.6444, lon: -76.6089, fuente: 'gps', precisionM: 500 },
      }),
    ).toThrow()
  })

  it('completa el radio por defecto de la fuente, que es dato publicado y no una invención', () => {
    const centroide = recibirSimulado({
      ...TEXTO_LIBRE,
      ubicacion: { lat: 5.6444, lon: -76.6089, fuente: 'centroide' },
    })
    expect(centroide.ubicacion?.precisionM).toBe(1000)

    const referida = recibirSimulado({
      ...TEXTO_LIBRE,
      ubicacion: { lat: 5.6444, lon: -76.6089, fuente: 'referida' },
    })
    expect(referida.ubicacion?.precisionM).toBe(2000)
  })

  it('exige el radio cuando lo puso una persona en el mapa', () => {
    // `manual` has no default radius: whoever placed it says how accurate it is.
    expect(() =>
      recibirSimulado({
        ...TEXTO_LIBRE,
        ubicacion: { lat: 5.6444, lon: -76.6089, fuente: 'manual' },
      }),
    ).toThrow()
  })
})

describe('la ventana de servicio de 24 h', () => {
  const hace = (horas: number) => new Date(AHORA.getTime() - horas * HORA)

  it('está abierta mientras el último entrante tenga menos de 24 h', () => {
    expect(ventanaAbierta({ ultimoEntranteEn: hace(23), ahora: AHORA })).toBe(true)
    expect(ventanaAbierta({ ultimoEntranteEn: hace(24), ahora: AHORA })).toBe(false)
    expect(ventanaAbierta({ ultimoEntranteEn: hace(25), ahora: AHORA })).toBe(false)
  })

  it('está cerrada con quien nunca nos ha escrito', () => {
    // Never measured is not the same as recently active: an unprompted free-form message to
    // a number that has never written to us is exactly what Meta drops.
    expect(ventanaAbierta({ ultimoEntranteEn: null, ahora: AHORA })).toBe(false)
  })

  it('deja pasar texto libre dentro de la ventana', () => {
    const decision = decidirSalida(
      { cuerpo: 'Recibimos su reporte, quedó con el folio 472.' },
      { ultimoEntranteEn: hace(2), ahora: AHORA },
    )
    expect(decision).toEqual({ permitido: true, modo: 'libre' })
  })

  it('fuera de la ventana no deja pasar texto libre', () => {
    const decision = decidirSalida(
      { cuerpo: 'Recibimos su reporte, quedó con el folio 472.' },
      { ultimoEntranteEn: hace(30), ahora: AHORA },
    )
    expect(decision.permitido).toBe(false)
  })

  it('fuera de la ventana no pasa una plantilla que no existe', () => {
    const contexto = { ultimoEntranteEn: hace(30), ahora: AHORA }

    expect(
      decidirSalida({ cuerpo: '¡Aproveche!', plantilla: 'promocion_agosto' }, contexto).permitido,
    ).toBe(false)
  })

  it('fuera de la ventana no pasa una plantilla que Meta todavía no aprobó', () => {
    // The five utility templates are written, not cleared: D4 is open and approval takes days
    // per template. Letting a draft through means the folio is accepted here, queued, sent,
    // and refused by Meta — and the only person who finds out is the one still waiting for it.
    const contexto = { ultimoEntranteEn: hace(30), ahora: AHORA }

    const decision = decidirSalida(
      { cuerpo: 'Recibimos su reporte…', plantilla: 'reporte_recibido' },
      contexto,
    )

    expect(decision.permitido).toBe(false)
    if (!decision.permitido) expect(decision.motivo).toContain('aprobado')
    // Every template in the registry, so approving one by accident cannot pass unnoticed.
    for (const nombre of NOMBRES_PLANTILLA) {
      expect(PLANTILLAS[nombre].aprobada).toBe(false)
      expect(decidirSalida({ cuerpo: 'Hola', plantilla: nombre }, contexto).permitido).toBe(false)
    }
  })

  it('fuera de la ventana sí pasa una plantilla aprobada', () => {
    // The other half of the gate: the day Meta clears `reporte_recibido`, flipping the flag
    // is the whole change and the folio goes out cold.
    const contexto = { ultimoEntranteEn: hace(30), ahora: AHORA }
    const aprobadas = { ...PLANTILLAS, reporte_recibido: { aprobada: true } }

    expect(
      decidirSalida(
        { cuerpo: 'Recibimos su reporte…', plantilla: 'reporte_recibido' },
        contexto,
        aprobadas,
      ),
    ).toEqual({ permitido: true, modo: 'plantilla', plantilla: 'reporte_recibido' })

    // Approving one does not approve the rest.
    expect(
      decidirSalida({ cuerpo: 'Su envío va en camino…', plantilla: 'envio_programado' }, contexto, aprobadas)
        .permitido,
    ).toBe(false)
  })

  it('dentro de la ventana no le pide aprobación a nada', () => {
    // Inside 24 hours free text is fine, and so is a draft: the rule Meta enforces there is
    // about the window, not about the template.
    const contexto = { ultimoEntranteEn: hace(2), ahora: AHORA }

    expect(
      decidirSalida({ cuerpo: 'Recibimos su reporte…', plantilla: 'reporte_recibido' }, contexto),
    ).toEqual({ permitido: true, modo: 'libre' })
  })

  it('no envía un mensaje vacío por ningún camino', () => {
    expect(decidirSalida({ cuerpo: '   ' }, { ultimoEntranteEn: hace(1), ahora: AHORA }).permitido).toBe(
      false,
    )
  })

  it('explica el rechazo en vez de tirar una excepción', () => {
    // The outbound queue acts on a refusal — that is what salidas_pendientes is for (2.14).
    const decision = decidirSalida({ cuerpo: 'Hola' }, { ultimoEntranteEn: null, ahora: AHORA })
    expect(decision.permitido).toBe(false)
    if (!decision.permitido) expect(decision.motivo.length).toBeGreaterThan(0)
  })
})
