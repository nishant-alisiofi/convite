import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { creadoEn, enLista, pk } from './_shared'
import { contactos, organizaciones } from './core'
import { reportes } from './intake'
import { ESTADOS_LLAMADA, TIPOS_LLAMADA } from './vocabulario'

/**
 * Every call, including the ones we decided not to make.
 *
 * Section 4.3: a missed call costs the caller nothing because we reject it without
 * answering, and then we pay for the callback. That inversion is the point of the channel
 * and it puts the entire cost on our side, which is why the spend caps read this table.
 *
 * A blocked callback is a row. A cap that silently drops a call is indistinguishable from a
 * bug, and «why did nobody ring Élver back» has to have an answer.
 */
export const llamadas = pgTable(
  'llamadas',
  {
    id: pk(),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    proveedor: text('proveedor').notNull().default('voz_simulador'),
    proveedorLlamadaId: text('proveedor_llamada_id'),
    contactoId: uuid('contacto_id').references(() => contactos.id),
    telefono: text('telefono').notNull(),
    tipo: text('tipo').notNull(),
    estado: text('estado').notNull(),
    /** Only when blocked: which cap refused it, in words. */
    motivoBloqueo: text('motivo_bloqueo'),
    /** Keys pressed, in order. Read as prompt-quality data, not as user error. */
    rutaTecleada: text('ruta_tecleada'),
    duracionSeg: integer('duracion_seg').notNull().default(0),
    costoUsd: numeric('costo_usd', { precision: 10, scale: 5 }),
    reporteId: uuid('reporte_id').references(() => reportes.id),
    iniciadaEn: timestamp('iniciada_en', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    finalizadaEn: timestamp('finalizada_en', { withTimezone: true, mode: 'date' }),
    /**
     * §6.1 (v4 supplement): on a `devolucion` row, the `perdida` row that triggered it. The
     * Adaptive Retry Protocol's 2-hour TTL reads `iniciadaEn` off THIS row, not off the
     * callback's own — see lib/canales/voz/reintento.ts.
     */
    llamadaOrigenId: uuid('llamada_origen_id').references((): AnyPgColumn => llamadas.id),
    /** §6.1: when the one allowed SMS retry actually went out. Null = not sent (yet, or ever). */
    smsReintentoEn: timestamp('sms_reintento_en', { withTimezone: true, mode: 'date' }),
    creadoEn: creadoEn(),
  },
  (t) => [
    // 2.7: providers retry call webhooks exactly like message webhooks.
    uniqueIndex('llamadas_proveedor_id_key')
      .on(t.proveedor, t.proveedorLlamadaId)
      .where(sql`proveedor_llamada_id is not null`),
    index('llamadas_telefono_idx').on(t.telefono, t.iniciadaEn),
    index('llamadas_iniciada_idx').on(t.iniciadaEn),
    index('llamadas_reporte_idx').on(t.reporteId),
    check('llamadas_tipo_check', enLista('tipo', TIPOS_LLAMADA)),
    check('llamadas_estado_check', enLista('estado', ESTADOS_LLAMADA)),
    check('llamadas_duracion_check', sql`duracion_seg >= 0`),
    check('llamadas_telefono_e164_check', sql`telefono ~ '^\\+[1-9][0-9]{7,14}$'`),
    check('llamadas_bloqueo_check', sql`(estado = 'bloqueada') = (motivo_bloqueo is not null)`),
    check(
      'llamadas_sin_costo_check',
      sql`estado not in ('bloqueada', 'rechazada') or duracion_seg = 0`,
    ),
    check('llamadas_origen_check', sql`llamada_origen_id is null or tipo = 'devolucion'`),
  ],
)
