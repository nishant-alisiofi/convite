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

/**
 * FR-46/PRD-47: `lanchero` is a boat operator worth naming as their own contact role — the leg
 * payee (FR-46) and, once registered against the communities on their route in
 * `lancheros_comunidades`, a vetted relay for reports out of a dark community (PRD-47). Never
 * self-signed up (PRD-47's stated assumption, mirroring FR-18's vetted stance) — a coordinador/
 * admin registers one the same way any other contact is registered.
 */
export const ROLES_CONTACTO = [
  'reportante',
  'verificador',
  'transportista',
  'coordinador',
  'donante',
  'lanchero',
] as const

export const ROLES_STAFF = [
  'coordinador',
  'verificador',
  'despachador',
  'admin',
  'lectura',
] as const

/**
 * Worker roles a centre's admin may invite (§2.4). A narrower set than ROLES_STAFF: an admin
 * hands out desks — verify, dispatch, coordinate, read — but does not mint another admin, and
 * platform-admin is not a role at all (it is the `es_plataforma` flag, granted only by the
 * platform). The invite UI offers exactly these; the escalation guard in migration 0034 is
 * what enforces the boundary at the database.
 */
export const ROLES_TRABAJADOR = ['coordinador', 'verificador', 'despachador', 'lectura'] as const

/**
 * §2.4 / §4: a centre is an organisation, and it does not operate until the platform approves
 * it. `pendiente` is where a requested centre starts; `aprobada` is the only state whose members
 * reach the panel; `rechazada` is a decided no. Existing seeded organisations are backfilled to
 * `aprobada` by migration 0034 so nothing that works today stops working.
 */
export const ESTADOS_APROBACION = ['pendiente', 'aprobada', 'rechazada'] as const

export const TIPOS_COMUNIDAD = [
  'cabecera',
  'corregimiento',
  'vereda',
  'resguardo',
  'consejo_comunitario',
] as const

/**
 * §29.3b: `manual` is the zeroth channel (PRD-35). Stage-0 setup must work with no channel
 * at all — once the data agreement is signed, a coordinator types in reports they are already
 * receiving by phone, on paper, or in their own WhatsApp group. Every such record carries
 * `canal = 'manual'` with the person who entered it (in `reportes.payload_crudo`); a live
 * channel attaches later as verification clears, and nothing already entered changes. Like
 * `web`, it is a staff-only channel, so it is not a contact preference.
 */
/**
 * PRD-47: `relevo` is the lanchero-relay channel — a registered lanchero carries a report out of
 * a community with no channel at all and a coordinador/verificador/admin keys it in through
 * `registrar_reporte_relevo`, recording both the lanchero and the origin community. Staff-gated
 * like `manual`, never a contact preference.
 */
export const CANALES = [
  'whatsapp',
  'sms',
  'ivr',
  'radio',
  'papel',
  'web',
  'manual',
  'relevo',
] as const

/** Channels a contact can be reached on. `web` and `manual` are staff-only, not preferences. */
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
 * FR-18 (§29.3b): the lifecycle of a transport-capacity OFFER made by an aportante (supply side).
 * Narrower than ESTADOS_CAPACIDAD on purpose — an offer is either standing or withdrawn; the
 * dispatch-side commitment/completion lives on `capacidades`, not on the supply-side offer.
 */
export const ESTADOS_OFERTA_TRANSPORTE = ['OFRECIDA', 'RETIRADA'] as const

/** FR-46: a lanchero's payment for a leg is either still owed or already paid. */
export const ESTADOS_PAGO_LANCHERO = ['pendiente', 'pagado'] as const

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

/**
 * Section 4.3. `perdida` is a call we hung up on without answering, so it cost the caller
 * nothing; `devolucion` is us ringing back, and we pay for it.
 */
export const TIPOS_LLAMADA = ['perdida', 'devolucion'] as const

/** `bloqueada` is a callback a spend cap refused — recorded, never silently skipped. */
export const ESTADOS_LLAMADA = [
  'registrada',
  'rechazada',
  'bloqueada',
  'marcando',
  'contestada',
  'grabada',
  'a_persona',
  'fallida',
] as const

export const ESTADOS_JOB = ['pendiente', 'corriendo', 'hecho', 'fallido'] as const

/**
 * §29.3b: the shared registry holds diverse kinds of organisation — an anchor community
 * network, a foundation, an arriving NGO, a diocese, a community council, a donor, a
 * transporter, a shop. Kept as text + check so a new kind is a one-line ALTER, with `otro` so
 * the registry never has to reject a real organisation just to record it. Registry typing and
 * enforcement are PRD-35; this vocabulary only backs the `organizaciones.tipo` column.
 */
export const TIPOS_ORGANIZACION = [
  'red_comunitaria',
  'fundacion',
  'ong',
  'diocesis',
  'consejo_comunitario',
  'donante',
  'transportista',
  'comercio',
  'gobierno',
  'otro',
] as const

/** §5.7: a region groups communities for the map and jornada planning. `mixta` = urban + rural. */
export const TIPOS_REGION = ['rural', 'urbana', 'mixta'] as const

/** §22: a jornada is one occurrence; the type names what arrives (goods, people, a facilitator…). */
export const TIPOS_JORNADA = [
  'distribucion',
  'brigada',
  'taller',
  'formacion',
  'evaluacion',
  'obra',
] as const

/**
 * §22/§23: a jornada begins as a draft laid over the map, is planned, happens, and ends
 * completed or cancelled. `historico` is a past jornada seeded so a partner opens the map onto
 * their own work rather than an empty screen (§31). The flow itself is PRD-30; this vocabulary
 * only backs the `jornadas.estado` column.
 */
export const ESTADOS_JORNADA = [
  'borrador',
  'planificada',
  'en_curso',
  'completada',
  'cancelada',
  'historico',
] as const

export type RolContacto = (typeof ROLES_CONTACTO)[number]
export type RolStaff = (typeof ROLES_STAFF)[number]
export type RolTrabajador = (typeof ROLES_TRABAJADOR)[number]
export type EstadoAprobacion = (typeof ESTADOS_APROBACION)[number]
export type TipoOrganizacion = (typeof TIPOS_ORGANIZACION)[number]
export type TipoComunidad = (typeof TIPOS_COMUNIDAD)[number]
export type TipoRegion = (typeof TIPOS_REGION)[number]
export type TipoJornada = (typeof TIPOS_JORNADA)[number]
export type EstadoJornada = (typeof ESTADOS_JORNADA)[number]
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
export type EstadoOfertaTransporte = (typeof ESTADOS_OFERTA_TRANSPORTE)[number]
export type EstadoPagoLanchero = (typeof ESTADOS_PAGO_LANCHERO)[number]
export type EstadoOferta = (typeof ESTADOS_OFERTA)[number]
export type EstadoMensaje = (typeof ESTADOS_MENSAJE)[number]
export type TipoAdjunto = (typeof TIPOS_ADJUNTO)[number]
export type TipoLlamada = (typeof TIPOS_LLAMADA)[number]
export type EstadoLlamada = (typeof ESTADOS_LLAMADA)[number]
export type TipoLabor = (typeof TIPOS_LABOR)[number]
export type EstadoEnvio = (typeof ESTADOS_ENVIO)[number]
