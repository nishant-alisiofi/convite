import { CloudRain, History, Sun, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { TEMPORADAS_OPERATIVAS } from '@/db/schema/vocabulario'
import { efectoDeLaTemporada } from '@/lib/alcance'
import type { TemporadaActual } from '@/lib/matching/tipos'
import { conSesion, sesionActual } from '@/lib/sesion'
import { CLAVE_TEMPORADA, fijarTemporada, temporadaVigente } from '@/lib/temporada'

export const dynamic = 'force-dynamic'

/**
 * Admin settings — today, the season.
 *
 * It was an environment variable, and that was the problem: `rutas.temporada` filters the
 * reachability graph, so this one word decides which communities the engine believes can be
 * reached at all. Winandó has no route row in `seca`. Setting it wrong raises nothing
 * anywhere; the plans just come out different.
 *
 * So the change is confirmed on a page that names what it costs, is restricted to admins by
 * RLS rather than by hiding the form, and leaves an `auditoria` row with the name of whoever
 * flipped it. Server-rendered, no client JavaScript.
 */

const DESCRIPCION: Record<TemporadaActual, { titulo: string; detalle: string }> = {
  lluvias: {
    titulo: 'Lluvias',
    detalle:
      'El río alto. Entran las lanchas por el Atrato y la chalupa por el caño hasta Winandó. La trocha a San Francisco de Ichó se pone pesada.',
  },
  seca: {
    titulo: 'Seca',
    detalle:
      'Bajan las aguas. Aparecen los playones, todos los tramos del Atrato tardan más y cuestan más, y al caño de Winandó no entra chalupa.',
  },
}

type Params = Promise<{ cambiar?: string; error?: string }>

export default async function Ajustes({ searchParams }: { searchParams: Params }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { cambiar, error } = await searchParams
  const esAdmin = sesion.rolStaff === 'admin'

  const destino = TEMPORADAS_OPERATIVAS.includes(cambiar as TemporadaActual)
    ? (cambiar as TemporadaActual)
    : null

  const { temporada, historia, efecto } = await conSesion(sesion, async (client) => {
    const temporada = await temporadaVigente(client)
    const { rows: historia } = await client.query<{
      antes: { valor: string } | null
      despues: { valor: string }
      creado_en: Date
    }>(
      `select antes, despues, creado_en
         from auditoria
        where accion = 'configuracion.cambio'
        order by creado_en desc
        limit 10`,
    )

    return {
      temporada,
      historia,
      efecto:
        destino && destino !== temporada
          ? await efectoDeLaTemporada(client, temporada, destino)
          : null,
    }
  })

  async function cambiarTemporada(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || sesion.rolStaff !== 'admin') {
      redirect('/ajustes?error=Solo+un+admin+cambia+la+temporada')
    }

    const valor = String(formData.get('temporada') ?? '')
    if (!TEMPORADAS_OPERATIVAS.includes(valor as TemporadaActual)) {
      redirect('/ajustes?error=Temporada+desconocida')
    }

    await conSesion(
      sesion,
      (client) => fijarTemporada(client, valor as TemporadaActual, sesion.authId),
      { escribe: true },
    )

    // The engine reads the setting per run, so the next sweep already uses this.
    revalidatePath('/ajustes')
    redirect('/ajustes')
  }

  return (
    <main>
      <h1 className="text-xl font-semibold text-barro-900">Ajustes</h1>

      {error && (
        <p className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </p>
      )}

      <section className="mt-6 rounded-lg border border-barro-200 bg-white px-4 py-4">
        <h2 className="flex items-center gap-2 font-semibold text-barro-900">
          {temporada === 'lluvias' ? (
            <CloudRain className="size-4" aria-hidden />
          ) : (
            <Sun className="size-4" aria-hidden />
          )}
          Temporada: {DESCRIPCION[temporada].titulo}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-barro-700">{DESCRIPCION[temporada].detalle}</p>
        <p className="mt-2 max-w-3xl text-sm text-barro-600">
          El emparejador decide con esto qué tramos están abiertos, así que ponerla mal no da
          error: simplemente deja comunidades fuera del alcance sin que nadie lo note.
        </p>

        {!esAdmin && (
          <p className="mt-3 text-sm text-barro-600">
            Solo un admin puede cambiarla. Si hay que cambiarla, pídalo — queda registrado con
            el nombre de quien la cambie.
          </p>
        )}

        {esAdmin && !destino && (
          <div className="mt-4 flex flex-wrap gap-3">
            {TEMPORADAS_OPERATIVAS.filter((t) => t !== temporada).map((t) => (
              <Link
                key={t}
                href={`/ajustes?cambiar=${t}`}
                className="rounded border border-barro-200 bg-white px-3 py-1.5 text-sm text-barro-800 underline"
              >
                Cambiar a {DESCRIPCION[t].titulo.toLowerCase()}
              </Link>
            ))}
          </div>
        )}

        {esAdmin && destino && destino !== temporada && (
          <form action={cambiarTemporada} className="mt-4 rounded border border-atrato-100 bg-atrato-50 px-4 py-3">
            <input type="hidden" name="temporada" value={destino} />
            <h3 className="flex items-center gap-2 text-sm font-semibold text-barro-900">
              <TriangleAlert className="size-4" aria-hidden />
              Pasar a {DESCRIPCION[destino].titulo.toLowerCase()}
            </h3>

            {efecto && efecto.pierden.length > 0 ? (
              <p className="mt-2 text-sm font-medium text-rose-900">
                {efecto.pierden.join(', ')}{' '}
                {efecto.pierden.length === 1 ? 'queda incomunicada' : 'quedan incomunicadas'}: no
                hay ruta abierta hacia allá en {DESCRIPCION[destino].titulo.toLowerCase()}.
              </p>
            ) : (
              <p className="mt-2 text-sm text-barro-800">
                Ninguna comunidad se queda sin paso con este cambio.
              </p>
            )}

            {efecto && efecto.ganan.length > 0 && (
              <p className="mt-1 text-sm text-barro-800">
                Se vuelve a poder llegar a {efecto.ganan.join(', ')}.
              </p>
            )}

            <p className="mt-2 text-xs text-barro-600">
              Queda una fila de auditoría con su nombre y la hora. El emparejador usa el valor
              nuevo desde la próxima corrida.
            </p>

            <div className="mt-3 flex gap-3">
              <button
                type="submit"
                className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
              >
                Confirmar el cambio
              </button>
              <Link href="/ajustes" className="px-3 py-1.5 text-sm text-barro-700 underline">
                Cancelar
              </Link>
            </div>
          </form>
        )}
      </section>

      <section className="mt-8">
        <h2 className="flex items-center gap-2 font-semibold text-barro-900">
          <History className="size-4" aria-hidden />
          Quién la ha cambiado
        </h2>

        {historia.length === 0 ? (
          <p className="mt-3 text-sm text-barro-600">
            Nadie todavía: sigue en el valor con el que arrancó el sistema.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
            {historia.map((f, i) => (
              <li key={i} className="flex flex-wrap gap-x-2 px-4 py-3 text-sm">
                <span className="text-barro-900">
                  {f.antes ? `${f.antes.valor} → ${f.despues.valor}` : f.despues.valor}
                </span>
                <span className="ml-auto text-barro-500">
                  {f.creado_en.toLocaleString('es-CO')}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-barro-600">
          La escribe un trigger, no la pantalla: un cambio hecho desde un script queda igual de
          registrado. Nadie puede editar ni borrar estas filas.
        </p>
      </section>

      <p className="mt-8 text-sm text-barro-600">
        La clave se llama <code className="text-barro-800">{CLAVE_TEMPORADA}</code> y vive en{' '}
        <code className="text-barro-800">configuracion</code>. Si la fila no existe, el motor cae
        a <code className="text-barro-800">CONVITE_TEMPORADA</code> y, sin eso, a lluvias.
      </p>
    </main>
  )
}
