import type { PayloadSimulado } from '@/lib/canales'

/**
 * Inbound messages for the simulator driver, written the way people in the basin actually
 * write — not the way a coded-syntax card wishes they would (2.11).
 *
 * These are invented, and that is the limit of what they prove. They exercise the *shape* of
 * the port: three payloads, three sets of fields present, one duplicate id. They are not a
 * corpus, and M4 must not be built on them — see PRD §7, which is explicit that the
 * normalizer cannot be validated on examples we made up, because Chocoano vocabulary is
 * exactly where a generic classifier fails.
 *
 * Phone numbers are the seed's synthetic contacts, so a later milestone that resolves a
 * contact by number finds a real row.
 */

/**
 * Rosa Palacios in Tagachí, after the river came up. Free text, no location, no media.
 *
 * «mercado» here is a food parcel, not a marketplace — the exact term PRD §4 M4 lists as one
 * a generic classifier gets wrong. No `tipo` is declared: reading a need out of this is the
 * normalizer's job, not the driver's.
 */
export const TEXTO_LIBRE: PayloadSimulado = {
  id: 'sim-tag-0001',
  de: '+573000000001',
  canal: 'whatsapp',
  recibidoEn: '2026-08-13T14:02:11-05:00',
  comunidad: 'TAG',
  texto:
    'Buenas tardes, aquí en Tagachí la creciente nos entró a las casas anoche. ' +
    'Se mojó todo y quedamos como 12 familias sin nada que cocinar. ' +
    'Manden mercados por favor, y si se puede toldillos que los pelaos están picados.',
}

/**
 * Marta Perea in Bellavista, who sent a voice note and nothing else.
 *
 * The common case wherever writing on a phone is harder than talking to it, and the reason
 * the audio inbox (M7) exists. `texto` is null on purpose: the transcript arrives later
 * through the pipeline and never overwrites `texto_original` (PRD §4 M4).
 *
 * `ref` is the provider's media id, which expires in minutes — M5 downloads it and takes our
 * own copy under a `storage_key` (2.6). Nothing here is stored yet.
 */
export const NOTA_DE_VOZ: PayloadSimulado = {
  id: 'sim-bll-0002',
  de: '+573000000003',
  canal: 'whatsapp',
  recibidoEn: '2026-08-13T15:40:03-05:00',
  comunidad: 'BLL',
  media: [{ tipo: 'audio', ref: 'media-id-8f21c4', mime: 'audio/ogg', duracionSeg: 34 }],
}

/**
 * Carmen Rentería in Pacurita, dropping a pin so somebody can find the acopio.
 *
 * `fuente: 'gps'` with radius 0 — a WhatsApp pin is the one location we do not have to
 * approximate. Every seeded community is a `centroide` at 1000 m, so this is the rare case
 * the map may draw as a dot rather than a dashed circle (PRD §4 M8).
 */
export const UBICACION_FIJADA: PayloadSimulado = {
  id: 'sim-pac-0003',
  de: '+573000000008',
  canal: 'whatsapp',
  recibidoEn: '2026-08-13T16:12:47-05:00',
  comunidad: 'PAC',
  texto: 'Aquí es donde estamos guardando lo que ha llegado.',
  ubicacion: { lat: 5.6444, lon: -76.6089, fuente: 'gps', precisionM: 0 },
}

export const ENTRANTES = [TEXTO_LIBRE, NOTA_DE_VOZ, UBICACION_FIJADA]
