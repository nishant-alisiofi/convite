import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { NavSecciones } from '@/app/(panel)/nav-secciones'
import { seccionesVisibles } from '@/app/(panel)/secciones'
import type { SesionStaff } from '@/lib/sesion'

/**
 * The seven-section nav — its role gate and its nested shape (PRD-28).
 *
 * Two things are worth pinning here and neither needs a database. The role gate
 * (`seccionesVisibles`) is pure config, so a coordinator seeing all seven while a verificador
 * sees only what they can act on is a plain assertion — this is the part that must never regress
 * when the presentation changes. And the presentation itself: the refinement nests the sub-items,
 * so the markup has to be disclosures (`<details>`/`<summary>`), the «en construcción» items must
 * stay greyed non-links, every live link must remain a link, and the current section must open
 * and mark itself. `usePathname` is the only thing mocked — everything else is the real component.
 */
vi.mock('next/navigation', () => ({ usePathname: () => '/tablero' }))

function sesion(rolStaff: string, extra: Partial<SesionStaff> = {}): SesionStaff {
  return {
    authId: '00000000-0000-4000-8000-000000000001',
    correo: `${rolStaff}@convite.test`,
    telefono: null,
    rolStaff,
    organizacionId: 'org',
    esPlataforma: false,
    estadoOrganizacion: 'aprobada',
    nivelAdmision: 'ancla',
    organizacionDeclarada: true,
    ...extra,
  }
}

const etiquetas = (rolStaff: string, extra?: Partial<SesionStaff>) =>
  seccionesVisibles(sesion(rolStaff, extra)).map((s) => s.etiqueta)

describe('seccionesVisibles — el candado por rol (§18)', () => {
  it('un coordinador ve las siete secciones', () => {
    expect(etiquetas('coordinador')).toEqual([
      'Bandeja',
      'Mapa',
      'Comunidades',
      'Agenda',
      'Existencias',
      'Informes',
      'Ajustes',
    ])
  })

  it('un verificador solo ve lo que puede atender: Bandeja y Comunidades', () => {
    expect(etiquetas('verificador')).toEqual(['Bandeja', 'Comunidades'])
  })

  it('lectura ve solo Mapa e Informes', () => {
    expect(etiquetas('lectura')).toEqual(['Mapa', 'Informes'])
  })

  it('el candado por ítem también corre: Equipo y Organizaciones no son del coordinador', () => {
    const ajustes = seccionesVisibles(sesion('coordinador')).find((s) => s.clave === 'ajustes')!
    const items = ajustes.items.map((it) => it.etiqueta)
    expect(items).toContain('Estado')
    expect(items).not.toContain('Equipo')
    expect(items).not.toContain('Organizaciones')
  })

  it('la plataforma sí ve Organizaciones y Equipo bajo Ajustes', () => {
    const ajustes = seccionesVisibles(sesion('admin', { esPlataforma: true })).find(
      (s) => s.clave === 'ajustes',
    )!
    const items = ajustes.items.map((it) => it.etiqueta)
    expect(items).toContain('Organizaciones')
    expect(items).toContain('Equipo')
  })

  it('una sección sin ítems visibles no se dibuja, pero una con «en construcción» sí', () => {
    // Informes for `lectura`: its only built item (Apadrinamientos) is gated away, yet the section
    // still shows because its «en construcción» placeholders keep it non-empty.
    const informes = seccionesVisibles(sesion('lectura')).find((s) => s.clave === 'informes')
    expect(informes).toBeDefined()
    expect(informes!.items.every((it) => !it.listo)).toBe(true)
  })
})

describe('NavSecciones — el shell anidado (PRD-28)', () => {
  const marcado = renderToStaticMarkup(
    <NavSecciones secciones={seccionesVisibles(sesion('coordinador'))} />,
  )

  it('cada sección es un disclosure, no una lista plana', () => {
    // Seven sections ⇒ seven <details>/<summary>, i.e. nested and revealed on interaction.
    expect((marcado.match(/<details/g) ?? []).length).toBe(7)
    expect((marcado.match(/<summary/g) ?? []).length).toBe(7)
  })

  it('los siete rótulos están en la barra', () => {
    for (const rotulo of ['Bandeja', 'Mapa', 'Comunidades', 'Agenda', 'Existencias', 'Informes', 'Ajustes']) {
      expect(marcado).toContain(rotulo)
    }
  })

  it('los ítems «en construcción» siguen grises y no son enlaces', () => {
    // «Citas» has no route: it must render as a greyed span, never inside an <a>.
    expect(marcado).toContain('En construcción')
    expect(marcado).toContain('text-barro-400')
    expect(marcado).not.toMatch(/<a[^>]*>\s*Citas\s*<\/a>/)
  })

  it('todo enlace vivo sigue siendo un enlace', () => {
    expect(marcado).toContain('href="/tablero"')
    expect(marcado).toContain('href="/rutas"')
  })

  it('las secciones con página propia siguen alcanzables (Mapa → /mapa, Ajustes → /ajustes)', () => {
    expect(marcado).toContain('href="/mapa"')
    expect(marcado).toContain('href="/ajustes"')
  })

  it('la sección de la ruta actual queda abierta y marcada, y solo esa', () => {
    // Only the section holding /tablero (Bandeja) is expanded; the other six are closed.
    expect((marcado.match(/aria-expanded="true"/g) ?? []).length).toBe(1)
    expect((marcado.match(/aria-expanded="false"/g) ?? []).length).toBe(6)
    // And the exact page is flagged for a screen reader.
    expect(marcado).toContain('aria-current="page"')
  })
})
