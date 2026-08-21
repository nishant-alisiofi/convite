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
 * **Bandeja** is §18/§19's answer to «two inboxes», and it is now one real queue: `/bandeja`
 * merges reports awaiting verification, pedidos the matcher could not move, and silence — which
 * is a first-class item there rather than a link to an anchor on another page (§19). Verificación
 * stays as its own entry because verifying is a distinct sitting-down-to-work surface, not
 * because the queue is still split. Tablero moved to Agenda: §18 files a goods-dispatch board
 * with the goods legs of a jornada, and it never was the head of the pipeline.
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
 * structure, which is identical across impacto/emergencia/recuperación/ordinario. The phase-based
 * ordering now happens inside the queue (lib/bandeja/rango.ts) rather than in this shell, which
 * stays phase-invariant by design. It became buildable when migration 0065 gave the phase its
 * first home in the database.
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

/**
 * Not a self-registered transporter (FR-18).
 *
 * Their org is minted `aprobada`, so `panelBloqueado` lets them into the shell, and their role is
 * `lectura` — which the Mapa section admits. RLS then gives them nothing on the coordinator-facing
 * pages, so they met empty screens with no explanation. The tier is what separates them from a
 * centre-invited `lectura`, who is real staff of a real organisation and may legitimately read.
 */
const NO_ES_APORTANTE = (s: SesionStaff) => s.nivelAdmision !== 'aportante'

export const SECCIONES: SeccionNav[] = [
  {
    // §19: everything awaiting a person. Two entries + silence until the single queue exists.
    clave: 'bandeja',
    etiqueta: 'Bandeja',
    ver: rol(['verificador', 'despachador', 'coordinador', 'admin']),
    items: [
      { href: '/bandeja', etiqueta: 'Todo lo pendiente', listo: true },
      // The phone surface: existencias + avisar qué falta, for whoever is not at a desk.
      { href: '/campo', etiqueta: 'Campo (teléfono)', listo: true },
      { href: '/verificacion', etiqueta: 'Verificación', listo: true, ver: VE_VERIFICACION },
    ],
  },
  {
    clave: 'mapa',
    etiqueta: 'Mapa',
    // No section link for an aportante: /mapa is the coordinator's planning surface and now has
    // a server-side role gate of its own, so offering it here would land them on a refusal.
    href: '/mapa',
    ver: rol(['despachador', 'coordinador', 'admin', 'lectura']),
    items: [
      { href: '/evaluaciones', etiqueta: 'Evaluaciones', listo: true, ver: NO_ES_APORTANTE }, // PRD-29
      { href: '/rutas', etiqueta: 'Rutas', listo: true, ver: NO_ES_APORTANTE },
      { href: '/conexion', etiqueta: 'Puntos de conexión', listo: true, ver: NO_ES_APORTANTE },
      // The one Mapa item a transporter should see: their basemap, their position, their stop.
      { href: '/mapa-offline', etiqueta: 'Mapa sin conexión', listo: true }, // PRD-13
    ],
  },
  {
    clave: 'comunidades',
    etiqueta: 'Comunidades',
    ver: rol(['verificador', 'coordinador', 'admin']),
    items: [
      { href: '/comunidades', etiqueta: 'Red', listo: true, ver: VE_REGISTRO },
      { href: '/personas', etiqueta: 'Personas', listo: true, ver: VE_REGISTRO }, // FR-42
      { href: '/radio', etiqueta: 'Radio', listo: true }, // PRD-11
      { href: '/manual', etiqueta: 'Entrada manual', listo: true }, // PRD-35
      { href: '/registro', etiqueta: 'Correcciones del registro', listo: true }, // PRD-35
      { href: '/relevo', etiqueta: 'Red de lancheros', listo: true, ver: VE_VERIFICACION }, // PRD-47
      { href: '/estado#silencio', etiqueta: 'Silencio', listo: true, ver: VE_SILENCIO },
    ],
  },
  {
    clave: 'agenda',
    etiqueta: 'Agenda',
    ver: rol(['despachador', 'coordinador', 'admin']),
    items: [
      // §18 puts a goods-dispatch board here: Tablero is the tail of the pipeline, not its head
      // (nothing reaches it until a report is verified and the matcher has run), so it sits with
      // the other goods legs of a jornada rather than acting as the front door. PRD-28 AC 2.
      { href: '/tablero', etiqueta: 'Tablero de despacho', listo: true },
      { href: '/programas', etiqueta: 'Programas', listo: true }, // PRD-31
      { href: '/jornadas', etiqueta: 'Jornadas', listo: true }, // PRD-30
      { href: '/agenda', etiqueta: 'Mi calendario', listo: true }, // PRD-34 (.ics subscribe link)
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
      { href: '/coordinacion', etiqueta: 'Cobertura', listo: true, ver: rol(['coordinador', 'admin']) }, // PRD-35
      { href: '', etiqueta: 'Entregas y evidencia' }, // §18
      { href: '/apadrinar', etiqueta: 'Apadrinamientos', listo: true, ver: VE_APADRINAR },
      { href: '/exportes', etiqueta: 'Exportes', listo: true, ver: rol(['coordinador', 'admin']) }, // PRD-34 (CSV export)
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
