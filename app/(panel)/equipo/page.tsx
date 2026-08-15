import { UserPlus, Users } from 'lucide-react'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { ROLES_TRABAJADOR, type RolTrabajador } from '@/db/schema/vocabulario'
import { aE164 } from '@/lib/canales'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * A centre admin's team (§2.4): invite and manage the workers of their own organisation.
 *
 * This is the per-org invitation, not the global CORREOS_STAFF bootstrap — a centre admin adds
 * their own verificadores, despachadores, coordinadores and readers, and the RLS policy
 * `invitaciones_admin` (0017) confines every write to `organizacion_id = convite_organizacion()`,
 * so an admin cannot reach into another centre. The escalation guard (0034) is the other half:
 * this UI only offers worker roles, and the database refuses a platform-tier invitation from
 * anyone who is not already platform.
 *
 * The invitation is an allowlist entry, not an account. The person still signs in through the
 * ordinary /entrar flow and proves they own the address or the number (§4).
 */

const ROL_ETIQUETA: Record<string, string> = {
  coordinador: 'Coordinador',
  verificador: 'Verificador',
  despachador: 'Despachador',
  lectura: 'Lectura',
  admin: 'Admin',
}

/** An address has an @; a number does not. Mirrors scripts/invitar.ts. */
function clasificar(valor: string): { correo: string | null; telefono: string | null } {
  const limpio = valor.trim()
  if (limpio.includes('@')) return { correo: limpio.toLowerCase(), telefono: null }
  const telefono = aE164(limpio)
  return /^\+[1-9][0-9]{7,14}$/.test(telefono) ? { correo: null, telefono } : { correo: null, telefono: null }
}

type MiembroFila = {
  id: string
  correo: string | null
  telefono: string | null
  rol_staff: string
  usado_en: Date | null
  usuario_id: string | null
  usuario_activo: boolean | null
}

function estadoDe(m: MiembroFila): { etiqueta: string; clase: string } {
  if (!m.usado_en) return { etiqueta: 'Invitado', clase: 'bg-atrato-50 text-barro-700' }
  if (m.usuario_activo) return { etiqueta: 'Activo', clase: 'bg-selva-50 text-selva-800' }
  return { etiqueta: 'Desactivado', clase: 'bg-barro-100 text-barro-600' }
}

export default async function Equipo({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>
}) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { ok, error } = await searchParams
  const puedeGestionar = sesion.rolStaff === 'admin' || sesion.esPlataforma

  if (!puedeGestionar) {
    return (
      <main>
        <h1 className="text-xl font-semibold text-barro-900">Equipo</h1>
        <p className="mt-4 max-w-2xl rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
          Solo el admin de su centro gestiona al equipo. Si necesita que agreguen o quiten a
          alguien, pídaselo.
        </p>
      </main>
    )
  }

  const miembros = await conSesion(sesion, async (client) => {
    const { rows } = await client.query<MiembroFila>(
      `select i.id, i.correo, i.telefono, i.rol_staff, i.usado_en, i.usuario_id,
              u.activo as usuario_activo
         from invitaciones_staff i
         left join usuarios u on u.id = i.usuario_id
        where i.organizacion_id = $1 and i.es_plataforma = false
        order by i.creado_en`,
      [sesion.organizacionId],
    )
    return rows
  })

  async function invitar(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || (sesion.rolStaff !== 'admin' && !sesion.esPlataforma)) {
      redirect('/equipo?error=permiso')
    }

    const rol = String(formData.get('rol') ?? '')
    if (!(ROLES_TRABAJADOR as readonly string[]).includes(rol)) redirect('/equipo?error=rol')

    const { correo, telefono } = clasificar(String(formData.get('contacto') ?? ''))
    if (!correo && !telefono) redirect('/equipo?error=contacto')

    try {
      await conSesion(
        sesion,
        (client) =>
          client.query(
            `insert into invitaciones_staff (correo, telefono, rol_staff, organizacion_id)
               values ($1, $2, $3, $4)`,
            [correo, telefono, rol, sesion.organizacionId],
          ),
        { escribe: true },
      )
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : ''
      if (mensaje.includes('invitaciones_correo_key') || mensaje.includes('invitaciones_telefono_key')) {
        redirect('/equipo?error=ya_invitado')
      }
      redirect('/equipo?error=general')
    }

    revalidatePath('/equipo')
    redirect('/equipo?ok=invitado')
  }

  async function cambiarActivo(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || (sesion.rolStaff !== 'admin' && !sesion.esPlataforma)) {
      redirect('/equipo?error=permiso')
    }

    const usuarioId = String(formData.get('usuario') ?? '')
    const activo = String(formData.get('activo') ?? '') === 'true'

    await conSesion(
      sesion,
      (client) => client.query('update usuarios set activo = $2 where id = $1', [usuarioId, activo]),
      { escribe: true },
    )

    revalidatePath('/equipo')
    redirect(activo ? '/equipo?ok=reactivado' : '/equipo?ok=desactivado')
  }

  return (
    <main>
      <h1 className="flex items-center gap-2 text-xl font-semibold text-barro-900">
        <Users className="size-5 text-selva-700" aria-hidden />
        Equipo
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-barro-600">
        Invite a las personas de su centro y désele a cada una su rol. La invitación no crea una
        cuenta: cada quien entra por su cuenta y prueba que el correo o el número es suyo.
      </p>

      {ok && (
        <p className="mt-4 rounded-lg border border-selva-200 bg-selva-50 px-4 py-3 text-sm text-barro-800">
          {ok === 'invitado'
            ? 'Invitación creada. Ya puede entrar desde /entrar.'
            : ok === 'desactivado'
              ? 'Persona desactivada. Pierde el acceso en su próximo clic.'
              : 'Persona reactivada.'}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error === 'ya_invitado'
            ? 'Ese correo o número ya está en la lista.'
            : error === 'contacto'
              ? 'Escriba un correo válido o un número con indicativo (+57 300 111 2233).'
              : error === 'rol'
                ? 'Escoja un rol válido.'
                : 'No se pudo completar la acción.'}
        </p>
      )}

      <section className="mt-6 rounded-lg border border-barro-200 bg-white px-4 py-4">
        <h2 className="flex items-center gap-2 font-semibold text-barro-900">
          <UserPlus className="size-4" aria-hidden />
          Invitar a alguien
        </h2>
        <form action={invitar} className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="contacto" className="block text-sm font-medium text-barro-800">
              Correo o WhatsApp
            </label>
            <input
              id="contacto"
              name="contacto"
              type="text"
              required
              placeholder="nombre@organizacion.org o 300 111 2233"
              className="mt-1.5 w-full rounded-lg border border-barro-200 bg-white px-3 py-2.5
                         text-base text-barro-900 placeholder:text-barro-400
                         focus:border-selva-600 focus:outline-none focus:ring-2 focus:ring-selva-600/20"
            />
          </div>
          <div>
            <label htmlFor="rol" className="block text-sm font-medium text-barro-800">
              Rol
            </label>
            <select
              id="rol"
              name="rol"
              defaultValue="verificador"
              className="mt-1.5 rounded-lg border border-barro-200 bg-white px-3 py-2.5 text-base
                         text-barro-900 focus:border-selva-600 focus:outline-none focus:ring-2 focus:ring-selva-600/20"
            >
              {ROLES_TRABAJADOR.map((r: RolTrabajador) => (
                <option key={r} value={r}>
                  {ROL_ETIQUETA[r]}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-selva-700 px-4 py-2.5 font-medium text-white hover:bg-selva-900
                       focus:outline-none focus:ring-2 focus:ring-selva-700/30 focus:ring-offset-2"
          >
            Invitar
          </button>
        </form>
        <p className="mt-2 text-xs text-barro-600">
          Un verificador solo ve su territorio; asígnele sus comunidades cuando entre.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold text-barro-900">Su equipo</h2>
        {miembros.length === 0 ? (
          <p className="mt-3 text-sm text-barro-600">Todavía no ha invitado a nadie.</p>
        ) : (
          <ul className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
            {miembros.map((m) => {
              const estado = estadoDe(m)
              const esYo = m.usuario_id === sesion.authId
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                  <span className="min-w-0 truncate font-medium text-barro-900">
                    {m.correo ?? m.telefono}
                  </span>
                  <span className="text-barro-500">{ROL_ETIQUETA[m.rol_staff] ?? m.rol_staff}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${estado.clase}`}>
                    {estado.etiqueta}
                  </span>

                  {/* Deactivating is only offered for somebody who has actually joined, and never
                      for yourself — locking yourself out of your own centre is not a button. */}
                  {m.usuario_id && !esYo && (
                    <form action={cambiarActivo} className="ml-auto">
                      <input type="hidden" name="usuario" value={m.usuario_id} />
                      <input type="hidden" name="activo" value={m.usuario_activo ? 'false' : 'true'} />
                      <button
                        type="submit"
                        className="text-barro-600 underline hover:text-barro-900"
                      >
                        {m.usuario_activo ? 'Desactivar' : 'Reactivar'}
                      </button>
                    </form>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </main>
  )
}
