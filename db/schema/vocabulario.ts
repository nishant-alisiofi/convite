/**
 * Controlled vocabularies.
 *
 * Section 5: `text` + `check` constraints instead of Postgres enums — adding a check value
 * in production is a one-line ALTER, adding an enum value is not. These arrays are the TS
 * mirror of the SQL check constraints in db/migrations. Keep both sides in step; the seed
 * validation tests assert every seeded value is a member.
 *
 * These are *vocabularies*, not the item catalogue. The catalogue is data in
 * `catalogo_items` and must never appear here (non-negotiable 2.8).
 */

export const ROLES_CONTACTO = [
  'reportante',
  'verificador',
  'transportista',
  'coordinador',
  'donante',
] as const

export const ROLES_STAFF = [
  'coordinador',
  'verificador',
  'despachador',
  'admin',
  'lectura',
] as const

export const TIPOS_COMUNIDAD = [
  'cabecera',
  'corregimiento',
  'vereda',
  'resguardo',
  'consejo_comunitario',
] as const

export const CANALES = ['whatsapp', 'sms', 'ivr', 'radio', 'papel', 'web'] as const

/** Channels a contact can be reached on. `web` is staff-only, so it is not a preference. */
export const CANALES_PREFERIDOS = ['whatsapp', 'sms', 'ivr', 'radio', 'papel'] as const

export const TIPOS_REPORTE = ['necesidad', 'dano'] as const

/**
 * What a `reportes` row may be, which is one value wider than the catalogue.
 *
 * A record is created on receipt (2.13) and the driver never classifies, so intake has to
 * write a row before anyone knows whether it is a need or a damage report. `sin_clasificar`
 * is that state — the same first-class "we looked and cannot tell" that `ofertas.estado`
 * already carries, rather than a guess 2.12 forbids. See 0021.
 *
 * `catalogo_items.tipo` deliberately stays on TIPOS_REPORTE: a catalogue entry that does not
 * know what it is would be a different bug entirely.
 */
export const TIPOS_REPORTE_REGISTRADO = [...TIPOS_REPORTE, 'sin_clasificar'] as const

/**
 * Non-negotiable 2.2 — never invent a coordinate. Every stored location declares where it
 * came from, and carries an accuracy radius in metres.
 *   gps       WhatsApp location pin           radius 0
 *   centroide community centroid              radius ~1000 m
 *   referida  relayed by radio or third party  radius ~2000 m
 *   manual    placed by staff on the map      radius as entered
 */
export const FUENTES_UBICACION = ['gps', 'centroide', 'referida', 'manual'] as const

/** Default accuracy radius per source, in metres. `manual` has no default — staff enter it. */
export const PRECISION_POR_FUENTE: Record<string, number | null> = {
  gps: 0,
  centroide: 1000,
  referida: 2000,
  manual: null,
}

export const ESTADOS_REPORTE = ['RECIBIDO', 'VERIFICADO', 'DUPLICADO', 'CANCELADO'] as const

/**
 * Section 1: this classification is the product. Every open request names the side that is
 * missing, so a count turns into a specific phone call to a specific person.
 */
export const ESTADOS_PEDIDO = [
  'ABIERTO', // not yet run through the matcher
  'SIN_RUTA', // no open path from any stocked node
  'SIN_EXISTENCIA', // no reachable node holds enough
  'SIN_CAPACIDAD', // stock is reachable, nobody is travelling there
  'LISTO', // all three align; awaiting human confirmation
  'EN_CAMINO',
  'ENTREGADO',
  'CANCELADO',
] as const

/** The buckets the Tablero shows and `mapa_publico` counts as pending. */
export const ESTADOS_PEDIDO_PENDIENTE = [
  'SIN_RUTA',
  'SIN_EXISTENCIA',
  'SIN_CAPACIDAD',
  'LISTO',
] as const

export const TIPOS_NODO = ['bodega', 'acopio'] as const

export const MODOS = ['lancha', 'chalupa', 'carretera', 'trocha', 'avioneta'] as const

/** Section 7.3: the river modes are always entered by a human who knows the river. */
export const MODOS_FLUVIALES = ['lancha', 'chalupa'] as const

/** Section 7.2: only these can be populated from the Google Routes API. */
export const MODOS_TERRESTRES = ['carretera', 'trocha'] as const

export const TEMPORADAS = ['todo_el_ano', 'lluvias', 'seca'] as const

/**
 * The seasons the basin can actually be in. `todo_el_ano` is a property of a route — a leg
 * open whatever the river does — never an answer to "which season is it now", which is what
 * the `temporada` setting in `configuracion` holds.
 */
export const TEMPORADAS_OPERATIVAS = ['lluvias', 'seca'] as const

export const FUENTES_RUTA = ['google', 'manual'] as const

export const ESTADOS_CAPACIDAD = ['OFRECIDA', 'COMPROMETIDA', 'CANCELADA', 'COMPLETADA'] as const

/**
 * `SIN_CLASIFICAR` is a first-class state, not an error. «Muchas cosas!! De todo!!!» is a
 * phone call a coordinator should make, never an offer we reject (2.12, Section 9.4).
 */
export const ESTADOS_OFERTA = [
  'SIN_CLASIFICAR',
  'DISPONIBLE',
  'RESERVADA',
  'RECOGIDA',
  'EN_NODO',
  'VENCIDA',
  'RETIRADA',
] as const

export const TIPOS_LABOR = ['clasificar', 'cargar', 'cocinar', 'atender'] as const

export const ESTADOS_VOLUNTARIO = ['OFRECIDO', 'CONFIRMADO', 'CANCELADO', 'COMPLETADO'] as const

export const ESTADOS_RECOGIDA = [
  'PLANEADA',
  'EN_CURSO',
  'RECOGIDA',
  'FALLIDA',
  'CANCELADA',
] as const

export const ESTADOS_ENVIO = [
  'PLANEADO',
  'DESPACHADO',
  'EN_RUTA',
  'COMPLETADO',
  'CANCELADO',
] as const

export const DIRECCIONES_MENSAJE = ['entrante', 'saliente'] as const

export const ESTADOS_MENSAJE = [
  'recibido',
  'encolado',
  'enviado',
  'entregado',
  'leido',
  'fallido',
] as const

export const TIPOS_ADJUNTO = ['audio', 'foto', 'firma'] as const

export const ESTADOS_JOB = ['pendiente', 'corriendo', 'hecho', 'fallido'] as const

export type RolContacto = (typeof ROLES_CONTACTO)[number]
export type RolStaff = (typeof ROLES_STAFF)[number]
export type TipoComunidad = (typeof TIPOS_COMUNIDAD)[number]
export type Canal = (typeof CANALES)[number]
export type TipoReporte = (typeof TIPOS_REPORTE)[number]
export type TipoReporteRegistrado = (typeof TIPOS_REPORTE_REGISTRADO)[number]
export type FuenteUbicacion = (typeof FUENTES_UBICACION)[number]
export type EstadoReporte = (typeof ESTADOS_REPORTE)[number]
export type EstadoPedido = (typeof ESTADOS_PEDIDO)[number]
export type TipoNodo = (typeof TIPOS_NODO)[number]
export type Modo = (typeof MODOS)[number]
export type Temporada = (typeof TEMPORADAS)[number]
export type FuenteRuta = (typeof FUENTES_RUTA)[number]
export type EstadoCapacidad = (typeof ESTADOS_CAPACIDAD)[number]
export type EstadoOferta = (typeof ESTADOS_OFERTA)[number]
export type EstadoMensaje = (typeof ESTADOS_MENSAJE)[number]
export type TipoAdjunto = (typeof TIPOS_ADJUNTO)[number]
export type TipoLabor = (typeof TIPOS_LABOR)[number]
export type EstadoEnvio = (typeof ESTADOS_ENVIO)[number]
