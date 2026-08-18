import Link from 'next/link'

/**
 * Instrucciones para eliminar datos — public, no session.
 *
 * This is the URL Meta wants in App Dashboard → Settings → Basic → "Data Deletion Instructions
 * URL". Meta's bar: "Email us to delete your data" is NOT enough — it must state WHAT data is
 * held, WHAT gets deleted, and a TIMEFRAME, in the app's language, and the privacy policy must
 * point to it. This page does that. Entity/contact details need legal review (agent `lex`).
 */

export const metadata = {
  title: 'Eliminar mis datos — Convite',
  description:
    'Cómo solicitar la eliminación de sus datos personales en Convite: qué se elimina y en qué plazo.',
}

const ACTUALIZADO = '18 de agosto de 2026'

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-serif text-2xl font-semibold tracking-[-0.01em] text-barro-900">
        {titulo}
      </h2>
      <div className="mt-3 space-y-3 text-barro-700">{children}</div>
    </section>
  )
}

export default function EliminarDatos() {
  return (
    <div className="min-h-screen bg-barro-50">
      <main className="mx-auto max-w-3xl px-5 py-14 sm:px-6 sm:py-20">
        <Link href="/" className="text-sm text-selva-700 hover:underline">
          ← Convite
        </Link>

        <h1 className="mt-6 font-serif text-3xl font-semibold tracking-[-0.01em] text-barro-900 sm:text-4xl">
          Eliminar mis datos
        </h1>
        <p className="mt-3 text-sm text-barro-500">Última actualización: {ACTUALIZADO}</p>

        <p className="mt-6 text-barro-700">
          Usted puede pedir que Convite elimine sus datos personales en cualquier momento y sin
          costo. Esta página explica qué datos guardamos, qué se elimina y en cuánto tiempo,
          conforme a la Ley 1581 de 2012 de Colombia.
        </p>

        <Seccion titulo="Qué datos guardamos sobre usted">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Su número de teléfono.</li>
            <li>
              El contenido de los reportes que envió (por WhatsApp, SMS, llamada perdida o radio),
              incluyendo grabaciones de voz.
            </li>
            <li>La comunidad y la ubicación asociadas a esos reportes.</li>
            <li>Si es personal de una organización, los datos de su cuenta y su rol.</li>
          </ul>
        </Seccion>

        <Seccion titulo="Cómo solicitar la eliminación">
          <p>Puede hacerlo de dos maneras:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Por WhatsApp:</strong> escriba la palabra <strong>BORRAR</strong> al número de
              WhatsApp de Convite desde el mismo número con el que reportó.
            </li>
            <li>
              <strong>Por correo:</strong> escriba a <strong>privacidad@alisiofi.com</strong> desde
              su correo, o indicando el número de teléfono cuyos datos desea eliminar.
            </li>
          </ul>
        </Seccion>

        <Seccion titulo="Qué se elimina y en qué plazo">
          <p>
            Al recibir su solicitud, le enviamos una <strong>confirmación</strong> de que la
            recibimos. Eliminamos sus datos personales de nuestros sistemas dentro de los{' '}
            <strong>30 días siguientes</strong>: su número de teléfono, el contenido y las
            grabaciones de sus reportes, y los identificadores asociados. Podremos conservar, de
            forma anonimizada o agregada, información que ya no permita identificarlo, y aquella que
            la ley obligue a conservar a la organización responsable.
          </p>
          <p>
            En cuanto a WhatsApp: Meta conserva los mensajes por un máximo de{' '}
            <strong>30 días</strong> del lado de su plataforma; una vez eliminados por nosotros, no
            volvemos a tratarlos.
          </p>
        </Seccion>

        <Seccion titulo="Confirmación">
          <p>
            Cuando la eliminación esté completa, se lo confirmaremos por el mismo canal por el que
            hizo la solicitud. Si tiene dudas sobre el estado de su solicitud, escriba a{' '}
            <strong>privacidad@alisiofi.com</strong>.
          </p>
        </Seccion>

        <p className="mt-12 border-t border-barro-200 pt-6 text-sm text-barro-500">
          Convite — Chocó y el Pacífico colombiano.{' '}
          <Link href="/privacidad" className="text-selva-700 hover:underline">
            Política de privacidad
          </Link>{' '}
          ·{' '}
          <Link href="/terminos" className="text-selva-700 hover:underline">
            Términos de servicio
          </Link>
        </p>
      </main>
    </div>
  )
}
