import type { PoolClient } from 'pg'
import type { FamiliaAyuda } from '@/db/schema/vocabulario'

/**
 * The aggregate coordination read layer (PRD-35, §29.3b).
 *
 * «Coordination value at zero privacy cost.» Every tier — down to observadora — reads this: the
 * same picture `/respuesta` publishes, extended and authenticated. Which communities already have
 * someone working in them, which do not (so nobody sends three convoys to Bellavista while nobody
 * goes to Winandó), municipality-level demand, and which route legs are reported closed.
 *
 * It reads only aggregate and shared-registry facts, through the SECURITY DEFINER functions in
 * migration 0052 — never another organisation's community-level operational detail, which §29.3b
 * says is negotiated bilaterally and is never default. The functions cross organisations; this
 * module only shapes their output for the page.
 *
 * FR-45: `panoramaCoordinacion` takes an optional coarse aid family (alimentos/medicinas/
 * construcción) and narrows the demand counts (pendientes/atendidos) to it — migration 0060's
 * `convite_coordinacion_demanda(text)`. Coverage and closed-leg facts are not goods-shaped, so
 * they stay basin-wide regardless of the filter.
 */

export type MunicipioCoordinacion = {
  municipio: string
  comunidadesTotal: number
  comunidadesCubiertas: number
  comunidadesSinCubrir: number
  pendientes: number
  atendidos: number
  /** The uncovered communities in this municipality — the actionable gaps. */
  sinCubrir: string[]
}

export type TramoCerrado = {
  origen: string
  destino: string
  modo: string
  desactivadaEn: Date | null
  notas: string | null
}

export type Coordinacion = {
  municipios: MunicipioCoordinacion[]
  totalComunidades: number
  totalCubiertas: number
  totalSinCubrir: number
  totalPendientes: number
  totalAtendidos: number
  tramosCerrados: TramoCerrado[]
}

/**
 * The whole coordination picture, assembled from the three aggregate functions.
 *
 * `familiaAyuda` narrows the demand counts to one of the three FR-45 families; `null` (the
 * default) reads every family, same as before the filter existed.
 */
export async function panoramaCoordinacion(
  client: PoolClient,
  familiaAyuda: FamiliaAyuda | null = null,
): Promise<Coordinacion> {
  const [cobertura, demanda, cerrados] = await Promise.all([
    client.query<{ municipio: string; comunidad: string; cubierta: boolean }>(
      `select municipio, comunidad, cubierta from convite_coordinacion_comunidades()`,
    ),
    client.query<{ municipio: string; pendientes: string; atendidos: string }>(
      `select municipio, pendientes, atendidos from convite_coordinacion_demanda($1)`,
      [familiaAyuda],
    ),
    client.query<{
      origen: string
      destino: string
      modo: string
      desactivada_en: Date | null
      notas: string | null
    }>(`select origen, destino, modo, desactivada_en, notas from convite_coordinacion_tramos_cerrados()`),
  ])

  const porMunicipio = new Map<string, MunicipioCoordinacion>()
  const obtener = (municipio: string): MunicipioCoordinacion => {
    let m = porMunicipio.get(municipio)
    if (!m) {
      m = {
        municipio,
        comunidadesTotal: 0,
        comunidadesCubiertas: 0,
        comunidadesSinCubrir: 0,
        pendientes: 0,
        atendidos: 0,
        sinCubrir: [],
      }
      porMunicipio.set(municipio, m)
    }
    return m
  }

  for (const c of cobertura.rows) {
    const m = obtener(c.municipio)
    m.comunidadesTotal += 1
    if (c.cubierta) {
      m.comunidadesCubiertas += 1
    } else {
      m.comunidadesSinCubrir += 1
      m.sinCubrir.push(c.comunidad)
    }
  }

  for (const d of demanda.rows) {
    const m = obtener(d.municipio)
    m.pendientes = Number(d.pendientes)
    m.atendidos = Number(d.atendidos)
  }

  const municipios = [...porMunicipio.values()].sort((a, b) => a.municipio.localeCompare(b.municipio))

  return {
    municipios,
    totalComunidades: municipios.reduce((n, m) => n + m.comunidadesTotal, 0),
    totalCubiertas: municipios.reduce((n, m) => n + m.comunidadesCubiertas, 0),
    totalSinCubrir: municipios.reduce((n, m) => n + m.comunidadesSinCubrir, 0),
    totalPendientes: municipios.reduce((n, m) => n + m.pendientes, 0),
    totalAtendidos: municipios.reduce((n, m) => n + m.atendidos, 0),
    tramosCerrados: cerrados.rows.map((r) => ({
      origen: r.origen,
      destino: r.destino,
      modo: r.modo,
      desactivadaEn: r.desactivada_en,
      notas: r.notas,
    })),
  }
}
