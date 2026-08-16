import type { PoolClient } from 'pg'

/**
 * PRD-36 — Setup, staged by phase.
 *
 * §29b.2: «A deployment responding to a fresh disaster needs communities and a phone number,
 * and nothing else.» So setup is not one long form — it is five stages, each unlocking a
 * capability, and a fresh deployment reaches useful operation at stage 1 (communities + one
 * number) without touching the later ones.
 *
 * Almost everything here is *derived*, not stored: whether the catalogue has items, whether a
 * community has a route written, whether a centre has a location. The product already surfaces
 * those gaps in place (§7); the Configurar checklist collects the same facts in one screen and,
 * for each one still missing, states the *consequence* rather than a bare «pendiente» (§29b.3).
 *
 * The only two facts with no other home are acknowledgements a person makes once: the data
 * agreement (§29b.2, stage 0) and the confirmed role model (§29b.4). Those live as rows in the
 * existing `configuracion` table — no new schema — namespaced by organisation so a second
 * partner records its own. Reading is any staff role; writing is an admin's, the same shape the
 * season change already uses.
 *
 * The IO (`reunirDatosConfiguracion`) and the reasoning (`resumenConfiguracion`) are split on
 * purpose: the reasoning is a pure function of plain numbers, so the whole checklist — every
 * consequence sentence, the stage-1 reachability rule, when it counts as complete — is testable
 * without a database.
 */

// ── Acknowledgement keys (rows in `configuracion`, namespaced per organisation) ─────────────

/** The data agreement was signed for this organisation. Value is the ISO instant it happened. */
export function claveAcuerdoDatos(organizacionId: string): string {
  return `onboarding:acuerdo_datos:${organizacionId}`
}

/** The role model was confirmed for this organisation. Value is the ISO instant it happened. */
export function claveRolesConfirmados(organizacionId: string): string {
  return `onboarding:roles_confirmados:${organizacionId}`
}

// ── The plain facts a stage reads, all scoped to the caller's own organisation ───────────────

export type DatosConfiguracion = {
  /** §2.4: the platform admitted this organisation to operate. */
  organizacionAprobada: boolean
  /** When the data agreement was signed, or null. Not derivable — an acknowledgement. */
  acuerdoDatosEn: string | null
  /** When the role model was confirmed, or null. Not derivable — an acknowledgement. */
  rolesConfirmadosEn: string | null
  /** Active communities attached to this organisation (stage 0). */
  comunidades: number
  /** Reports recorded at all — the sign a coordinator started entering what they receive. */
  reportes: number
  /** An intake number is configured (`waba_phone_number_id`), so reports can arrive directly. */
  numeroEntrada: boolean
  /** Active catalogue items — needed before a report can be classified or become a request. */
  catalogoItems: number
  /** Supply centres (`nodos`) belonging to this organisation. */
  centrosTotal: number
  /** …of those, how many still have no location — Recogidas has nothing to measure from. */
  centrosSinUbicacion: number
  /** Communities with no route leg written in either direction — invisible to the matcher. */
  comunidadesSinRuta: number
  /** Counted stock rows — the matcher needs to know what there is to send. */
  existencias: number
  /** Active sponsorships (stage 3) — the funds a local financed purchase can draw on. */
  apadrinamientosActivos: number
  /** Connection points (stage 4) — where a no-signal community reports or hears an answer. */
  puntosConexion: number
}

// ── The shape the screen renders ────────────────────────────────────────────────────────────

/** `hecho` = done · `pendiente` = still missing · `no_disponible` = the capability isn't built yet. */
export type EstadoPaso = 'hecho' | 'pendiente' | 'no_disponible'

export type PasoConfiguracion = {
  clave: string
  etiqueta: string
  estado: EstadoPaso
  /**
   * What staying undone *costs* — the blocked capability, never «pendiente» (§29b.3). Read this
   * only when `estado` is not `hecho`; for a done step it is the reassurance of what now works.
   */
  consecuencia: string
  /** Where to go to fix it. Absent for steps completed by a button on the Configurar screen. */
  href?: string
  /** A step finished by confirming on the Configurar screen itself, not on another page. */
  accion?: 'acuerdo' | 'roles'
  /** Useful but not required to call setup complete (e.g. entering reports by hand, later stages). */
  opcional?: boolean
}

export type EtapaConfiguracion = {
  numero: number
  clave: string
  titulo: string
  /** The one-line «what this unlocks», so the stage reads as a capability, not a chore. */
  desbloquea: string
  pasos: PasoConfiguracion[]
  /** Every required, available step in the stage is done. */
  completa: boolean
}

export type ResumenConfiguracion = {
  etapas: EtapaConfiguracion[]
  /** §29b.2 / AC#2: communities + one number — the point at which the deployment is useful. */
  etapa1Alcanzada: boolean
  /**
   * §29b.1: «Operar» appears once configuration is far enough along. Far enough is «there is
   * something to operate on» — at least one community — so an empty Bandeja is never the first
   * thing a fresh deployment sees.
   */
  operarDisponible: boolean
  /** AC#1: setup is done (every required, available step through stage 2), so Configurar collapses. */
  completa: boolean
  /** How many required, available steps are still pending — the badge the nav can show. */
  pendientes: number
}

function paso(
  clave: string,
  etiqueta: string,
  hecho: boolean,
  consecuencia: string,
  extra: { href?: string; accion?: PasoConfiguracion['accion']; opcional?: boolean } = {},
): PasoConfiguracion {
  return { clave, etiqueta, estado: hecho ? 'hecho' : 'pendiente', consecuencia, ...extra }
}

function pasoFuturo(clave: string, etiqueta: string, consecuencia: string): PasoConfiguracion {
  return { clave, etiqueta, estado: 'no_disponible', consecuencia, opcional: true }
}

/**
 * Turn the plain facts into the five stages, each step carrying the consequence of staying
 * undone. Pure — no database, no session — so every sentence below is unit-testable.
 */
export function resumenConfiguracion(d: DatosConfiguracion): ResumenConfiguracion {
  const centrosMsg =
    d.centrosTotal === 0
      ? 'No hay centros de acopio registrados. El emparejador necesita saber desde dónde sale la ayuda para poder proponer una entrega.'
      : `${d.centrosSinUbicacion} ${d.centrosSinUbicacion === 1 ? 'centro de acopio no tiene' : 'centros de acopio no tienen'} ubicación. Sin ella, Recogidas no tiene desde dónde medir la vuelta.`

  const rutasMsg =
    d.comunidades === 0
      ? 'Primero hacen falta comunidades: sin ellas no hay tramos que escribir.'
      : `${d.comunidadesSinRuta} ${d.comunidadesSinRuta === 1 ? 'comunidad no tiene' : 'comunidades no tienen'} ningún tramo escrito. El emparejador no puede proponer nada para ellas — aparecen como incomunicadas aunque no lo estén.`

  const etapas: EtapaConfiguracion[] = [
    {
      numero: 0,
      clave: 'entrada_manual',
      titulo: 'Entrada manual',
      desbloquea: 'Operar sin ningún canal: registrar a mano lo que ya llega por radio o en persona.',
      pasos: [
        paso(
          'acuerdo_datos',
          'Acuerdo de datos firmado',
          d.acuerdoDatosEn !== null,
          'Sin el acuerdo de datos firmado no se puede registrar a nadie ni guardar lo que reporta. Es el permiso (Ley 1581) para tener sus datos, y va antes que todo lo demás.',
          { accion: 'acuerdo' },
        ),
        paso(
          'comunidades',
          'Comunidades registradas',
          d.comunidades > 0,
          'No hay ninguna comunidad registrada. Sin comunidades no hay a quién atender: el mapa, la bandeja y las alertas de silencio quedan vacíos porque no hay nada que mostrar.',
          { href: '/comunidades' },
        ),
        paso(
          'roles',
          'Roles del equipo confirmados',
          d.rolesConfirmadosEn !== null,
          'Falta confirmar quién ve qué. Si nadie lo decide, por defecto todos ven todo — y las direcciones de los hogares quedan a la vista de más gente de la necesaria.',
          { accion: 'roles' },
        ),
        paso(
          'reportes',
          'Primeros reportes escritos a mano',
          d.reportes > 0,
          'Todavía nadie ha registrado un reporte. Puede empezar a mano con lo que ya recibe, sin esperar a tener número: una comunidad registrada ya acumula pedidos y dispara alertas de silencio.',
          { href: '/tablero', opcional: true },
        ),
      ],
      completa: false,
    },
    {
      numero: 1,
      clave: 'alcance',
      titulo: 'Alcance',
      desbloquea: 'Recibir reportes directamente, sin que alguien los escriba a mano.',
      pasos: [
        paso(
          'numero_entrada',
          'Número de entrada',
          d.numeroEntrada,
          'Falta el número por donde entra la gente. Sin él los reportes no llegan solos: todo hay que escribirlo a mano. Se conecta cuando Meta verifique la cuenta de WhatsApp; mientras tanto, la entrada manual sigue funcionando.',
          { href: '/ajustes' },
        ),
      ],
      completa: false,
    },
    {
      numero: 2,
      clave: 'emparejamiento',
      titulo: 'Emparejamiento',
      desbloquea: 'Que el emparejador proponga: cruzar un pedido con una donación y un transporte.',
      pasos: [
        paso(
          'catalogo',
          'Catálogo con ítems',
          d.catalogoItems > 0,
          'El catálogo está vacío. Sin ítems un reporte no se puede clasificar ni volver pedido — no hay con qué nombrar lo que se pide.',
          { href: '/catalogo' },
        ),
        paso(
          'centros_ubicados',
          'Centros de acopio con ubicación',
          d.centrosTotal > 0 && d.centrosSinUbicacion === 0,
          centrosMsg,
          { href: '/inventario' },
        ),
        paso('rutas', 'Tramos escritos', d.comunidades > 0 && d.comunidadesSinRuta === 0, rutasMsg, {
          href: '/rutas',
        }),
        paso(
          'inventario',
          'Inventario contado',
          d.existencias > 0,
          'No hay existencias contadas. El emparejador no sabe qué hay para mandar, así que no puede cruzar un pedido con una donación.',
          { href: '/inventario' },
        ),
      ],
      completa: false,
    },
    {
      numero: 3,
      clave: 'recuperacion',
      titulo: 'Recuperación',
      desbloquea: 'Evaluaciones y reconstrucción, cuando la emergencia da paso al día después.',
      pasos: [
        pasoFuturo(
          'plantillas_evaluacion',
          'Plantillas de evaluación',
          'Las plantillas de evaluación todavía no están en el sistema (llegan con Evaluaciones y recuperación). Sin ellas no se puede levantar un diagnóstico de daños para reconstruir.',
        ),
        paso(
          'apadrinamiento',
          'Apadrinamiento activo',
          d.apadrinamientosActivos > 0,
          'No hay apadrinamientos activos. Sin fondos comprometidos, una compra local financiada no tiene de dónde girar.',
          { href: '/apadrinar', opcional: true },
        ),
      ],
      completa: false,
    },
    {
      numero: 4,
      clave: 'ordinario',
      titulo: 'Ordinario',
      desbloquea: 'Programas y citas: el ritmo de un mes normal, no el de una emergencia.',
      pasos: [
        paso(
          'puntos_conexion',
          'Puntos de conexión',
          d.puntosConexion > 0,
          'No hay puntos de conexión registrados. Sin ellos no se sabe dónde una comunidad sin señal puede reportar o escuchar una respuesta.',
          { href: '/conexion', opcional: true },
        ),
        pasoFuturo(
          'proveedores',
          'Proveedores de servicio y citas',
          'Los proveedores de servicio y las citas todavía no están en el sistema (llegan con la integración de telesalud).',
        ),
        pasoFuturo(
          'cadencias',
          'Cadencias de programa',
          'Las cadencias de programa todavía no están en el sistema. Sin ellas no se pueden agendar controles ni entregas periódicas.',
        ),
      ],
      completa: false,
    },
  ]

  // A stage is complete when every required, available step in it is done. «Available» excludes
  // capabilities not yet built; «required» excludes the optional-but-useful steps.
  const requeridoPendiente = (p: PasoConfiguracion) =>
    p.estado === 'pendiente' && !p.opcional
  for (const etapa of etapas) {
    etapa.completa = !etapa.pasos.some(requeridoPendiente)
  }

  const etapa1Alcanzada = d.comunidades > 0 && d.numeroEntrada
  const operarDisponible = d.comunidades > 0

  // Setup «complete» (Configurar collapses to a link, §29b.1) means the core response is
  // configured: every required, available step through stage 2. Stages 3–4 are the later rhythm
  // and never block a fresh disaster deployment from reading as ready.
  const nucleo = etapas.filter((e) => e.numero <= 2)
  const pendientes = nucleo.flatMap((e) => e.pasos).filter(requeridoPendiente).length
  const completa = pendientes === 0

  return { etapas, etapa1Alcanzada, operarDisponible, completa, pendientes }
}

// ── IO: gather the facts, and record the two acknowledgements ────────────────────────────────

/**
 * Read every fact the checklist needs, scoped to the caller's own organisation.
 *
 * The read policies (0017) gate by role but not by organisation — a coordinator can *see* the
 * whole basin on purpose — so every count here filters on `convite_organizacion()` explicitly.
 * That is what makes «your setup» mean this organisation's, not the platform's.
 */
export async function reunirDatosConfiguracion(client: PoolClient): Promise<DatosConfiguracion> {
  const { rows } = await client.query<{
    aprobada: boolean
    acuerdo_datos_en: string | null
    roles_confirmados_en: string | null
    comunidades: string
    reportes: string
    numero_entrada: boolean
    catalogo_items: string
    centros_total: string
    centros_sin_ubicacion: string
    comunidades_sin_ruta: string
    existencias: string
    apadrinamientos_activos: string
    puntos_conexion: string
  }>(`
    with org as (
      select id, estado_aprobacion = 'aprobada' as aprobada,
             waba_phone_number_id is not null as numero_entrada
        from organizaciones where id = convite_organizacion()
    )
    select
      (select aprobada from org) as aprobada,
      (select numero_entrada from org) as numero_entrada,
      (select valor from configuracion where clave = 'onboarding:acuerdo_datos:' || (select id from org)) as acuerdo_datos_en,
      (select valor from configuracion where clave = 'onboarding:roles_confirmados:' || (select id from org)) as roles_confirmados_en,
      (select count(*) from comunidades where activa and organizacion_id = (select id from org)) as comunidades,
      (select count(*) from reportes where organizacion_id = (select id from org)) as reportes,
      (select count(*) from catalogo_items where activo) as catalogo_items,
      (select count(*) from nodos n join comunidades c on c.id = n.comunidad_id
        where n.activo and c.organizacion_id = (select id from org)) as centros_total,
      (select count(*) from nodos n join comunidades c on c.id = n.comunidad_id
        where n.activo and n.ubicacion is null and c.organizacion_id = (select id from org)) as centros_sin_ubicacion,
      (select count(*) from comunidades c
        where c.activa and c.organizacion_id = (select id from org)
          and not exists (
            select 1 from rutas r
             where r.activa and (r.origen_id = c.id or r.destino_id = c.id))) as comunidades_sin_ruta,
      (select count(*) from existencias e
        join nodos n on n.id = e.nodo_id
        join comunidades c on c.id = n.comunidad_id
        where c.organizacion_id = (select id from org)) as existencias,
      (select count(*) from apadrinamientos
        where organizacion_id = (select id from org) and estado = 'activo') as apadrinamientos_activos,
      (select count(*) from puntos_conexion
        where organizacion_id = (select id from org) and activo) as puntos_conexion
  `)

  const f = rows[0]
  const n = (v: string | null | undefined) => Number(v ?? 0)
  return {
    organizacionAprobada: f?.aprobada ?? false,
    acuerdoDatosEn: f?.acuerdo_datos_en ?? null,
    rolesConfirmadosEn: f?.roles_confirmados_en ?? null,
    comunidades: n(f?.comunidades),
    reportes: n(f?.reportes),
    numeroEntrada: f?.numero_entrada ?? false,
    catalogoItems: n(f?.catalogo_items),
    centrosTotal: n(f?.centros_total),
    centrosSinUbicacion: n(f?.centros_sin_ubicacion),
    comunidadesSinRuta: n(f?.comunidades_sin_ruta),
    existencias: n(f?.existencias),
    apadrinamientosActivos: n(f?.apadrinamientos_activos),
    puntosConexion: n(f?.puntos_conexion),
  }
}

/**
 * Record an acknowledgement (data agreement or role model) as a `configuracion` row, stamped
 * with who did it and when. Admin-only at the RLS floor (0020), the same as the season change,
 * which is correct: setting up who-sees-what and signing the data agreement are admin decisions
 * (§11). `auth.uid()` on both the insert and the update path satisfies the signed-write policy.
 */
export async function guardarReconocimiento(
  client: PoolClient,
  clave: string,
  descripcion: string,
): Promise<void> {
  await client.query(
    `insert into configuracion (clave, valor, descripcion, actualizado_por)
       values ($1, $2, $3, auth.uid())
     on conflict (clave)
       do update set valor = excluded.valor, actualizado_por = auth.uid()`,
    [clave, new Date().toISOString(), descripcion],
  )
}
