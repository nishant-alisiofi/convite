import { Radio as RadioIcon } from 'lucide-react'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { fechaCorta } from '@/lib/fechas'
import {
  atestarRadio,
  comunidadesPermitidas,
  estadoRadioPorComunidad,
  registrarRelevo,
  relevosRecientes,
  revocarRadio,
  type EstadoRadio,
} from '@/lib/radio'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * Radio — the fourth channel, ingested and never operated (PRD-11, §2, §5.8).
 *
 * Convite does not run a radio net. It ingests from a licensed community net that a partner has
 * confirmed exists and is safe to use. Because that is a judgement about one community's real
 * situation, radio is OFF everywhere until someone with a name attests otherwise, and the
 * attestation expires after six months. This screen is the two halves of that: the attestation
 * management, and — only for communities currently on — the manual relay intake, which names the
 * two people every relay carries and enters the same verification queue as any other channel.
 */

/** §11 gates the UI; RLS and the DB gate the data. This is the UI half. */
const PUEDEN_ATESTAR = ['coordinador', 'admin']
const PUEDEN_RELEVAR = ['verificador', 'coordinador', 'admin']

const ETIQUETA_ESTADO: Record<EstadoRadio, string> = {
  permitido: 'Habilitada',
  vencido: 'Vencida',
  revocado: 'Revocada',
  inseguro: 'Uso no seguro',
  nunca: 'Apagada',
}

const CLASE_ESTADO: Record<EstadoRadio, string> = {
  permitido: 'border-selva-600 bg-selva-50 text-selva-900',
  vencido: 'border-amber-400 bg-amber-50 text-amber-900',
  revocado: 'border-rose-300 bg-rose-50 text-rose-900',
  inseguro: 'border-rose-300 bg-rose-50 text-rose-900',
  nunca: 'border-barro-200 bg-white text-barro-600',
}

type Params = Promise<{ error?: string; ok?: string }>

export default async function Radio({ searchParams }: { searchParams: Params }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { error, ok } = await searchParams
  const puedeAtestar = PUEDEN_ATESTAR.includes(sesion.rolStaff)
  const puedeRelevar = PUEDEN_RELEVAR.includes(sesion.rolStaff)

  const { comunidades, permitidas, relevos } = await conSesion(sesion, async (client) => ({
    comunidades: await estadoRadioPorComunidad(client),
    permitidas: await comunidadesPermitidas(client),
    relevos: await relevosRecientes(client),
  }))

  async function accion(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion) redirect('/entrar')

    const que = String(formData.get('accion') ?? '')

    const resultado = await conSesion(
      sesion,
      async (client) => {
        switch (que) {
          case 'atestar':
            if (!PUEDEN_ATESTAR.includes(sesion.rolStaff)) {
              return { ok: false as const, error: 'Su rol no puede atestar la radio.' }
            }
            return atestarRadio(client, {
              organizacionId: sesion.organizacionId,
              comunidadId: String(formData.get('comunidadId') ?? ''),
              atestadoPor: sesion.authId,
              redDescrita: String(formData.get('redDescrita') ?? ''),
              usoSeguro: formData.get('usoSeguro') === 'on',
              notas: (String(formData.get('notas') ?? '').trim() || null) as string | null,
            })
          case 'revocar':
            if (!PUEDEN_ATESTAR.includes(sesion.rolStaff)) {
              return { ok: false as const, error: 'Su rol no puede revocar la radio.' }
            }
            return revocarRadio(client, {
              organizacionId: sesion.organizacionId,
              comunidadId: String(formData.get('comunidadId') ?? ''),
              revocadoPor: sesion.authId,
            })
          case 'relevo':
            if (!PUEDEN_RELEVAR.includes(sesion.rolStaff)) {
              return { ok: false as const, error: 'Su rol no puede registrar un relevo.' }
            }
            return registrarRelevo(client, {
              comunidadId: String(formData.get('comunidadId') ?? ''),
              hablante: String(formData.get('hablante') ?? ''),
              operador: String(formData.get('operador') ?? ''),
              detalle: String(formData.get('detalle') ?? ''),
              tipo: String(formData.get('tipo') ?? ''),
            })
          default:
            return { ok: false as const, error: 'Acción desconocida.' }
        }
      },
      { escribe: true },
    )

    if (!resultado.ok) {
      redirect(`/radio?error=${encodeURIComponent(resultado.error)}`)
    }
    revalidatePath('/radio')
    const nota =
      que === 'relevo' && 'folio' in resultado
        ? `Relevo registrado con el número ${resultado.folio}. Espera verificación.`
        : que === 'atestar'
          ? 'Atestación guardada. Vence en seis meses.'
          : 'Atestación revocada.'
    redirect(`/radio?ok=${encodeURIComponent(nota)}`)
  }

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-barro-900">
          <RadioIcon className="size-5" aria-hidden />
          Radio
        </h1>
        <p className="text-sm text-barro-600">
          {permitidas.length === 0
            ? 'Ninguna comunidad habilitada'
            : `${permitidas.length} comunidad${permitidas.length === 1 ? '' : 'es'} habilitada${
                permitidas.length === 1 ? '' : 's'
              }`}
        </p>
      </div>

      <p className="mt-2 max-w-3xl text-sm text-barro-700">
        Convite no opera una red de radio: ingiere de una red licenciada que ya existe y que la
        comunidad ya acepta. Por eso la radio está apagada para cada comunidad hasta que alguien
        confirme, con su nombre, que esa red existe y que su uso es seguro. La confirmación vence a
        los seis meses: no se extiende sola, se vuelve a confirmar.
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </p>
      )}
      {ok && (
        <p className="mt-4 rounded-lg border border-selva-600 bg-selva-50 px-4 py-3 text-sm text-selva-900">
          {ok}
        </p>
      )}

      {/* ── Relay intake ─────────────────────────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="font-semibold text-barro-900">Registrar un relevo de radio</h2>
        <p className="mt-1 max-w-3xl text-sm text-barro-700">
          Un relevo trae dos personas: quien habló y el operador que lo transmitió. Ambas quedan
          registradas. En la radio no prometemos exactitud de transcripción — lo que usted escribe
          es el registro. Todo relevo es de segunda mano, así que espera verificación como cualquier
          otro canal.
        </p>

        {!puedeRelevar ? (
          <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
            Su rol puede leer esta pantalla pero no registrar relevos.
          </p>
        ) : permitidas.length === 0 ? (
          <p className="mt-4 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
            No hay ninguna comunidad con la radio habilitada, así que no se puede registrar un
            relevo. Habilite primero una comunidad más abajo, con la atestación de una red
            licenciada y segura.
          </p>
        ) : (
          <form action={accion} className="mt-4 max-w-2xl space-y-3 rounded-lg border border-barro-200 bg-white p-4">
            <input type="hidden" name="accion" value="relevo" />
            <label className="block text-sm">
              <span className="text-barro-700">Comunidad (solo las habilitadas)</span>
              <select
                name="comunidadId"
                required
                className="mt-1 block w-full rounded border border-barro-300 px-3 py-2 text-barro-900"
              >
                {permitidas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} · {c.municipio}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-barro-700">Quien habló</span>
                <input
                  name="hablante"
                  required
                  placeholder="p. ej. Bertha Rentería (partera)"
                  className="mt-1 block w-full rounded border border-barro-300 px-3 py-2 text-barro-900"
                />
              </label>
              <label className="block text-sm">
                <span className="text-barro-700">Operador que lo transmitió</span>
                <input
                  name="operador"
                  required
                  placeholder="p. ej. Aristóbulo Mena (operador de radio)"
                  className="mt-1 block w-full rounded border border-barro-300 px-3 py-2 text-barro-900"
                />
              </label>
            </div>
            <label className="block text-sm">
              <span className="text-barro-700">Lo que se dijo</span>
              <textarea
                name="detalle"
                required
                rows={3}
                placeholder="Escriba lo que oyó por la radio. Su escritura es el registro."
                className="mt-1 block w-full rounded border border-barro-300 px-3 py-2 text-barro-900"
              />
            </label>
            <label className="block text-sm">
              <span className="text-barro-700">Tipo (opcional — un verificador lo confirma)</span>
              <select
                name="tipo"
                className="mt-1 block w-full rounded border border-barro-300 px-3 py-2 text-barro-900"
              >
                <option value="">Sin clasificar</option>
                <option value="necesidad">Necesidad</option>
                <option value="dano">Daño</option>
              </select>
            </label>
            <button
              type="submit"
              className="rounded bg-selva-600 px-4 py-2 text-sm font-medium text-white"
            >
              Registrar relevo
            </button>
          </form>
        )}
      </section>

      {/* ── Attestation management ───────────────────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="font-semibold text-barro-900">Comunidades y su estado de radio</h2>
        <p className="mt-1 max-w-3xl text-sm text-barro-700">
          Ninguna fila está habilitada por defecto. Habilitar es una decisión de coordinación:
          confirmar que existe una red licenciada y que su uso es seguro, con su nombre y una fecha.
        </p>

        {comunidades.length === 0 ? (
          <p className="mt-4 text-barro-600">No hay comunidades activas en su organización.</p>
        ) : (
          <ul className="mt-4 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
            {comunidades.map((c) => (
              <li key={c.comunidadId} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <span className="font-medium text-barro-900">{c.nombre}</span>
                    <span className="ml-2 text-sm text-barro-600">{c.municipio}</span>
                    {c.tierConectividad === 4 && (
                      <span className="ml-2 text-xs text-barro-500">solo radio</span>
                    )}
                  </div>
                  <span
                    className={`rounded border px-2 py-0.5 text-xs font-medium ${CLASE_ESTADO[c.estado]}`}
                  >
                    {ETIQUETA_ESTADO[c.estado]}
                  </span>
                </div>

                {c.atestadoEn && (
                  <p className="mt-1 text-xs text-barro-600">
                    {c.redDescrita ? `Red: ${c.redDescrita}. ` : ''}
                    {c.atestadoPor ? `Confirmó ${c.atestadoPor}. ` : ''}
                    {c.estado === 'permitido' && c.expiraEn
                      ? `Vence el ${fechaCorta(c.expiraEn)}.`
                      : c.estado === 'vencido' && c.expiraEn
                        ? `Venció el ${fechaCorta(c.expiraEn)} — vuelva a confirmar.`
                        : ''}
                    {c.notas ? ` ${c.notas}` : ''}
                  </p>
                )}

                {puedeAtestar && (
                  <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
                    <form
                      action={accion}
                      className="flex flex-wrap items-end gap-2 rounded border border-barro-200 bg-barro-50 p-3"
                    >
                      <input type="hidden" name="accion" value="atestar" />
                      <input type="hidden" name="comunidadId" value={c.comunidadId} />
                      <label className="block text-xs">
                        <span className="text-barro-700">Red licenciada</span>
                        <input
                          name="redDescrita"
                          required
                          defaultValue={c.redDescrita ?? ''}
                          placeholder="p. ej. VHF marino de lancheros"
                          className="mt-1 block w-56 rounded border border-barro-300 px-2 py-1 text-barro-900"
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs text-barro-700">
                        <input type="checkbox" name="usoSeguro" className="size-4" />
                        Su uso es seguro
                      </label>
                      <button
                        type="submit"
                        className="rounded bg-selva-600 px-3 py-1.5 text-xs font-medium text-white"
                      >
                        {c.estado === 'nunca' ? 'Habilitar' : 'Volver a confirmar'}
                      </button>
                    </form>

                    {c.estado === 'permitido' && (
                      <form action={accion} className="flex items-end">
                        <input type="hidden" name="accion" value="revocar" />
                        <input type="hidden" name="comunidadId" value={c.comunidadId} />
                        <button
                          type="submit"
                          className="rounded border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-900"
                        >
                          Revocar
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Recent relays ────────────────────────────────────────────────────────────────── */}
      {relevos.length > 0 && (
        <section className="mt-10">
          <h2 className="font-semibold text-barro-900">Relevos recientes</h2>
          <ul className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
            {relevos.map((r) => (
              <li key={r.folio} className="px-4 py-3 text-sm">
                <span className="font-medium text-barro-900">#{r.folio}</span>
                <span className="ml-2 text-barro-700">{r.comunidad}</span>
                <span className="ml-2 rounded border border-barro-200 px-1.5 py-0.5 text-xs text-barro-600">
                  {r.estado}
                </span>
                <p className="mt-1 text-barro-700">{r.detalle}</p>
                <p className="mt-1 text-xs text-barro-500">
                  Habló {r.hablante} · transmitió {r.operador}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
