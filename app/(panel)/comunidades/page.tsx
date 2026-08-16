import { EarOff, MapPin, MapPinOff, Radio } from 'lucide-react'
import { redirect } from 'next/navigation'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * The community registry — who is in the basin, and whether we have heard from them.
 *
 * A read-only roll of every community: where it is, how well it connects, and when it last
 * reached us. It is the reference behind every other screen — the map draws these points, the
 * matcher routes to them, verification is scoped by them.
 *
 * Section 9.8: silence is a signal, not an absence of need. «Última señal» is the last time
 * anything at all arrived — an inbound message or a report — because someone confirming a
 * delivery is as alive as someone asking for food. A community past its own check-in interval
 * is flagged; a community we have never heard from is a different fact (onboarding, not alarm)
 * and is named as such rather than sounded like an alert.
 *
 * Non-negotiable 2.2: a stored point never travels without its source and its radius. A
 * community centroid is not a GPS pin, so the source and the accuracy are shown next to every
 * location and never quietly upgraded to a false precision.
 */

const PUEDEN_VER = ['verificador', 'despachador', 'coordinador', 'admin']

/** Plain-language gloss for how a location was obtained (non-negotiable 2.2). */
const FUENTE_UBICACION: Record<string, string> = {
  gps: 'pin GPS',
  centroide: 'centroide',
  referida: 'referida',
  manual: 'puesta a mano',
}

type Fila = {
  id: string
  codigo: string
  nombre: string
  tipo: string
  municipio: string
  agrupador: string | null
  tier: number
  intervalo: number
  familias: number | null
  fuente: string | null
  precision: number | null
  tiene_ubicacion: boolean
  activa: boolean
  dias: number | null
  ultimo_canal: string | null
}

export default async function Comunidades() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  if (!PUEDEN_VER.includes(sesion.rolStaff)) {
    return (
      <main>
        <h1 className="text-xl font-semibold text-barro-900">Comunidades</h1>
        <p className="mt-4 max-w-2xl text-barro-700">Su rol no ve el registro de comunidades.</p>
      </main>
    )
  }

  const filas = await conSesion(sesion, async (client) => {
    const { rows } = await client.query<Fila>(
      `with ultima_senal as (
         select c.id as comunidad_id,
                max(x.cuando) as cuando,
                (array_agg(x.canal order by x.cuando desc))[1] as canal
           from comunidades c
           left join (
             select co.comunidad_id, m.creado_en as cuando, m.canal
               from mensajes m
               join contactos co on co.id = m.contacto_id
              where m.direccion = 'entrante'
             union all
             select r.comunidad_id, r.creado_en as cuando, r.canal
               from reportes r
              where r.comunidad_id is not null
           ) x on x.comunidad_id = c.id
          group by c.id
       )
       select c.id, c.codigo, c.nombre, c.tipo, c.municipio, c.agrupador,
              c.tier_conectividad        as tier,
              c.intervalo_chequeo_dias   as intervalo,
              c.familias_estimadas       as familias,
              c.ubicacion_fuente         as fuente,
              c.ubicacion_precision_m    as precision,
              (c.ubicacion is not null)  as tiene_ubicacion,
              c.activa,
              case when u.cuando is null then null
                   else date_part('day', now() - u.cuando)::int end as dias,
              u.canal as ultimo_canal
         from comunidades c
         left join ultima_senal u on u.comunidad_id = c.id
        order by c.municipio, c.nombre`,
    )
    return rows
  })

  if (filas.length === 0) {
    return (
      <main>
        <h1 className="text-xl font-semibold text-barro-900">Comunidades</h1>
        <p className="mt-6 rounded-lg border border-barro-200 bg-white px-4 py-3 text-barro-700">
          Todavía no hay comunidades en el registro.
        </p>
      </main>
    )
  }

  const enSilencio = filas.filter((f) => f.dias !== null && f.dias > f.intervalo).length
  const nuncaVistas = filas.filter((f) => f.dias === null).length

  // Group by municipality — the one place name that is safe to show, and how the field team
  // reads the basin.
  const porMunicipio = new Map<string, Fila[]>()
  for (const f of filas) {
    const lista = porMunicipio.get(f.municipio) ?? []
    lista.push(f)
    porMunicipio.set(f.municipio, lista)
  }

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-barro-900">Comunidades</h1>
        <p className="text-sm text-barro-600">
          {filas.length} en el registro
          {enSilencio > 0 && (
            <>
              {' · '}
              <span className="text-atrato-700">{enSilencio} en silencio</span>
            </>
          )}
          {nuncaVistas > 0 && <> · {nuncaVistas} nunca vistas</>}
        </p>
      </div>

      <p className="mt-2 max-w-3xl text-sm text-barro-700">
        El registro de la cuenca: dónde queda cada comunidad, qué tan bien se comunica y cuándo
        supimos de ella por última vez. El silencio es una señal, no una ausencia de necesidad —
        sobre todo en tier 3 y 4, donde casi siempre habla más de la señal que de la situación.
      </p>

      <div className="mt-6 space-y-8">
        {[...porMunicipio.entries()].map(([municipio, comunidades]) => (
          <section key={municipio}>
            <h2 className="text-xs font-medium uppercase tracking-wide text-barro-500">
              {municipio}
              <span className="ml-2 font-normal normal-case">{comunidades.length}</span>
            </h2>
            <ul className="mt-2 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
              {comunidades.map((c) => (
                <ComunidadFila key={c.id} c={c} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  )
}

function ComunidadFila({ c }: { c: Fila }) {
  const silencio = c.dias !== null && c.dias > c.intervalo
  const nuncaVista = c.dias === null

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-sm text-barro-500">{c.codigo}</span>
        <span className="font-medium text-barro-900">{c.nombre}</span>
        <span className="text-sm text-barro-500">{c.tipo.replace(/_/g, ' ')}</span>
        {c.agrupador && <span className="text-sm text-barro-500">· {c.agrupador}</span>}
        <span
          className={
            c.tier >= 3
              ? 'ml-auto flex shrink-0 items-center gap-1 rounded bg-atrato-100 px-1.5 py-0.5 text-xs font-medium text-atrato-700'
              : 'ml-auto shrink-0 rounded bg-barro-100 px-1.5 py-0.5 text-xs font-medium text-barro-600'
          }
          title={
            c.tier >= 3 ? 'Voz/SMS o relevo por radio — la señal más débil' : 'Datos confiables'
          }
        >
          {c.tier >= 4 && <Radio className="size-3" aria-hidden />}
          tier {c.tier}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-barro-600">
        {c.familias !== null && <span>{c.familias} familias est.</span>}

        <span className="flex items-center gap-1">
          {c.tiene_ubicacion ? (
            <>
              <MapPin className="size-3.5 text-barro-400" aria-hidden />
              {c.fuente ? (FUENTE_UBICACION[c.fuente] ?? c.fuente) : 'ubicación'}
              {c.precision !== null && ` · ±${c.precision} m`}
            </>
          ) : (
            <>
              <MapPinOff className="size-3.5 text-barro-400" aria-hidden />
              sin ubicación en el mapa
            </>
          )}
        </span>

        <span>revisa cada {c.intervalo} d</span>

        {!c.activa && <span className="text-barro-400">inactiva</span>}
      </div>

      {/* Contact status: silence is loud, never-seen is quiet, everyone else is a plain fact. */}
      {nuncaVista ? (
        <p className="mt-1 text-sm text-barro-500">
          Nunca hemos sabido nada de ella — es alta, no alarma.
        </p>
      ) : silencio ? (
        <p className="mt-1 flex flex-wrap items-center gap-1 text-sm font-medium text-atrato-700">
          <EarOff className="size-3.5 shrink-0" aria-hidden />
          En silencio hace {c.dias} días, y se esperaba cada {c.intervalo}
          {c.ultimo_canal && (
            <span className="font-normal text-barro-600">
              · respondió por {c.ultimo_canal}, por ahí conviene buscarla
            </span>
          )}
        </p>
      ) : (
        <p className="mt-1 text-sm text-barro-600">
          Última señal {c.dias === 0 ? 'hoy' : `hace ${c.dias} ${c.dias === 1 ? 'día' : 'días'}`}
          {c.ultimo_canal && ` · por ${c.ultimo_canal}`}
        </p>
      )}
    </li>
  )
}
