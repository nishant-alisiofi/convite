import { sql } from 'drizzle-orm'
import { boolean, char, check, integer, pgTable, smallint, text } from 'drizzle-orm/pg-core'
import { actualizadoEn, creadoEn, enLista } from './_shared'
import { FAMILIAS_AYUDA, TIPOS_REPORTE } from './vocabulario'

/**
 * Non-negotiable 2.8: the item catalogue is data, not code. No enums, no switch statements
 * on item codes anywhere in the repo. Different territories need different items, and
 * changing the catalogue must not require a deploy — it is edited from the Catálogo screen.
 *
 * The two-digit `codigo` is deliberately visible to reporters in the WhatsApp list rows
 * (Section 6.4). People learn the codes by use, and that is what makes the eventual SMS
 * fallback ("22 12 3") work without a menu.
 */
export const catalogoItems = pgTable(
  'catalogo_items',
  {
    codigo: char('codigo', { length: 2 }).primaryKey(),
    familia: char('familia', { length: 1 }).notNull(),
    familiaLabel: text('familia_label').notNull(),
    itemLabel: text('item_label').notNull(),
    tipo: text('tipo').notNull(),
    /** Shown under the row in the WhatsApp list; plain language, no jargon. */
    ayudaTexto: text('ayuda_texto'),
    /**
     * How a person counts this item out loud — «un mercado» / «18 mercados». Used verbatim
     * when building `pedidos.motivo`, which is why it is catalogue data and not a lookup
     * table in the source (2.8).
     */
    unidadSingular: text('unidad_singular'),
    unidadPlural: text('unidad_plural'),
    /** If true the flow asks a follow-up free-text or voice note (e.g. which medicine). */
    pideDetalle: boolean('pide_detalle').notNull().default(false),
    /** Floor on urgency: a medical transfer is never logged as routine. */
    urgenciaMin: smallint('urgencia_min').notNull().default(1),
    /** False for items that are not a thing to load on a boat, e.g. psychosocial support. */
    entregable: boolean('entregable').notNull().default(true),
    /**
     * FR-45 — the coarse family Doña Marta asked to track distinctly: alimentos, medicinas or
     * construcción. NULL for items that are genuinely none of the three (shelter kits, hygiene,
     * niñez, daños) — see the vocabulary comment on `FAMILIAS_AYUDA`. Never guessed to fill the
     * field.
     */
    familiaAyuda: text('familia_ayuda'),
    /**
     * FR-43 — whether counted stock of this item is the kind that carries a printed/labelled
     * expiry (medicines, packaged food, water-treatment tablets). Distinct from `ofertas
     * .perecedero`, which marks a specific donor's free-text offer (a cooked meal is perishable
     * even under a catalogue code whose usual stock is not); this flags the catalogue LINE for
     * counted node stock, which the same code always means. Drives whether the Inventario lot
     * form offers a `fecha_caducidad` field — the date itself always stays optional (2.3, BUG-23:
     * unknown shows «sin fecha», never a guess).
     */
    perecedero: boolean('perecedero').notNull().default(false),
    orden: integer('orden').notNull().default(0),
    activo: boolean('activo').notNull().default(true),
    creadoEn: creadoEn(),
    actualizadoEn: actualizadoEn(),
  },
  () => [
    check('catalogo_items_codigo_check', sql`codigo ~ '^[0-9]{2}$'`),
    check('catalogo_items_familia_check', sql`familia = left(codigo, 1)`),
    check('catalogo_items_tipo_check', enLista('tipo', TIPOS_REPORTE)),
    check('catalogo_items_urgencia_check', sql`urgencia_min between 1 and 3`),
    check(
      'catalogo_items_familia_ayuda_check',
      sql`familia_ayuda is null or ${enLista('familia_ayuda', FAMILIAS_AYUDA)}`,
    ),
  ],
)
