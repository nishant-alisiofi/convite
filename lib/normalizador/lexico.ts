/**
 * The domain lexicon: how people in the basin actually name things.
 *
 * This is DATA, not logic. Nothing in the extractor branches on a code (2.8) — it walks this
 * table, and the catalogue supplies the semantics. Adding «gasolina para la planta» when a
 * new territory needs it is an edit here, and eventually a row in a table: when a second
 * basin arrives this should move into Postgres beside `catalogo_items`, which is why every
 * entry is plain data with no behaviour attached.
 *
 * Why a lexicon rather than a classifier: PRD §4 M4 is explicit that a generic model
 * mishandles exactly these words. *Mercado* is a food parcel, not a marketplace. *Colada de
 * plátano* is infant feeding. *Pañitos* are nappies. *Toldillo* is vector control, and it is
 * the difference between malaria and not. Those are not edge cases here, they are the
 * vocabulary, and each one is a wrong boat-load if it is missed.
 *
 * `peso` is how much a single occurrence is worth, 0..1:
 *   0.85  unmistakable — the word names the item and almost nothing else
 *   0.60  strong in context, but the word has other lives
 *   0.35  a hint only; on its own it stays below threshold and goes to clarification
 *
 * Terms are matched on word boundaries against accent-stripped lowercase text, so `panales`
 * catches «pañales», and multi-word phrases are matched as phrases.
 */

export const VERSION_LEXICO = '2026-08-14'

export type EntradaLexico = {
  /** Accent-free, lowercase. Multi-word entries match as a phrase. */
  termino: string
  codigo: string
  peso: number
  /** Cooked or fresh food: proposes `perecedero` on the offer side. */
  perecedero?: boolean
}

export const LEXICO: EntradaLexico[] = [
  // ── 11 Mercado y alimentos ───────────────────────────────────────────────────────────
  // «Mercado» is the single most important word in this file: in Chocó it is a parcel of
  // household food, never a marketplace. A generic classifier reads it as a place.
  { termino: 'mercado', codigo: '11', peso: 0.85 },
  { termino: 'mercados', codigo: '11', peso: 0.85 },
  { termino: 'mercaditos', codigo: '11', peso: 0.85 },
  { termino: 'remesa', codigo: '11', peso: 0.85 },
  { termino: 'remesas', codigo: '11', peso: 0.85 },
  { termino: 'panela', codigo: '11', peso: 0.7 },
  { termino: 'arroz', codigo: '11', peso: 0.7 },
  { termino: 'aceite', codigo: '11', peso: 0.6 },
  { termino: 'granos', codigo: '11', peso: 0.6 },
  { termino: 'frijol', codigo: '11', peso: 0.6 },
  { termino: 'lenteja', codigo: '11', peso: 0.6 },
  { termino: 'platano', codigo: '11', peso: 0.5 },
  { termino: 'comida', codigo: '11', peso: 0.5 },
  { termino: 'alimentos', codigo: '11', peso: 0.6 },
  { termino: 'sin nada que cocinar', codigo: '11', peso: 0.6 },
  { termino: 'no hay que comer', codigo: '11', peso: 0.6 },
  { termino: 'nada que comer', codigo: '11', peso: 0.6 },
  { termino: 'aguantando hambre', codigo: '11', peso: 0.7 },
  // Cooked food is the perishable case the matcher has to respect (2.15).
  { termino: 'comidas preparadas', codigo: '11', peso: 0.8, perecedero: true },
  { termino: 'comida preparada', codigo: '11', peso: 0.8, perecedero: true },
  { termino: 'almuerzos', codigo: '11', peso: 0.7, perecedero: true },
  { termino: 'sancocho', codigo: '11', peso: 0.6, perecedero: true },
  // On its own an emoji is a hint and nothing more.
  { termino: '🍲', codigo: '11', peso: 0.35 },
  { termino: '🍚', codigo: '11', peso: 0.35 },

  // ── 12 Agua potable ──────────────────────────────────────────────────────────────────
  { termino: 'agua potable', codigo: '12', peso: 0.85 },
  { termino: 'agua para tomar', codigo: '12', peso: 0.85 },
  { termino: 'agua limpia', codigo: '12', peso: 0.8 },
  { termino: 'bidon', codigo: '12', peso: 0.7 },
  { termino: 'bidones', codigo: '12', peso: 0.7 },

  // ── 13 Alimentación infantil ─────────────────────────────────────────────────────────
  // «Colada» is a drink for small children; a food classifier files it under beverages.
  { termino: 'colada', codigo: '13', peso: 0.8 },
  { termino: 'colada de platano', codigo: '13', peso: 0.85 },
  { termino: 'bienestarina', codigo: '13', peso: 0.85 },
  { termino: 'papilla', codigo: '13', peso: 0.85 },
  { termino: 'leche', codigo: '13', peso: 0.7 },
  { termino: 'formula', codigo: '13', peso: 0.7 },
  { termino: 'comida de bebe', codigo: '13', peso: 0.85 },
  { termino: 'compota', codigo: '13', peso: 0.7 },

  // ── 21 Medicamento general ───────────────────────────────────────────────────────────
  { termino: 'acetaminofen', codigo: '21', peso: 0.85 },
  { termino: 'suero', codigo: '21', peso: 0.7 },
  { termino: 'para la fiebre', codigo: '21', peso: 0.8 },
  { termino: 'para la gripa', codigo: '21', peso: 0.8 },
  { termino: 'para la diarrea', codigo: '21', peso: 0.8 },
  { termino: 'fiebre', codigo: '21', peso: 0.6 },
  { termino: 'gripa', codigo: '21', peso: 0.6 },
  { termino: 'diarrea', codigo: '21', peso: 0.6 },

  // ── 22 Medicamento crónico (pide_detalle) ────────────────────────────────────────────
  // Never bare «azúcar»: that is sugar in a food list. Only the phrasings that mean
  // diabetes. Getting this wrong sends groceries to someone who needs insulin.
  { termino: 'para la tension', codigo: '22', peso: 0.85 },
  { termino: 'de la tension', codigo: '22', peso: 0.85 },
  { termino: 'la tension', codigo: '22', peso: 0.7 },
  { termino: 'presion alta', codigo: '22', peso: 0.85 },
  { termino: 'diabetes', codigo: '22', peso: 0.85 },
  { termino: 'para el azucar', codigo: '22', peso: 0.85 },
  { termino: 'del azucar', codigo: '22', peso: 0.8 },
  { termino: 'epilepsia', codigo: '22', peso: 0.85 },
  { termino: 'tratamiento', codigo: '22', peso: 0.5 },
  { termino: 'medicamento cronico', codigo: '22', peso: 0.85 },

  // ── 23 Atención médica o traslado (urgencia_min 3 lives in the catalogue) ────────────
  { termino: 'traslado', codigo: '23', peso: 0.85 },
  { termino: 'ambulancia', codigo: '23', peso: 0.85 },
  { termino: 'puesto de salud', codigo: '23', peso: 0.6 },
  { termino: 'atencion medica', codigo: '23', peso: 0.85 },
  { termino: 'esta grave', codigo: '23', peso: 0.8 },
  { termino: 'muy grave', codigo: '23', peso: 0.8 },
  { termino: 'sacar al enfermo', codigo: '23', peso: 0.85 },
  { termino: 'parto', codigo: '23', peso: 0.8 },

  // ── 24 Insumos de curación ───────────────────────────────────────────────────────────
  { termino: 'gasas', codigo: '24', peso: 0.85 },
  { termino: 'vendas', codigo: '24', peso: 0.85 },
  { termino: 'alcohol', codigo: '24', peso: 0.7 },
  { termino: 'curacion', codigo: '24', peso: 0.7 },
  { termino: 'herida', codigo: '24', peso: 0.6 },

  // ── 31 Cobijas, hamacas, toldillos ───────────────────────────────────────────────────
  // Vector control. A classifier that reads «toldillo» as bedding misses that this is the
  // difference between malaria and not.
  { termino: 'toldillo', codigo: '31', peso: 0.85 },
  { termino: 'toldillos', codigo: '31', peso: 0.85 },
  { termino: 'mosquitero', codigo: '31', peso: 0.85 },
  { termino: 'cobija', codigo: '31', peso: 0.8 },
  { termino: 'cobijas', codigo: '31', peso: 0.8 },
  { termino: 'hamaca', codigo: '31', peso: 0.8 },
  { termino: 'hamacas', codigo: '31', peso: 0.8 },
  { termino: 'zancudo', codigo: '31', peso: 0.6 },
  { termino: 'zancudos', codigo: '31', peso: 0.6 },

  // ── 32 Colchonetas ───────────────────────────────────────────────────────────────────
  { termino: 'colchoneta', codigo: '32', peso: 0.85 },
  { termino: 'colchonetas', codigo: '32', peso: 0.85 },
  { termino: 'colchon', codigo: '32', peso: 0.8 },

  // ── 33 Plásticos y tejas ─────────────────────────────────────────────────────────────
  { termino: 'teja', codigo: '33', peso: 0.8 },
  { termino: 'tejas', codigo: '33', peso: 0.8 },
  { termino: 'plastico', codigo: '33', peso: 0.7 },
  { termino: 'plasticos', codigo: '33', peso: 0.7 },
  { termino: 'cambuche', codigo: '33', peso: 0.8 },
  { termino: 'lona', codigo: '33', peso: 0.7 },
  { termino: 'para tapar el techo', codigo: '33', peso: 0.85 },

  // ── 34 Kit de cocina ─────────────────────────────────────────────────────────────────
  { termino: 'ollas', codigo: '34', peso: 0.8 },
  { termino: 'kit de cocina', codigo: '34', peso: 0.85 },
  { termino: 'platos', codigo: '34', peso: 0.6 },
  { termino: 'cucharas', codigo: '34', peso: 0.6 },
  { termino: 'menaje', codigo: '34', peso: 0.8 },

  // ── 41 Kit de aseo ───────────────────────────────────────────────────────────────────
  { termino: 'jabon', codigo: '41', peso: 0.8 },
  { termino: 'cepillo de dientes', codigo: '41', peso: 0.85 },
  { termino: 'crema dental', codigo: '41', peso: 0.85 },
  { termino: 'papel higienico', codigo: '41', peso: 0.8 },
  { termino: 'kit de aseo', codigo: '41', peso: 0.85 },
  { termino: 'aseo', codigo: '41', peso: 0.5 },

  // ── 42 Pañales (pide_detalle) ────────────────────────────────────────────────────────
  // «Pañitos» is the local diminutive and the one a generic model reads as wipes.
  { termino: 'panales', codigo: '42', peso: 0.85 },
  { termino: 'panal', codigo: '42', peso: 0.8 },
  { termino: 'panitos', codigo: '42', peso: 0.8 },
  { termino: 'pañalera', codigo: '42', peso: 0.6 },

  // ── 43 Salud menstrual ───────────────────────────────────────────────────────────────
  { termino: 'toallas higienicas', codigo: '43', peso: 0.85 },
  { termino: 'salud menstrual', codigo: '43', peso: 0.85 },
  { termino: 'menstruacion', codigo: '43', peso: 0.8 },
  { termino: 'la regla', codigo: '43', peso: 0.6 },

  // ── 44 Tratamiento de agua ───────────────────────────────────────────────────────────
  { termino: 'cloro', codigo: '44', peso: 0.85 },
  { termino: 'pastillas para el agua', codigo: '44', peso: 0.85 },
  { termino: 'potabilizar', codigo: '44', peso: 0.85 },
  { termino: 'tratamiento de agua', codigo: '44', peso: 0.85 },

  // ── 51 Ropa infantil ─────────────────────────────────────────────────────────────────
  { termino: 'ropita', codigo: '51', peso: 0.8 },
  { termino: 'ropa para los ninos', codigo: '51', peso: 0.85 },
  { termino: 'muda de ropa', codigo: '51', peso: 0.8 },
  { termino: 'zapatos', codigo: '51', peso: 0.6 },
  { termino: 'ropa', codigo: '51', peso: 0.5 },

  // ── 52 Kit escolar ───────────────────────────────────────────────────────────────────
  { termino: 'cuadernos', codigo: '52', peso: 0.85 },
  { termino: 'utiles escolares', codigo: '52', peso: 0.85 },
  { termino: 'lapices', codigo: '52', peso: 0.8 },
  { termino: 'morral', codigo: '52', peso: 0.8 },

  // ── 53 Apoyo psicosocial (not cargo) ─────────────────────────────────────────────────
  { termino: 'apoyo psicosocial', codigo: '53', peso: 0.85 },
  { termino: 'psicologo', codigo: '53', peso: 0.85 },
  { termino: 'acompanamiento', codigo: '53', peso: 0.7 },

  // ── 61 Herramientas ──────────────────────────────────────────────────────────────────
  { termino: 'machete', codigo: '61', peso: 0.85 },
  { termino: 'herramientas', codigo: '61', peso: 0.8 },
  { termino: 'martillo', codigo: '61', peso: 0.8 },
  { termino: 'clavos', codigo: '61', peso: 0.7 },
  { termino: 'pala', codigo: '61', peso: 0.7 },

  // ── 62 Semillas ──────────────────────────────────────────────────────────────────────
  { termino: 'semillas', codigo: '62', peso: 0.85 },
  { termino: 'pancoger', codigo: '62', peso: 0.8 },
  { termino: 'volver a sembrar', codigo: '62', peso: 0.8 },

  // ── 9x Daños ─────────────────────────────────────────────────────────────────────────
  { termino: 'derrumbe', codigo: '91', peso: 0.85 },
  { termino: 'via tapada', codigo: '91', peso: 0.85 },
  { termino: 'camino bloqueado', codigo: '91', peso: 0.85 },
  { termino: 'palo caido', codigo: '91', peso: 0.8 },
  { termino: 'barrizal', codigo: '91', peso: 0.7 },
  { termino: 'no se puede pasar', codigo: '91', peso: 0.6 },

  { termino: 'puente caido', codigo: '92', peso: 0.85 },
  { termino: 'se cayo el puente', codigo: '92', peso: 0.85 },
  { termino: 'tumbo el puente', codigo: '92', peso: 0.85 },
  { termino: 'palizada', codigo: '92', peso: 0.8 },
  { termino: 'el puente', codigo: '92', peso: 0.6 },
  { termino: 'paso peligroso', codigo: '92', peso: 0.8 },

  { termino: 'casas inundadas', codigo: '93', peso: 0.85 },
  { termino: 'se inundo', codigo: '93', peso: 0.8 },
  { termino: 'inundacion', codigo: '93', peso: 0.8 },
  { termino: 'sin techo', codigo: '93', peso: 0.7 },
  { termino: 'creciente', codigo: '93', peso: 0.6 },
  { termino: 'se llevo la casa', codigo: '93', peso: 0.85 },

  { termino: 'acueducto', codigo: '94', peso: 0.85 },
  { termino: 'el pozo', codigo: '94', peso: 0.8 },

  { termino: 'la escuela', codigo: '95', peso: 0.6 },
  { termino: 'el puesto de salud se', codigo: '95', peso: 0.7 },

  { termino: 'se perdio el cultivo', codigo: '96', peso: 0.85 },
  { termino: 'cultivo', codigo: '96', peso: 0.6 },
  { termino: 'la canoa', codigo: '96', peso: 0.7 },
]

/**
 * Phrases that mean «I cannot tell you what I need».
 *
 * PRD §4 M4 names «Muchas cosas!! De todo!!!» as a case that must yield no category. These
 * are not noise to be filtered out — they are a person telling us the situation is bad in
 * general, which is a phone call a coordinator should make (2.12, Section 9.4). When one of
 * these fires, no category is assigned however many other words matched.
 */
export const MARCADORES_VAGOS = [
  'muchas cosas',
  'de todo',
  'todo lo que puedan',
  'lo que sea',
  'cualquier cosa',
  'necesitamos de todo',
  'nos hace falta todo',
  'estamos mal',
]

/** Wording that marks the message as a request rather than a description of damage. */
export const MARCADORES_PETICION = [
  'manden',
  'mandenos',
  'necesitamos',
  'necesito',
  'nos hace falta',
  'nos falta',
  'regalen',
  'se necesita',
  'hace falta',
  'porfa',
  'por favor',
]

/**
 * Explicit urgency, and nothing implicit.
 *
 * The catalogue's `urgencia_min` is applied by the core, not here — traslado médico is
 * urgency 3 because the catalogue says so, not because the extractor guessed.
 */
export const MARCADORES_URGENCIA: { termino: string; urgencia: number }[] = [
  { termino: 'urgente', urgencia: 3 },
  { termino: 'urgentemente', urgencia: 3 },
  { termino: 'de emergencia', urgencia: 3 },
  { termino: 'se nos muere', urgencia: 3 },
  { termino: 'se esta muriendo', urgencia: 3 },
  { termino: 'grave', urgencia: 3 },
  { termino: 'pronto', urgencia: 2 },
  { termino: 'lo antes posible', urgencia: 2 },
]

/** Nouns that count households rather than items. «12 familias» is not 12 mercados. */
export const SUSTANTIVOS_FAMILIAS = ['familias', 'familia', 'hogares', 'nucleos']

/** Relative dates, as whole-day offsets. Anything vaguer is left null rather than invented. */
export const FECHAS_RELATIVAS: { termino: string; dias: number }[] = [
  { termino: 'pasado manana', dias: 2 },
  { termino: 'manana', dias: 1 },
  { termino: 'hoy', dias: 0 },
  { termino: 'esta noche', dias: 0 },
]

/** Spelled-out numbers people actually write. Digits are handled separately. */
export const NUMEROS_ESCRITOS: Record<string, number> = {
  un: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  veinte: 20,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  cien: 100,
}
