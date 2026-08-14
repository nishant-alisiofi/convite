import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COPIA,
  PROVEEDOR_SMS_SIMULADOR,
  proveedorSmsSimulador,
  recibirSms,
  recortarAUnSegmento,
  segmentar,
} from '@/lib/canales'
import { catalogoDesdeSemilla, extraer } from '@/lib/normalizador'

/**
 * SMS: what it costs, what it carries, and the printed card.
 *
 * D1 puts SMS in v1 because it is the channel that reaches tier 3–4 communities, and 2.13
 * ranks it the least fragile thing we have. D2 — which aggregator — is unanswered, so this
 * runs entirely against the simulator, the same way M5 ran against recorded Meta payloads.
 */

const catalogo = catalogoDesdeSemilla()
const AHORA = new Date('2026-08-14T15:00:00Z')

describe('cuánto cuesta de verdad un SMS', () => {
  it('cuenta 160 caracteres en GSM-7', () => {
    expect(segmentar('hola')).toMatchObject({ alfabeto: 'gsm7', unidades: 4, segmentos: 1 })
    expect(segmentar('a'.repeat(160))).toMatchObject({ segmentos: 1, cabeEnUno: true })
    expect(segmentar('a'.repeat(161))).toMatchObject({ segmentos: 2, cabeEnUno: false })
  })

  it('una sola tilde de las que GSM-7 no tiene manda todo a UCS-2', () => {
    // THE failure this module exists for. GSM-7 has é and ñ but NOT á í ó ú, so «está»
    // silently drops the limit from 160 to 70 and the bill for a basin-wide run triples
    // with nothing in any log to explain it.
    const sinTilde = segmentar('esta bien'.padEnd(100, ' '))
    const conTilde = segmentar('está bien'.padEnd(100, ' '))

    expect(sinTilde.alfabeto).toBe('gsm7')
    expect(sinTilde.segmentos).toBe(1)
    expect(conTilde.alfabeto).toBe('ucs2')
    expect(conTilde.segmentos).toBeGreaterThan(1)
    expect(conTilde.culpables).toContain('á')
  })

  it('sabe cuáles tildes sí están en GSM-7 y cuáles no', () => {
    // Worth pinning: é and ñ are free, á í ó ú are not. Nobody remembers this correctly.
    expect(segmentar('él señor').alfabeto).toBe('gsm7')
    for (const caracter of ['á', 'í', 'ó', 'ú']) {
      expect(segmentar(`x${caracter}`).alfabeto, caracter).toBe('ucs2')
    }
  })

  it('cuenta 70 caracteres cuando es UCS-2', () => {
    expect(segmentar('á'.repeat(70))).toMatchObject({ segmentos: 1, cabeEnUno: true })
    expect(segmentar('á'.repeat(71))).toMatchObject({ segmentos: 2, cabeEnUno: false })
  })

  it('cobra doble por los caracteres de la tabla extendida', () => {
    expect(segmentar('{').unidades).toBe(2)
    expect(segmentar('€').unidades).toBe(2)
  })

  it('recorta por palabra cuando hay que recortar', () => {
    const largo = 'aviso '.repeat(40)
    const recortado = recortarAUnSegmento(largo)
    expect(segmentar(recortado).cabeEnUno).toBe(true)
    expect(recortado.endsWith('…')).toBe(true)
    expect(recortado).not.toMatch(/avi…$/)
  })
})

describe('la copia de SMS cabe en un segmento', () => {
  it('la pregunta y el folio caben, con sus tildes puestas', () => {
    // We keep proper Spanish and stay inside the 70-character UCS-2 segment rather than
    // stripping accents to buy room. «Quedo con el numero» is worse Spanish sent to someone
    // already having a bad week.
    for (const cuerpo of [COPIA.aclaracionSms, COPIA.folioSms(472), COPIA.folioSms(99999)]) {
      const medida = segmentar(cuerpo)
      expect(medida.cabeEnUno, `${cuerpo} → ${medida.unidades} ${medida.alfabeto}`).toBe(true)
    }
  })

  it('la versión de SMS no ofrece nota de voz', () => {
    // Someone routed to SMS is there because their link will not carry audio. Asking for a
    // voice note is asking for a message that cannot arrive.
    expect(COPIA.aclaracion).toContain('nota de voz')
    expect(COPIA.aclaracionSms).not.toContain('nota de voz')
  })

  it('la copia larga de WhatsApp efectivamente NO cabe, que es por qué existe la corta', () => {
    expect(segmentar(COPIA.folio(472)).cabeEnUno).toBe(false)
  })
})

describe('el driver de SMS', () => {
  it('traduce el payload del agregador al mismo sobre', () => {
    const sobre = recibirSms(
      { id: 'MSG-88213', de: '3000000001', texto: '22 12 3', recibidoEn: '2026-08-14T10:00:00-05:00' },
      AHORA,
    )

    expect(sobre.proveedor).toBe(PROVEEDOR_SMS_SIMULADOR)
    expect(sobre.canal).toBe('sms')
    expect(sobre.idExterno).toBe('MSG-88213')
    // Ten digits is a Colombian mobile; the country code is added, not guessed at.
    expect(sobre.telefono).toBe('+573000000001')
    expect(sobre.contenido.media).toEqual([])
    expect(sobre.ubicacion).toBeNull()
    // The driver does not classify, so even a card code arrives as plain text.
    expect(sobre.tipo).toBe('texto_libre')
    expect(sobre.contenido.texto).toBe('22 12 3')
  })

  it('deja en paz un número que ya viene en E.164', () => {
    expect(recibirSms({ id: 'A', de: '+573000000008', texto: 'hola' }, AHORA).telefono).toBe(
      '+573000000008',
    )
  })

  it('el simulador se niega a mandar más de un segmento', async () => {
    // The point of a simulator is that what passes here would have passed there.
    const proveedor = proveedorSmsSimulador()
    await expect(proveedor.enviar('+573000000001', 'á'.repeat(200))).rejects.toThrow(
      /un SMS sale en uno/,
    )
  })

  it('el simulador registra lo que salió', async () => {
    const proveedor = proveedorSmsSimulador()
    await proveedor.enviar('+573000000001', COPIA.folioSms(472))
    expect(proveedor.enviados).toHaveLength(1)
    expect(proveedor.enviados[0]!.segmentos).toBe(1)
  })
})

describe('la sintaxis de la tarjeta impresa', () => {
  const leer = (texto: string) => extraer(texto, { catalogo, ahora: AHORA })

  it('lee «22 12 3» como el código, las familias y la urgencia', () => {
    const p = leer('22 12 3')
    expect(p.codigoItem).toBe('22')
    expect(p.tipo).toBe('necesidad')
    expect(p.familias).toBe(12)
    expect(p.urgencia).toBe(3)
    // 22 is medicamento crónico: the catalogue still wants to know which one.
    expect(p.requiereDetalle).toContain('detalle')
  })

  it('en un daño el segundo número es severidad, no familias', () => {
    // Section 4.2. Getting this backwards files «vía bloqueada, severidad 2» as two
    // households needing help, which is a different phone call entirely.
    const p = leer('91 2')
    expect(p.codigoItem).toBe('91')
    expect(p.tipo).toBe('dano')
    expect(p.familias).toBeNull()
    expect(p.severidad).toBe(2)
  })

  it('descarta una severidad fuera de rango en vez de recortarla', () => {
    // `reportes_severidad_check` allows 1–3. A «91 12» is somebody typing a quantity into
    // the severity slot, and clamping it to 3 would invent an assessment nobody made.
    expect(leer('91 12').severidad).toBeNull()
    expect(leer('91 12').codigoItem).toBe('91')
  })

  it('una necesidad nunca lleva severidad', () => {
    expect(leer('22 12 3').severidad).toBeNull()
  })

  it('el texto libre no propone severidad: eso lo juzga una persona', () => {
    // How bad a landslide is, from prose, is a judgement someone makes after looking (2.12).
    expect(leer('hubo un derrumbe muy grande, no pasa nadie').severidad).toBeNull()
  })

  it('acepta separadores flojos, porque la gente escribe como escribe', () => {
    for (const texto of ['22 12 3', '22-12-3', '22,12,3', '22.12.3', '22  12  3']) {
      expect(leer(texto).codigoItem, texto).toBe('22')
      expect(leer(texto).familias, texto).toBe(12)
    }
  })

  it('lee un código solo', () => {
    expect(leer('12').codigoItem).toBe('12')
    expect(leer('12').familias).toBeNull()
  })

  it('ignora un código que el catálogo no conoce', () => {
    // 90 is not an item. Somebody misremembered, and that is a question, not a request.
    expect(leer('90 12 3').codigoItem).toBeNull()
    expect(leer('99 5').codigoItem).toBeNull()
  })

  it('no deja que un número dentro de una frase secuestre el mensaje', () => {
    // Only a message that IS the code counts. «...como 22 12 3 familias» is prose.
    expect(leer('somos como 22 personas y 12 familias').codigoItem).not.toBe('22')
  })

  it('funciona igual en cualquier canal, no solo en SMS', () => {
    // The codes live in the normalizer, not in the SMS driver: people who carry the card
    // use them on WhatsApp too.
    const sobre = recibirSms({ id: 'X', de: '3000000001', texto: '31 8' }, AHORA)
    expect(leer(sobre.contenido.texto!).codigoItem).toBe('31')
  })
})

describe('ningún camino manda sin pasar por el despachador', () => {
  it('solo despachador.ts escribe en salidas_pendientes', () => {
    // PRD §4 M6: «no code path sends unconditionally.» That is a structural claim, so it is
    // checked structurally — a second writer would make the policy and the 24-hour rule
    // advisory, and the first sign would be a message that silently never arrived.
    const archivos: string[] = []
    const recorrer = (dir: string) => {
      for (const entrada of readdirSync(dir)) {
        const ruta = join(dir, entrada)
        if (statSync(ruta).isDirectory()) recorrer(ruta)
        else if (ruta.endsWith('.ts') || ruta.endsWith('.tsx')) archivos.push(ruta)
      }
    }
    recorrer('lib')
    recorrer('app')

    const escritores = archivos.filter((ruta) =>
      /insert\s+into\s+salidas_pendientes/i.test(readFileSync(ruta, 'utf8')),
    )

    // Two, and the second is deliberate rather than an escape hatch. `vencerOfertas`
    // predates M6 and queues its lapse notice with `canal_sugerido` null precisely so that
    // the outbound policy decides channel and timing later — its own comment says as much.
    // `entregarPendientes` then applies the policy to every queued row whoever wrote it,
    // which is asserted against the database in tests/enlace.db.test.ts.
    //
    // What this guards is a THIRD writer appearing. A queue with an unpoliced writer makes
    // the 24-hour rule advisory, and the first sign is a message that silently never
    // arrived.
    expect(escritores.sort()).toEqual([
      'lib/canales/despachador.ts',
      'lib/matching/vencimientos.ts',
    ])
  })
})
