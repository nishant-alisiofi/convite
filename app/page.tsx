import {
  ArrowRight,
  Building2,
  MessageSquare,
  PhoneMissed,
  Radio,
  Route,
  Scale,
  ShieldCheck,
  Smartphone,
  Users,
} from 'lucide-react'
import { Marca } from '@/components/marca'

/**
 * The front door — what Convite is and why it can be trusted, for the people who arrive
 * before they have a login: a partner organisation, a funder, or the humanitarian cluster it
 * plugs into. This is the surface that decides whether someone trusts Convite with a
 * community's data, so it is built to the same bar as the tool behind it.
 *
 * This is the site root (`/`). A cold visitor — an aid org, a funder — should meet what
 * Convite is and why to trust it before the live numbers, so the landing is the front door
 * and the aggregate response lives one click in at `/respuesta`.
 *
 * Static marketing content — no database, no client JavaScript — so it prerenders cleanly and
 * arrives whole on a weak connection, the same bar the rest of the product holds to. That
 * also lets a harness render it without standing up Next.
 *
 * Same ethos as the rest of the product, and the ethos is the design brief: no web fonts, no
 * images — it has to arrive whole over a weak connection. Colour is rationed to `selva` (the
 * primary) and `atrato`; everything else stays quiet `barro`. The one indulgence is register:
 * display headings are set in the system serif (`font-serif`, a Georgia-led stack that ships
 * with every device — zero bytes over the wire) because a humanitarian instrument should read
 * as a considered thing, not a startup landing page.
 */
export const dynamic = 'force-static'

const CANALES = [
  {
    icono: MessageSquare,
    titulo: 'WhatsApp',
    condicion: 'Donde hay datos',
    texto:
      'Lista de opciones, notas de voz, foto y ubicación. En la mayoría de los paquetes prepago del país, los mensajes de WhatsApp no consumen datos. Si no hay paquete activo, la llamada perdida siempre funciona.',
  },
  {
    icono: Smartphone,
    titulo: 'SMS con tarjeta impresa',
    condicion: 'Donde la señal es intermitente',
    texto:
      'Un código de dos dígitos en una tarjeta plastificada basta para reportar. Un solo mensaje, donde el WhatsApp ya no alcanza.',
  },
  {
    icono: PhoneMissed,
    titulo: 'Llamada perdida',
    condicion: 'Con cero saldo',
    texto:
      'La persona solo marca; el sistema devuelve la llamada. Sin saldo y con una raya de señal, se puede pedir ayuda. También sirve a quien no lee.',
  },
  {
    icono: Radio,
    titulo: 'Radio y papel',
    condicion: 'Donde no llega ninguna señal',
    texto:
      'Un relevo humano digita el reporte al llegar a cobertura. Lento, pero la comunidad queda existiendo en el sistema.',
  },
]

const PARA_QUIEN = [
  {
    icono: Users,
    titulo: 'Las comunidades del territorio',
    texto: 'Piden lo que necesitan por el canal que tengan. Sin costo, sin app y sin contraseña.',
  },
  {
    icono: Scale,
    titulo: 'Los equipos que coordinan',
    texto: 'Verifican lo que entra, priorizan bajo escasez y despachan la ayuda por el río.',
  },
  {
    icono: Building2,
    titulo: 'Organizaciones y donantes',
    texto: 'Se conectan a la coordinación que ya existe en el territorio, sin duplicarla.',
  },
]

function Enlaces({ compacto = false }: { compacto?: boolean }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <a
        href="/respuesta"
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-selva-700 px-5 py-3 font-medium text-white transition-colors hover:bg-selva-900 sm:w-auto"
      >
        Ver cómo va la respuesta
        <ArrowRight className="size-4" aria-hidden />
      </a>
      {!compacto && (
        <a
          href="/entrar"
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-barro-300 bg-white px-5 py-3 font-medium text-barro-800 transition-colors hover:border-barro-400 hover:bg-barro-50 sm:w-auto"
        >
          Entrar al panel
        </a>
      )}
    </div>
  )
}

export default function Inicio() {
  return (
    <div className="min-h-dvh bg-barro-50">
      {/* Quiet top bar. One lockup, one link — the front door announces itself and gets out
          of the way. */}
      <header className="border-b border-barro-200/70">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4 sm:px-6">
          <Marca />
          <a
            href="/entrar"
            className="text-sm font-medium text-barro-600 underline underline-offset-4 hover:text-barro-900"
          >
            Entrar al panel
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 pb-20 sm:px-6">
        {/* Hero — the one line that carries the whole product. */}
        <section className="pt-14 sm:pt-20">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-selva-700">
            <span className="h-1.5 w-1.5 rounded-full bg-selva-600" aria-hidden />
            Ayuda humanitaria · Chocó y el Pacífico colombiano
          </p>
          <h1 className="mt-5 max-w-3xl font-serif text-[2.15rem] font-semibold leading-[1.08] tracking-[-0.015em] text-barro-900 sm:text-5xl md:text-[3.4rem]">
            Quien necesita ayuda nunca paga por pedirla.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-barro-700 sm:text-xl">
            En el Chocó y el Pacífico colombiano, las comunidades reportan lo que necesitan por
            el canal que tengan a la mano. Una persona verifica cada reporte, y la ayuda se
            despacha por río y por carretera hasta que llega.
          </p>
          <div className="mt-8">
            <Enlaces />
          </div>
          <p className="mt-6 text-sm text-barro-500">
            Sin app que instalar <span className="text-barro-300">·</span> sin contraseña que
            recordar <span className="text-barro-300">·</span> sin costo para quien pide.
          </p>
        </section>

        {/* The insight, stated as a choice — no card, so it reads as the thesis, not a feature. */}
        <section className="mt-20 max-w-2xl sm:mt-28">
          <p className="text-xl leading-relaxed text-barro-800 sm:text-2xl">
            Un sistema que exige internet continuo solo atiende a quien ya tiene alternativas.
          </p>
          <p className="mt-4 text-barro-600">
            Buena parte del territorio opera con conectividad nula o intermitente. Si la única
            forma de pedir ayuda es una app que consume datos, la gente que más la necesita
            queda por fuera. Convite se construye al revés: primero el canal más frágil.
          </p>
        </section>

        {/* The multichannel model — the centerpiece. A ladder of falling connectivity, one
            report at the bottom. This is the part the humanitarian cluster will recognise. */}
        <section className="mt-20 sm:mt-28" aria-labelledby="canales">
          <h2
            id="canales"
            className="font-serif text-3xl font-semibold tracking-[-0.01em] text-barro-900 sm:text-4xl"
          >
            Pedir ayuda no puede costar saldo.
          </h2>
          <p className="mt-4 max-w-2xl text-barro-700">
            El canal se adapta a la señal, no al revés. A medida que la conectividad baja, el
            medio cambia — pero todo entra al mismo registro, con un campo que dice por dónde
            llegó.
          </p>

          <ol className="relative mt-10 max-w-2xl">
            {/* The spine. Nodes sit on top of it with a paper fill, so it reads as one line
                threading four rungs. */}
            <span
              className="absolute left-[21px] top-6 bottom-6 w-px bg-barro-200"
              aria-hidden
            />
            {CANALES.map((c) => {
              const Icono = c.icono
              return (
                <li key={c.titulo} className="relative flex gap-4 pb-8 last:pb-0">
                  <span className="relative z-10 flex size-11 shrink-0 items-center justify-center rounded-full border border-barro-200 bg-barro-50 text-selva-700">
                    <Icono className="size-5" aria-hidden />
                  </span>
                  <div className="flex-1 pt-1">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h3 className="font-semibold text-barro-900">{c.titulo}</h3>
                      <span className="rounded-full bg-barro-100 px-2.5 py-0.5 text-xs font-medium text-barro-600">
                        {c.condicion}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-barro-600">{c.texto}</p>
                  </div>
                </li>
              )
            })}
          </ol>

          <p className="mt-8 max-w-2xl border-l-2 border-selva-200 pl-4 text-barro-700">
            Un código marcado por SMS y una opción elegida en WhatsApp generan el mismo reporte.
            El canal se adapta a la señal; el registro es uno solo.
          </p>
        </section>

        {/* The Waze half — reporting damage is not asking for aid. */}
        <section className="mt-20 sm:mt-28">
          <div className="rounded-xl border border-barro-200 bg-white p-6 sm:p-8">
            <h2 className="flex items-center gap-2.5 font-serif text-2xl font-semibold tracking-[-0.01em] text-barro-900">
              <Route className="size-6 shrink-0 text-selva-700" aria-hidden />
              Reportar un daño no es pedir ayuda
            </h2>
            <p className="mt-3 max-w-2xl text-barro-700">
              La misma red reporta vías bloqueadas, puentes caídos y pasos de río dañados. Un
              daño verificado desactiva ese tramo, y el sistema deja de proponer envíos por un
              camino que ya no existe. Nadie planea un viaje imposible ni se entera al llegar.
            </p>
          </div>
        </section>

        {/* Trust — the part that decides whether an organisation hands over a community's data.
            The privacy posture gets the one tinted panel; the other two guarantees stay open. */}
        <section className="mt-20 sm:mt-28" aria-labelledby="confianza">
          <h2
            id="confianza"
            className="font-serif text-3xl font-semibold tracking-[-0.01em] text-barro-900 sm:text-4xl"
          >
            Construido para que se pueda confiar.
          </h2>

          <div className="mt-8 rounded-xl border border-selva-100 bg-selva-50 p-6 sm:p-8">
            <h3 className="flex items-center gap-2.5 text-lg font-semibold text-barro-900">
              <ShieldCheck className="size-6 shrink-0 text-selva-700" aria-hidden />
              Mostramos poco a propósito
            </h3>
            <p className="mt-3 max-w-2xl text-barro-800">
              La página pública dice cuántas solicitudes hay en espera y de qué tipo. No dice
              nombres de comunidades, ni ubicaciones, ni teléfonos, y agrupa las zonas para que
              ninguna cifra hable de un solo pueblo.
            </p>
            <p className="mt-3 max-w-2xl text-barro-800">
              Saber qué vereda se quedó sin comida y no tiene cómo salir es información que puede
              usarse en contra de quien vive ahí. En un territorio con presencia de actores
              armados, mostrar de menos es una medida de protección, no una falla.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-2">
            <div>
              <h3 className="flex items-center gap-2.5 text-lg font-semibold text-barro-900">
                <Scale className="size-5 shrink-0 text-selva-700" aria-hidden />
                Las decisiones las toma una persona
              </h3>
              <p className="mt-2 text-barro-700">
                El sistema hace la aritmética: calcula qué cabe en un envío y con qué costo, y lo
                presenta como propuesta. Bajo escasez, quién espera y quién no lo decide una
                persona con su nombre en la decisión. «El sistema lo decidió» no es una respuesta
                que alguien pueda controvertir.
              </p>
            </div>
            <div>
              <h3 className="flex items-center gap-2.5 text-lg font-semibold text-barro-900">
                <Building2 className="size-5 shrink-0 text-selva-700" aria-hidden />
                Se conecta a lo que ya existe
              </h3>
              <p className="mt-2 text-barro-700">
                Las comunidades no instalan nada; las organizaciones no cambian su forma de
                trabajar. Convite se enchufa a la coordinación que ya opera en el territorio y la
                hace legible, en vez de pedirle a todos que empiecen de cero.
              </p>
            </div>
          </div>
        </section>

        {/* Who it's for. */}
        <section className="mt-20 sm:mt-28" aria-labelledby="quien">
          <h2 id="quien" className="text-sm font-semibold uppercase tracking-[0.12em] text-barro-500">
            Para quién es
          </h2>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {PARA_QUIEN.map((q) => {
              const Icono = q.icono
              return (
                <div
                  key={q.titulo}
                  className="rounded-xl border border-barro-200 bg-white p-5"
                >
                  <Icono className="size-5 text-selva-700" aria-hidden />
                  <h3 className="mt-3 font-semibold text-barro-900">{q.titulo}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-barro-700">{q.texto}</p>
                </div>
              )
            })}
          </div>
        </section>

        {/* Close. */}
        <section className="mt-20 border-t border-barro-200 pt-12 sm:mt-28">
          <p className="max-w-2xl font-serif text-2xl leading-snug tracking-[-0.01em] text-barro-900 sm:text-3xl">
            Una necesidad reportada, verificada por una persona y atendida por el río — sin que
            pedir ayuda cueste saldo, y sin publicar nada que ponga en riesgo a quien la pide.
          </p>
          <div className="mt-8">
            <Enlaces />
          </div>
        </section>
      </main>

      <footer className="border-t border-barro-200">
        <div className="mx-auto flex max-w-4xl flex-col gap-3 px-5 py-8 text-sm text-barro-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Marca />
          <nav className="flex flex-wrap gap-x-4 gap-y-1">
            <a href="/privacidad" className="hover:text-barro-700 hover:underline">
              Privacidad
            </a>
            <a href="/terminos" className="hover:text-barro-700 hover:underline">
              Términos
            </a>
            <a href="/eliminar-datos" className="hover:text-barro-700 hover:underline">
              Eliminar mis datos
            </a>
          </nav>
          <p>Chocó y el Pacífico colombiano.</p>
        </div>
      </footer>
    </div>
  )
}
