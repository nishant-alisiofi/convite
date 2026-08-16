import type { Canal } from '@/db/schema/vocabulario'

/**
 * Demo operating data: staff, reporters, nodes, stock, a few verified needs and one
 * offered boat.
 *
 * Two things to know before trusting anything here.
 *
 * 1. The `usuarios` uuids are placeholders. `usuarios.id` must equal the `auth_user.id` of
 *    the person who signed in, so on a real deployment these rows are created when staff
 *    first sign in — by `vincular_usuario_staff()`, and only for an invited address. Locally
 *    they exist because `existencias.contado_por` and `reportes.verificado_por` are NOT
 *    NULL by design — non-negotiable 2.1 means there is no way to record a count or a
 *    verification without a person, not even in seed data.
 * 2. The phone numbers are synthetic and deliberately not dialable.
 */

export const USUARIOS_SEMILLA = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    nombre: 'Yeison Cuesta',
    telefono: '+573000000006',
    rolContacto: 'coordinador' as const,
    rolStaff: 'coordinador' as const,
    comunidad: 'QBD',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    nombre: 'Nubia Rentería',
    telefono: '+573000000005',
    rolContacto: 'verificador' as const,
    rolStaff: 'verificador' as const,
    comunidad: 'QBD',
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    nombre: 'Ana Mosquera',
    telefono: '+573000000007',
    rolContacto: 'coordinador' as const,
    rolStaff: 'despachador' as const,
    comunidad: 'QBD',
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    nombre: 'Hernán Ibargüen',
    telefono: '+573000000009',
    rolContacto: 'coordinador' as const,
    rolStaff: 'admin' as const,
    comunidad: 'QBD',
  },
]

const COORDINADOR = USUARIOS_SEMILLA[0]!.id
const VERIFICADORA = USUARIOS_SEMILLA[1]!.id
const BODEGUERO = USUARIOS_SEMILLA[3]!.id

/** Reporters and transporters. They never log in (non-negotiable 2.10). */
export const CONTACTOS_SEMILLA = [
  {
    telefono: '+573000000001',
    nombre: 'Rosa Palacios',
    rol: 'reportante' as const,
    comunidad: 'TAG',
    canalPreferido: 'whatsapp' as const,
  },
  {
    telefono: '+573000000002',
    nombre: 'Élver Mosquera',
    rol: 'reportante' as const,
    comunidad: 'WIN',
    // Tier 4: he is relayed by radio, so WhatsApp is not his channel.
    canalPreferido: 'radio' as const,
  },
  {
    telefono: '+573000000003',
    nombre: 'Marta Perea',
    rol: 'reportante' as const,
    comunidad: 'BLL',
    canalPreferido: 'whatsapp' as const,
  },
  {
    telefono: '+573000000004',
    nombre: 'Aníbal Córdoba',
    rol: 'transportista' as const,
    comunidad: 'QBD',
    canalPreferido: 'whatsapp' as const,
  },
  {
    telefono: '+573000000008',
    nombre: 'Carmen Rentería',
    rol: 'reportante' as const,
    comunidad: 'PAC',
    canalPreferido: 'whatsapp' as const,
  },
  // Donors. In the first week of a response this is where the supply actually is.
  {
    telefono: '+573000000010',
    nombre: 'Emperatriz Mosquera',
    rol: 'donante' as const,
    comunidad: 'QBD',
    canalPreferido: 'whatsapp' as const,
  },
  {
    telefono: '+573000000011',
    nombre: 'Restaurante El Sabor Chocoano',
    rol: 'donante' as const,
    comunidad: 'QBD',
    canalPreferido: 'whatsapp' as const,
  },
  {
    telefono: '+573000000012',
    nombre: 'Droguería La Salud',
    rol: 'donante' as const,
    comunidad: 'QBD',
    canalPreferido: 'whatsapp' as const,
  },
  {
    telefono: '+573000000013',
    nombre: 'Yolanda Asprilla',
    rol: 'donante' as const,
    comunidad: 'QBD',
    canalPreferido: 'whatsapp' as const,
  },
  // Three more donors so the pickup run has two stops in each of three neighbourhoods —
  // the shape the first-mile clustering exists to handle (M8).
  {
    telefono: '+573000000014',
    nombre: 'Bernardina Palacios',
    rol: 'donante' as const,
    comunidad: 'QBD',
    canalPreferido: 'whatsapp' as const,
  },
  {
    telefono: '+573000000015',
    nombre: 'Panadería La Esperanza',
    rol: 'donante' as const,
    comunidad: 'QBD',
    canalPreferido: 'whatsapp' as const,
  },
  {
    telefono: '+573000000016',
    nombre: 'Ferretería El Tornillo',
    rol: 'donante' as const,
    comunidad: 'QBD',
    canalPreferido: 'whatsapp' as const,
  },
]

/**
 * Offers, as they actually arrive: unpunctuated, often without a quantity, sometimes
 * unclassifiable. `texto_original` is exactly what the person sent (2.12).
 *
 * Between them these cover the cases the matcher has to survive — a plain offer, a
 * perishable with a deadline, an offer with no stated quantity, and one nobody could
 * classify. The medicine offer is the M2 regression case: no node anywhere stocks item 22,
 * so without `ofertas` the engine would tell a coordinator "nobody has this" while a
 * pharmacy two streets away is offering it.
 */
export type OfertaSemilla = {
  telefono: string
  textoOriginal: string
  codigoItem: string | null
  cantidad: number | null
  unidad: string | null
  confianza: number
  requiereAclaracion?: boolean
  estado: 'SIN_CLASIFICAR' | 'DISPONIBLE'
  perecedero?: boolean
  /** Hours from seed time, for perishables. */
  venceEnHoras?: number
  necesitaRecogida?: boolean
  lat?: number
  lon?: number
  direccionTexto?: string
}

/**
 * The located offers sit in three real Quibdó neighbourhoods, two in each: Yesquita by the
 * river, Roma to the south, Niño Jesús to the north. Roughly a kilometre between
 * neighbourhoods and under a hundred metres within one, which is what makes them cluster
 * into three stops on one run rather than six separate errands (M8).
 */
export const OFERTAS_SEMILLA: OfertaSemilla[] = [
  // ── Yesquita ──────────────────────────────────────────────────────────────────────
  {
    telefono: '+573000000010',
    textoOriginal: 'Buenas tengo 6 mercados completos para los damnificados, arroz panela aceite y atun',
    codigoItem: '11',
    cantidad: 6,
    unidad: 'mercados',
    confianza: 0.92,
    estado: 'DISPONIBLE',
    necesitaRecogida: true,
    lat: 5.6935,
    lon: -76.6552,
    direccionTexto: 'Barrio Yesquita, casa de portón azul',
  },
  {
    telefono: '+573000000014',
    textoOriginal: 'yo tengo cuatro cobijas y dos toldillos que no estoy usando',
    codigoItem: '31',
    cantidad: 4,
    unidad: 'cobijas',
    confianza: 0.83,
    estado: 'DISPONIBLE',
    necesitaRecogida: true,
    lat: 5.6941,
    lon: -76.6546,
    direccionTexto: 'Barrio Yesquita, al lado de la tienda',
  },

  // ── Roma ──────────────────────────────────────────────────────────────────────────
  {
    telefono: '+573000000011',
    textoOriginal: 'tenemos 40 almuerzos listos para mañana, hay que recogerlos temprano',
    codigoItem: '11',
    cantidad: 40,
    unidad: 'almuerzos',
    confianza: 0.88,
    estado: 'DISPONIBLE',
    // Non-negotiable 2.15: cooked meals for tomorrow do not wait behind blankets. This is
    // also why the run starts in Roma — a deadline sets the departure time for the whole
    // trip, not just for its own stop.
    perecedero: true,
    venceEnHoras: 30,
    necesitaRecogida: true,
    lat: 5.6822,
    lon: -76.6604,
    direccionTexto: 'Barrio Roma, frente a la cancha',
  },
  {
    telefono: '+573000000015',
    textoOriginal: 'Podemos donar pan y colada todos los días mientras dure la emergencia',
    codigoItem: '11',
    // No quantity stated and no deadline given: it is supply, and it is not a perishable we
    // can sort by a date nobody wrote down (2.12, 2.15).
    cantidad: null,
    unidad: null,
    confianza: 0.64,
    requiereAclaracion: true,
    estado: 'DISPONIBLE',
    necesitaRecogida: true,
    lat: 5.6816,
    lon: -76.6611,
    direccionTexto: 'Barrio Roma, esquina de la calle 30',
  },

  // ── Niño Jesús ────────────────────────────────────────────────────────────────────
  {
    telefono: '+573000000012',
    textoOriginal: 'Tenemos losartan y metformina disponible para donar, digan cuanto necesitan',
    codigoItem: '22',
    // The sender never said how much. Inventing a number here is exactly what 2.12 forbids.
    cantidad: null,
    unidad: null,
    confianza: 0.71,
    requiereAclaracion: true,
    estado: 'DISPONIBLE',
    necesitaRecogida: true,
    lat: 5.7018,
    lon: -76.6538,
    direccionTexto: 'Barrio Niño Jesús, droguería de la esquina',
  },
  {
    telefono: '+573000000016',
    textoOriginal: 'tengo 20 tejas de zinc y unos plasticos grandes, paso el dato',
    codigoItem: '33',
    cantidad: 20,
    unidad: 'tejas',
    confianza: 0.86,
    estado: 'DISPONIBLE',
    necesitaRecogida: true,
    lat: 5.7024,
    lon: -76.6532,
    direccionTexto: 'Barrio Niño Jesús, ferretería',
  },
  {
    telefono: '+573000000013',
    textoOriginal: 'Muchas cosas!! De todo!!!',
    // Nobody could classify this. It is a phone call to make, not an error to return.
    codigoItem: null,
    cantidad: null,
    unidad: null,
    confianza: 0.12,
    requiereAclaracion: true,
    estado: 'SIN_CLASIFICAR',
    necesitaRecogida: true,
  },
]

export const VOLUNTARIOS_SEMILLA = [
  {
    telefono: '+573000000010',
    nodo: 'BOD-QBD',
    tipoLabor: 'clasificar' as const,
    desdeEnDias: 1,
    hastaEnDias: 2,
  },
]

export const NODOS_SEMILLA = [
  {
    clave: 'BOD-QBD',
    nombre: 'Bodega Central Quibdó',
    tipo: 'bodega' as const,
    comunidad: 'QBD',
    responsableTelefono: null,
    // Placed on the map by staff, hence 'manual' with an honest radius — not a GPS pin.
    lat: 5.6889,
    lon: -76.6583,
    ubicacionFuente: 'manual' as const,
    ubicacionPrecisionM: 250,
  },
  {
    clave: 'ACO-TAG',
    nombre: 'Acopio Tagachí',
    tipo: 'acopio' as const,
    comunidad: 'TAG',
    responsableTelefono: '+573000000001',
    lat: 5.9564,
    lon: -76.7264,
    ubicacionFuente: 'manual' as const,
    ubicacionPrecisionM: 500,
  },
  {
    clave: 'ACO-YUT',
    nombre: 'Acopio Yuto',
    tipo: 'acopio' as const,
    comunidad: 'YUT',
    responsableTelefono: null,
    // Nobody has located this one yet. Deliberately null so every map and manifest surface
    // has to handle "we do not know where this is" instead of guessing.
    lat: null,
    lon: null,
    ubicacionFuente: null,
    ubicacionPrecisionM: null,
  },
]

/**
 * Stock. `diasDesdeConteo` is what makes this seed useful: Tagachí was last counted almost
 * three weeks ago, and the Inventario screen has to say so loudly (non-negotiable 2.3).
 */
export const EXISTENCIAS_SEMILLA = [
  {
    nodo: 'BOD-QBD',
    contadoPor: BODEGUERO,
    diasDesdeConteo: 2,
    items: {
      '11': 180,
      '12': 240,
      '13': 60,
      '21': 40,
      '24': 35,
      '31': 60,
      '32': 45,
      '33': 40,
      '34': 30,
      '41': 90,
      '42': 50,
      '43': 40,
      '44': 300,
      '51': 25,
      '52': 80,
    } as Record<string, number>,
  },
  {
    nodo: 'ACO-TAG',
    contadoPor: COORDINADOR,
    diasDesdeConteo: 19,
    items: { '11': 18, '12': 40, '31': 0, '41': 12 } as Record<string, number>,
  },
  {
    nodo: 'ACO-YUT',
    contadoPor: COORDINADOR,
    diasDesdeConteo: 6,
    items: { '11': 45, '33': 15, '34': 30 } as Record<string, number>,
  },
]

/**
 * Verified needs. Each one carries the verifier and the timestamp that promoted it, because
 * a `pedido` that nobody verified is exactly what M5 exists to prevent.
 *
 * Left in `ABIERTO`: the matcher has not run yet. M2 is what turns these into SIN_RUTA /
 * SIN_EXISTENCIA / SIN_CAPACIDAD / LISTO. Seeding them pre-classified would be inventing
 * the answer the engine is supposed to produce.
 */
export type NecesidadSemilla = {
  comunidad: string
  telefono: string
  codigoItem: string
  familias: number
  urgencia: number
  descripcion: string
  detalleLibre?: string
  verificadoPor: string
  diasAtras: number
  /** How it arrived. Omitted means WhatsApp, which is what the canonical basin assumes. */
  canal?: Canal
}

export const NECESIDADES_VERIFICADAS: NecesidadSemilla[] = [
  {
    comunidad: 'TAG',
    telefono: '+573000000001',
    codigoItem: '11',
    familias: 30,
    urgencia: 2,
    descripcion: 'Se perdió el mercado con la creciente. Somos treinta familias.',
    verificadoPor: VERIFICADORA,
    diasAtras: 3,
  },
  {
    comunidad: 'BLL',
    telefono: '+573000000003',
    codigoItem: '11',
    familias: 60,
    urgencia: 2,
    descripcion: 'Sesenta familias sin mercado desde la inundación.',
    verificadoPor: VERIFICADORA,
    diasAtras: 4,
  },
  {
    comunidad: 'WIN',
    telefono: '+573000000002',
    codigoItem: '12',
    familias: 20,
    urgencia: 3,
    descripcion: 'El agua del caño está sucia. Los niños están con diarrea.',
    verificadoPor: VERIFICADORA,
    diasAtras: 2,
  },
  {
    comunidad: 'BET',
    telefono: '+573000000003',
    codigoItem: '22',
    familias: 8,
    urgencia: 2,
    detalleLibre: 'Losartán y metformina para ocho personas mayores.',
    descripcion: 'Se acabaron las pastillas de la tensión y el azúcar.',
    verificadoPor: VERIFICADORA,
    diasAtras: 5,
  },
  {
    comunidad: 'PAC',
    telefono: '+573000000008',
    codigoItem: '33',
    familias: 25,
    urgencia: 2,
    descripcion: 'El vendaval levantó los techos de veinticinco casas.',
    verificadoPor: VERIFICADORA,
    diasAtras: 6,
  },
  {
    comunidad: 'MER',
    telefono: '+573000000001',
    codigoItem: '41',
    familias: 15,
    urgencia: 1,
    descripcion: 'Necesitamos jabón y aseo para las familias del albergue.',
    verificadoPor: VERIFICADORA,
    diasAtras: 8,
  },
  {
    comunidad: 'PAI',
    telefono: '+573000000003',
    codigoItem: '44',
    familias: 50,
    urgencia: 2,
    descripcion: 'Pastillas para el agua, el pozo quedó revuelto.',
    verificadoPor: VERIFICADORA,
    diasAtras: 7,
  },
]

/**
 * Sitting in the verification queue. No `pedido` exists for any of these and none may be
 * created until a human acts (M5 acceptance).
 */
export type ReporteSinVerificarSemilla = {
  tipo: 'necesidad' | 'dano'
  comunidad: string
  telefono: string
  codigoItem: string
  familias?: number
  urgencia?: number
  severidad?: number
  descripcion: string
  diasAtras: number
}

export const REPORTES_SIN_VERIFICAR: ReporteSinVerificarSemilla[] = [
  {
    tipo: 'necesidad' as const,
    comunidad: 'BLL',
    telefono: '+573000000003',
    codigoItem: '13',
    familias: 12,
    urgencia: 2,
    descripcion: 'Falta leche para los pelaos.',
    diasAtras: 1,
  },
  {
    tipo: 'necesidad' as const,
    comunidad: 'PAC',
    telefono: '+573000000008',
    codigoItem: '31',
    familias: 25,
    urgencia: 1,
    descripcion: 'También necesitamos cobijas y toldillos.',
    diasAtras: 1,
  },
  {
    // Non-negotiable 2.1 / Section 9.3: a damage report does not deactivate a route. A
    // coordinator does that, after verification, and says why.
    tipo: 'dano' as const,
    comunidad: 'TAG',
    telefono: '+573000000001',
    codigoItem: '92',
    severidad: 3,
    descripcion: 'Bajó una palizada grande y tapó el paso antes de Tagachí.',
    diasAtras: 1,
  },
]

/**
 * A voice note on one of the unverified reports.
 *
 * Without this the audio inbox — «este es el trabajo diario real» (Section 4.5) — cannot be
 * seen working by anybody, which is how a screen ships with its player broken. The audio
 * itself is a generated tone, not a recording of a person: synthetic phone numbers and
 * synthetic voices, for the same reason.
 *
 * The transcript is the realistic part, and it is deliberately imperfect. «pelaos» is what
 * people say; a transcriber trained on neutral Spanish tends to produce something else, and
 * the correction flow exists for exactly that.
 */
export const NOTA_DE_VOZ_SEMILLA = {
  /** Matches REPORTES_SIN_VERIFICAR[0] — Bellavista, alimentación infantil. */
  semillaReporte: 'sinver-BLL-13-0',
  segundos: 6,
  transcripcion: 'falta leche para los pelados y la creciente se llevo el mercado',
  confianza: 0.58,
}

/** One boat actually going somewhere — the thin side, seeded thin on purpose. */
export const CAPACIDADES_SEMILLA = [
  {
    telefono: '+573000000004',
    modo: 'lancha' as const,
    origenNodo: 'BOD-QBD',
    hastaComunidad: 'TAG',
    enDias: 3,
    cupoFamilias: 40,
    notas: 'Va con carga de la alcaldía, lleva lo que quepa.',
  },
]

// ════════════════════════════════════════════════════════════════════════════════════════
// DEMO LAYER — staging only.
//
// Everything below is layered on top of the canonical seed by scripts/seed.ts so the staging
// walkthrough has something true-to-life on every screen and the matcher produces its whole
// spread of states. It is kept in separate `_DEMO` arrays, never folded into the arrays above,
// because those are the fixtures the matcher and map unit tests pin — this layer must be able
// to grow without moving a single assertion. It is the same honest data as the rest: real
// Chocoano phrasing, honest location sources, `texto_original` untouched, every row marked
// [DATO DE PRUEBA] by scripts/seed.ts before it reaches a screen a partner might open.
// ════════════════════════════════════════════════════════════════════════════════════════

/**
 * Parteras (the first partner is a network of them), a radio operator who relays for the
 * communities with no signal of their own, and one lanchera. Phones are synthetic and not
 * dialable, continuing the +57300000002x block.
 */
export const CONTACTOS_DEMO = [
  {
    telefono: '+573000000020',
    nombre: 'Feliciana Moreno (partera)',
    rol: 'reportante' as const,
    comunidad: 'SIV',
    canalPreferido: 'sms' as const,
  },
  {
    telefono: '+573000000021',
    nombre: 'Bertha Rentería (partera)',
    rol: 'reportante' as const,
    comunidad: 'DOC',
    // Tier-4 coast: reached by radio relay, never a data channel.
    canalPreferido: 'radio' as const,
  },
  {
    telefono: '+573000000022',
    nombre: 'Yined Mosquera (partera)',
    rol: 'reportante' as const,
    comunidad: 'PIZ',
    canalPreferido: 'whatsapp' as const,
  },
  {
    telefono: '+573000000023',
    nombre: 'Custodia Palacios (partera)',
    rol: 'reportante' as const,
    comunidad: 'BEB',
    canalPreferido: 'radio' as const,
  },
  {
    // The other half of a radio relay (PRD §5.8): the person at the base who keys the message
    // in on behalf of someone who cannot reach us directly. Named on the relayed reports.
    telefono: '+573000000024',
    nombre: 'Aristóbulo Mena (operador de radio)',
    rol: 'reportante' as const,
    comunidad: 'QBD',
    canalPreferido: 'radio' as const,
  },
  {
    telefono: '+573000000025',
    nombre: 'Sixta Mena (lanchera)',
    rol: 'transportista' as const,
    comunidad: 'QBD',
    canalPreferido: 'whatsapp' as const,
  },
  {
    telefono: '+573000000026',
    nombre: 'Rosalba Cuesta (partera)',
    rol: 'reportante' as const,
    comunidad: 'TUT',
    canalPreferido: 'whatsapp' as const,
  },
  {
    telefono: '+573000000027',
    nombre: 'Deyanira Ríos (partera)',
    rol: 'reportante' as const,
    comunidad: 'SFI',
    canalPreferido: 'sms' as const,
  },
]

/**
 * The coastal acopio. Its stock is deliberately the wrong stock: it holds aseo and curación,
 * not the mercados Sivirú asks for — so the matcher, finding nothing on the coast it can use
 * and 180 mercados stranded in Quibdó with no river to the sea, returns SIN_RUTA and names
 * where the goods actually are. Located `manual`, like every node: staff placed it, so it is
 * an honest radius, not a GPS pin.
 */
export const NODOS_DEMO = [
  {
    clave: 'ACO-PIZ',
    nombre: 'Acopio Pizarro',
    tipo: 'acopio' as const,
    comunidad: 'PIZ',
    responsableTelefono: '+573000000022',
    lat: 4.955,
    lon: -77.366,
    ubicacionFuente: 'manual' as const,
    ubicacionPrecisionM: 300,
  },
]

/**
 * Coastal stock. Counted three days ago (fresh), and short on purpose: 10 curación kits
 * against a request for 40, so Pizarro's own request classifies as SIN_EXISTENCIA with the
 * honest sentence «solo hay 10 en Acopio Pizarro». No mercados at all, which is what strands
 * Sivirú. The Quibdó warehouse keeps only 35 curación kits, so nothing anywhere covers the 40.
 */
export const EXISTENCIAS_DEMO = [
  {
    nodo: 'ACO-PIZ',
    contadoPor: COORDINADOR,
    diasDesdeConteo: 3,
    items: { '41': 20, '24': 10, '33': 8 } as Record<string, number>,
  },
]

/**
 * Verified needs on the demo layer, one per matcher state the canonical basin does not already
 * reach. Each names the channel it arrived on so the Tablero shows the four-channel spread.
 * Verified by the coordinator, who is not community-scoped (the seeded verificadora is, and the
 * coast is outside her territory — so signing her name here would demo a permission she lacks).
 */
export const NECESIDADES_VERIFICADAS_DEMO: NecesidadSemilla[] = [
  {
    comunidad: 'SIV',
    telefono: '+573000000020',
    codigoItem: '11',
    familias: 20,
    urgencia: 2,
    descripcion: 'Se perdió la comida con el mar de leva. Somos veinte familias en Sivirú.',
    canal: 'radio',
    verificadoPor: COORDINADOR,
    diasAtras: 4,
  },
  {
    comunidad: 'DOC',
    telefono: '+573000000021',
    codigoItem: '11',
    familias: 30,
    urgencia: 2,
    descripcion: 'Docampadó quedó incomunicado y sin mercado. Piden ayuda por la radio.',
    canal: 'radio',
    verificadoPor: COORDINADOR,
    diasAtras: 5,
  },
  {
    comunidad: 'TUT',
    telefono: '+573000000026',
    codigoItem: '62',
    familias: 20,
    urgencia: 1,
    descripcion: 'Se perdió el pancoger con la creciente. Necesitan semillas para volver a sembrar.',
    canal: 'whatsapp',
    verificadoPor: COORDINADOR,
    diasAtras: 6,
  },
  {
    comunidad: 'PIZ',
    telefono: '+573000000022',
    codigoItem: '41',
    familias: 12,
    urgencia: 1,
    descripcion: 'Piden aseo para las familias que están en el albergue de la escuela.',
    canal: 'whatsapp',
    verificadoPor: COORDINADOR,
    diasAtras: 5,
  },
  {
    comunidad: 'PIZ',
    telefono: '+573000000022',
    codigoItem: '24',
    familias: 40,
    urgencia: 2,
    descripcion: 'Muchos heridos leves después del temporal. Se acabaron las gasas y el alcohol.',
    canal: 'sms',
    verificadoPor: COORDINADOR,
    diasAtras: 4,
  },
]

/**
 * Verified needs that are not cargo (Section 4.5): a person has to travel, not a box. They
 * never become a `pedido`; they sit in the «derivaciones» list of the verification screen so
 * it is not empty. `apoyo psicosocial` (item 53) is `entregable = false` in the catalogue.
 */
export const NECESIDADES_DERIVADAS_DEMO: NecesidadSemilla[] = [
  {
    comunidad: 'BLL',
    telefono: '+573000000003',
    codigoItem: '53',
    familias: 20,
    urgencia: 2,
    descripcion: 'Piden acompañamiento para las familias; los niños siguen asustados.',
    canal: 'whatsapp',
    verificadoPor: COORDINADOR,
    diasAtras: 3,
  },
]

/**
 * Reports still in the verification queue, across all four channels. Some carry a voice note
 * (see NOTAS_DE_VOZ_DEMO); two are radio relays, second-hand and therefore requiring a human
 * to confirm; two are things nobody could classify on arrival — a first-class state, not an
 * error (2.12), so they land in the clarification queue with no item rather than a guess.
 */
export type ReporteDemoSemilla = {
  /** Stable key, used to attach voice notes and inbound messages to this exact report. */
  semilla: string
  tipo: 'necesidad' | 'dano' | 'sin_clasificar'
  comunidad: string
  telefono: string
  codigoItem: string | null
  familias?: number
  urgencia?: number
  severidad?: number
  descripcion?: string
  /** Where intake stores inbound/transcribed text; the queue reads this before descripcion. */
  detalleLibre?: string
  canal: Canal
  diasAtras: number
  /** Radio relay only: the person at the base who keyed it in for the speaker (PRD §5.8). */
  relatadoPor?: string
}

export const REPORTES_SIN_VERIFICAR_DEMO: ReporteDemoSemilla[] = [
  {
    semilla: 'demo-tut-13',
    tipo: 'necesidad',
    comunidad: 'TUT',
    telefono: '+573000000026',
    codigoItem: '13',
    familias: 15,
    urgencia: 2,
    // A transcribed voice note: intake writes what the model heard into detalle_libre, warts
    // and all («pelaos»), and the correction flow exists for exactly that.
    detalleLibre: 'las niñas estan con diarrea y no hay con que prepararles la comida a los pelaos',
    canal: 'whatsapp',
    diasAtras: 1,
  },
  {
    semilla: 'demo-sfi-12',
    tipo: 'necesidad',
    comunidad: 'SFI',
    telefono: '+573000000027',
    codigoItem: '12',
    familias: 18,
    urgencia: 2,
    detalleLibre: 'no hay agua limpia el caño bajo revuelto y los pelaos con diarrea',
    canal: 'sms',
    diasAtras: 1,
  },
  {
    semilla: 'demo-pac-21',
    tipo: 'necesidad',
    comunidad: 'PAC',
    telefono: '+573000000008',
    codigoItem: '21',
    familias: 10,
    urgencia: 2,
    // Came in as a missed call; the callback recording was transcribed (see NOTAS_DE_VOZ_DEMO).
    detalleLibre: 'necesitamos remedios para la fiebre y el dolor somos varias familias',
    canal: 'ivr',
    diasAtras: 2,
  },
  {
    semilla: 'demo-win-33',
    tipo: 'necesidad',
    comunidad: 'WIN',
    telefono: '+573000000002',
    codigoItem: '33',
    familias: 12,
    urgencia: 2,
    descripcion: 'El vendaval levantó unos techos en Winandó.',
    canal: 'radio',
    relatadoPor: 'Aristóbulo Mena (operador de radio)',
    diasAtras: 1,
  },
  {
    semilla: 'demo-doc-21',
    tipo: 'necesidad',
    comunidad: 'DOC',
    telefono: '+573000000021',
    codigoItem: '21',
    familias: 8,
    urgencia: 2,
    descripcion: 'Hay una señora mayor con la tensión muy alta y sin sus pastillas.',
    canal: 'radio',
    relatadoPor: 'Aristóbulo Mena (operador de radio)',
    diasAtras: 2,
  },
  {
    // «🍲 90» — the M4 named case: an emoji and a number are not ninety of anything. No item,
    // no quantity, straight to clarification (2.12).
    semilla: 'demo-sc-cocina',
    tipo: 'sin_clasificar',
    comunidad: 'SFI',
    telefono: '+573000000027',
    codigoItem: null,
    descripcion: '🍲 90',
    canal: 'sms',
    diasAtras: 1,
  },
  {
    semilla: 'demo-sc-ayuda',
    tipo: 'sin_clasificar',
    comunidad: 'TAG',
    telefono: '+573000000001',
    codigoItem: null,
    detalleLibre: 'Ayúdennos por favor aquí estamos mal manden lo que puedan',
    canal: 'whatsapp',
    diasAtras: 1,
  },
]

/**
 * Voice notes on the demo layer, attached by seed key. Together with the canonical one on the
 * Bellavista report this gives the audio inbox three notes to play, each with the machine's
 * transcript, its confidence, and a duration — the daily work of Section 4.5. Synthetic tones,
 * never a real person's voice, for the same reason the phone numbers are not dialable.
 */
export const NOTAS_DE_VOZ_DEMO = [
  {
    semillaReporte: 'demo-tut-13',
    segundos: 7,
    transcripcion: 'las niñas estan con diarrea y no hay con que prepararles la comida a los pelados',
    confianza: 0.55,
  },
  {
    semillaReporte: 'demo-pac-21',
    segundos: 9,
    transcripcion: 'necesitamos remedios para la fiebre y el dolor somos varias familias aca',
    confianza: 0.62,
  },
]

/**
 * Raw inbound messages, exactly as the channel layer would have written them on receipt (2.13).
 * They give the silence job real signal to reason about and show the four-channel ingestion as
 * it actually looks: WhatsApp, SMS, an IVR callback, and radio relay. `reporteSemilla` links a
 * message to the report it produced; a null one is a message that produced no report — like
 * Bebedó's, eleven days old with nothing since, which is what makes Bebedó go quiet.
 */
export type MensajeDemoSemilla = {
  /** Deterministic provider id, so re-running the seed inserts each message exactly once. */
  id: string
  reporteSemilla: string | null
  direccion: 'entrante' | 'saliente'
  canal: Canal
  proveedor: string
  telefono: string
  cuerpo: string
  diasAtras: number
  payload?: Record<string, unknown>
}

export const MENSAJES_DEMO: MensajeDemoSemilla[] = [
  {
    id: 'demo-msg-tut-13',
    reporteSemilla: 'demo-tut-13',
    direccion: 'entrante',
    canal: 'whatsapp',
    proveedor: 'whatsapp_cloud',
    telefono: '+573000000026',
    cuerpo: '[nota de voz] las niñas estan con diarrea y no hay con que prepararles la comida',
    diasAtras: 1,
    payload: { tipo: 'audio', transcrito: true },
  },
  {
    id: 'demo-msg-sfi-12',
    reporteSemilla: 'demo-sfi-12',
    direccion: 'entrante',
    canal: 'sms',
    proveedor: 'sms_hablame',
    telefono: '+573000000027',
    cuerpo: 'no hay agua limpia el caño bajo revuelto y los pelaos con diarrea',
    diasAtras: 1,
  },
  {
    id: 'demo-msg-pac-21',
    reporteSemilla: 'demo-pac-21',
    direccion: 'entrante',
    canal: 'ivr',
    proveedor: 'ivr_hablame',
    telefono: '+573000000008',
    cuerpo: '[llamada perdida → devolución, opción 1] grabación transcrita',
    diasAtras: 2,
    payload: { tipo: 'llamada', opcion: 1 },
  },
  {
    id: 'demo-msg-win-33',
    reporteSemilla: 'demo-win-33',
    direccion: 'entrante',
    canal: 'radio',
    proveedor: 'radio_hf',
    telefono: '+573000000002',
    cuerpo: 'el vendaval levantó unos techos en Winandó',
    diasAtras: 1,
    payload: { relatado_por: 'Aristóbulo Mena (operador de radio)', hablante: 'Élver Mosquera', segunda_mano: true },
  },
  {
    id: 'demo-msg-doc-21',
    reporteSemilla: 'demo-doc-21',
    direccion: 'entrante',
    canal: 'radio',
    proveedor: 'radio_hf',
    telefono: '+573000000021',
    cuerpo: 'hay una señora mayor con la tensión muy alta y sin sus pastillas',
    diasAtras: 2,
    payload: { relatado_por: 'Aristóbulo Mena (operador de radio)', hablante: 'Bertha Rentería (partera)', segunda_mano: true },
  },
  {
    id: 'demo-msg-sc-cocina',
    reporteSemilla: 'demo-sc-cocina',
    direccion: 'entrante',
    canal: 'sms',
    proveedor: 'sms_hablame',
    telefono: '+573000000027',
    cuerpo: '🍲 90',
    diasAtras: 1,
  },
  {
    id: 'demo-msg-sc-ayuda',
    reporteSemilla: 'demo-sc-ayuda',
    direccion: 'entrante',
    canal: 'whatsapp',
    proveedor: 'whatsapp_cloud',
    telefono: '+573000000001',
    cuerpo: 'Ayúdennos por favor aquí estamos mal manden lo que puedan',
    diasAtras: 1,
  },
  {
    // Bebedó: one message eleven days ago and nothing since, with a seven-day interval. No
    // report ever came of it — this is what silence looks like, not a queue backing up.
    id: 'demo-msg-beb-silencio',
    reporteSemilla: null,
    direccion: 'entrante',
    canal: 'radio',
    proveedor: 'radio_hf',
    telefono: '+573000000023',
    cuerpo: 'aquí estamos pendientes, avisamos cuando podamos bajar a la cabecera',
    diasAtras: 11,
    payload: { relatado_por: 'Aristóbulo Mena (operador de radio)', hablante: 'Custodia Palacios (partera)' },
  },
]

/**
 * One more boat, so the thin side is not a single trip. Sixta's chalupa up the Río Quito to
 * Paimadó turns that request LISTO, and it is the trip scripts/seed.ts actually dispatches.
 * Its route serves only Paimadó (no needy community sits between Quibdó and the Quito), so it
 * leaves the SIN_CAPACIDAD spread on the Atrato untouched.
 */
export const CAPACIDADES_DEMO = [
  {
    telefono: '+573000000025',
    modo: 'chalupa' as const,
    origenNodo: 'BOD-QBD',
    hastaComunidad: 'PAI',
    enDias: 4,
    cupoFamilias: 60,
    notas: 'Sube el Quito el sábado con encargos; puede llevar carga.',
  },
]

/**
 * The demo dispatch. STAGING ONLY. One trip is actually sent so Envíos, the manifest and its
 * four-digit codes are not empty, and one request shows EN_CAMINO on the Tablero. Sixta's
 * chalupa carries Paimadó's water-treatment request in full (50 of a 60 cupo), so nobody is
 * short and no rationing decision is required. See scripts/seed.ts `sembrarDespacho`.
 */
export const DESPACHO_DEMO = {
  /** The lanchera whose offered trip we dispatch. */
  transportistaTelefono: '+573000000025',
  hastaComunidad: 'PAI',
  /** The request loaded onto it. */
  pedidoComunidad: 'PAI',
  pedidoCodigoItem: '44',
}
