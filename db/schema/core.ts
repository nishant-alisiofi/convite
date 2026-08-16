import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { actualizadoEn, creadoEn, enLista, pk, punto } from './_shared'
import {
  CANALES,
  CANALES_PREFERIDOS,
  ESTADOS_APROBACION,
  FUENTES_UBICACION,
  ROLES_CONTACTO,
  ROLES_STAFF,
  TIPOS_COMUNIDAD,
} from './vocabulario'

/**
 * Section 4: we operate under a partner organisation's WhatsApp Business Account, not our
 * own. v1 has exactly one row, but the WABA config is scoped per organisation from day one
 * so onboarding a second partner is an INSERT, not a migration.
 */
export const organizaciones = pgTable(
  'organizaciones',
  {
    id: pk(),
    nombre: text('nombre').notNull(),
    /**
     * Null until we know whose WABA we operate under. Nothing in the system requires it:
     * the messaging channel sits behind a port (lib/canales) and the simulator driver
     * needs no Meta credential at all. When a real id arrives it must be unique, because
     * inbound webhooks route to an organisation by it.
     */
    wabaPhoneNumberId: text('waba_phone_number_id'),
    wabaId: text('waba_id'),
    /**
     * §2.4 / §4: a centre handles aid and PII, so it operates only once the platform has
     * approved it. `pendiente` on a newly-requested centre, `aprobada` once a platform admin
     * says yes, `rechazada` for a decided no. Migration 0034 backfills every organisation that
     * existed before this column to `aprobada`, so nothing that already worked is cut off. The
     * panel gate is in app/(panel)/layout.tsx; a member of a non-approved centre sees a
     * «pending approval» screen, never a 500.
     */
    estadoAprobacion: text('estado_aprobacion').notNull().default('pendiente'),
    /**
     * §5.7: the centre's own point on the map, from which the Recogidas run is measured. Set
     * via `convite_fijar_ubicacion_organizacion` (migration 0036), which is the only writer.
     * Non-negotiable 2.2 — a stored point never travels without its declared source and radius.
     */
    ubicacion: punto('ubicacion'),
    ubicacionFuente: text('ubicacion_fuente'),
    ubicacionPrecisionM: integer('ubicacion_precision_m'),
    activo: boolean('activo').notNull().default(true),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    uniqueIndex('organizaciones_nombre_key').on(t.nombre),
    uniqueIndex('organizaciones_waba_phone_number_id_key')
      .on(t.wabaPhoneNumberId)
      .where(sql`waba_phone_number_id is not null`),
    check('organizaciones_estado_aprobacion_check', enLista('estado_aprobacion', ESTADOS_APROBACION)),
    check(
      'organizaciones_ubicacion_declarada_check',
      sql`(ubicacion is null and ubicacion_fuente is null)
          or (ubicacion is not null and ubicacion_fuente is not null and ubicacion_precision_m is not null)`,
    ),
    check(
      'organizaciones_ubicacion_fuente_check',
      sql`ubicacion_fuente is null or ${enLista('ubicacion_fuente', FUENTES_UBICACION)}`,
    ),
    check('organizaciones_ubicacion_precision_check', sql`ubicacion_precision_m is null or ubicacion_precision_m >= 0`),
  ],
)

export const comunidades = pgTable(
  'comunidades',
  {
    id: pk(),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    codigo: text('codigo').notNull(),
    nombre: text('nombre').notNull(),
    tipo: text('tipo').notNull(),
    municipio: text('municipio').notNull(),
    /** Sub-municipal grouping used by the field team, e.g. "Atrato medio", "Vía Yuto". */
    agrupador: text('agrupador'),
    ubicacion: punto('ubicacion'),
    /** Non-negotiable 2.2 — a community centroid is not a GPS pin and must not render as one. */
    ubicacionFuente: text('ubicacion_fuente').notNull().default('centroide'),
    ubicacionPrecisionM: integer('ubicacion_precision_m').notNull().default(1000),
    familiasEstimadas: integer('familias_estimadas'),
    /** 1 = data reliable, 2 = intermittent, 3 = voice/SMS only, 4 = radio relay only. */
    tierConectividad: smallint('tier_conectividad').notNull().default(2),
    /** Section 9.8: silence beyond this many days is a signal, not an absence of need. */
    intervaloChequeoDias: integer('intervalo_chequeo_dias').notNull().default(14),
    activa: boolean('activa').notNull().default(true),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    uniqueIndex('comunidades_codigo_key').on(t.codigo),
    index('comunidades_municipio_idx').on(t.municipio),
    check('comunidades_tipo_check', enLista('tipo', TIPOS_COMUNIDAD)),
    check('comunidades_ubicacion_fuente_check', enLista('ubicacion_fuente', FUENTES_UBICACION)),
    check('comunidades_tier_check', sql`tier_conectividad between 1 and 4`),
    check('comunidades_precision_check', sql`ubicacion_precision_m >= 0`),
    // A stored point without a declared source is exactly the silent precision upgrade
    // non-negotiable 2.2 forbids.
    check(
      'comunidades_ubicacion_declarada_check',
      sql`ubicacion is null or ubicacion_fuente is not null`,
    ),
  ],
)

/**
 * Non-negotiable 2.10: community members never log in. They are identified by phone number
 * alone — no password, no app install. Only rows in `usuarios` can authenticate.
 */
export const contactos = pgTable(
  'contactos',
  {
    id: pk(),
    /** E.164, e.g. +573001234567. */
    telefono: text('telefono').notNull(),
    nombre: text('nombre'),
    rol: text('rol').notNull().default('reportante'),
    comunidadId: uuid('comunidad_id').references(() => comunidades.id),
    canalPreferido: text('canal_preferido').notNull().default('whatsapp'),
    idioma: text('idioma').notNull().default('es'),
    aceptaLlamadas: boolean('acepta_llamadas').notNull().default(true),
    ultimoContactoEn: timestamp('ultimo_contacto_en', { withTimezone: true, mode: 'date' }),
    activo: boolean('activo').notNull().default(true),

    // Non-negotiable 2.14: link quality is measured, not declared. `tier_conectividad` on
    // the community is a starting guess; these are what we observed for this person.
    /** 0..1. NULL means never measured, which is not the same as bad. */
    calidadEnlace: numeric('calidad_enlace', { precision: 3, scale: 2 }),
    /** Hour-of-day distribution of inbound messages — when they are actually reachable. */
    ventanaActividad: jsonb('ventana_actividad'),
    /** Has a media upload EVER completed? NULL = never attempted. Strongest predictor. */
    mediaExitosa: boolean('media_exitosa'),
    ultimaMedicion: timestamp('ultima_medicion', { withTimezone: true, mode: 'date' }),

    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    uniqueIndex('contactos_telefono_key').on(t.telefono),
    index('contactos_comunidad_idx').on(t.comunidadId),
    check('contactos_rol_check', enLista('rol', ROLES_CONTACTO)),
    check('contactos_canal_check', enLista('canal_preferido', CANALES_PREFERIDOS)),
    check('contactos_telefono_e164_check', sql`telefono ~ '^\\+[1-9][0-9]{7,14}$'`),
    check(
      'contactos_calidad_enlace_check',
      sql`calidad_enlace is null or calidad_enlace between 0 and 1`,
    ),
  ],
)

/**
 * Non-negotiable 2.14: outbound to a poor link is queued here and piggybacked on the
 * person's next inbound message, batched into a single digest. Never five messages fired
 * at once when somebody reappears, and never a message whose only job is to advance a
 * state machine (2.13).
 */
export const salidasPendientes = pgTable(
  'salidas_pendientes',
  {
    id: pk(),
    contactoId: uuid('contacto_id')
      .notNull()
      .references(() => contactos.id, { onDelete: 'cascade' }),
    cuerpo: text('cuerpo').notNull(),
    prioridad: smallint('prioridad').notNull().default(5),
    canalSugerido: text('canal_sugerido'),
    /**
     * Approved template to use if this goes out after the 24-hour window closed (0022).
     * NULL means ordinary text, which is only legal inside the window. A name here records
     * intent, not approval — D4 has cleared none of them.
     */
    plantilla: text('plantilla'),
    intentos: integer('intentos').notNull().default(0),
    enviarDespuesDe: timestamp('enviar_despues_de', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    enviadoEn: timestamp('enviado_en', { withTimezone: true, mode: 'date' }),
    creadoEn: creadoEn(),
  },
  (t) => [
    index('salidas_pendientes_contacto_idx')
      .on(t.contactoId, t.enviarDespuesDe)
      .where(sql`enviado_en is null`),
    check('salidas_prioridad_check', sql`prioridad between 1 and 9`),
    check(
      'salidas_canal_check',
      sql`canal_sugerido is null or ${enLista('canal_sugerido', CANALES)}`,
    ),
  ],
)

/**
 * Staff only. `id` is the `auth_user.id` of the person who signed in, so RLS policies can
 * compare against auth.uid() without a join. Section 11: rol_staff gates the UI, RLS gates
 * the data.
 */
export const usuarios = pgTable(
  'usuarios',
  {
    id: uuid('id').primaryKey(),
    contactoId: uuid('contacto_id').references(() => contactos.id),
    rolStaff: text('rol_staff').notNull(),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    /**
     * §2.5: the platform tier (Alisio / us), a level above a centre's own admin. Orthogonal to
     * `rol_staff` on purpose — a platform admin still has a working desk inside their own
     * organisation (they are an `admin`), and this flag is the cross-org elevation on top: it
     * lets them approve centres and reach across organisations. Modelling it as a flag rather
     * than a sixth role keeps every existing `convite_es(array[...])` policy untouched; the
     * cross-org reach is added additively in migration 0034 via `convite_es_plataforma()`.
     * Set only from a platform invitation (`invitaciones_staff.es_plataforma`) — never by a
     * centre admin, which the escalation guard in 0034 enforces.
     */
    esPlataforma: boolean('es_plataforma').notNull().default(false),
    activo: boolean('activo').notNull().default(true),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    index('usuarios_organizacion_idx').on(t.organizacionId),
    check('usuarios_rol_staff_check', enLista('rol_staff', ROLES_STAFF)),
  ],
)

/**
 * Which communities a `verificador` may act on (Section 11). Empty set for a role that is
 * not scoped by community.
 */
export const usuariosComunidades = pgTable(
  'usuarios_comunidades',
  {
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuarios.id, { onDelete: 'cascade' }),
    comunidadId: uuid('comunidad_id')
      .notNull()
      .references(() => comunidades.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('usuarios_comunidades_key').on(t.usuarioId, t.comunidadId)],
)
