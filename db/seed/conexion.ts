import type { CostoConexion, NivelConexion, TipoPuntoConexion } from '@/db/schema/conexion'
import type { FuenteUbicacion } from '@/db/schema/vocabulario'

/**
 * §5.9 — Connection points, the "where can I go" surface. STAGING ONLY.
 *
 * The places a person from a low- or no-signal community walks to in order to send a report or
 * hear an answer: a shop with a phone, a pier the boats pass, a health post, a community WiFi
 * mast. Communities hold this knowledge in detail and none of it is on an operator's coverage
 * map, which is exactly why the /conexion screen sits empty until it is recorded.
 *
 * Two things this layer is careful to keep true, and both are the point of §5.9:
 *
 *   1. A point is NOT judged by bandwidth. It is judged by whether it is safe, private, one can
 *      stay, it is reachable, it has power, and what it costs — and privacy weighs most where the
 *      subject is health. The health post in Beté scores `privacidad alto` (a room apart, where a
 *      maternal-health report can be made alone); the shop in Tagachí scores `privacidad bajo`
 *      (a counter with people always listening). That contrast is deliberate.
 *
 *   2. Reaching a point can itself cost travel, money and risk — an activity meant to avoid a
 *      journey can require one first — so every row carries the honest `notas` the coordinator
 *      reads before sending someone up the river.
 *
 * These are recorded SEPARATELY from supply nodes (`nodos`), never merged: one person may run
 * both a shop and an acopio, and the two rows keep that convergence visible (§5.9).
 *
 * Location is declared honestly per row (non-negotiable 2.2): the Pizarro mast the field team
 * GPS-pinned, staff-placed points at an honest radius, and the Sivirú pier known by name before
 * anyone pinned it (null location — it renders "sin ubicar", not at a guessed dot). Every
 * name and note is marked [DATO DE PRUEBA] by scripts/seed.ts before it reaches a screen.
 */
export type PuntoConexionSemilla = {
  nombre: string
  tipo: TipoPuntoConexion
  /** Community codes this point answers for. The "where can I go" many-to-many join. */
  comunidades: string[]

  // Characteristics: what it is, not how good it is.
  tieneSenal: boolean
  internetDisponible: boolean
  vendePines: boolean
  atendido: boolean

  // The six judgements (§5.9).
  seguridad: NivelConexion
  privacidad: NivelConexion
  permanencia: NivelConexion
  accesibilidad: NivelConexion
  energia: NivelConexion
  costo: CostoConexion

  /** The honest travel/cost/risk note. */
  notas: string

  // Optional location, with its declared source and radius (2.2). Omitted = known by name only.
  lat?: number
  lon?: number
  ubicacionFuente?: FuenteUbicacion
  ubicacionPrecisionM?: number
}

export const PUNTOS_CONEXION_DEMO: PuntoConexionSemilla[] = [
  {
    // Strong privacy, the health case: a room apart where a maternal-health report is made alone.
    nombre: 'Puesto de salud de Beté',
    tipo: 'puesto_salud',
    comunidades: ['BET', 'MER'],
    tieneSenal: true,
    internetDisponible: true,
    vendePines: false,
    atendido: true,
    seguridad: 'alto',
    privacidad: 'alto',
    permanencia: 'alto',
    accesibilidad: 'medio',
    energia: 'alto',
    costo: 'gratuito',
    notas:
      'La enfermera atiende de día y hay una pieza aparte para hablar sin que nadie oiga — es a donde mandamos los reportes de salud materna. Tiene planta y la señal casi nunca falta.',
    lat: 6.029,
    lon: -76.755,
    ubicacionFuente: 'manual',
    ubicacionPrecisionM: 200,
  },
  {
    // Weak privacy, the counterexample: signal is good but nothing said here stays private.
    nombre: 'Tienda La Esquina (Tagachí)',
    tipo: 'tienda',
    comunidades: ['TAG'],
    tieneSenal: true,
    internetDisponible: false,
    vendePines: true,
    atendido: true,
    seguridad: 'medio',
    privacidad: 'bajo',
    permanencia: 'bajo',
    accesibilidad: 'alto',
    energia: 'alto',
    costo: 'bajo',
    notas:
      'Siempre hay señal, pero el dueño cobra por dejar llamar y en el mostrador nunca falta gente escuchando. No sirve para algo delicado.',
    lat: 5.956,
    lon: -76.726,
    ubicacionFuente: 'manual',
    ubicacionPrecisionM: 100,
  },
  {
    // Known by name, not yet pinned (null location → "sin ubicar"). Hard to reach, no power.
    nombre: 'Muelle de Sivirú',
    tipo: 'muelle',
    comunidades: ['SIV', 'DOC'],
    tieneSenal: true,
    internetDisponible: false,
    vendePines: false,
    atendido: false,
    seguridad: 'medio',
    privacidad: 'medio',
    permanencia: 'bajo',
    accesibilidad: 'bajo',
    energia: 'bajo',
    costo: 'gratuito',
    notas:
      'Solo entra señal parado en la punta del muelle y cuando sube la marea. Llegar son casi dos horas en lancha y no hay dónde cargar el teléfono.',
  },
  {
    // Connectivity commerce is acceptable (§5.9): a solar mast that sells data. GPS-pinned by
    // the field team, like the Pizarro pier — an honest zero-radius point.
    nombre: 'Antena comunitaria de Pizarro',
    tipo: 'antena',
    comunidades: ['PIZ', 'SIV'],
    tieneSenal: true,
    internetDisponible: true,
    vendePines: true,
    atendido: false,
    seguridad: 'medio',
    privacidad: 'medio',
    permanencia: 'medio',
    accesibilidad: 'medio',
    energia: 'medio',
    costo: 'bajo',
    notas:
      'Antena solar que puso la junta; con aguacero fuerte se cae y toca esperar a que escampe. Venden pines en la tienda de al lado.',
    lat: 4.955,
    lon: -77.365,
    ubicacionFuente: 'gps',
    ubicacionPrecisionM: 0,
  },
  {
    // Free but public: safe and powered, no privacy, and a half-day walk for those who rely on it.
    nombre: 'Punto WiFi del parque (Quibdó)',
    tipo: 'punto_wifi',
    comunidades: ['QBD', 'SAM'],
    tieneSenal: true,
    internetDisponible: true,
    vendePines: false,
    atendido: false,
    seguridad: 'alto',
    privacidad: 'bajo',
    permanencia: 'medio',
    accesibilidad: 'alto',
    energia: 'alto',
    costo: 'gratuito',
    notas:
      'WiFi gratis de la alcaldía en el parque. Funciona bien, pero es plena plaza y llena de gente; para bajar desde Samurindó es medio día de camino.',
    lat: 5.695,
    lon: -76.661,
    ubicacionFuente: 'manual',
    ubicacionPrecisionM: 50,
  },
]
