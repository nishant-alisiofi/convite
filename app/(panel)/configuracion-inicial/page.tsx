import {
  ArrowRight,
  CircleCheck,
  CircleDashed,
  Clock,
  ListChecks,
  Lock,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  claveAcuerdoDatos,
  claveRolesConfirmados,
  guardarReconocimiento,
  resumenConfiguracion,
  reunirDatosConfiguracion,
  type EstadoPaso,
  type PasoConfiguracion,
} from '@/lib/onboarding'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * «Configurar» — setup as a dependency-ordered checklist, not one long form (PRD-36 §29b).
 *
 * It mirrors §3: five stages, each unlocking a capability, and a fresh disaster deployment
 * reaches useful operation at stage 1 (communities + a number) without ever seeing stages 2–4.
 * Every step still missing states the *consequence* — the blocked capability — instead of a bare
 * «pendiente», because these are failures a coordinator cannot otherwise diagnose.
 *
 * Almost everything is derived from data the product already holds; the only two stored facts are
 * acknowledgements an admin makes here — the data agreement and the role model — and both write
 * through the same admin-only, audited path the season change uses. The nav (Configurar / Operar
 * / Revisar) is wired elsewhere (PRD-28); this screen is the Configurar surface itself, and it
 * frames the three contexts so they read as contexts and not a menu.
 */

/** The five roles, written as sentences to confirm — never a grid of permission checkboxes (§29b.4). */
const FRASES_ROL: { rol: string; frase: string }[] = [
  {
    rol: 'Verificador',
    frase:
      'Un verificador ve la bandeja de sus comunidades y nada más — no ve las direcciones de los hogares ni el resto de la cuenca.',
  },
  {
    rol: 'Despachador',
    frase:
      'Un despachador arma y despacha los envíos, y ve las ubicaciones exactas solo de su propio viaje, y solo mientras dura.',
  },
  {
    rol: 'Coordinador',
    frase:
      'Un coordinador ve toda la cuenca y organiza la respuesta, pero no cambia la temporada ni abre centros nuevos.',
  },
  {
    rol: 'Admin',
    frase:
      'Un admin hace todo lo del coordinador y, además, invita al equipo, fija la temporada y ubica el centro.',
  },
  {
    rol: 'Solo lectura',
    frase: 'Alguien de solo lectura ve la cuenca para reportar hacia afuera, pero no toca nada.',
  },
]

/** The seven Operar sections (§29b.1), so the context reads as what it opens, not a bare word. */
const SECCIONES_OPERAR = [
  { href: '/tablero', etiqueta: 'Tablero' },
  { href: '/verificacion', etiqueta: 'Verificación' },
  { href: '/mapa', etiqueta: 'Mapa' },
  { href: '/inventario', etiqueta: 'Inventario' },
  { href: '/rutas', etiqueta: 'Rutas' },
  { href: '/recogidas', etiqueta: 'Recogidas' },
  { href: '/envios', etiqueta: 'Envíos' },
]

const ICONO_ESTADO: Record<EstadoPaso, typeof CircleCheck> = {
  hecho: CircleCheck,
  pendiente: CircleDashed,
  no_disponible: Lock,
}

type Params = Promise<{ ok?: string; error?: string }>

export default async function ConfiguracionInicial({ searchParams }: { searchParams: Params }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { ok, error } = await searchParams
  const esAdmin = sesion.rolStaff === 'admin'

  const { datos, resumen } = await conSesion(sesion, async (client) => {
    const datos = await reunirDatosConfiguracion(client)
    return { datos, resumen: resumenConfiguracion(datos) }
  })

  /** Confirm an admin-only acknowledgement (the data agreement or the role model). */
  async function confirmar(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion) redirect('/entrar')
    if (sesion.rolStaff !== 'admin') {
      redirect('/configuracion-inicial?error=Solo+un+admin+confirma+esto')
    }

    const cual = String(formData.get('cual') ?? '')
    const { clave, descripcion } =
      cual === 'acuerdo'
        ? { clave: claveAcuerdoDatos(sesion.organizacionId), descripcion: 'Acuerdo de datos firmado (onboarding)' }
        : cual === 'roles'
          ? { clave: claveRolesConfirmados(sesion.organizacionId), descripcion: 'Modelo de roles confirmado (onboarding)' }
          : { clave: '', descripcion: '' }

    if (!clave) redirect('/configuracion-inicial?error=Confirmación+desconocida')

    await conSesion(sesion, (client) => guardarReconocimiento(client, clave, descripcion), {
      escribe: true,
    })

    revalidatePath('/configuracion-inicial')
    redirect(`/configuracion-inicial?ok=${cual}`)
  }

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-barro-900">
          <ListChecks className="size-5" aria-hidden />
          Configuración inicial
        </h1>
        <p className="text-sm text-barro-600">
          {resumen.completa
            ? 'Lista'
            : `${resumen.pendientes} paso${resumen.pendientes === 1 ? '' : 's'} para arrancar`}
        </p>
      </div>

      <p className="mt-2 max-w-3xl text-sm text-barro-700">
        No es un formulario largo: se arma por fases, en orden, y cada fase abre una capacidad. Una
        respuesta a un desastre nuevo necesita comunidades y un número, nada más — el resto puede
        esperar. Cada paso que falta dice qué deja sin funcionar, no solo «pendiente».
      </p>

      {ok && (
        <p className="mt-4 rounded-lg border border-selva-300 bg-selva-50 px-4 py-3 text-sm text-barro-900">
          {ok === 'acuerdo' && 'Acuerdo de datos confirmado.'}
          {ok === 'roles' && 'Modelo de roles confirmado.'}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </p>
      )}

      {/* AC#1: when everything is configured, this whole screen collapses to a line — it lives in
          Ajustes from then on, and stays reachable. */}
      {resumen.completa && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-selva-300 bg-selva-50 px-4 py-3 text-sm text-barro-800">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-selva-700" aria-hidden />
          <span>
            La configuración base está lista. De aquí en adelante esto vive en{' '}
            <Link href="/ajustes" className="underline">
              Ajustes
            </Link>{' '}
            — puede volver cuando quiera ajustar algo. Abajo quedan las fases del día después
            (Recuperación y Ordinario), que se arman con el tiempo.
          </span>
        </p>
      )}

      {/* The three contexts (§29b.1), framed as contexts and not a menu. */}
      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-atrato-200 bg-atrato-50 px-4 py-3">
          <h2 className="text-sm font-semibold text-barro-900">Configurar</h2>
          <p className="mt-1 text-sm text-barro-700">Está aquí. Se arma una vez, en orden.</p>
        </div>
        <div className="rounded-lg border border-barro-200 bg-white px-4 py-3">
          <h2 className="text-sm font-semibold text-barro-900">Operar</h2>
          {resumen.operarDisponible ? (
            <p className="mt-1 text-sm text-barro-700">
              El día a día:{' '}
              {SECCIONES_OPERAR.map((s, i) => (
                <span key={s.href}>
                  <Link href={s.href} className="underline">
                    {s.etiqueta}
                  </Link>
                  {i < SECCIONES_OPERAR.length - 1 ? ', ' : '.'}
                </span>
              ))}
            </p>
          ) : (
            <p className="mt-1 text-sm text-barro-500">
              Aparece cuando haya al menos una comunidad registrada — una bandeja vacía no le sirve
              a nadie.
            </p>
          )}
        </div>
        <div className="rounded-lg border border-barro-200 bg-white px-4 py-3">
          <h2 className="text-sm font-semibold text-barro-900">Revisar</h2>
          <p className="mt-1 text-sm text-barro-700">
            Otro ritmo, casi siempre otra persona:{' '}
            <Link href="/estado" className="underline">
              Estado
            </Link>
            .
          </p>
        </div>
      </section>

      {/* The five stages. */}
      <ol className="mt-8 space-y-6">
        {resumen.etapas.map((etapa) => (
          <li key={etapa.clave} className="rounded-lg border border-barro-200 bg-white">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-barro-100 px-4 py-3">
              <h2 className="flex items-baseline gap-2 font-semibold text-barro-900">
                <span className="text-barro-400">{etapa.numero}</span>
                {etapa.titulo}
                {etapa.completa && (
                  <span className="rounded bg-selva-50 px-1.5 py-0.5 text-xs font-medium text-selva-700">
                    lista
                  </span>
                )}
                {etapa.numero === 1 && resumen.etapa1Alcanzada && (
                  <span className="rounded bg-selva-50 px-1.5 py-0.5 text-xs font-medium text-selva-700">
                    ya es útil sola
                  </span>
                )}
              </h2>
              <p className="text-sm text-barro-600">{etapa.desbloquea}</p>
            </div>

            <ul className="divide-y divide-barro-100">
              {etapa.pasos.map((p) => (
                <PasoFila key={p.clave} paso={p} esAdmin={esAdmin} datos={datos} confirmar={confirmar} />
              ))}
            </ul>
          </li>
        ))}
      </ol>

      {/* §29b.4 — roles confirmed as sentences, never a checkbox grid. The step above anchors here. */}
      <section id="roles" className="mt-8 rounded-lg border border-barro-200 bg-white px-4 py-4">
        <h2 className="flex items-center gap-2 font-semibold text-barro-900">
          <ShieldCheck className="size-4" aria-hidden />
          Quién ve qué
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-barro-700">
          Estas son las reglas por defecto. Léalas y confirme que están bien — una rejilla de
          casillas se responde con un encogimiento de hombros; tres frases se responden de verdad, y
          es lo que protege las direcciones de los hogares más adelante.
        </p>

        <ul className="mt-3 space-y-2">
          {FRASES_ROL.map((r) => (
            <li key={r.rol} className="flex gap-2 text-sm text-barro-800">
              <span className="min-w-24 shrink-0 font-medium text-barro-900">{r.rol}</span>
              <span>{r.frase}</span>
            </li>
          ))}
        </ul>

        {datos.rolesConfirmadosEn ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-selva-700">
            <CircleCheck className="size-4" aria-hidden />
            Confirmado el {new Date(datos.rolesConfirmadosEn).toLocaleDateString('es-CO')}. Cambie
            las asignaciones cuando haga falta en{' '}
            <Link href="/equipo" className="underline">
              Equipo
            </Link>
            .
          </p>
        ) : esAdmin ? (
          <form action={confirmar} className="mt-4">
            <input type="hidden" name="cual" value="roles" />
            <button
              type="submit"
              className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
            >
              Está bien: confirmar estos roles
            </button>
          </form>
        ) : (
          <p className="mt-4 text-sm text-barro-600">
            Solo un admin confirma el modelo de roles. Si hay que revisarlo, pídalo.
          </p>
        )}
      </section>
    </main>
  )
}

/**
 * One step in a stage: its state, and — when it is not done — the consequence of leaving it, plus
 * the way to fix it (a link to another screen, a confirm button here, or nothing for a capability
 * that isn't built yet).
 */
function PasoFila({
  paso,
  esAdmin,
  datos,
  confirmar,
}: {
  paso: PasoConfiguracion
  esAdmin: boolean
  datos: { acuerdoDatosEn: string | null; rolesConfirmadosEn: string | null }
  confirmar: (formData: FormData) => Promise<void>
}) {
  const Icono = ICONO_ESTADO[paso.estado]
  const hecho = paso.estado === 'hecho'
  const noDisponible = paso.estado === 'no_disponible'
  const selladoEn = paso.accion === 'acuerdo' ? datos.acuerdoDatosEn : paso.accion === 'roles' ? datos.rolesConfirmadosEn : null

  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3">
      <Icono
        className={`mt-0.5 size-4 shrink-0 ${
          hecho ? 'text-selva-600' : noDisponible ? 'text-barro-300' : 'text-atrato-600'
        }`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className={`font-medium ${noDisponible ? 'text-barro-500' : 'text-barro-900'}`}>
            {paso.etiqueta}
          </span>
          {paso.opcional && !hecho && (
            <span className="rounded bg-barro-100 px-1.5 py-0.5 text-xs text-barro-600">opcional</span>
          )}
          {noDisponible && (
            <span className="rounded bg-barro-100 px-1.5 py-0.5 text-xs text-barro-500">
              aún no disponible
            </span>
          )}
        </p>

        {/* §29b.3: what it blocks, not «pendiente». Silent once the step is done. */}
        {!hecho && (
          <p className="mt-1 flex items-start gap-1.5 text-sm text-barro-600">
            <TriangleAlert
              className={`mt-0.5 size-3.5 shrink-0 ${noDisponible ? 'text-barro-300' : 'text-atrato-600'}`}
              aria-hidden
            />
            <span>{paso.consecuencia}</span>
          </p>
        )}

        {hecho && selladoEn && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-barro-500">
            <Clock className="size-3.5" aria-hidden />
            {new Date(selladoEn).toLocaleDateString('es-CO')}
          </p>
        )}
      </div>

      {/* The way to fix it, on the right. */}
      {!hecho && !noDisponible && paso.href && (
        <Link
          href={paso.href}
          className="flex shrink-0 items-center gap-1 text-sm text-barro-700 underline hover:text-barro-950"
        >
          Ir
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      )}
      {!hecho && paso.accion && (
        esAdmin ? (
          <form action={confirmar} className="shrink-0">
            <input type="hidden" name="cual" value={paso.accion} />
            <button
              type="submit"
              className="rounded border border-barro-200 bg-white px-3 py-1.5 text-sm text-barro-800 hover:bg-barro-50"
            >
              Confirmar
            </button>
          </form>
        ) : (
          <span className="shrink-0 text-xs text-barro-500">solo un admin</span>
        )
      )}
    </li>
  )
}
