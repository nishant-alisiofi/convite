/**
 * PRD-33 «Cadena de frío y suministro anticipado» — demo cold-chain constraints and one
 * anticipatory subscription. STAGING ONLY. Consumed only by scripts/seed.ts, on ASOREDIPARCHOCÓ.
 *
 * The constraint is data on items, routes and nodes — never a branch on a code (2.8). Here it is
 * made demonstrable end to end on a REAL existing need: the verified chronic-meds request in Beté
 * (losartán/insulina para ocho personas mayores, db/seed/operacion.ts). Marking item 22 as
 * cold-chain, leaving the open-boat leg into Beté explicitly not apt, and marking the Quibdó
 * warehouse as cold-holding means the matcher — run once by the seed — reclassifies that pedido to
 * SIN_RUTA with a cold-chain motivo: «no hay una ruta que conserve la cadena de frío hasta Beté».
 * The node side is fine; the route is the blocker, which is exactly the «six-hour open boat» case.
 *
 * Nothing else changes: cold-chain data is read only for cold-chain items, so every other match is
 * untouched, and no other seeded pedido uses item 22. An anticipatory subscription (a chronic
 * refill on a cadence) is added so the anticipatory side of §24 has a row too.
 *
 * Idempotent: item requirement upserts on its primary key; route/node aptitude on theirs; the
 * subscription on a fixed id. UI-visible strings are marked [DATO DE PRUEBA] by scripts/seed.ts.
 */

/** One catalogue item's storage constraint (§24). Absence of a row = an ordinary, unconstrained item. */
export type RequisitoAlmacenamientoSemilla = {
  codigoItem: string
  cadenaFrio: boolean
  sensibleLuz: boolean
  /** Longest tolerated in open transit before spoiling, in minutes. Null = no time bound. */
  maxMinutosTransito: number | null
  notas: string | null
}

/**
 * A route leg's cold-chain aptitude, addressed by the community it reaches (resolved to a ruta id).
 * Absence already means «not apt» (fail-closed); this row makes one open-boat leg an EXPLICIT no,
 * so the exclusion is legible rather than merely default.
 */
export type RutaFrioSemilla = {
  /** Destination community code of the leg to mark. */
  destino: string
  aptaCadenaFrio: boolean
  notas: string | null
}

/** A node's cold-holding capability, addressed by its seed clave (resolved to a nodo id). */
export type NodoFrioSemilla = {
  nodoClave: string
  aptaCadenaFrio: boolean
  notas: string | null
}

/** A predictable recurring need proposed before stockout (§24 / §30). */
export type SuministroAnticipadoSemilla = {
  id: string
  comunidad: string
  /** Opaque beneficiary label (§27b.1) — never a name or a clinical record. */
  beneficiarioRef: string
  codigoItem: string
  familias: number
  cadenciaDias: number
  diasAnticipacion: number
  /** When it was last supplied, as days before today. */
  ultimoSuministroDiasAtras: number
}

export const REQUISITOS_ALMACENAMIENTO_DEMO: RequisitoAlmacenamientoSemilla[] = [
  {
    // Item 22 «Medicamento crónico» — tensión, azúcar/insulina. Refrigerated end to end; a six-hour
    // open boat is out of its window.
    codigoItem: '22',
    cadenaFrio: true,
    sensibleLuz: true,
    maxMinutosTransito: 360,
    notas: 'Insulina y crónicos: requieren frío y no toleran más de seis horas en tránsito abierto.',
  },
]

export const RUTAS_FRIO_DEMO: RutaFrioSemilla[] = [
  {
    // The open-boat leg into Beté: explicitly assessed as NOT apt for cold chain.
    destino: 'BET',
    aptaCadenaFrio: false,
    notas: 'Lancha abierta, varias horas de río: no conserva la cadena de frío.',
  },
]

export const NODOS_FRIO_DEMO: NodoFrioSemilla[] = [
  {
    // The Quibdó warehouse CAN hold cold chain — so the blocker is the route, not the origin.
    nodoClave: 'BOD-QBD',
    aptaCadenaFrio: true,
    notas: 'Cuenta con nevera para conservar insulina y crónicos mientras se despachan.',
  },
]

export const SUMINISTROS_ANTICIPADOS_DEMO: SuministroAnticipadoSemilla[] = [
  {
    id: 'd3000040-0000-4000-8000-000000000001',
    comunidad: 'BET',
    beneficiarioRef: 'Personas mayores en tratamiento crónico del Atrato medio',
    codigoItem: '22',
    familias: 8,
    cadenciaDias: 30,
    diasAnticipacion: 7,
    ultimoSuministroDiasAtras: 25,
  },
]
