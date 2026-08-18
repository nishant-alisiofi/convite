import type { EstadoCompraLocal, TipoEvidenciaCompra } from '@/db/schema/compra-local'

/**
 * PRD-9 «Compra local financiada» — demo funding pool, vendors and purchases for the /compra-local
 * screen. STAGING ONLY. Consumed only by scripts/seed.ts, on ASOREDIPARCHOCÓ (the demo org).
 *
 * One pool with a ceiling the database enforces, two local vendors, and two purchases at different
 * points of the six-step traceability chain — one mid-chain (COMPRADA, receipt filed) and one
 * near-complete (DISTRIBUIDA, with photographic evidence). Every purchase is inserted directly at
 * its target state with all the earlier steps' who-and-when filled, because the authorisation core
 * is immutable after recording (the 0049 trigger) and the chain's checks require each prior step's
 * evidence to be present.
 *
 * The two purchases sum well under the pool ceiling, so the guardrail trigger admits them, and the
 * pool still reads with real headroom. Idempotent: fixed UUIDs, and scripts/seed.ts skips a purchase
 * whose id already exists (so the BEFORE INSERT guardrail never double-counts on a re-run). Every
 * UI-visible string is marked [DATO DE PRUEBA] by scripts/seed.ts.
 */

export type FondoCompraSemilla = {
  id: string
  nombre: string
  techoCop: number
  umbralAlertaCop: number | null
}

export type ProveedorExistenciaSemilla = { codigoItem: string; cantidad: number }

export type ProveedorLocalSemilla = {
  id: string
  nombre: string
  comunidad: string | null
  municipio: string | null
  suministra: string | null
  contacto: string | null
  /** FR-44. A pharmacy's medical stock, tracked structurally rather than only in `suministra`. */
  esFarmacia?: boolean
  existencias?: ProveedorExistenciaSemilla[]
}

export type CompraLocalItemSemilla = { codigoItem: string; cantidad: number; costoCop: number | null }

export type CompraLocalEvidenciaSemilla = {
  tipo: TipoEvidenciaCompra
  referencia: string
  descripcion: string | null
}

export type CompraLocalSemilla = {
  id: string
  /** The pool it draws on, by fixed id. */
  fondo: string
  /** The vendor, by fixed id; null when none is on record. */
  proveedor: string | null
  /** The territorial responsible who buys, by their contact phone (resolved to a contacto id). */
  responsableTelefono: string
  comunidad: string | null
  concepto: string
  montoAutorizadoCop: number
  /** The amount actually spent, recorded with the receipt. Null until COMPRADA. */
  montoRealCop: number | null
  estado: EstadoCompraLocal
  /** Step 1: how long ago it was authorised (days). */
  autorizadoDiasAtras: number
  /** Step 3: the receipt reference, once COMPRADA. */
  reciboRef: string | null
  /** Days ago each step happened; null for steps not yet reached. */
  compradoDiasAtras: number | null
  verificadoDiasAtras: number | null
  distribuidoDiasAtras: number | null
  cerradoDiasAtras: number | null
  notas?: string | null
  items: CompraLocalItemSemilla[]
  evidencias: CompraLocalEvidenciaSemilla[]
}

const FONDO_MEDICAMENTOS = 'd3000030-0000-4000-8000-000000000001'
const PROV_DROGUERIA = 'd3000031-0000-4000-8000-000000000001'
const PROV_DISTRIBUIDORA = 'd3000031-0000-4000-8000-000000000002'

export const FONDOS_COMPRA_DEMO: FondoCompraSemilla[] = [
  {
    id: FONDO_MEDICAMENTOS,
    nombre: 'Banco de medicamentos del Atrato',
    techoCop: 30_000_000,
    umbralAlertaCop: 24_000_000,
  },
]

export const PROVEEDORES_LOCALES_DEMO: ProveedorLocalSemilla[] = [
  {
    id: PROV_DROGUERIA,
    nombre: 'Droguería La Salud',
    comunidad: 'QBD',
    municipio: 'Quibdó',
    suministra: 'Medicamentos generales y crónicos',
    contacto: 'Calle 26 con carrera 5, Quibdó',
    // FR-44: a real pharmacy already sitting in the community, structurally tracked so it can
    // be offered as a local fulfilment option for a medical need before shipping anything in.
    esFarmacia: true,
    existencias: [
      { codigoItem: '21', cantidad: 60 },
      { codigoItem: '22', cantidad: 25 },
      { codigoItem: '24', cantidad: 40 },
    ],
  },
  {
    id: PROV_DISTRIBUIDORA,
    nombre: 'Distribuidora del Atrato',
    comunidad: 'QBD',
    municipio: 'Quibdó',
    suministra: 'Aseo, higiene y agua',
    contacto: '+573000000041',
  },
]

export const COMPRAS_LOCALES_DEMO: CompraLocalSemilla[] = [
  {
    // Mid-chain: bought and receipt filed, not yet verified. Resolves a chronic-meds need near the
    // cabecera when shipping cold-chain in is not viable (see db/seed/cadena-frio.ts).
    id: 'd3000032-0000-4000-8000-000000000001',
    fondo: FONDO_MEDICAMENTOS,
    proveedor: PROV_DROGUERIA,
    responsableTelefono: '+573000000001',
    comunidad: 'BET',
    concepto: 'Medicamentos crónicos para el Atrato medio',
    montoAutorizadoCop: 3_000_000,
    montoRealCop: 2_850_000,
    estado: 'COMPRADA',
    autorizadoDiasAtras: 9,
    reciboRef: 'REC-2026-0412',
    compradoDiasAtras: 6,
    verificadoDiasAtras: null,
    distribuidoDiasAtras: null,
    cerradoDiasAtras: null,
    items: [
      { codigoItem: '22', cantidad: 40, costoCop: 2_200_000 },
      { codigoItem: '21', cantidad: 20, costoCop: 650_000 },
    ],
    evidencias: [
      { tipo: 'recibo', referencia: 'archivo://recibos/REC-2026-0412.pdf', descripcion: 'Recibo de la droguería.' },
    ],
  },
  {
    // Near-complete: distributed, with photographic evidence, one step from closing.
    id: 'd3000032-0000-4000-8000-000000000002',
    fondo: FONDO_MEDICAMENTOS,
    proveedor: PROV_DISTRIBUIDORA,
    responsableTelefono: '+573000000008',
    comunidad: 'BLL',
    concepto: 'Kits de aseo e higiene — Bellavista',
    montoAutorizadoCop: 4_000_000,
    montoRealCop: 3_900_000,
    estado: 'DISTRIBUIDA',
    autorizadoDiasAtras: 15,
    reciboRef: 'REC-2026-0388',
    compradoDiasAtras: 12,
    verificadoDiasAtras: 9,
    distribuidoDiasAtras: 5,
    cerradoDiasAtras: null,
    items: [{ codigoItem: '41', cantidad: 50, costoCop: 3_900_000 }],
    evidencias: [
      { tipo: 'recibo', referencia: 'archivo://recibos/REC-2026-0388.pdf', descripcion: 'Recibo de la distribuidora.' },
      { tipo: 'foto', referencia: 'archivo://fotos/entrega-bellavista.jpg', descripcion: 'Entrega en Bellavista.' },
    ],
  },
]
