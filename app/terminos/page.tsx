import Link from 'next/link'

/**
 * Términos de Servicio — public, no session.
 *
 * Meta's App Review asks for a Terms of Service URL alongside the privacy policy. This states
 * what Convite is, who may use it and how, the humanitarian (no-outcome-guarantee) nature of the
 * service, the compliance obligations that ride on top of WhatsApp Business, and the governing
 * law (Colombia). Entity details marked «[por confirmar]» need legal review (agent `lex`).
 */

export const metadata = {
  title: 'Términos de Servicio — Convite',
  description: 'Términos de uso de la plataforma de coordinación de ayuda humanitaria Convite.',
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

export default function Terminos() {
  return (
    <div className="min-h-screen bg-barro-50">
      <main className="mx-auto max-w-3xl px-5 py-14 sm:px-6 sm:py-20">
        <Link href="/" className="text-sm text-selva-700 hover:underline">
          ← Convite
        </Link>

        <h1 className="mt-6 font-serif text-3xl font-semibold tracking-[-0.01em] text-barro-900 sm:text-4xl">
          Términos de Servicio
        </h1>
        <p className="mt-3 text-sm text-barro-500">Última actualización: {ACTUALIZADO}</p>

        <p className="mt-6 text-barro-700">
          Estos términos regulan el uso de <strong>Convite</strong>, una plataforma de coordinación
          de ayuda humanitaria para el Chocó y el Pacífico colombiano, operada por{' '}
          <strong>Alisio</strong> (alisiofi.com) [razón social y NIT por confirmar]. Al usar la
          plataforma usted acepta estos términos.
        </p>

        <Seccion titulo="1. Qué es Convite">
          <p>
            Convite recibe reportes de necesidad y de daños desde comunidades por varios canales
            (WhatsApp, SMS, llamada perdida con devolución y radio), los verifica con una persona,
            y ayuda a las organizaciones aliadas a planear y coordinar la respuesta. Convite es una
            herramienta de coordinación: <strong>no</strong> es un servicio de emergencia y no
            garantiza la entrega de ayuda en un tiempo determinado.
          </p>
        </Seccion>

        <Seccion titulo="2. Quién puede usarlo y cómo">
          <p>
            El panel de coordinación es para el personal autorizado de las organizaciones aliadas.
            Los miembros de la comunidad interactúan únicamente por los canales de reporte y nunca
            necesitan una cuenta. Usted se compromete a usar Convite sólo para su finalidad
            humanitaria y a no usarlo para acosar, discriminar, ni poner en riesgo a ninguna
            persona o comunidad.
          </p>
        </Seccion>

        <Seccion titulo="3. Cuentas y acceso">
          <p>
            El acceso al panel se concede a quien demuestre posesión de un correo o número
            autorizado. El acceso a los datos está restringido por rol y por organización mediante
            seguridad a nivel de fila; usted es responsable de mantener la confidencialidad de su
            acceso y de la información que ve.
          </p>
        </Seccion>

        <Seccion titulo="4. Datos personales">
          <p>
            El tratamiento de datos personales se rige por nuestra{' '}
            <Link href="/privacidad" className="text-selva-700 underline">
              Política de Privacidad
            </Link>{' '}
            y por la Ley 1581 de 2012 de Colombia. Cada organización aliada es responsable del
            tratamiento de los datos de su comunidad; Alisio actúa como encargado.
          </p>
        </Seccion>

        <Seccion titulo="5. Uso de WhatsApp y otros canales">
          <p>
            La comunicación por WhatsApp se presta a través de la WhatsApp Business Platform y está
            sujeta también a las políticas de WhatsApp/Meta para empresas. Usted se compromete a que
            el uso de estos canales cumpla dichas políticas y la ley aplicable. Los canales de voz y
            SMS, cuando estén activos, se prestan a través de proveedores de telecomunicaciones.
          </p>
        </Seccion>

        <Seccion titulo="6. Disponibilidad y ausencia de garantías">
          <p>
            Convite se ofrece «tal cual», sin garantía de disponibilidad ininterrumpida ni de
            resultado. En la medida permitida por la ley, Alisio no será responsable por daños
            indirectos o derivados del uso o de la imposibilidad de uso de la plataforma. Nada en
            estos términos limita responsabilidades que no puedan limitarse conforme a la ley.
          </p>
        </Seccion>

        <Seccion titulo="7. Cambios">
          <p>
            Podemos actualizar estos términos. Publicaremos la versión vigente en esta página con su
            fecha de actualización.
          </p>
        </Seccion>

        <Seccion titulo="8. Ley aplicable">
          <p>
            Estos términos se rigen por las leyes de la República de Colombia. Cualquier
            controversia se someterá a los jueces competentes de Colombia.
          </p>
        </Seccion>

        <Seccion titulo="9. Contacto">
          <p>
            Para dudas sobre estos términos, escriba a <strong>privacidad@alisiofi.com</strong>.
          </p>
        </Seccion>

        <p className="mt-12 border-t border-barro-200 pt-6 text-sm text-barro-500">
          Convite — Chocó y el Pacífico colombiano.{' '}
          <Link href="/privacidad" className="text-selva-700 hover:underline">
            Política de privacidad
          </Link>{' '}
          ·{' '}
          <Link href="/eliminar-datos" className="text-selva-700 hover:underline">
            Eliminar mis datos
          </Link>
        </p>
      </main>
    </div>
  )
}
