import { describe, expect, it } from 'vitest'
import {
  claveAcuerdoDatos,
  claveRolesConfirmados,
  resumenConfiguracion,
  type DatosConfiguracion,
} from '@/lib/onboarding'

/**
 * PRD-36 — the Configurar checklist reasoning, tested without a database.
 *
 * `resumenConfiguracion` is a pure function of plain numbers, so the whole surface — the five
 * stages, the stage-1 reachability rule, when it counts as complete, and above all that every
 * unfinished step states a *consequence* rather than «pendiente» — is asserted here directly.
 */

const NADA: DatosConfiguracion = {
  organizacionAprobada: false,
  acuerdoDatosEn: null,
  rolesConfirmadosEn: null,
  comunidades: 0,
  reportes: 0,
  numeroEntrada: false,
  catalogoItems: 0,
  centrosTotal: 0,
  centrosSinUbicacion: 0,
  comunidadesSinRuta: 0,
  existencias: 0,
  apadrinamientosActivos: 0,
  puntosConexion: 0,
}

/** Communities + a number, and nothing else — the fresh-disaster deployment of §29b.2. */
const ETAPA_1: DatosConfiguracion = {
  ...NADA,
  organizacionAprobada: true,
  acuerdoDatosEn: '2026-08-01T00:00:00.000Z',
  rolesConfirmadosEn: '2026-08-01T00:00:00.000Z',
  comunidades: 6,
  reportes: 3,
  numeroEntrada: true,
  comunidadesSinRuta: 6,
}

/** Everything through stage 2 configured. */
const NUCLEO_LISTO: DatosConfiguracion = {
  ...ETAPA_1,
  catalogoItems: 40,
  centrosTotal: 2,
  centrosSinUbicacion: 0,
  comunidadesSinRuta: 0,
  existencias: 12,
}

describe('resumenConfiguracion — cinco fases en orden', () => {
  it('presenta las cinco etapas, numeradas 0 a 4', () => {
    const r = resumenConfiguracion(NADA)
    expect(r.etapas.map((e) => e.numero)).toEqual([0, 1, 2, 3, 4])
    expect(r.etapas.map((e) => e.clave)).toEqual([
      'entrada_manual',
      'alcance',
      'emparejamiento',
      'recuperacion',
      'ordinario',
    ])
  })

  it('cada etapa dice qué desbloquea', () => {
    const r = resumenConfiguracion(NADA)
    for (const e of r.etapas) expect(e.desbloquea.length).toBeGreaterThan(0)
  })
})

describe('cada paso pendiente dice qué deja sin funcionar, no «pendiente» (§29b.3)', () => {
  it('ningún consecuencia es un simple «pendiente»', () => {
    const r = resumenConfiguracion(NADA)
    const pendientes = r.etapas.flatMap((e) => e.pasos).filter((p) => p.estado === 'pendiente')
    expect(pendientes.length).toBeGreaterThan(0)
    for (const p of pendientes) {
      expect(p.consecuencia.trim().length).toBeGreaterThan(20)
      expect(p.consecuencia.toLowerCase()).not.toBe('pendiente')
    }
  })

  it('los tramos nombran cuántas comunidades quedan «incomunicadas»', () => {
    const r = resumenConfiguracion({ ...ETAPA_1, comunidadesSinRuta: 6 })
    const rutas = r.etapas[2]!.pasos.find((p) => p.clave === 'rutas')!
    expect(rutas.estado).toBe('pendiente')
    expect(rutas.consecuencia).toContain('6')
    expect(rutas.consecuencia).toContain('incomunicadas')
  })

  it('un centro sin ubicación nombra a Recogidas', () => {
    const r = resumenConfiguracion({ ...NUCLEO_LISTO, centrosTotal: 3, centrosSinUbicacion: 1 })
    const centros = r.etapas[2]!.pasos.find((p) => p.clave === 'centros_ubicados')!
    expect(centros.estado).toBe('pendiente')
    expect(centros.consecuencia).toContain('1 centro de acopio no tiene')
    expect(centros.consecuencia).toContain('Recogidas')
  })

  it('sin ningún centro, lo dice sin inventar un número', () => {
    const r = resumenConfiguracion({ ...NUCLEO_LISTO, centrosTotal: 0, centrosSinUbicacion: 0 })
    const centros = r.etapas[2]!.pasos.find((p) => p.clave === 'centros_ubicados')!
    expect(centros.consecuencia).toContain('No hay centros de acopio')
  })
})

describe('el despliegue es útil en la etapa 1 (comunidades + un número), AC#2', () => {
  it('con comunidades y número, la etapa 1 está alcanzada aunque falte todo lo demás', () => {
    const r = resumenConfiguracion(ETAPA_1)
    expect(r.etapa1Alcanzada).toBe(true)
    expect(r.operarDisponible).toBe(true)
    expect(r.etapas[1]!.completa).toBe(true)
    // Pero el emparejamiento (etapa 2) todavía no está listo.
    expect(r.etapas[2]!.completa).toBe(false)
  })

  it('sin número, la etapa 1 no está alcanzada', () => {
    const r = resumenConfiguracion({ ...ETAPA_1, numeroEntrada: false })
    expect(r.etapa1Alcanzada).toBe(false)
  })

  it('sin comunidades, Operar no está disponible', () => {
    const r = resumenConfiguracion(NADA)
    expect(r.operarDisponible).toBe(false)
  })
})

describe('completa colapsa la configuración (AC#1)', () => {
  it('sin nada, no está completa', () => {
    expect(resumenConfiguracion(NADA).completa).toBe(false)
  })

  it('con el núcleo (fases 0–2) listo, está completa aunque falten fases 3–4', () => {
    const r = resumenConfiguracion(NUCLEO_LISTO)
    expect(r.completa).toBe(true)
    expect(r.pendientes).toBe(0)
    // Las fases 3–4 no bloquean: son opcionales o aún no disponibles.
    expect(r.etapas[3]!.pasos.some((p) => p.estado === 'no_disponible')).toBe(true)
    expect(r.etapas[4]!.pasos.some((p) => p.estado === 'no_disponible')).toBe(true)
  })
})

describe('los dos reconocimientos se derivan de su fecha', () => {
  it('acuerdo de datos: pendiente sin fecha, hecho con fecha', () => {
    const sin = resumenConfiguracion(NADA).etapas[0]!.pasos.find((p) => p.clave === 'acuerdo_datos')!
    expect(sin.estado).toBe('pendiente')
    expect(sin.accion).toBe('acuerdo')
    const con = resumenConfiguracion({ ...NADA, acuerdoDatosEn: '2026-08-01T00:00:00.000Z' }).etapas[0]!.pasos.find(
      (p) => p.clave === 'acuerdo_datos',
    )!
    expect(con.estado).toBe('hecho')
  })

  it('roles: pendiente sin fecha, hecho con fecha', () => {
    const sin = resumenConfiguracion(NADA).etapas[0]!.pasos.find((p) => p.clave === 'roles')!
    expect(sin.estado).toBe('pendiente')
    expect(sin.accion).toBe('roles')
    const con = resumenConfiguracion({ ...NADA, rolesConfirmadosEn: '2026-08-01T00:00:00.000Z' }).etapas[0]!.pasos.find(
      (p) => p.clave === 'roles',
    )!
    expect(con.estado).toBe('hecho')
  })
})

describe('las claves de reconocimiento están namespaced por organización', () => {
  it('cada organización tiene su propia clave', () => {
    expect(claveAcuerdoDatos('org-a')).toBe('onboarding:acuerdo_datos:org-a')
    expect(claveRolesConfirmados('org-b')).toBe('onboarding:roles_confirmados:org-b')
    expect(claveAcuerdoDatos('org-a')).not.toBe(claveAcuerdoDatos('org-b'))
  })
})
