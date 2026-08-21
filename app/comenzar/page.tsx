import { ArrowRight, Boxes, HandCoins, Megaphone, Network, Stethoscope, Truck } from 'lucide-react'
import { redirect } from 'next/navigation'
import {
  FASES_RESPUESTA,
  HERRAMIENTAS_ORGANIZACION,
  INTENCIONES_ORGANIZACION,
  type FaseRespuesta,
  type HerramientaOrganizacion,
  type IntencionOrganizacion,
} from '@/db/schema/vocabulario'
import { debeDeclarar, guardarDeclaracion, leerDeclaracion } from '@/lib/declaracion'
import { conSesion, sesionActual } from '@/lib/sesion'

/**
 * «Antes de empezar» — what an organisation says about itself before the panel opens.
 *
 * Deliberately *outside* `app/(panel)/`. The panel layout is what redirects here, so living
 * inside it would be a redirect loop; and the shell it renders — seven sections of a product
 * this organisation has not yet told us anything about — is exactly what this screen exists to
 * postpone. One screen, four questions, one submit.
 *
 * Four questions and not fourteen. Every one of them changes what the product does next, and
 * anything that does not has no business standing between somebody and their first useful
 * screen. The opposite failure is the more common one: an onboarding that asks a great deal,
 * routes on none of it, and teaches people that forms here are decoration.
 *
 * Server-rendered with no client JavaScript, like /entrar and /solicitar-centro. A coordinator
 * signing up over a weak connection in Quibdó gets a form that works, not a wizard that spins.
 */

export const dynamic = 'force-dynamic'

const INTENCIONES: Record<IntencionOrganizacion, { titulo: string; ayuda: string; Icono: typeof Boxes }> = {
  donaciones: {
    titulo: 'Recibir y canalizar donaciones',
    ayuda: 'Dinero o especie que llega de fuera y hay que dirigir a donde hace falta.',
    Icono: HandCoins,
  },
  materiales: {
    titulo: 'Acopiar y despachar materiales',
    ayuda: 'Mercados, kits, agua, techos: bienes que se guardan en un centro y salen hacia una comunidad.',
    Icono: Boxes,
  },
  servicios: {
    titulo: 'Prestar servicios',
    ayuda: 'Brigadas de salud, partería, evaluación técnica, obra. Lo que se lleva no es carga.',
    Icono: Stethoscope,
  },
  transporte: {
    titulo: 'Transportar',
    ayuda: 'Lancha, chalupa o vehículo, para carga o para personas.',
    Icono: Truck,
  },
  reportes: {
    titulo: 'Levantar necesidades en territorio',
    ayuda: 'Recoger lo que las comunidades reportan y verificarlo.',
    Icono: Megaphone,
  },
  coordinacion: {
    titulo: 'Coordinar a otras organizaciones',
    ayuda: 'Ver la cobertura entre varias organizaciones y evitar que se dupliquen o se dejen huecos.',
    Icono: Network,
  },
}

const HERRAMIENTAS: Record<HerramientaOrganizacion, string> = {
  whatsapp: 'WhatsApp (grupos o chats)',
  google_drive: 'Google Drive',
  google_sheets: 'Google Sheets',
  google_calendar: 'Google Calendar',
  excel: 'Excel',
  radio: 'Radio comunitaria',
  papel: 'Papel: cuadernos, actas, planillas',
  ninguna: 'Nada de esto todavía',
}

const FASES: Record<FaseRespuesta, { titulo: string; ayuda: string }> = {
  impacto: {
    titulo: 'Impacto',
    ayuda: 'Acaba de pasar. Lo urgente es saber quién está incomunicado.',
  },
  emergencia: {
    titulo: 'Emergencia',
    ayuda: 'Está llegando ayuda y hay que moverla. Lo urgente es lo que está atascado.',
  },
  recuperacion: {
    titulo: 'Recuperación',
    ayuda: 'Lo agudo pasó. Ahora se evalúa el daño y se costea lo que hay que reconstruir.',
  },
  ordinario: {
    titulo: 'Ordinario',
    ayuda: 'Sin emergencia abierta: trabajo programado, jornadas y seguimiento.',
  },
}

async function declarar(formData: FormData) {
  'use server'

  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const marcados = (campo: string, permitidos: readonly string[]) =>
    formData.getAll(campo).map(String).filter((v) => permitidos.includes(v))

  const intenciones = marcados('intenciones', INTENCIONES_ORGANIZACION) as IntencionOrganizacion[]
  const herramientas = marcados('herramientas', HERRAMIENTAS_ORGANIZACION) as HerramientaOrganizacion[]
  const faseCruda = String(formData.get('fase') ?? '')
  const rural = String(formData.get('alcance_rural') ?? '')

  // Validated here as well as in SQL. The database is the boundary that matters, but a
  // coordinator who leaves a question blank deserves the question back with a reason, not a
  // stack trace from a check constraint.
  if (intenciones.length === 0) redirect('/comenzar?error=intenciones')
  if (!(FASES_RESPUESTA as readonly string[]).includes(faseCruda)) redirect('/comenzar?error=fase')
  if (rural !== 'si' && rural !== 'no') redirect('/comenzar?error=rural')

  await conSesion(
    sesion,
    (client) =>
      guardarDeclaracion(client, {
        intenciones,
        herramientas,
        fase: faseCruda as FaseRespuesta,
        alcanceRural: rural === 'si',
      }),
    { escribe: true },
  )

  redirect('/tablero')
}

export default async function Comenzar({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  // Anyone not actually being asked is sent on. Without this the screen would be reachable by
  // typing the URL and would then refuse the submit at the SQL layer — a dead end with no
  // explanation. `debeDeclarar` owns the whole rule; see lib/declaracion.ts for why each
  // exemption exists.
  if (!debeDeclarar(sesion)) redirect('/tablero')

  const { error } = await searchParams
  const actual = await conSesion(sesion, (client) => leerDeclaracion(client))

  return (
    <main className="min-h-dvh bg-barro-50 px-5 py-10 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm font-medium text-selva-700">Convite</p>
        <h1 className="mt-1 text-2xl font-semibold text-barro-900">Antes de empezar</h1>
        <p className="mt-3 text-barro-700">
          Cuatro preguntas, una sola vez. Con esto el panel abre en lo que a ustedes les sirve y
          no en todo lo demás. Se puede cambiar después desde Ajustes.
        </p>

        {error && (
          <p className="mt-4 rounded-lg border border-atrato-100 bg-atrato-50 px-4 py-3 text-sm text-barro-800">
            {error === 'intenciones' && 'Marque al menos una cosa que su organización vaya a hacer.'}
            {error === 'fase' && 'Falta decir en qué momento de la respuesta están.'}
            {error === 'rural' && 'Falta decir si necesitan llegar a comunidades fuera de la vía.'}
          </p>
        )}

        <form action={declarar} className="mt-8 space-y-8">
          <fieldset className="rounded-xl border border-barro-200 bg-white p-5">
            <legend className="px-1 text-sm font-semibold text-barro-900">
              1 · ¿Para qué está aquí su organización?
            </legend>
            <p className="mt-1 text-sm text-barro-600">Marque todo lo que apliquen. Casi todas hacen varias.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {INTENCIONES_ORGANIZACION.map((clave) => {
                const { titulo, ayuda, Icono } = INTENCIONES[clave]
                return (
                  <label
                    key={clave}
                    className="flex cursor-pointer gap-3 rounded-lg border border-barro-200 p-3 hover:border-selva-200"
                  >
                    <input
                      type="checkbox"
                      name="intenciones"
                      value={clave}
                      defaultChecked={actual.intenciones.includes(clave)}
                      className="mt-1 h-4 w-4 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-medium text-barro-900">
                        <Icono className="h-4 w-4 shrink-0 text-selva-700" aria-hidden />
                        {titulo}
                      </span>
                      <span className="mt-1 block text-xs text-barro-600">{ayuda}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>

          <fieldset className="rounded-xl border border-barro-200 bg-white p-5">
            <legend className="px-1 text-sm font-semibold text-barro-900">
              2 · ¿En qué trabajan hoy?
            </legend>
            <p className="mt-1 text-sm text-barro-600">
              Convite se pone al lado de lo que ya usan, no encima. Esto decide qué vale la pena
              conectar primero — y «nada de esto» es una respuesta perfectamente válida.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {HERRAMIENTAS_ORGANIZACION.map((clave) => (
                <label
                  key={clave}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-barro-200 px-3 py-2 text-sm text-barro-800 hover:border-selva-200"
                >
                  <input
                    type="checkbox"
                    name="herramientas"
                    value={clave}
                    defaultChecked={actual.herramientas.includes(clave)}
                    className="h-4 w-4 shrink-0"
                  />
                  {HERRAMIENTAS[clave]}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="rounded-xl border border-barro-200 bg-white p-5">
            <legend className="px-1 text-sm font-semibold text-barro-900">
              3 · ¿En qué momento de la respuesta están?
            </legend>
            <p className="mt-1 text-sm text-barro-600">
              Cambia con qué abre la bandeja y en qué abre el mapa. Se cambia cuando cambie.
            </p>
            <div className="mt-4 grid gap-2">
              {FASES_RESPUESTA.map((clave) => (
                <label
                  key={clave}
                  className="flex cursor-pointer gap-3 rounded-lg border border-barro-200 p-3 hover:border-selva-200"
                >
                  <input
                    type="radio"
                    name="fase"
                    value={clave}
                    defaultChecked={actual.fase === clave}
                    className="mt-1 h-4 w-4 shrink-0"
                  />
                  <span>
                    <span className="block text-sm font-medium text-barro-900">{FASES[clave].titulo}</span>
                    <span className="mt-0.5 block text-xs text-barro-600">{FASES[clave].ayuda}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="rounded-xl border border-barro-200 bg-white p-5">
            <legend className="px-1 text-sm font-semibold text-barro-900">
              4 · ¿Necesitan llegar a comunidades fuera de la vía?
            </legend>
            <p className="mt-1 text-sm text-barro-600">
              Ríos, lancha, señal intermitente, radio. Es la respuesta que más cambia: mapas para
              usar sin conexión, por dónde se pregunta y cómo se confirma.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {[
                { valor: 'si', titulo: 'Sí', ayuda: 'Parte de nuestro territorio solo se alcanza por río o queda sin señal.' },
                { valor: 'no', titulo: 'No', ayuda: 'Todo lo que atendemos se alcanza por carretera y con señal.' },
              ].map((o) => (
                <label
                  key={o.valor}
                  className="flex cursor-pointer gap-3 rounded-lg border border-barro-200 p-3 hover:border-selva-200"
                >
                  <input
                    type="radio"
                    name="alcance_rural"
                    value={o.valor}
                    defaultChecked={actual.alcanceRural === (o.valor === 'si')}
                    className="mt-1 h-4 w-4 shrink-0"
                  />
                  <span>
                    <span className="block text-sm font-medium text-barro-900">{o.titulo}</span>
                    <span className="mt-0.5 block text-xs text-barro-600">{o.ayuda}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-lg bg-selva-700 px-5 py-3 font-medium text-white hover:bg-selva-800"
          >
            Entrar al panel
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </form>
      </div>
    </main>
  )
}
