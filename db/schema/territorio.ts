import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { actualizadoEn, creadoEn, enLista, pk } from './_shared'
import { comunidades, organizaciones } from './core'
import { ESTADOS_JORNADA, TIPOS_JORNADA, TIPOS_REGION } from './vocabulario'

/**
 * PRD-37 — the territory & registry schema the real seed (db/seed/territorio.sql, loaded by
 * PRD-38) plants on top of. Schema only: no enforcement, no UI. The feature logic lands in the
 * WIs cited per table (PRD-30 jornadas, PRD-28/PRD-31/PRD-35 the registry surfacing).
 *
 * regiones and jornadas live in their own file so the migration and its mirror do not collide
 * with the busy core.ts / marketplace.ts. The reference back from comunidades.region_id is
 * declared as a plain uuid in core.ts with the FK in the migration (0042), to keep this a
 * one-way import (territorio → core) rather than a cycle.
 */

/**
 * §5.7: the top level of the shared gazetteer. A region groups communities for the map and for
 * jornada planning — Chocó, Pacífico caucano, Valle del Cauca. Reference data, exactly like
 * catalogo_items: every signed-in staff role reads it, only an admin edits it (0042). Not
 * org-scoped — the gazetteer is shared across every organisation (§29.3b).
 */
export const regiones = pgTable(
  'regiones',
  {
    id: pk(),
    nombre: text('nombre').notNull(),
    departamento: text('departamento').notNull(),
    tipo: text('tipo').notNull(),
    activa: boolean('activa').notNull().default(true),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    uniqueIndex('regiones_nombre_key').on(t.nombre),
    check('regiones_tipo_check', enLista('tipo', TIPOS_REGION)),
  ],
)

/**
 * §21b/§22: a jornada is one occurrence — people and things arrive at a place, on a date, for a
 * community that must be told in advance. This is the bare table only; the planning surface,
 * drafting and matching are PRD-30. The tables live here ahead of that feature because the seed
 * (PRD-38) plants Herencia's historical jornadas so a partner opens the map onto their own work
 * rather than an empty screen (§31). Org-scoped like every operational table; RLS binds it (0043).
 */
export const jornadas = pgTable(
  'jornadas',
  {
    id: pk(),
    codigo: text('codigo').notNull(),
    tipo: text('tipo').notNull(),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    titulo: text('titulo').notNull(),
    regionId: uuid('region_id')
      .notNull()
      .references(() => regiones.id),
    /**
     * PRD-31 (§21b): the programa a jornada realises, when it belongs to one — «not everything
     * belongs to a programa» (an emergency shipment does not), so it is nullable. Declared as a
     * plain uuid with the FK added in migration 0045, keeping the import one-way (programas.ts →
     * territorio.ts) rather than a cycle — the same trick comunidades.region_id uses (0042).
     */
    programaId: uuid('programa_id'),
    fechaInicio: date('fecha_inicio'),
    fechaFin: date('fecha_fin'),
    estado: text('estado').notNull().default('borrador'),
    familiasAtendidas: integer('familias_atendidas'),
    notas: text('notas'),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    uniqueIndex('jornadas_codigo_key').on(t.codigo),
    index('jornadas_organizacion_idx').on(t.organizacionId),
    index('jornadas_region_idx').on(t.regionId),
    index('jornadas_estado_idx').on(t.estado),
    index('jornadas_programa_idx').on(t.programaId),
    check('jornadas_tipo_check', enLista('tipo', TIPOS_JORNADA)),
    check('jornadas_estado_check', enLista('estado', ESTADOS_JORNADA)),
    check('jornadas_familias_check', sql`familias_atendidas is null or familias_atendidas >= 0`),
    check(
      'jornadas_fechas_check',
      sql`fecha_fin is null or fecha_inicio is null or fecha_fin >= fecha_inicio`,
    ),
  ],
)

/**
 * The ordered stops of a jornada — which communities it reaches, and in what order. Seeded
 * (PRD-38) as «supposed» stops for the historical jornadas, explicitly for the partner to
 * correct. Cascades with its jornada; comunidad_id is a plain reference so deleting a jornada
 * never reaches into the shared registry.
 */
export const jornadaParadas = pgTable(
  'jornada_paradas',
  {
    id: pk(),
    jornadaId: uuid('jornada_id')
      .notNull()
      .references(() => jornadas.id, { onDelete: 'cascade' }),
    comunidadId: uuid('comunidad_id')
      .notNull()
      .references(() => comunidades.id),
    orden: integer('orden').notNull(),
    notas: text('notas'),
    creadoEn: creadoEn(),
  },
  (t) => [
    uniqueIndex('jornada_paradas_orden_key').on(t.jornadaId, t.orden),
    index('jornada_paradas_jornada_idx').on(t.jornadaId),
    index('jornada_paradas_comunidad_idx').on(t.comunidadId),
    check('jornada_paradas_orden_check', sql`orden >= 0`),
  ],
)
