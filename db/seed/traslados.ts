import type { EstadoTraslado, MotivoTraslado } from '@/db/schema/transporte-personas'

/**
 * PRD-8 «Traslado de personas» — demo person-transport records for the /traslados screen. STAGING
 * ONLY. Consumed only by scripts/seed.ts, on ASOREDIPARCHOCÓ (the demo org).
 *
 * Two records that between them show what §25 adds over a goods shipment: seats (a person plus an
 * accompanier), the things a trip out of the basin actually needs (lodging, food, accompaniment)
 * and a RETURN leg; the PII posture (`personaNombre`/`motivoDetalle` behind the RLS floor, only the
 * safe `personaEtiqueta`/`motivo` on the card); and two different states, including one DESPACHADO
 * carrying its 4-digit arrival code.
 *
 * Origin and destination are REAL registry communities. The only hub in the registry is Quibdó, so
 * a referral onward to Medellín is modelled as a trip to Quibdó with the onward context in `motivo`
 * and `notas` (there is no Medellín community to point a foreign key at, and 2.2 forbids inventing
 * one). States are set directly — the person-transport matcher is not run by the seed.
 *
 * Idempotent: fixed UUIDs with `on conflict (id) do nothing`. Every UI-visible string is marked
 * [DATO DE PRUEBA] by scripts/seed.ts; the reserved PII columns are marked too, so even behind the
 * floor a partner cannot mistake a demo person for a real one.
 */

export type TrasladoSemilla = {
  id: string
  personaEtiqueta: string
  personaNombre: string | null
  personaTelefono: string | null
  personas: number
  motivoCategoria: MotivoTraslado
  /** Reserved clinical/context note (PII): behind the RLS floor like the name. */
  motivoDetalle: string | null
  necesidadAccesibilidad: string | null
  origen: string
  destino: string
  ventanaDesdeDiasAtras: number
  ventanaHastaDiasAtras: number
  requiereAlojamiento: boolean
  requiereAlimentacion: boolean
  requiereAcompanamiento: boolean
  requiereRegreso: boolean
  /** Return-leg window as days from today (negative = future); null when no return is asked. */
  regresoVentanaDesdeEnDias: number | null
  regresoVentanaHastaEnDias: number | null
  estado: EstadoTraslado
  /** The public-safe reason shown on the card. */
  motivo: string | null
  /** Who dispatched it and when (days ago). Required for any state past LISTO (§2.1). */
  despachadoDiasAtras: number | null
  /** 4-digit arrival code, set once dispatched. */
  codigoLlegada: string | null
  notas: string | null
}

export const TRASLADOS_DEMO: TrasladoSemilla[] = [
  {
    // Dispatched, with an accompanier, a full set of §25 needs and a return leg — carrying its
    // 4-digit arrival code, awaiting confirmation from the receiving end.
    id: 'd3000020-0000-4000-8000-000000000001',
    personaEtiqueta: 'Partera del Atrato medio',
    personaNombre: 'Bertha Rentería',
    personaTelefono: '+573000000031',
    personas: 2,
    motivoCategoria: 'cirugia',
    motivoDetalle: 'Cirugía programada; viaja con acompañante.',
    necesidadAccesibilidad: 'Requiere ayuda para embarcar y desembarcar.',
    origen: 'TAG',
    destino: 'QBD',
    ventanaDesdeDiasAtras: 2,
    ventanaHastaDiasAtras: 0,
    requiereAlojamiento: true,
    requiereAlimentacion: true,
    requiereAcompanamiento: true,
    requiereRegreso: true,
    regresoVentanaDesdeEnDias: 5,
    regresoVentanaHastaEnDias: 9,
    estado: 'DESPACHADO',
    motivo: 'Lancha de Tagachí a Quibdó con dos cupos; llegada por confirmar con el código.',
    despachadoDiasAtras: 2,
    codigoLlegada: '4821',
    notas: 'Sale primero a Quibdó; de ahí conecta a atención especializada.',
  },
  {
    // Stuck at SIN_CAPACIDAD: reachable, but nobody with a free seat is going in the window. The
    // Medellín referral lives in the reason text — the trip out of the basin starts at Quibdó.
    id: 'd3000020-0000-4000-8000-000000000002',
    personaEtiqueta: 'Gestante de alto riesgo del Bajo Atrato',
    personaNombre: 'Marta Perea',
    personaTelefono: '+573000000032',
    personas: 1,
    motivoCategoria: 'especialista',
    motivoDetalle: 'Remitida a valoración de tercer nivel en Medellín.',
    necesidadAccesibilidad: null,
    origen: 'BLL',
    destino: 'QBD',
    ventanaDesdeDiasAtras: -1,
    ventanaHastaDiasAtras: -6,
    requiereAlojamiento: true,
    requiereAlimentacion: true,
    requiereAcompanamiento: false,
    requiereRegreso: true,
    regresoVentanaDesdeEnDias: 12,
    regresoVentanaHastaEnDias: 18,
    estado: 'SIN_CAPACIDAD',
    motivo: 'Nadie con cupo va de Bellavista a Quibdó dentro de la ventana. Referida a Medellín.',
    despachadoDiasAtras: null,
    codigoLlegada: null,
    notas: 'Debe salir a Quibdó y de ahí a Medellín para valoración especializada.',
  },
]
