import type { SesionStaff } from '@/lib/sesion'

/**
 * The navigation model — PRD v3 §18, PRD-28.
 *
 * Fourteen flat items became **seven sections**, so the panel survives jornadas and
 * evaluaciones without the top bar growing a fifteenth peer. Every URL is unchanged: this is a
 * regrouping, not a route move. `Centros` is relabelled **Organizaciones** and moved under
 * Ajustes (it is the organisation approval queue, not collection centres); Rutas and Puntos de
 * conexión nest under Mapa (you edit them by looking at them); Envíos and Recogidas nest under
 * Agenda (the goods legs of a jornada); Catálogo and Inventario sit under Existencias.
 *
 * **Bandeja** is §18/§19's answer to «two inboxes». A full single-queue merge is a page with
 * its own business logic (PRD-28 scope note), so this shell keeps Tablero and Verificación as
 * the two Bandeja entries and adds **Silencio** as a first-class Bandeja item — the signal that
 * fires when *nobody* reports (§19), which until now lived only in Comunidades where a
 * coordinator working the board never saw it. Silencio points at the existing «Comunidades
 * calladas» list on /estado.
 *
 * **Not-yet-built** sub-items (Citas §27b.2 → FR-17, Cobertura, Entregas y evidencia, Exportes,
 * Centros de acopio, Ofertas, Capacidad ofrecida) are shown greyed as «en construcción» so the
 * target structure is legible — the shell teaches what is coming — but they never link to a
 * route that does not exist.
 *
 * **Role-scoped** per §18/§29.3. `ver` on a section decides who sees the section at all;
 * `ver` on an item mirrors the page's own role gate so a link never lands on a «sin permiso»
 * screen — a link merely spares somebody a screen they could not use anyway. RLS is the real
 * boundary behind every one of these; the nav is only courtesy. `href` on a section makes its
 * title a link to the section's own overview page (Mapa → /mapa, Ajustes → /ajustes); the other
 * five are pure group labels whose destinations are their items.
 *
 * **Presentation** (PRD-28 QA refinement): the sub-items nest. The top bar shows only the seven
 * section labels; each section's items reveal on interaction (a native `<details>` disclosure —
 * see `nav-secciones.tsx`). This module owns the *data* and the *role gate* only; it renders
 * nothing and runs on the server, so the predicates never cross to the client. `seccionesVisibles`
 * returns the plain, serialisable shape the client island consumes.
 *
 * **Phase** (§18) changes only what Bandeja leads with and what Mapa opens on — never this
 * structure, which is identical across impacto/emergencia/recuperación/ordinario. Phase-based
 * ordering is deferred to the pages themselves; the seven-section shell is phase-invariant. TODO
 * (PRD-28 follow-up): lead-item reordering by phase once the Bandeja becomes one real queue.
 */
export type ItemNav = {
  href: string
  etiqueta: string
  /** `false`/absent ⇒ shown greyed «en construcción», never a link (route does not exist yet). */
  listo?: boolean
  /** Item-level visibility, mirroring the destination page's own role gate. Default: visible. */
  ver?: (sesion: SesionStaff) => boolean
}
export type SeccionNav = {
  clave: string
  etiqueta: string
  /** When set, the section title itself links to the section's overview page. */
  href?: string
  /** Section-level visibility per §18's role → section map. */
  ver: (sesion: SesionStaff) => boolean
  items: ItemNav[]
}

/**
 * The plain, serialisable shape handed to the client nav island. No predicates cross the
 * boundary — the role gate has already run on the server by the time this exists.
 */
export type ItemVisible = { href: string; etiqueta: string; listo: boolean }
export type SeccionVisible = {
  clave: string
  etiqueta: string
  href?: string
  items: ItemVisible[]
}

/** True when the session's staff role is one of `roles`. */
const rol = (roles: string[]) => (s: SesionStaff) => roles.includes(s.rolStaff)

// Page-level role gates, copied from the pages so the nav and the page agree on who gets in.
const VE_VERIFICACION = rol(['verificador', 'coordinador', 'admin']) // verificacion PUEDEN_VERIFICAR
const VE_SILENCIO = rol(['verificador', 'despachador', 'coordinador', 'admin']) // estado PUEDEN_VER
const VE_REGISTRO = rol(['verificador', 'despachador', 'coordinador', 'admin']) // comunidades/inventario/catalogo PUEDEN_VER
const VE_RECOGIDAS = rol(['coordinador', 'admin']) // recogidas PUEDEN_PLANEAR
const VE_APADRINAR = rol(['coordinador', 'admin']) // apadrinar PUEDEN_APADRINAR

export const SECCIONES: SeccionNav[] = [
  {
    // §19: everything awaiting a person. Two entries + silence until the single queue exists.
    clave: 'bandeja',
    etiqueta: 'Bandeja',
    ver: rol(['verificador', 'despachador', 'coordinador', 'admin']),
    items: [
      { href: '/tablero', etiqueta: 'Tablero', listo: true },
      { href: '/verificacion', etiqueta: 'Verificación', listo: true, ver: VE_VERIFICACION },
      { href: '/estado#silencio', etiqueta: 'Silencio', listo: true, ver: VE_SILENCIO },
    ],
  },
  {
    clave: 'mapa',
    etiqueta: 'Mapa',
    href: '/mapa',
    ver: rol(['despachador', 'coordinador', 'admin', 'lectura']),
    items: [
      { href: '/evaluaciones', etiqueta: 'Evaluaciones', listo: true }, // PRD-29
      { href: '/rutas', etiqueta: 'Rutas', listo: true },
      { href: '/conexion', etiqueta: 'Puntos de conexión', listo: true },
      { href: '/mapa-offline', etiqueta: 'Mapa sin conexión', listo: true }, // PRD-13
    ],
  },
  {
    clave: 'comunidades',
    etiqueta: 'Comunidades',
    ver: rol(['verificador', 'coordinador', 'admin']),
    items: [
      { href: '/comunidades', etiqueta: 'Red', listo: true, ver: VE_REGISTRO },
      { href: '/radio', etiqueta: 'Radio', listo: true }, // PRD-11
      { href: '/manual', etiqueta: 'Entrada manual', listo: true }, // PRD-35
      { href: '/registro', etiqueta: 'Correcciones del registro', listo: true }, // PRD-35
      { href: '/estado#silencio', etiqueta: 'Silencio', listo: true, ver: VE_SILENCIO },
    ],
  },
  {
    clave: 'agenda',
    etiqueta: 'Agenda',
    ver: rol(['despachador', 'coordinador', 'admin']),
    items: [
      { href: '/programas', etiqueta: 'Programas', listo: true }, // PRD-31
      { href: '/jornadas', etiqueta: 'Jornadas', listo: true }, // PRD-30
      { href: '', etiqueta: 'Citas' }, // FR-17
      { href: '/envios', etiqueta: 'Envíos', listo: true },
      { href: '/traslados', etiqueta: 'Traslado de personas', listo: true }, // PRD-8
      { href: '/recogidas', etiqueta: 'Recogidas', listo: true, ver: VE_RECOGIDAS },
      { href: '', etiqueta: 'Capacidad ofrecida' }, // §18
    ],
  },
  {
    clave: 'existencias',
    etiqueta: 'Existencias',
    ver: rol(['despachador', 'coordinador', 'admin']),
    items: [
      { href: '', etiqueta: 'Centros de acopio' }, // §18
      { href: '/inventario', etiqueta: 'Inventario', listo: true, ver: VE_REGISTRO },
      { href: '', etiqueta: 'Ofertas' }, // §18
      { href: '/catalogo', etiqueta: 'Catálogo', listo: true, ver: VE_REGISTRO },
      { href: '/compra-local', etiqueta: 'Compra local', listo: true }, // PRD-9
    ],
  },
  {
    clave: 'informes',
    etiqueta: 'Informes',
    ver: rol(['coordinador', 'admin', 'lectura']),
    items: [
      { href: '/coordinacion', etiqueta: 'Cobertura', listo: true }, // PRD-35
      { href: '', etiqueta: 'Entregas y evidencia' }, // §18
      { href: '/apadrinar', etiqueta: 'Apadrinamientos', listo: true, ver: VE_APADRINAR },
      { href: '', etiqueta: 'Exportes' }, // §18
    ],
  },
  {
    // §18: Equipo (centre admin, §2.4), Organizaciones (platform approval queue, §2.5), Estado.
    clave: 'ajustes',
    etiqueta: 'Ajustes',
    href: '/ajustes',
    ver: (s) => rol(['coordinador', 'admin'])(s) || s.esPlataforma,
    items: [
      { href: '/equipo', etiqueta: 'Equipo', listo: true, ver: (s) => s.rolStaff === 'admin' || s.esPlataforma },
      { href: '/centros', etiqueta: 'Organizaciones', listo: true, ver: (s) => s.esPlataforma },
      { href: '/estado', etiqueta: 'Estado', listo: true, ver: VE_SILENCIO },
      { href: '/configuracion-inicial', etiqueta: 'Configuración inicial', listo: true }, // PRD-36
    ],
  },
]

/**
 * The sections this session may see, as plain data for the client nav.
 *
 * A section shows when the role may see it and it has somewhere to go — a title link or at
 * least one visible item. Items keep «en construcción» placeholders (no `ver`), so an allowed
 * section is never empty; role-gated built items drop out for whoever cannot reach them. This is
 * the same rule the shell has always applied — it lives here now so it can be tested directly
 * and so the client island receives no predicates, only the answer.
 */
export function seccionesVisibles(sesion: SesionStaff): SeccionVisible[] {
  return SECCIONES.filter((s) => s.ver(sesion))
    .map((s) => ({
      clave: s.clave,
      etiqueta: s.etiqueta,
      href: s.href,
      items: s.items
        .filter((it) => !it.ver || it.ver(sesion))
        .map((it) => ({ href: it.href, etiqueta: it.etiqueta, listo: !!it.listo })),
    }))
    .filter((s) => Boolean(s.href) || s.items.length > 0)
}
