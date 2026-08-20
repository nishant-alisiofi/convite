import { CalendarDays, ShieldCheck } from 'lucide-react'
import { redirect } from 'next/navigation'
import { misMembresiasActivas } from '@/lib/agenda-ics/suscripcion'
import { urlDeSuscripcion } from '@/lib/agenda-ics/token'
import { conSesion, sesionActual } from '@/lib/sesion'
import CopiarEnlace from './copiar-enlace'

export const dynamic = 'force-dynamic'

/**
 * PRD-34 §28.1 — the .ics subscribe link, surfaced.
 *
 * The feed (`app/api/agenda/[token]/route.ts`) and its token (`lib/agenda-ics/token.ts`) have
 * existed since PRD-34's first slice; nothing here changes what the feed shows or how the token
 * is checked. This screen is the missing half a Codex review caught (aa02969: «UI exposes no
 * subscription link») — a place a signed-in person finds their own link and pastes it into a
 * calendar app.
 *
 * One row per ACTIVE membership (§29.5 — a person may hold more than one, e.g. across two
 * organisations): each URL only ever unlocks that membership's own feed. No role gate on this
 * page itself — it shows exactly the memberships RLS (`membresias_propias`, 0047) already
 * scopes to this person, nothing more, so there is nothing here for a role check to protect.
 */
const ROL_ETIQUETA: Record<string, string> = {
  coordinador: 'Coordinador',
  verificador: 'Verificador',
  despachador: 'Despachador',
  lectura: 'Lectura',
  admin: 'Admin',
}

export default async function Agenda() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const membresias = await conSesion(sesion, (client) =>
    misMembresiasActivas(client, sesion.authId),
  )

  return (
    <main>
      <h1 className="flex items-center gap-2 text-xl font-semibold text-barro-900">
        <CalendarDays className="size-5" aria-hidden />
        Agenda
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-barro-700">
        Suscríbase con este enlace desde Google Calendar, Apple Calendar o cualquier app que
        acepte «agregar calendario por URL», y sus jornadas y envíos aparecen ahí, siempre al
        día, sin volver a entrar a Convite.
      </p>

      {membresias.length === 0 ? (
        <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
          No tiene una membresía activa todavía, así que no hay un enlace que mostrarle.
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {membresias.map((m) => {
            const enlace = urlDeSuscripcion(m.id)
            return (
              <li key={m.id} className="rounded-lg border border-barro-200 bg-white p-4">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-barro-900">
                    {m.organizacionNombre ?? 'Su organización'}
                  </span>
                  <span className="text-sm text-barro-600">{ROL_ETIQUETA[m.rol] ?? m.rol}</span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    readOnly
                    value={enlace}
                    className="min-w-0 flex-1 rounded border border-barro-200 bg-barro-50 px-2 py-1.5 text-sm text-barro-800"
                  />
                  <CopiarEnlace valor={enlace} />
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-8 flex items-start gap-2 text-sm text-barro-600">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        Este enlace es un secreto — cualquiera que lo tenga ve sus jornadas y envíos. Nunca lo
        comparta por un canal público. Los títulos muestran solo el folio y el tipo, nunca un
        nombre ni un motivo, y el enlace deja de funcionar solo si su membresía se suspende o se
        da de baja.
      </p>
    </main>
  )
}
