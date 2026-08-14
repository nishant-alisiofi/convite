import {
  Waves,
  MessageSquare,
  Phone,
  PhoneMissed,
  Radio,
  Route,
  ShieldCheck,
  UserCheck,
  Users,
  ArrowRight,
} from 'lucide-react'

/**
 * The front door. What Convite is and why it works the way it does, for the people who arrive
 * before they have a login: partner organisations, the humanitarian cluster, funders, and
 * anyone deciding whether to trust it with a community's data.
 *
 * Static marketing content — no database, no client JavaScript — so it prerenders cleanly and
 * arrives whole on a weak connection, the same bar the rest of the product holds to. Same
 * rationed palette as the public page: `selva` (green) and `atrato` (ochre) carry meaning,
 * everything else stays quiet `barro`.
 *
 * First cut by engineering while the design studio was rate-limited; the intended owner of the
 * final pass, and of the question of whether this should be the site root, is Dante.
 */
export const dynamic = 'force-static'

const CANALES = [
  {
    icono: MessageSquare,
    titulo: 'WhatsApp',
    cuerpo:
      'Donde hay datos. Lista de opciones, notas de voz, foto y ubicación. En los planes prepago del país no consume saldo.',
  },
  {
    icono: Phone,
    titulo: 'SMS con tarjeta impresa',
    cuerpo:
      'Donde la señal es intermitente y el saldo escaso. Un código de dos dígitos en una tarjeta plastificada basta para reportar.',
  },
  {
    icono: PhoneMissed,
    titulo: 'Llamada perdida (IVR)',
    cuerpo:
      'Con cero saldo y un teléfono básico. La persona marca y cuelga, el sistema devuelve la llamada. También sirve a quien no lee.',
  },
  {
    icono: Radio,
    titulo: 'Radio y papel',
    cuerpo:
      'Donde no llega ninguna señal. Un relevo humano digita el reporte al llegar a cobertura. Lento, pero la comunidad existe en el sistema.',
  },
]

export default function Acerca() {
  return (
    <main className="mx-auto max-w-4xl px-5 py-10 sm:px-6 sm:py-14">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-barro-900">
          <Waves className="h-6 w-6 text-selva-700" aria-hidden />
          <span className="text-2xl font-semibold tracking-tight">Convite</span>
        </div>
        <a
          href="/"
          className="text-sm font-medium text-selva-700 underline underline-offset-2 hover:text-selva-900"
        >
          Ver la respuesta
        </a>
      </header>

      {/* Hero — the one sentence that carries the whole thing. */}
      <section className="mt-10 sm:mt-14">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-barro-900 sm:text-4xl">
          Quien necesita ayuda nunca paga por pedirla.
        </h1>
        <p className="mt-4 max-w-prose text-lg leading-relaxed text-barro-700">
          Convite coordina la ayuda humanitaria en la cuenca del Atrato, en el Chocó. Las
          comunidades reportan lo que necesitan por el canal que tengan a la mano; el equipo
          verifica cada reporte y organiza los envíos por río y por carretera.
        </p>
      </section>

      {/* The problem, stated plainly. */}
      <section className="mt-12 rounded-xl border border-barro-200 bg-white p-5 sm:p-6">
        <h2 className="font-semibold text-barro-900">El problema</h2>
        <p className="mt-2 max-w-prose text-barro-700">
          Un sistema que exige internet continuo solo atiende a quien ya tiene alternativas.
          Buena parte del territorio opera con conectividad nula o intermitente. Si la única
          forma de pedir ayuda es una app que consume datos, la gente que más la necesita queda
          por fuera. Convite se construye al revés: primero el canal más frágil.
        </p>
      </section>

      {/* How it works — the tiered channels. Cards reflow to one column on a phone. */}
      <section className="mt-12" aria-labelledby="como">
        <h2 id="como" className="text-xl font-semibold tracking-tight text-barro-900">
          Cómo funciona
        </h2>
        <p className="mt-2 max-w-prose text-barro-700">
          Cada comunidad se clasifica por su nivel de conectividad, y el canal se adapta a esa
          realidad. Todo entra a un mismo registro, con un campo que dice por dónde llegó. Un
          código marcado por SMS y una opción elegida en WhatsApp generan el mismo reporte.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {CANALES.map((c) => {
            const Icono = c.icono
            return (
              <div
                key={c.titulo}
                className="rounded-xl border border-barro-200 bg-white px-5 py-4"
              >
                <div className="flex items-center gap-2.5">
                  <Icono className="size-5 shrink-0 text-selva-700" aria-hidden />
                  <h3 className="font-semibold text-barro-900">{c.titulo}</h3>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-barro-700">{c.cuerpo}</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* The Waze half — reporting damage is not asking for aid. */}
      <section className="mt-12 rounded-xl border border-barro-200 bg-white p-5 sm:p-6">
        <h2 className="flex items-center gap-2 font-semibold text-barro-900">
          <Route className="size-5 shrink-0 text-selva-700" aria-hidden />
          Reportar un daño no es pedir ayuda
        </h2>
        <p className="mt-2 max-w-prose text-barro-700">
          La misma red reporta vías bloqueadas, puentes caídos y pasos de río dañados. Un daño
          verificado desactiva ese tramo, y el sistema deja de proponer envíos por un camino que
          ya no existe. Nadie planea un viaje imposible ni se entera al llegar.
        </p>
      </section>

      {/* Trust — the restraint is the feature. */}
      <section className="mt-12 rounded-xl border border-selva-100 bg-selva-50 p-5 sm:p-6">
        <h2 className="flex items-center gap-2 font-semibold text-barro-900">
          <ShieldCheck className="size-5 shrink-0 text-selva-700" aria-hidden />
          Por qué mostramos tan poco en público
        </h2>
        <p className="mt-2 max-w-prose text-barro-700">
          Esta es una zona con presencia de actores armados. Saber qué vereda se quedó sin
          comida y no tiene cómo salir es información que puede usarse en contra de quien vive
          ahí. La página pública solo muestra conteos agrupados: nunca un nombre de comunidad,
          una ubicación ni un teléfono. Lo demás vive detrás de una sesión, y cada quien ve solo
          lo que su función necesita.
        </p>
      </section>

      {/* Human judgment. */}
      <section className="mt-12 rounded-xl border border-barro-200 bg-white p-5 sm:p-6">
        <h2 className="flex items-center gap-2 font-semibold text-barro-900">
          <UserCheck className="size-5 shrink-0 text-selva-700" aria-hidden />
          Las decisiones las toma una persona
        </h2>
        <p className="mt-2 max-w-prose text-barro-700">
          El sistema hace la aritmética: calcula qué cabe en un envío y con qué costo, y lo
          presenta como propuesta. Bajo escasez, quién espera y quién no lo decide una persona
          que conoce el territorio, con su nombre en la decisión. «El sistema lo decidió» no es
          una respuesta que alguien pueda controvertir.
        </p>
      </section>

      {/* Who it's for. */}
      <section className="mt-12" aria-labelledby="para-quien">
        <h2
          id="para-quien"
          className="flex items-center gap-2 text-xl font-semibold tracking-tight text-barro-900"
        >
          <Users className="size-5 shrink-0 text-selva-700" aria-hidden />
          Para quién es
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-barro-200 bg-white px-5 py-4">
            <h3 className="font-semibold text-barro-900">Las comunidades</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-barro-700">
              Reportan lo que necesitan por el canal que tengan, sin costo y sin instalar nada.
            </p>
          </div>
          <div className="rounded-xl border border-barro-200 bg-white px-5 py-4">
            <h3 className="font-semibold text-barro-900">Quien coordina</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-barro-700">
              Verifica, prioriza y despacha, con roles separados y cada acción a su nombre.
            </p>
          </div>
          <div className="rounded-xl border border-barro-200 bg-white px-5 py-4">
            <h3 className="font-semibold text-barro-900">Las organizaciones aliadas</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-barro-700">
              Se conectan a la coordinación que ya existe en el territorio, sin duplicarla.
            </p>
          </div>
        </div>
      </section>

      <footer className="mt-14 border-t border-barro-200 pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 font-medium text-selva-700 underline underline-offset-2 hover:text-selva-900"
          >
            Ver cómo va la respuesta
            <ArrowRight className="size-4" aria-hidden />
          </a>
          <a
            href="/entrar"
            className="text-sm font-medium text-barro-600 underline underline-offset-2 hover:text-barro-900"
          >
            ¿Trabaja en la respuesta? Entrar al panel
          </a>
        </div>
      </footer>
    </main>
  )
}
