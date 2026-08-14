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
