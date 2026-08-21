import type { Metadata } from 'next'
import { CircleDashed, MapPin, WifiOff } from 'lucide-react'
import { redirect } from 'next/navigation'
import { figurasDe } from '@/lib/mapa/capas'
import { cargarMapa } from '@/lib/mapa/datos'
import { representacionDe } from '@/lib/mapa/precision'
import { IntroColapsable } from '@/components/intro-colapsable'
import { esTransportista } from '@/lib/campo'
import { conSesion, sesionActual } from '@/lib/sesion'
import { temporadaVigente } from '@/lib/temporada'
import MapaOffline from './mapa-offline'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Mapa sin conexión',
  manifest: '/manifest.webmanifest',
}

/**
 * The offline field map (PRD-13 / §26).
 *
 * The same basin the panel map draws, on a basemap built to survive going offline: a PMTiles
 * archive cached on the device, with a live GPS dot on top. The data is loaded server-side and
 * embedded in the page, so a device that cached this document keeps the last-synced geography
 * even with no signal — the list under the map carries the same rows, so the screen still
 * answers «where is this, and how sure are we?» when the map itself cannot draw.
 *
 * This route owns only the basemap half of the transporter bundle. The run-scoped, encrypted,
 * expiring bundle (manifest + ordered stops + confirmation codes + corridor tiles) is the
 * safety half and is deferred to a follow-up — see docs/mapas-offline.md.
 */
export default async function MapaOfflinePagina() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  // PRD-13, corroborated by v4: the transporter's offline map is the basemap, their own
  // position, and the stop they are driving to. Nothing else — a delivery driver's screen, not a
  // reduced copy of the coordinator's.
  //
  // The dataset is produced by RLS rather than by branching here, and that is the whole point.
  // `comunidades_transportista` (0025) admits exactly the communities this person is currently
  // carrying something to: `convite_conduce_hacia` requires that the envío is theirs AND that it
  // is out and not yet back. Somebody who ran a trip in March cannot pull those coordinates in
  // August. Meanwhile `nodos_lectura` and `rutas_lectura` stay role-gated, so warehouse contents
  // and the route graph simply do not come back for them.
  //
  // So the same `cargarMapa` call yields the coordinator's basin and the driver's single pin,
  // and the difference is enforced by policy rather than by a branch somebody can forget. What
  // this fixes is only the copy: a driver used to meet «0 tramos dibujados», which reads as a
  // broken map rather than a correct one.
  const transportista = esTransportista(sesion)

  const { datos } = await conSesion(sesion, async (client) => {
    const datos = await cargarMapa(client, await temporadaVigente(client))
    return { datos }
  })

  const { sinUbicar } = figurasDe(datos)

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-barro-900">Mapa sin conexión</h1>
        <p className="text-sm text-barro-600">
          {transportista
            ? datos.comunidades.length === 0
              ? 'Sin viaje activo. Cuando le asignen uno, aquí aparece a dónde va.'
              : `Su viaje: ${datos.comunidades.length === 1 ? '1 parada' : `${datos.comunidades.length} paradas`}.`
            : `Temporada ${datos.temporada} · ${datos.tramos.length} tramos dibujados`}
        </p>
      </div>

      <IntroColapsable
        id="mapa-offline"
        unaLinea={
          transportista
            ? 'Descargue el mapa con señal. Después el GPS y su parada siguen funcionando sin ella.'
            : 'El mapa base se descarga con señal; el GPS funciona sin ella.'
        }
      >
        Descarga el mapa del territorio mientras haya señal y quedará disponible sin conexión en
        campo. El punto de GPS del teléfono no necesita conexión —solo el mapa la necesitaba—, así
        que sigue mostrando dónde estás aunque no haya red. Los círculos son el margen de error de
        cada ubicación, no el tamaño de la comunidad: eso no cambia estando sin conexión.
      </IntroColapsable>

      <div className="mt-4">
        <MapaOffline datos={datos} />
      </div>

      <p className="mt-3 flex items-start gap-2 rounded-lg border border-atrato-100 bg-atrato-50 px-4 py-3 text-sm text-barro-800">
        <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Primera versión: se descarga el mapa base del territorio y se dibuja el GPS encima. Falta
          —y está anotado, no simulado— el paquete por viaje (manifiesto, paradas en orden, códigos
          de confirmación y teselas del corredor), cifrado, que expira al terminar el viaje. Eso
          necesita trabajo en dispositivo y es un siguiente paso (§26).
        </span>
      </p>

      {sinUbicar.length > 0 && (
        <p className="mt-3 text-sm text-barro-700">
          Sin ubicar, y por eso fuera del mapa: {sinUbicar.join(', ')}.
        </p>
      )}

      <section className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-barro-200 bg-white px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-barro-900">
            <MapPin className="size-4" aria-hidden />
            Punto azul
          </h2>
          <p className="mt-1 text-sm text-barro-600">
            Tu ubicación por GPS, con su halo de precisión. Funciona sin conexión.
          </p>
        </div>
        <div className="rounded-lg border border-barro-200 bg-white px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-barro-900">
            <CircleDashed className="size-4" aria-hidden />
            Círculos de raya
          </h2>
          <p className="mt-1 text-sm text-barro-600">
            El margen de error de cada comunidad, igual que en el mapa del panel.
          </p>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold text-barro-900">Comunidades</h2>
        <ul className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
          {datos.comunidades.map((c) => {
            const figura = representacionDe(c)
            return (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 px-4 py-3 text-sm">
                <span className="font-medium text-barro-900">{c.nombre}</span>
                <span className="text-barro-500">{c.municipio}</span>
                <span className="text-barro-600">
                  {figura.forma === 'pin' && 'punto exacto'}
                  {figura.forma === 'circulo' && `±${figura.radioM} m (${c.fuente})`}
                  {figura.forma === 'ausente' && 'sin ubicar'}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    </main>
  )
}
