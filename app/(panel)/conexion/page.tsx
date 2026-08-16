import { EarOff, Info, MapPin, MapPinOff, ShieldCheck, TriangleAlert, Users } from 'lucide-react'
import { redirect } from 'next/navigation'
import { type Costo, type Nivel, type PuntoConexion, puntosDeConexion } from '@/lib/conexion'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * §5.9 — "Where can I go".
 *
 * The connection points a community reaches signal through: a shop with a phone, a pier the
 * boats pass, a health post, a WiFi mast. This is the operator's blind spot made visible — the
 * detailed local knowledge of where signal is and where it is safe to *stay* for the length of
 * a call, which never appears on a coverage map.
 *
 * Two things this screen is careful to say out loud. First, a point is NOT judged by bandwidth:
 * it is judged by whether it is safe, private, reachable, powered, whether one can stay, and
 * what it costs — privacy most of all where the subject is health. Second, reaching a point can
 * itself cost travel, money and risk: an activity meant to avoid a journey can require a journey
 * first, and pretending otherwise would send someone up the river for nothing.
 *
 * These are deliberately NOT the supply centres (`nodos`). The same person may run both, but
 * they are kept separate everywhere — including here — so that convergence is always visible.
 */

const TIPOS: Record<string, string> = {
  tienda: 'Tienda',
  muelle: 'Muelle',
  puesto_salud: 'Puesto de salud',
  punto_wifi: 'Punto WiFi',
  antena: 'Antena',
  vivienda: 'Vivienda',
  otro: 'Punto de conexión',
}

const NIVEL_TEXTO: Record<Nivel, string> = {
  alto: 'Alto',
  medio: 'Medio',
  bajo: 'Bajo',
  desconocido: 'Sin datos',
}

const COSTO_TEXTO: Record<Costo, string> = {
  gratuito: 'Gratuito',
  bajo: 'Bajo',
  medio: 'Medio',
  alto: 'Alto',
  desconocido: 'Sin datos',
}

/** Tone by how good the value is for the person. Positive dimensions: `alto` is good. */
function tonoNivel(n: Nivel): string {
  if (n === 'alto') return 'bg-selva-50 text-selva-700'
  if (n === 'bajo') return 'bg-atrato-100 text-atrato-700'
  if (n === 'medio') return 'bg-barro-100 text-barro-700'
  return 'bg-barro-50 text-barro-400'
}

/** Cost runs the other way: free or cheap is good, expensive is the warning. */
function tonoCosto(c: Costo): string {
  if (c === 'gratuito' || c === 'bajo') return 'bg-selva-50 text-selva-700'
  if (c === 'alto') return 'bg-atrato-100 text-atrato-700'
  if (c === 'medio') return 'bg-barro-100 text-barro-700'
  return 'bg-barro-50 text-barro-400'
}

function Dimension({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-barro-200 bg-white px-3 py-2">
      <span className="text-sm text-barro-600">{etiqueta}</span>
      <span className={`rounded px-2 py-0.5 text-xs font-medium ${tono}`}>{valor}</span>
    </div>
  )
}

function Rasgo({ activo, texto }: { activo: boolean; texto: string }) {
  if (!activo) return null
  return (
    <span className="rounded-full border border-selva-200 bg-selva-50 px-2.5 py-0.5 text-xs font-medium text-selva-700">
      {texto}
    </span>
  )
}

function Tarjeta({ punto }: { punto: PuntoConexion }) {
  return (
    <li className="rounded-xl border border-barro-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 font-semibold text-barro-900">
          {punto.ubicado ? (
            <MapPin className="size-4 text-selva-600" aria-hidden />
          ) : (
            <MapPinOff className="size-4 text-barro-400" aria-hidden />
          )}
          {punto.nombre}
        </h2>
        <span className="text-xs uppercase tracking-wide text-barro-500">
          {TIPOS[punto.tipo] ?? TIPOS.otro}
        </span>
      </div>

      {punto.comunidades.length > 0 && (
        <p className="mt-2 flex items-start gap-2 text-sm text-barro-700">
          <Users className="mt-0.5 size-4 shrink-0 text-barro-400" aria-hidden />
          <span>
            Sirve a {punto.comunidades.join(', ')}.
          </span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Rasgo activo={punto.tieneSenal} texto="Hay señal" />
        <Rasgo activo={punto.internetDisponible} texto="Internet" />
        <Rasgo activo={punto.vendePines} texto="Venden pines" />
        <Rasgo activo={punto.atendido} texto="Atendido" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Dimension etiqueta="Seguridad" valor={NIVEL_TEXTO[punto.seguridad]} tono={tonoNivel(punto.seguridad)} />
        <Dimension etiqueta="Privacidad" valor={NIVEL_TEXTO[punto.privacidad]} tono={tonoNivel(punto.privacidad)} />
        <Dimension etiqueta="Se puede quedar" valor={NIVEL_TEXTO[punto.permanencia]} tono={tonoNivel(punto.permanencia)} />
        <Dimension etiqueta="Acceso" valor={NIVEL_TEXTO[punto.accesibilidad]} tono={tonoNivel(punto.accesibilidad)} />
        <Dimension etiqueta="Energía" valor={NIVEL_TEXTO[punto.energia]} tono={tonoNivel(punto.energia)} />
        <Dimension etiqueta="Costo" valor={COSTO_TEXTO[punto.costo]} tono={tonoCosto(punto.costo)} />
      </div>

      {punto.notas && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-barro-50 px-3 py-2 text-sm text-barro-700">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-atrato-600" aria-hidden />
          <span>{punto.notas}</span>
        </p>
      )}
    </li>
  )
}

export default async function Conexion() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const puntos = await conSesion(sesion, (client) => puntosDeConexion(client))

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-barro-900">Puntos de conexión</h1>
        {puntos.length > 0 && (
          <p className="text-sm text-barro-600">
            {puntos.length} {puntos.length === 1 ? 'punto' : 'puntos'}
          </p>
        )}
      </div>

      <p className="mt-2 max-w-3xl text-sm text-barro-700">
        Los lugares a donde alguien de una comunidad sin señal camina para mandar un reporte o
        recibir una respuesta. No se miden por velocidad, sino por si son seguros, privados,
        alcanzables, con energía, si uno se puede quedar el rato de una llamada, y cuánto cuestan
        — la privacidad pesa más cuando lo que se habla es de salud.
      </p>

      <p className="mt-3 flex max-w-3xl items-start gap-2 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-700">
        <Info className="mt-0.5 size-4 shrink-0 text-barro-400" aria-hidden />
        <span>
          Llegar a uno puede costar viaje, plata y riesgo: una gestión pensada para evitar un
          desplazamiento a veces exige uno primero. Estos no son los centros de acopio —
          conectividad y suministro se llevan aparte a propósito.
        </span>
      </p>

      {puntos.length === 0 ? (
        <div className="mt-6 rounded-lg border border-barro-200 bg-white px-4 py-6 text-barro-700">
          <p className="flex items-center gap-2 font-medium text-barro-900">
            <ShieldCheck className="size-4 text-barro-400" aria-hidden />
            Todavía no hay puntos de conexión registrados.
          </p>
          <p className="mt-2 max-w-2xl text-sm">
            Cuando el equipo de campo registre dónde hay señal —una tienda, un muelle, un puesto
            de salud, una antena comunitaria— y cómo es cada lugar (seguridad, privacidad,
            energía, costo, si se puede quedar), aparecerán aquí junto a las comunidades a las que
            sirven.
          </p>
          <p className="mt-2 flex items-start gap-2 text-sm text-barro-600">
            <EarOff className="mt-0.5 size-4 shrink-0 text-barro-400" aria-hidden />
            <span>
              La privacidad es la primera pregunta cuando el reporte es de salud: no es lo mismo
              hablar solo que junto al mostrador de una tienda.
            </span>
          </p>
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-4">
          {puntos.map((punto) => (
            <Tarjeta key={punto.id} punto={punto} />
          ))}
        </ul>
      )}
    </main>
  )
}
