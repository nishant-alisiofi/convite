import type { Croquis, Manifiesto } from '@/lib/despacho/manifiesto'

/**
 * The sheet itself, kept apart from the page so `pnpm vista:manifiesto` can render it with
 * real rows. A printed page is the whole deliverable here — if the table breaks across a
 * fold or the codes come out small, nobody finds that in a test.
 */
export default function HojaManifiesto({
  manifiesto,
  croquis,
  enlaceVolver,
}: {
  manifiesto: Manifiesto
  croquis: Croquis
  enlaceVolver?: string
}) {
  const asignadas = manifiesto.paradas.reduce((n, p) => n + p.familiasAsignadas, 0)

  return (
    <main className="manifiesto">
      <style>{`
        @media print {
          header, nav, .no-imprimir { display: none !important; }
          .manifiesto { font-size: 12pt; color: #000; }
          .hoja { border: none !important; padding: 0 !important; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; }
        }
      `}</style>

      <div className="no-imprimir flex flex-wrap items-baseline justify-between gap-3">
        {enlaceVolver && (
          <a href={enlaceVolver} className="text-sm text-stone-700 underline">
            ← Volver al plan
          </a>
        )}
        <p className="text-sm text-stone-600">
          Imprima con Ctrl/Cmd + P. Para mandarlo por WhatsApp, imprima a PDF.
        </p>
      </div>

      <div className="hoja mt-4 rounded-lg border border-barro-200 bg-white p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-stone-300 pb-3">
          <div>
            <h1 className="font-mono text-2xl font-bold text-stone-900">{manifiesto.codigo}</h1>
            <p className="text-stone-800">
              {manifiesto.modo} · {manifiesto.transportista}
            </p>
          </div>
          <div className="text-right text-sm text-stone-800">
            <p>Sale de {manifiesto.origenNodo}</p>
            <p>{manifiesto.salidaProgramada?.toLocaleString('es-CO') ?? 'sin fecha'}</p>
            <p>
              {asignadas} de {manifiesto.cupoFamilias} familias
            </p>
          </div>
        </div>

        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-stone-300 text-stone-700">
              <th className="py-2 pr-2 font-medium">#</th>
              <th className="py-2 pr-2 font-medium">Comunidad</th>
              <th className="py-2 pr-2 font-medium">Qué se entrega</th>
              <th className="py-2 pr-2 font-medium">Familias</th>
              <th className="py-2 font-medium">Código</th>
            </tr>
          </thead>
          <tbody>
            {manifiesto.paradas.map((p) => (
              <tr key={p.pedidoId} className="border-b border-stone-200 align-top">
                <td className="py-3 pr-2 font-semibold text-stone-900">{p.orden}</td>
                <td className="py-3 pr-2">
                  <span className="font-medium text-stone-900">{p.comunidad}</span>
                  <span className="block text-stone-600">{p.municipio}</span>
                </td>
                <td className="py-3 pr-2 text-stone-900">{p.item}</td>
                <td className="py-3 pr-2 text-stone-900">
                  {p.familiasAsignadas}
                  {p.familiasAsignadas < p.familiasPedidas && (
                    <span className="block text-stone-600">de {p.familiasPedidas} pedidas</span>
                  )}
                </td>
                <td className="py-3 font-mono text-lg font-bold tracking-widest text-stone-900">
                  {p.codigoConfirmacion ?? '····'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-3 text-sm text-stone-700">
          En cada parada, quien recibe le lee el código de vuelta. Ese número es la constancia
          de que llegó: sin él, la entrega queda sin confirmar.
        </p>

        {croquis.puntos.length > 0 && (
          <figure className="mt-6">
            <svg
              viewBox={`0 0 ${croquis.ancho} ${croquis.alto}`}
              width="100%"
              role="img"
              aria-label="Croquis esquemático del recorrido"
              className="max-w-xl border border-stone-200"
            >
              <rect width={croquis.ancho} height={croquis.alto} fill="#faf9f7" />
              {croquis.puntos.slice(1).map((p, i) => {
                const previo = croquis.puntos[i]!
                return (
                  <line
                    key={`l-${i}`}
                    x1={previo.x}
                    y1={previo.y}
                    x2={p.x}
                    y2={p.y}
                    stroke="#8a6229"
                    strokeWidth={1.2}
                    strokeDasharray="5 3"
                  />
                )
              })}
              {croquis.puntos.map((p, i) => (
                <g key={`p-${i}`}>
                  {p.radio > 1 && (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={p.radio}
                      fill="none"
                      stroke="#57534e"
                      strokeWidth={1}
                      strokeDasharray="3 3"
                    />
                  )}
                  <circle cx={p.x} cy={p.y} r={p.esOrigen ? 5 : 3} fill="#1f5c4a" />
                  <text x={p.x + 8} y={p.y + 4} fontSize={11} fill="#292524">
                    {p.etiqueta}
                  </text>
                </g>
              ))}
            </svg>
            <figcaption className="mt-2 max-w-xl text-xs text-stone-600">
              Croquis, no mapa: muestra el orden de las paradas y más o menos dónde queda cada
              una. Las líneas de raya no son el camino — no tenemos cartografía del canal. Los
              círculos son el margen de error de cada ubicación, no el tamaño del pueblo.
            </figcaption>
          </figure>
        )}

        {manifiesto.decision && (
          <section className="mt-6 border-t border-stone-300 pt-3 text-sm">
            <h2 className="font-semibold text-stone-900">Cómo se repartió</h2>
            <p className="mt-1 text-stone-900">{manifiesto.decision.reglaAplicada}</p>
            {manifiesto.decision.nota && (
              <p className="mt-1 text-stone-700">{manifiesto.decision.nota}</p>
            )}
            {manifiesto.decision.postergados.length > 0 && (
              <p className="mt-1 text-stone-800">
                Quedaron para después:{' '}
                {manifiesto.decision.postergados.map((p) => p.comunidad).join(', ')}.
              </p>
            )}
          </section>
        )}

        <p className="mt-6 border-t border-stone-300 pt-3 text-xs text-stone-600">
          Despachado {manifiesto.despachadoEn?.toLocaleString('es-CO') ?? '—'}. Convite ·
          coordinación de ayuda en la cuenca del Atrato.
        </p>
      </div>
    </main>
  )
}
