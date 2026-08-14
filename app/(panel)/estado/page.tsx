import { Activity, BellRing, CircleCheck, EarOff, Layers, TriangleAlert } from 'lucide-react'
import { redirect } from 'next/navigation'
import { estadoSistema } from '@/lib/observabilidad/salud'
import {
  agrupacionesDeDanos,
  comunidadesEnSilencio,
  type AgrupacionDanos,
  type ComunidadEnSilencio,
} from '@/lib/observabilidad/silencio'
import { confirmacionesAmbiguas, type ConfirmacionAmbigua } from '@/lib/verificacion/danos'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * Whether the system is working, in words rather than in metrics.
 *
 * PRD §6: «a silently failing matcher looks exactly like a quiet week». Everything on this
 * page is a failure that does not throw — a worker that died holding a job, outbound queued
 * for two days, a verification queue nobody is draining, a community that stopped talking.
 * The health endpoint answers the same questions in JSON for a monitor; this answers them
 * for the person who can actually do something about it.
 *
 * Silence gets the most room because it is the one alert about people rather than about
 * machinery. Section 9.8: silence is a signal, not an absence of need — and the tier 3–4
 * communities, the ones on radio relay, are exactly the ones whose silence means least about
 * their situation and most about their signal.
 */

const PUEDEN_VER = ['verificador', 'despachador', 'coordinador', 'admin']

export default async function Estado() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  if (!PUEDEN_VER.includes(sesion.rolStaff)) {
    return (
      <main>
        <h1 className="text-xl font-semibold text-stone-900">Estado</h1>
        <p className="mt-4 text-stone-700">Su rol no ve el estado del sistema.</p>
      </main>
    )
  }

  const { salud, silencio, danos, ambiguas } = await conSesion(sesion, async (client) => ({
    salud: await estadoSistema(client),
    silencio: await comunidadesEnSilencio(client),
    danos: await agrupacionesDeDanos(client),
    ambiguas: await confirmacionesAmbiguas(client),
  }))

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-stone-900">Estado</h1>
        <p className="text-sm text-stone-600">
          {salud.alertas.length === 0
            ? 'Sin alertas.'
            : `${salud.alertas.length} alerta${salud.alertas.length === 1 ? '' : 's'}`}
        </p>
      </div>

      <p className="mt-2 max-w-3xl text-sm text-stone-700">
        Un emparejador que dejó de correr se ve igual que una semana tranquila. Todo lo de
        acá son fallas que no dan error: nadie se entera hasta que alguien pregunta por qué
        una comunidad lleva días sin aparecer.
      </p>

      {salud.alertas.length === 0 ? (
        <p className="mt-6 flex items-center gap-2 rounded-lg border border-selva-600 bg-selva-50 px-4 py-3 text-sm text-stone-800">
          <CircleCheck className="size-4" aria-hidden />
          La cola corre, la verificación avanza y nadie lleva más de lo esperado sin reportar.
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {salud.alertas.map((alerta, i) => (
            <li
              key={i}
              className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900"
            >
              <BellRing className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{alerta}</span>
            </li>
          ))}
        </ul>
      )}

      <Ambiguas confirmaciones={ambiguas} />
      <Silencio comunidades={silencio} nuncaVistas={salud.silencio.nuncaVistas} />
      <Danos agrupaciones={danos} />

      <section className="mt-10">
        <h2 className="flex items-center gap-2 font-semibold text-stone-900">
          <Activity className="size-4" aria-hidden />
          La maquinaria
        </h2>

        <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Dato
            titulo="Cola de trabajos"
            valor={`${salud.jobs.pendientes} pendientes`}
            detalle={
              salud.jobs.colgados > 0
                ? `${salud.jobs.colgados} colgados — un worker murió con ellos`
                : salud.jobs.sinProcesarMin === null
                  ? 'nada ha corrido todavía'
                  : `último terminado hace ${salud.jobs.sinProcesarMin} min`
            }
            malo={salud.jobs.colgados > 0 || salud.jobs.fallidos > 0}
          />
          <Dato
            titulo="Salidas encoladas"
            valor={`${salud.salidas.encoladas}`}
            detalle={
              salud.salidas.encoladas === 0
                ? 'nada esperando'
                : `la más vieja lleva ${salud.salidas.masViejaHoras} h`
            }
            malo={salud.salidas.masViejaHoras >= 48}
          />
          <Dato
            titulo="Verificación"
            valor={
              salud.verificacion.medianaHoras === null
                ? 'sin datos'
                : `${salud.verificacion.medianaHoras} h de mediana`
            }
            detalle={`${salud.verificacion.pendientes} sin revisar · la más vieja ${salud.verificacion.masViejoHoras} h`}
            malo={(salud.verificacion.medianaHoras ?? 0) > 24}
          />
          <Dato
            titulo="Presupuesto de voz"
            valor={`${salud.voz.porcentaje}%`}
            detalle={`${salud.voz.usadosMin} de ${salud.voz.presupuestoMin} min`}
            malo={salud.voz.alerta || salud.voz.agotado}
          />
        </dl>
      </section>
    </main>
  )
}

function Dato({
  titulo,
  valor,
  detalle,
  malo,
}: {
  titulo: string
  valor: string
  detalle: string
  malo: boolean
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${malo ? 'border-rose-300 bg-rose-50' : 'border-barro-200 bg-white'}`}
    >
      <dt className="text-sm text-stone-600">{titulo}</dt>
      <dd className="mt-0.5 font-medium text-stone-900">{valor}</dd>
      <dd className="text-sm text-stone-600">{detalle}</dd>
    </div>
  )
}

function Ambiguas({ confirmaciones }: { confirmaciones: ConfirmacionAmbigua[] }) {
  if (confirmaciones.length === 0) return null

  return (
    <section className="mt-10">
      <h2 className="flex items-center gap-2 font-semibold text-stone-900">
        <TriangleAlert className="size-4" aria-hidden />
        Códigos que no se pueden resolver
        <span className="font-normal text-stone-600">{confirmaciones.length}</span>
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-stone-700">
        Dos entregas abiertas en la misma comunidad con el mismo código. Si alguien lo lee de
        vuelta, no hay forma de saber cuál llegó — y desde el tablero eso se ve idéntico a una
        comunidad que nunca confirmó. Hay que llamar y cerrar una a mano.
      </p>
      <ul className="mt-3 divide-y divide-stone-200 rounded-lg border border-rose-300 bg-rose-50">
        {confirmaciones.map((c) => (
          <li key={`${c.comunidad}-${c.codigo}`} className="flex flex-wrap items-baseline gap-x-2 px-4 py-3 text-sm">
            <span className="font-medium text-stone-900">{c.comunidad}</span>
            <span className="font-mono text-stone-900">{c.codigo}</span>
            <span className="text-stone-800">
              {c.entregas} entregas abiertas · envíos {c.envios.join(', ')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Silencio({
  comunidades,
  nuncaVistas,
}: {
  comunidades: ComunidadEnSilencio[]
  nuncaVistas: number
}) {
  return (
    <section className="mt-10">
      <h2 className="flex items-center gap-2 font-semibold text-stone-900">
        <EarOff className="size-4" aria-hidden />
        Comunidades calladas
        <span className="font-normal text-stone-600">{comunidades.length}</span>
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-stone-700">
        Pasaron su propio intervalo sin decir nada. El silencio es una señal, no una ausencia
        de necesidad — y en tier 3 y 4 casi siempre habla más de la señal que de la situación.
      </p>

      {comunidades.length === 0 ? (
        <p className="mt-3 text-sm text-stone-600">
          Todas han aparecido dentro de su intervalo.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-200 rounded-lg border border-barro-200 bg-white">
          {comunidades.map((c) => (
            <li key={c.comunidadId} className="flex flex-wrap items-baseline gap-x-2 px-4 py-3 text-sm">
              <span className="font-medium text-stone-900">{c.nombre}</span>
              <span className="text-stone-500">tier {c.tier}</span>
              <span className="text-stone-800">
                {c.diasEnSilencio} días callada, y esperábamos cada {c.intervaloDias}
              </span>
              {c.ultimoCanal && (
                <span className="ml-auto text-stone-600">
                  respondió por {c.ultimoCanal} — por ahí conviene buscarla
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {nuncaVistas > 0 && (
        <p className="mt-2 text-sm text-stone-600">
          {nuncaVistas} comunidad{nuncaVistas === 1 ? '' : 'es'} de las que nunca hemos sabido
          nada. Eso es alta, no alarma: nadie ha dejado de hablarnos.
        </p>
      )}
    </section>
  )
}

function Danos({ agrupaciones }: { agrupaciones: AgrupacionDanos[] }) {
  if (agrupaciones.length === 0) return null

  return (
    <section className="mt-10">
      <h2 className="flex items-center gap-2 font-semibold text-stone-900">
        <Layers className="size-4" aria-hidden />
        Daños agrupados
        <span className="font-normal text-stone-600">{agrupaciones.length}</span>
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-stone-700">
        Tres o más daños verificados en la misma zona dentro de dos días. Eso casi nunca son
        tres problemas: es una creciente, un vendaval, una palizada que se llevó varias cosas
        a la vez. Leerlo como tres tiquetes es como se llega tarde y con la respuesta
        equivocada.
      </p>

      <ul className="mt-3 space-y-2">
        {agrupaciones.map((a, i) => (
          <li
            key={i}
            className="flex items-start gap-2 rounded-lg border border-atrato-100 bg-atrato-50 px-4 py-3 text-sm"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="text-stone-900">
              <span className="font-medium">
                {a.agrupador ?? a.municipio}
              </span>{' '}
              — {a.danos} daños verificados
              {a.severidadMaxima !== null && `, el peor de severidad ${a.severidadMaxima}`}.
              Reportaron: {a.comunidades.join(', ')}.
              <span className="mt-1 block text-stone-700">
                Revise en Rutas si algún tramo de esa zona quedó cerrado. Un reporte no
                desactiva una ruta: lo hace una persona, después de verificarlo.
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
