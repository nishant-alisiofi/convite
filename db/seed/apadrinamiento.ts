import { RECURRENCIAS_APADRINAMIENTO, TIPOS_PADRINO } from '@/db/schema/apadrinamiento'

/**
 * PRD-12 «Apadrina una partera» — demo sponsorships for the /apadrinar screen. STAGING ONLY.
 *
 * The funding side of the marketplace: a sponsor earmarks money to a beneficiary, and every peso
 * is traced from the earmark to a real `pedido`. Seeded so the screen shows the whole chain —
 * committed vs applied vs available, and a per-sponsorship funding trace — instead of an empty
 * page.
 *
 * The three cover the shapes the page has to render:
 *
 *   - `siv-bajo-baudo` — a NAMED community (Sivirú) with consent captured, so it is `activo` and
 *     legal to show a sponsor (apadrinamientos_consentida_check). It has an assignment applied to
 *     Sivirú's real mercados `pedido`, so it shows committed > applied > available and a trace.
 *   - `piz-litoral` — a named community (Pizarro) with consent, but nothing applied yet: the
 *     whole earmark reads as available, the "Disponible para compras" figure PRD-9 draws on.
 *   - `fondo-comun` — a shared pool (no named community, so no consent needed) with one
 *     assignment to Docampadó's mercados `pedido`.
 *
 * Privacy (Ley 1581 / 2.16): a sponsor is only ever shown `beneficiario_etiqueta`, never a real
 * name, number or coordinate. The etiquetas here are aggregated on purpose. scripts/seed.ts marks
 * the etiqueta, the padrino name and the purpose [DATO DE PRUEBA] before any of it reaches a
 * screen a partner might open, and stores the seed key in `notas` (a field the screen never
 * shows) so a re-run does not duplicate a sponsorship.
 */

/** One slice of an earmark applied to a real, already-seeded demand. */
export type AsignacionSemilla = {
  /** Community code of the pedido this funds; resolved to a pedido id at seed time. */
  comunidadPedido: string
  codigoItem: string
  montoCop: number
  concepto: string
}

export type ApadrinamientoSemilla = {
  /** Stable key stored in `notas`, used to keep the seed idempotent. */
  semilla: string
  beneficiarioEtiqueta: string
  /** Community code when the earmark names one; null is a shared pool with no single partera. */
  comunidad: string | null
  padrinoNombre: string
  padrinoContacto?: string | null
  padrinoTipo: (typeof TIPOS_PADRINO)[number]
  proposito: string
  montoCop: number
  recurrencia: (typeof RECURRENCIAS_APADRINAMIENTO)[number]
  /** Must be true whenever `comunidad` is named, or the DB refuses the active sponsorship. */
  consentimiento: boolean
  asignaciones?: AsignacionSemilla[]
}

export const APADRINAMIENTOS_DEMO: ApadrinamientoSemilla[] = [
  {
    semilla: 'siv-bajo-baudo',
    beneficiarioEtiqueta: 'Partera del Bajo Baudó',
    comunidad: 'SIV',
    padrinoNombre: 'Fundación Solidaridad Chocó',
    padrinoContacto: 'aportes@solidaridadchoco.example',
    padrinoTipo: 'organizacion',
    proposito: 'insumos de partería y transporte fluvial',
    montoCop: 3_000_000,
    recurrencia: 'mensual',
    consentimiento: true,
    asignaciones: [
      {
        comunidadPedido: 'SIV',
        codigoItem: '11',
        montoCop: 1_200_000,
        concepto: 'mercados para las familias acompañadas',
      },
    ],
  },
  {
    semilla: 'piz-litoral',
    beneficiarioEtiqueta: 'Partera del litoral del Baudó',
    comunidad: 'PIZ',
    padrinoNombre: 'Ana María Restrepo',
    padrinoContacto: null,
    padrinoTipo: 'individuo',
    proposito: 'insumos de partería',
    montoCop: 1_500_000,
    recurrencia: 'unico',
    consentimiento: true,
  },
  {
    semilla: 'fondo-comun',
    beneficiarioEtiqueta: 'Fondo común de parteras del Atrato',
    comunidad: null,
    padrinoNombre: 'Diáspora Chocoana en Bogotá',
    padrinoContacto: 'diaspora@example.org',
    padrinoTipo: 'organizacion',
    proposito: 'compras locales de insumos',
    montoCop: 2_000_000,
    recurrencia: 'mensual',
    consentimiento: false,
    asignaciones: [
      {
        comunidadPedido: 'DOC',
        codigoItem: '11',
        montoCop: 800_000,
        concepto: 'mercados comprados en la cabecera',
      },
    ],
  },
]
