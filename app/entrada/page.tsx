import { ArrowRight, Building2, HeartHandshake, MessageSquare, Truck } from 'lucide-react'
import Link from 'next/link'

/**
 * «¿Qué quiere hacer?» — the entry that routes by intention (docs/tipos-de-usuario-y-accesos.md §1).
 *
 * The governing principle of that document is that **auth friction scales with power and with
 * access to sensitive data**: somebody who only reports or only gives sees nothing sensitive and
 * should meet no wall at all, while somebody who sees phone numbers, locations and health details
 * — or decides who waits — authenticates properly and is approved. A single login screen gets
 * this exactly backwards. It puts the heaviest door in front of the lightest user, and the four
 * people this product serves are not four kinds of staff.
 *
 * So the four intentions are four doors, and the friction differs on purpose:
 *
 *   Reportar        no account, ever. The channels are the product (2.10: a number lives on the
 *                   report, it never opens a panel).
 *   Donar           minimal — name and a number when offering. Not built yet; shown, not hidden.
 *   Entregar        light: possession proof, and detail only within the delivery window.
 *   Operar un centro  full: invited, approved, and only then sensitive data inside one org.
 *
 * Unbuilt doors are shown rather than omitted, the same way the nav greys «en construcción»
 * items: the shape of the product should be legible before all of it exists, and a door that is
 * missing entirely teaches somebody they are not welcome.
 */

export const dynamic = 'force-static'

type Puerta = {
  titulo: string
  quien: string
  friccion: string
  Icono: typeof MessageSquare
  href: string | null
  cta: string
}

const PUERTAS: Puerta[] = [
  {
    titulo: 'Reportar qué hace falta',
    quien: 'Vivo en la comunidad y necesito avisar algo.',
    friccion: 'Sin cuenta y sin app. Por WhatsApp, mensaje de texto o llamada perdida.',
    Icono: MessageSquare,
    href: '/respuesta',
    cta: 'Cómo avisar',
  },
  {
    titulo: 'Quiero donar',
    quien: 'Tengo algo para aportar: mercados, materiales, dinero.',
    friccion: 'Un nombre y un número. Nada más.',
    Icono: HeartHandshake,
    href: null,
    cta: 'En construcción',
  },
  {
    titulo: 'Puedo transportar',
    quien: 'Tengo lancha, chalupa o vehículo y puedo mover carga o gente.',
    friccion: 'Se confirma su número. Ve solo su viaje, y solo cuando le toca.',
    Icono: Truck,
    href: '/transportar',
    cta: 'Ofrecer capacidad',
  },
  {
    titulo: 'Operamos un centro',
    quien: 'Somos una organización que recibe, verifica y despacha ayuda.',
    friccion: 'Se aprueba la organización antes de operar. Aquí sí hay datos de hogares.',
    Icono: Building2,
    href: '/solicitar-centro',
    cta: 'Pedir acceso',
  },
]

export default function Entrada() {
  return (
    <main className="min-h-dvh bg-barro-50 px-5 py-12 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm font-medium text-selva-700">Convite</p>
        <h1 className="mt-1 text-2xl font-semibold text-barro-900">¿Qué quiere hacer?</h1>
        <p className="mt-3 max-w-prose text-barro-700">
          No todo el mundo entra por la misma puerta. Reportar no necesita cuenta; operar un centro
          sí, porque ahí se ven teléfonos y ubicaciones de familias.
        </p>

        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {PUERTAS.map(({ titulo, quien, friccion, Icono, href, cta }) => {
            const cuerpo = (
              <>
                <span className="flex items-center gap-2 text-base font-medium text-barro-900">
                  <Icono className="h-5 w-5 shrink-0 text-selva-700" aria-hidden />
                  {titulo}
                </span>
                <span className="mt-2 block text-sm text-barro-700">{quien}</span>
                <span className="mt-2 block text-xs text-barro-500">{friccion}</span>
                <span
                  className={`mt-3 inline-flex items-center gap-1 text-sm font-medium ${
                    href ? 'text-selva-700' : 'text-barro-400'
                  }`}
                >
                  {cta}
                  {href && <ArrowRight className="h-4 w-4" aria-hidden />}
                </span>
              </>
            )
            return (
              <li key={titulo}>
                {href ? (
                  <Link
                    href={href}
                    className="block h-full rounded-xl border border-barro-200 bg-white p-5 hover:border-selva-200"
                  >
                    {cuerpo}
                  </Link>
                ) : (
                  // Not a link and not hidden. Somebody who wants to give should see that the
                  // door exists and is not yet open, rather than conclude there is no door.
                  <div className="h-full rounded-xl border border-dashed border-barro-300 bg-barro-100/60 p-5">
                    {cuerpo}
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        <p className="mt-8 text-sm text-barro-600">
          ¿Ya trabaja en un centro?{' '}
          <Link href="/entrar" className="text-selva-700 underline">
            Entrar
          </Link>
          .
        </p>
      </div>
    </main>
  )
}
