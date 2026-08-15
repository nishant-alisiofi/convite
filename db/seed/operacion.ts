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
