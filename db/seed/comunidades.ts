/**
 * Thirteen communities in and around the Quibdó reach of the Atrato.
 *
 * ⚠ These coordinates are APPROXIMATE. They are populated place centroids taken from public
 * gazetteer data, not surveyed points and not GPS pins — which is exactly why every row
 * carries `ubicacion_fuente = 'centroide'` and a 1000 m radius (non-negotiable 2.2). The
 * map must draw these as dashed circles, never as dots, until the field team replaces them
 * with pins. Nothing in this file may be silently upgraded to `gps`.
 *
 * `familias_estimadas` are planning figures for the demo basin, not census data.
 */

export type ComunidadSemilla = {
  codigo: string
  nombre: string
  tipo: 'cabecera' | 'corregimiento' | 'vereda' | 'resguardo' | 'consejo_comunitario'
  municipio: string
  agrupador: string
  lat: number
  lon: number
  familiasEstimadas: number
  /** 1 data reliable · 2 intermittent · 3 voice/SMS only · 4 radio relay only. */
  tierConectividad: number
  intervaloChequeoDias: number
  /**
   * Where this coordinate came from. Omitted means `centroide` at 1000 m — a gazetteer
   * centroid, which is what every row of the canonical basin below is. The demo basin sets
   * it explicitly so the map has one of each: a `gps` pin the field team dropped, a
   * `referida` circle relayed over radio, and centroids for the rest. Non-negotiable 2.2:
   * the source is declared honestly and the precision matches it — never a pin over a guess.
   */
  ubicacionFuente?: 'gps' | 'centroide' | 'referida' | 'manual'
  ubicacionPrecisionM?: number
}

export const COMUNIDADES_SEMILLA: ComunidadSemilla[] = [
  {
    codigo: 'QBD',
    nombre: 'Quibdó',
    tipo: 'cabecera',
    municipio: 'Quibdó',
    agrupador: 'Casco urbano',
    lat: 5.6947,
    lon: -76.6611,
    familiasEstimadas: 24000,
    tierConectividad: 1,
    intervaloChequeoDias: 30,
  },

  // Vía Quibdó–Medellín and the road south. Reachable by vehicle year-round.
  {
    codigo: 'TUT',
    nombre: 'Tutunendo',
    tipo: 'corregimiento',
    municipio: 'Quibdó',
    agrupador: 'Vía Medellín',
    lat: 5.7683,
    lon: -76.5406,
    familiasEstimadas: 180,
    tierConectividad: 2,
    intervaloChequeoDias: 14,
  },
  {
    codigo: 'PAC',
    nombre: 'Pacurita',
    tipo: 'corregimiento',
    municipio: 'Quibdó',
    agrupador: 'Vía Medellín',
    lat: 5.6444,
    lon: -76.6089,
    familiasEstimadas: 95,
    tierConectividad: 2,
    intervaloChequeoDias: 14,
  },
  {
    codigo: 'GUY',
    nombre: 'Guayabal',
    tipo: 'corregimiento',
    municipio: 'Quibdó',
    agrupador: 'Vía Yuto',
    lat: 5.6206,
    lon: -76.6408,
    familiasEstimadas: 120,
    tierConectividad: 2,
    intervaloChequeoDias: 14,
  },
  {
    codigo: 'YUT',
    nombre: 'Yuto',
    tipo: 'cabecera',
    municipio: 'Atrato',
    agrupador: 'Vía Yuto',
    lat: 5.5694,
    lon: -76.6022,
    familiasEstimadas: 340,
    tierConectividad: 1,
    intervaloChequeoDias: 21,
  },
  {
    codigo: 'SFI',
    nombre: 'San Francisco de Ichó',
    tipo: 'corregimiento',
    municipio: 'Quibdó',
    agrupador: 'Río Ichó',
    lat: 5.6019,
    lon: -76.5372,
    familiasEstimadas: 70,
    tierConectividad: 3,
    intervaloChequeoDias: 10,
  },

  // Down the Atrato from Quibdó. Boat only — see db/seed/rutas.ts.
  {
    codigo: 'BTA',
    nombre: 'Boca de Tanandó',
    tipo: 'corregimiento',
    municipio: 'Quibdó',
    agrupador: 'Atrato medio',
    lat: 5.7594,
    lon: -76.7106,
    familiasEstimadas: 85,
    tierConectividad: 3,
    intervaloChequeoDias: 10,
  },
  {
    codigo: 'TAG',
    nombre: 'Tagachí',
    tipo: 'corregimiento',
    municipio: 'Quibdó',
    agrupador: 'Atrato medio',
    lat: 5.9564,
    lon: -76.7264,
    familiasEstimadas: 140,
    tierConectividad: 3,
    intervaloChequeoDias: 7,
  },
  {
    codigo: 'MER',
    nombre: 'Las Mercedes',
    tipo: 'corregimiento',
    municipio: 'Quibdó',
    agrupador: 'Atrato medio',
    lat: 5.8619,
    lon: -76.7247,
    familiasEstimadas: 75,
    tierConectividad: 3,
    intervaloChequeoDias: 10,
  },
  {
    codigo: 'WIN',
    nombre: 'Winandó',
    tipo: 'corregimiento',
    municipio: 'Quibdó',
    agrupador: 'Atrato medio',
    lat: 5.8825,
    lon: -76.7392,
    familiasEstimadas: 60,
    tierConectividad: 4,
    intervaloChequeoDias: 7,
  },
  {
    codigo: 'BET',
    nombre: 'Beté',
    tipo: 'cabecera',
    municipio: 'Medio Atrato',
    agrupador: 'Atrato bajo',
    lat: 6.0286,
    lon: -76.755,
    familiasEstimadas: 210,
    tierConectividad: 3,
    intervaloChequeoDias: 7,
  },
  {
    codigo: 'BLL',
    nombre: 'Bellavista',
    tipo: 'cabecera',
    municipio: 'Bojayá',
    agrupador: 'Atrato bajo',
    lat: 6.5561,
    lon: -76.8917,
    familiasEstimadas: 430,
    tierConectividad: 2,
    intervaloChequeoDias: 7,
  },

  // Up the Quito, a different river system reached from the same warehouse.
  {
    codigo: 'PAI',
    nombre: 'Paimadó',
    tipo: 'cabecera',
    municipio: 'Río Quito',
    agrupador: 'Río Quito',
    lat: 5.5147,
    lon: -76.7444,
    familiasEstimadas: 260,
    tierConectividad: 2,
    intervaloChequeoDias: 14,
  },
]

/** Rough bounding box of the Chocó basin, used by the seed validation tests. */
export const BBOX_CHOCO = { minLat: 4.0, maxLat: 8.7, minLon: -77.9, maxLon: -75.8 }

/**
 * Demo-only communities, layered on top of the canonical basin for the staging walkthrough.
 *
 * ⚠ STAGING ONLY. These exist so every panel screen has something true-to-life to show and
 * so the matcher produces its full spread of states — a coast the warehouse cannot reach
 * (SIN_RUTA), a community whose own acopio is short (SIN_EXISTENCIA), one that has gone quiet
 * (silence alert), and places on the map we have never heard a word from. They are kept out
 * of COMUNIDADES_SEMILLA on purpose: that array is the fixture the matcher and map unit tests
 * pin, and it stays exactly thirteen centroids.
 *
 * Coordinates are approximate places on the Pacific littoral (Bajo Baudó) and the Atrato /
 * Río Quito, all inside BBOX_CHOCO. The source is set honestly per row — no pin over a guess.
 */
export const COMUNIDADES_DEMO: ComunidadSemilla[] = [
  // ── Litoral del Bajo Baudó ──────────────────────────────────────────────────────────
  // Off the Atrato graph entirely: no river connects the warehouse in Quibdó to the coast,
  // which is exactly what makes a request here classify as SIN_RUTA.
  {
    codigo: 'PIZ',
    nombre: 'Pizarro',
    tipo: 'cabecera',
    municipio: 'Bajo Baudó',
    agrupador: 'Litoral del Baudó',
    lat: 4.9553,
    lon: -77.3653,
    familiasEstimadas: 380,
    tierConectividad: 2,
    intervaloChequeoDias: 14,
    // The field team stood on the pier and dropped a pin, so this one is a real point.
    ubicacionFuente: 'gps',
    ubicacionPrecisionM: 0,
  },
  {
    codigo: 'SIV',
    nombre: 'Sivirú',
    tipo: 'corregimiento',
    municipio: 'Bajo Baudó',
    agrupador: 'Litoral del Baudó',
    lat: 4.8992,
    lon: -77.3808,
    familiasEstimadas: 55,
    tierConectividad: 3,
    intervaloChequeoDias: 10,
    // A gazetteer centroid, like the canonical basin.
    ubicacionFuente: 'centroide',
    ubicacionPrecisionM: 1000,
  },
  {
    codigo: 'DOC',
    nombre: 'Docampadó',
    tipo: 'corregimiento',
    municipio: 'Bajo Baudó',
    agrupador: 'Litoral del Baudó',
    lat: 4.7789,
    lon: -77.3164,
    familiasEstimadas: 40,
    tierConectividad: 4,
    intervaloChequeoDias: 7,
    // We have never surveyed Docampadó; its location reached us over the radio net, so it is
    // a wide `referida` circle — approximate on purpose (2.2).
    ubicacionFuente: 'referida',
    ubicacionPrecisionM: 2000,
  },

  // ── Río Quito: a community that has gone quiet ──────────────────────────────────────
  // Sent one message eleven days ago and nothing since; its check-in interval is seven days,
  // so it accrues silence on the Estado screen. Radio-relay tier, where silence says more
  // about the signal than about the situation (Section 9.8).
  {
    codigo: 'BEB',
    nombre: 'Bebedó',
    tipo: 'corregimiento',
    municipio: 'Río Quito',
    agrupador: 'Río Quito',
    lat: 5.3494,
    lon: -76.8203,
    familiasEstimadas: 90,
    tierConectividad: 4,
    intervaloChequeoDias: 7,
    ubicacionFuente: 'centroide',
    ubicacionPrecisionM: 1000,
  },

  // ── On the map, never heard from ────────────────────────────────────────────────────
  // In the registry with coordinates but no message ever received (PRD §5.7). They render on
  // the map and count as «nunca vistas» — a to-do list, not an alarm — rather than silence.
  {
    codigo: 'SAM',
    nombre: 'Samurindó',
    tipo: 'corregimiento',
    municipio: 'Atrato',
    agrupador: 'Vía Yuto',
    lat: 5.6231,
    lon: -76.6822,
    familiasEstimadas: 65,
    tierConectividad: 3,
    intervaloChequeoDias: 10,
    ubicacionFuente: 'centroide',
    ubicacionPrecisionM: 1000,
  },
  {
    codigo: 'PCO',
    nombre: 'Puerto Conto',
    tipo: 'corregimiento',
    municipio: 'Bojayá',
    agrupador: 'Atrato bajo',
    lat: 6.5972,
    lon: -76.9061,
    familiasEstimadas: 110,
    tierConectividad: 4,
    intervaloChequeoDias: 7,
    // Relayed coordinates again: nobody from Convite has been to Puerto Conto.
    ubicacionFuente: 'referida',
    ubicacionPrecisionM: 2000,
  },
]

/**
 * PRD-39 — every demo short code, mapped to its real registry code in db/seed/territorio.sql.
 *
 * Staging used to carry TWO community sets: the real registry (`sembrar:territorio`, long codes
 * like `CH-QUI-TAG`) AND a parallel demo set (`db:seed`, short codes like `TAG`), so the same
 * real place appeared twice (two Quibdós, two Bellavistas…). That is fixed by pointing ALL demo
 * activity at the registry through this map, instead of minting a second row per place.
 *
 * The arrays above are unchanged on purpose: they stay the in-memory basin the matcher and map
 * *unit* tests pin (tests/semilla.test.ts, tests/mapa.test.ts, tests/emparejador.test.ts, the
 * cuenca fixture), which treat these codes as opaque graph ids and never touch the database. This
 * map is the ONLY place the two languages meet, and scripts/seed.ts is the only consumer: it
 * resolves each short code to the registry community's id so the whole demo layers onto one set.
 *
 * The last five (Sivirú, Docampadó, Bebedó, Samurindó, Puerto Conto) had no cabecera-level
 * registry equivalent, so they were added to territorio.sql as proper registry corregimientos
 * (verificado_en = NULL, like everything seeded) rather than kept as parallel demo rows.
 */
export const CODIGO_DEMO_A_REGISTRO: Record<string, string> = {
  QBD: 'CH-QUI', // Quibdó
  TUT: 'CH-QUI-TUT', // Tutunendo
  PAC: 'CH-QUI-PAC', // Pacurita
  GUY: 'CH-QUI-GUA', // Guayabal
  YUT: 'CH-ATR', // Yuto (cabecera de Atrato)
  SFI: 'CH-QUI-ICH', // San Francisco de Ichó
  BTA: 'CH-QUI-TAN', // Boca de Tanandó
  TAG: 'CH-QUI-TAG', // Tagachí
  MER: 'CH-QUI-MER', // Las Mercedes
  WIN: 'CH-QUI-WIN', // Winandó
  BET: 'CH-MAT', // Beté (cabecera de Medio Atrato)
  BLL: 'CH-BOJ', // Bellavista (cabecera de Bojayá)
  PAI: 'CH-RQU', // Paimadó (cabecera de Río Quito)
  PIZ: 'CH-BBA', // Pizarro (cabecera de Bajo Baudó)
  SIV: 'CH-BBA-SIV', // Sivirú — añadida al registro (PRD-39)
  DOC: 'CH-BBA-DOC', // Docampadó — añadida al registro (PRD-39)
  BEB: 'CH-RQU-BEB', // Bebedó — añadida al registro (PRD-39)
  SAM: 'CH-ATR-SAM', // Samurindó — añadida al registro (PRD-39)
  PCO: 'CH-BOJ-PCO', // Puerto Conto — añadida al registro (PRD-39)
}
