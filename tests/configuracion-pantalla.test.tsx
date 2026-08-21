import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DatosConfiguracion } from '@/lib/onboarding'

/**
 * PRD-36 — the Configurar screen actually renders, without a database.
 *
 * The screen is an async server component: it asks the session who is signed in, then reads the
 * setup facts inside `conSesion`. Here the session and the *fact-gathering* are mocked — a fixture
 * of a half-configured basin — while the real page, the real `resumenConfiguracion`, and the real
 * JSX render to static markup. So this proves the surface a coordinator sees: the three contexts,
 * every consequence sentence, the role model written as sentences, and the not-yet-built steps —
 * with no Postgres in the loop.
 */

// A basin part-way through setup: communities and reports entered by hand, but no number yet, an
// empty catalogue, a centre missing its location, six communities with no route, nothing counted,
// and neither acknowledgement made.
const FIXTURE: DatosConfiguracion = {
  organizacionAprobada: true,
  acuerdoDatosEn: null,
  rolesConfirmadosEn: null,
  comunidades: 6,
  reportes: 4,
  numeroEntrada: false,
  catalogoItems: 0,
  centrosTotal: 2,
  centrosSinUbicacion: 1,
  comunidadesSinRuta: 6,
  existencias: 0,
  apadrinamientosActivos: 0,
  puntosConexion: 0,
}

vi.mock('@/lib/sesion', () => ({
  sesionActual: async () => ({
    authId: '00000000-0000-4000-8000-000000000004',
    correo: 'admin@alisio.test',
    telefono: null,
    rolStaff: 'admin',
    organizacionId: '00000000-0000-4000-8000-0000000000aa',
    esPlataforma: false,
    estadoOrganizacion: 'aprobada',
    nivelAdmision: 'ancla',
    organizacionDeclarada: true,
  }),
  // Runs the page's callback with a throwaway client; the IO it would call is mocked below.
  conSesion: async <T,>(_s: unknown, fn: (c: unknown) => Promise<T>): Promise<T> => fn({}),
}))

vi.mock('@/lib/onboarding', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/onboarding')>()
  return { ...real, reunirDatosConfiguracion: async () => FIXTURE }
})

async function pintar(): Promise<string> {
  const { default: Pagina } = await import('@/app/(panel)/configuracion-inicial/page')
  const elemento = await (Pagina as (p: unknown) => Promise<React.ReactElement>)({
    searchParams: Promise.resolve({}),
  })
  return renderToStaticMarkup(elemento)
}

describe('la pantalla de configuración inicial se dibuja', () => {
  it('muestra los tres contextos, no un menú (§29b.1)', async () => {
    const html = await pintar()
    expect(html).toContain('Configuración inicial')
    expect(html).toContain('Configurar')
    expect(html).toContain('Operar')
    expect(html).toContain('Revisar')
  })

  it('cada paso pendiente muestra su consecuencia, no «pendiente» (§29b.3)', async () => {
    const html = await pintar()
    // Routes: six communities with no leg written read as «incomunicadas».
    expect(html).toContain('incomunicadas')
    // Catalogue empty blocks classification.
    expect(html).toContain('El catálogo está vacío')
    // A centre without a location names Recogidas.
    expect(html).toContain('Recogidas no tiene desde dónde medir')
    // The intake number states what it blocks.
    expect(html).toContain('los reportes no llegan solos')
  })

  it('presenta los roles como frases para confirmar (§29b.4)', async () => {
    const html = await pintar()
    expect(html).toContain('Quién ve qué')
    expect(html).toContain('Un verificador ve la bandeja de sus comunidades y nada más')
  })

  it('marca las capacidades que aún no existen como no disponibles (§29b.6)', async () => {
    const html = await pintar()
    expect(html).toContain('aún no disponible')
    expect(html).toContain('Las plantillas de evaluación todavía no están')
  })

  it('un admin ve los botones para confirmar los reconocimientos', async () => {
    const html = await pintar()
    expect(html).toContain('Confirmar')
    expect(html).toContain('Está bien: confirmar estos roles')
  })

  it('no muestra tripas de React ni de Postgres', async () => {
    const html = await pintar()
    for (const pista of ['[object Object]', 'undefined</', '>NaN<', 'Invalid Date', 'TypeError']) {
      expect(html.includes(pista), `mostró «${pista}»`).toBe(false)
    }
  })
})
