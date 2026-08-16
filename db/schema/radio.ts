import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { actualizadoEn, creadoEn, pk } from './_shared'
import { comunidades, organizaciones, usuarios } from './core'
import { reportes } from './intake'

/**
 * PRD-11 — radio as a real inbound channel, ingested from nets that already exist.
 *
 * Convite is NOT a radio network operator (§2): it never transmits, and it does not run a net.
 * It INGESTS from a licensed community net that a partner has confirmed exists and is safe to
 * use. Because that is a judgement about a specific community's real-world situation — which net
 * operates there, and whether keying traffic onto it puts anyone at risk — radio ingestion is
 * OFF for every community until someone with a name attests otherwise, and that attestation
 * EXPIRES. Defaults drift closed: no row means no radio; a lapsed attestation means no radio.
 *
 * This file holds the two radio-only tables. It touches no other feature's schema: the report a
 * relay produces is an ordinary `reportes` row tagged `canal = 'radio'` (the enum already
 * carries it), and the ingestion gate + the insert live in the SECURITY DEFINER functions in
 * migration 0050 rather than in a broad INSERT policy on `reportes`.
 */

/**
 * The per-community attestation that makes radio ingestion legal here (§2, §5.8, PRD-11).
 *
 * One live row per (organisation, community). Re-confirmation is an upsert that resets
 * `atestado_en`/`expira_en` and re-names the attestor — an EXPIRED attestation is never
 * silently extended, it is actively re-confirmed. `uso_seguro` is the safety half: an
 * attestation may record that a net exists yet that use is NOT safe, and that row does not
 * permit ingestion. The gate is `convite_radio_permitido()` (0050): a row that exists, is
 * safe, is not revoked, and has not expired. Anything else, including the absence of a row, is
 * a closed door.
 *
 * Org-scoped like every operational table (0017/0040/0043): a direct `organizacion_id` so the
 * scope is on the row, not on a join that could be widened later.
 */
export const radioPermitido = pgTable(
  'radio_permitido',
  {
    id: pk(),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    comunidadId: uuid('comunidad_id')
      .notNull()
      .references(() => comunidades.id),
    /** Who confirmed — a name on the decision (2.1). The staff member who attested. */
    atestadoPor: uuid('atestado_por')
      .notNull()
      .references(() => usuarios.id),
    /** Which existing licensed net was confirmed to operate here. We ingest from it; we never run it. */
    redDescrita: text('red_descrita').notNull(),
    /** The safety half of the attestation. Only `true` permits ingestion — drift closed. */
    usoSeguro: boolean('uso_seguro').notNull().default(false),
    atestadoEn: timestamp('atestado_en', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    /** Six months on, by default. The gate reads this; a past value is simply not permitted. */
    expiraEn: timestamp('expira_en', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now() + interval '6 months'`),
    /** An attestation can be pulled before it lapses. A revocation carries a name too (2.1). */
    revocadoEn: timestamp('revocado_en', { withTimezone: true, mode: 'date' }),
    revocadoPor: uuid('revocado_por').references(() => usuarios.id),
    notas: text('notas'),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  (t) => [
    // One live attestation per community, per organisation. Re-confirmation updates it.
    uniqueIndex('radio_permitido_org_comunidad_key').on(t.organizacionId, t.comunidadId),
    index('radio_permitido_comunidad_idx').on(t.comunidadId),
    index('radio_permitido_organizacion_idx').on(t.organizacionId),
    // An attestation that expires before it is made is a data error, not a permission.
    check('radio_permitido_vigencia_check', sql`expira_en > atestado_en`),
    // A revocation is somebody's decision, so it carries their name and its time together.
    check(
      'radio_permitido_revocacion_check',
      sql`(revocado_en is null and revocado_por is null)
          or (revocado_en is not null and revocado_por is not null)`,
    ),
  ],
)

/**
 * The relay record: one row per radio-relayed report, naming the TWO people every relay carries
 * (§6, §5.8, PRD-11) — the speaker who was heard on the air, and the operator who relayed and
 * keyed it in. Both are recorded, never one. `capturado_por` is the signed-in staff member who
 * saved it, for system accountability, and is separate from the field operator.
 *
 * A relay is second-hand by definition, so its report always requires a human verification
 * before it can become a pedido — which is already the `reportes` invariant (a verified state
 * needs a named verifier), reinforced here by the fact that a relay never arrives pre-verified.
 *
 * There is deliberately no transcription-confidence column: on radio there is no promised
 * transcription accuracy, so the operator's typing (`reportes.detalle_libre`) is the record,
 * not a machine transcript to be scored (contrast `adjuntos.transcripcion`).
 *
 * Insertion is gated (0050): a BEFORE INSERT trigger refuses a relay whose community has no
 * live, safe, unexpired attestation. Off-by-default and expired are the same closed door.
 */
export const radioRelevos = pgTable(
  'radio_relevos',
  {
    id: pk(),
    /** The report this relay produced. One relay, one report. */
    reporteId: uuid('reporte_id')
      .notNull()
      .unique()
      .references(() => reportes.id, { onDelete: 'cascade' }),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizaciones.id),
    comunidadId: uuid('comunidad_id')
      .notNull()
      .references(() => comunidades.id),
    /** The person heard on the air — whose need or damage this is. */
    hablante: text('hablante').notNull(),
    /** The operator who relayed it and keyed it in, by name (they are rarely a system user). */
    operador: text('operador').notNull(),
    /** The signed-in staff member who saved the relay. System accountability, not the operator. */
    capturadoPor: uuid('capturado_por')
      .notNull()
      .references(() => usuarios.id),
    creadoEn: creadoEn(),
  },
  (t) => [
    index('radio_relevos_organizacion_idx').on(t.organizacionId),
    index('radio_relevos_comunidad_idx').on(t.comunidadId),
    // Two people, both actually named — an empty string is not a name.
    check('radio_relevos_hablante_check', sql`length(btrim(hablante)) > 0`),
    check('radio_relevos_operador_check', sql`length(btrim(operador)) > 0`),
  ],
)
