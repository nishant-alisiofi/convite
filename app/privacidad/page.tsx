import Link from 'next/link'

/**
 * Política de Privacidad y Tratamiento de Datos — public, no session.
 *
 * Two audiences at once, and it has to satisfy both:
 *   1. Colombia's Ley 1581 de 2012 (habeas data) — Convite handles sensitive PII (phone numbers,
 *      reports about vulnerable households, locations). A política de tratamiento is a legal
 *      requirement before the pilot touches real people, not a formality.
 *   2. Meta's WhatsApp Business Platform review — a public, current privacy policy that discloses
 *      what data is collected, how it is used and shared (including with Meta/WhatsApp as a
 *      processor), and a specific path for a person to request deletion of their data.
 *
 * Entity details marked «[por confirmar]» need the founder's / legal review before the pilot.
 * This document must be reviewed by counsel (agent `lex`) before Convite processes real PII.
 */

export const metadata = {
  title: 'Política de Privacidad — Convite',
  description:
    'Cómo Convite recolecta, usa y protege los datos personales, conforme a la Ley 1581 de 2012 (habeas data) de Colombia.',
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

export default function Privacidad() {
  return (
    <div className="min-h-screen bg-barro-50">
      <main className="mx-auto max-w-3xl px-5 py-14 sm:px-6 sm:py-20">
        <Link href="/" className="text-sm text-selva-700 hover:underline">
          ← Convite
        </Link>

        <h1 className="mt-6 font-serif text-3xl font-semibold tracking-[-0.01em] text-barro-900 sm:text-4xl">
          Política de Privacidad y Tratamiento de Datos Personales
        </h1>
        <p className="mt-3 text-sm text-barro-500">Última actualización: {ACTUALIZADO}</p>

        <p className="mt-6 text-barro-700">
          Convite es una plataforma de coordinación de ayuda humanitaria para el Chocó y el
          Pacífico colombiano. Esta política explica qué datos personales tratamos, con qué fin,
          cómo los protegemos y cómo usted puede ejercer sus derechos, conforme a la{' '}
          <strong>Ley 1581 de 2012</strong> y el Decreto 1377 de 2013 (régimen de protección de
          datos personales — <em>habeas data</em>) de Colombia.
        </p>

        <Seccion titulo="1. Quién trata sus datos">
          <p>
            La plataforma Convite es operada por <strong>Alisio</strong> (alisiofi.com) [razón
            social y NIT por confirmar]. En el modelo de Convite, cada{' '}
            <strong>organización aliada</strong> que coordina ayuda en el territorio (por ejemplo,
            en el plan piloto, ASOREDIPARCHOCÓ y la Fundación Herencia de Timbiquí) es la{' '}
            <strong>responsable del tratamiento</strong> de los datos de su comunidad, y Alisio
            actúa como <strong>encargado del tratamiento</strong>, procesando los datos únicamente
            siguiendo las instrucciones de la organización responsable y esta política.
          </p>
        </Seccion>

        <Seccion titulo="2. Qué datos recolectamos">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Número de teléfono</strong> de quien reporta o de una persona de contacto en
              la comunidad.
            </li>
            <li>
              <strong>Contenido de los reportes</strong> que llegan por WhatsApp, SMS, llamada
              perdida con devolución (incluyendo grabaciones de voz) y radio: qué se necesita, para
              cuántas familias, y notas.
            </li>
            <li>
              <strong>Ubicación y comunidad</strong> asociadas a un reporte o a un envío.
            </li>
            <li>
              <strong>Datos de hogares y beneficiarios</strong> necesarios para coordinar la
              entrega de ayuda.
            </li>
            <li>
              <strong>Datos de cuentas del personal</strong> de las organizaciones (correo o
              teléfono, rol) para el acceso al panel.
            </li>
          </ul>
          <p>
            Parte de esta información puede constituir <strong>datos sensibles</strong> (por
            ejemplo, datos que revelan la situación de vulnerabilidad de una persona o comunidad).
            Su tratamiento es facultativo y se realiza con autorización y con medidas reforzadas de
            seguridad.
          </p>
        </Seccion>

        <Seccion titulo="3. Para qué usamos los datos (finalidad)">
          <p>
            Usamos los datos <strong>exclusivamente</strong> para coordinar ayuda humanitaria:
            recibir y verificar reportes, planear y despachar envíos y traslados, gestionar
            existencias y compras locales, y mantener el registro de comunidades. No usamos los
            datos con fines publicitarios ni los vendemos.
          </p>
        </Seccion>

        <Seccion titulo="4. Con quién se comparten">
          <p>
            Los datos se comparten únicamente con quienes son necesarios para prestar el servicio,
            bajo acuerdos de tratamiento de datos:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Meta Platforms / WhatsApp</strong>, como <em>procesador</em>, para entregar y
              recibir mensajes a través de la WhatsApp Business Platform (Cloud API).
            </li>
            <li>
              <strong>Infobip</strong>, como <em>procesador</em>, para los canales de voz (llamada
              perdida con devolución) y SMS, cuando estén activos.
            </li>
            <li>
              <strong>Proveedores de infraestructura</strong> (alojamiento y base de datos) que
              procesan datos por cuenta nuestra.
            </li>
          </ul>
          <p>
            Dentro de la plataforma, el acceso está restringido por rol y por organización
            (seguridad a nivel de fila). La información de direcciones y de identificación de
            hogares sólo es visible para los roles expresamente autorizados; la página pública
            nunca muestra nombres de comunidades, teléfonos ni ubicaciones, y agrupa las cifras
            para que ninguna hable de un solo pueblo.
          </p>
        </Seccion>

        <Seccion titulo="5. Uso de WhatsApp">
          <p>
            Cuando usted escribe al número de WhatsApp de Convite, o cuando le respondemos,
            el mensaje se transmite cifrado entre usted y la Cloud API mediante el protocolo Signal;
            Meta administra las llaves de cifrado por cuenta de la organización. Meta actúa como{' '}
            <strong>procesador</strong> y conserva los mensajes por un máximo de{' '}
            <strong>30 días</strong> del lado de su plataforma. Meta{' '}
            <strong>no utiliza</strong> el contenido de estos mensajes para la publicidad que una
            persona ve. La organización aliada permanece como responsable del tratamiento bajo la
            ley colombiana.
          </p>
        </Seccion>

        <Seccion titulo="6. Cuánto tiempo conservamos los datos">
          <p>
            Conservamos los datos mientras sean necesarios para la finalidad de coordinación y
            para cumplir obligaciones legales de la organización responsable. Cuando ya no sean
            necesarios, se eliminan o anonimizan. Usted puede solicitar su eliminación en cualquier
            momento (ver sección 8).
          </p>
        </Seccion>

        <Seccion titulo="7. Sus derechos (habeas data)">
          <p>Conforme a la Ley 1581 de 2012, usted tiene derecho a:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Conocer, actualizar y rectificar sus datos personales.</li>
            <li>Solicitar prueba de la autorización otorgada.</li>
            <li>Ser informado sobre el uso que se ha dado a sus datos.</li>
            <li>Presentar quejas ante la Superintendencia de Industria y Comercio (SIC).</li>
            <li>Revocar la autorización y/o solicitar la supresión de sus datos.</li>
            <li>Acceder de forma gratuita a sus datos personales.</li>
          </ul>
        </Seccion>

        <Seccion titulo="8. Cómo eliminar sus datos">
          <p>
            Usted puede pedir que borremos sus datos en cualquier momento. Explicamos qué se
            elimina y en qué plazo en la página{' '}
            <Link href="/eliminar-datos" className="text-selva-700 underline">
              Eliminar mis datos
            </Link>
            . En resumen: escriba <strong>BORRAR</strong> al número de WhatsApp de Convite, o
            escríbanos a <strong>privacidad@alisiofi.com</strong>; confirmamos su solicitud y
            eliminamos sus datos dentro de los 30 días siguientes.
          </p>
        </Seccion>

        <Seccion titulo="9. Seguridad">
          <p>
            Aplicamos medidas técnicas y organizativas para proteger los datos: control de acceso
            por rol y por organización, cifrado en tránsito, y minimización de lo que se muestra.
            En un territorio con presencia de actores armados, mostrar de menos es una medida de
            protección deliberada.
          </p>
        </Seccion>

        <Seccion titulo="10. Menores y poblaciones vulnerables">
          <p>
            Convite trata datos de coordinación de ayuda que pueden referirse a familias con niñas,
            niños y adolescentes. El tratamiento se realiza en su interés superior y bajo la
            responsabilidad de la organización aliada, con las medidas reforzadas que la ley exige.
          </p>
        </Seccion>

        <Seccion titulo="11. Cambios a esta política">
          <p>
            Podemos actualizar esta política. Publicaremos la versión vigente en esta página con su
            fecha de actualización.
          </p>
        </Seccion>

        <Seccion titulo="12. Contacto">
          <p>
            Para ejercer sus derechos o resolver dudas sobre el tratamiento de sus datos, escriba a{' '}
            <strong>privacidad@alisiofi.com</strong>. La organización responsable del tratamiento
            de los datos de su comunidad es la organización aliada con la que usted se relaciona; el
            encargado de la plataforma es Alisio.
          </p>
        </Seccion>

        <p className="mt-12 border-t border-barro-200 pt-6 text-sm text-barro-500">
          Convite — Chocó y el Pacífico colombiano.{' '}
          <Link href="/terminos" className="text-selva-700 hover:underline">
            Términos de servicio
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
