import { BookText, MessageSquareText, ShipWheel, TriangleAlert } from 'lucide-react'
import { redirect } from 'next/navigation'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * The item catalogue, read-only.
 *
 * Non-negotiable 2.8: the catalogue is data, not code — no enums, no switch on item codes.
 * Different territories carry different items, and editing the list must never need a deploy.
 * This screen is the plain reading of that data: the two-digit code a reporter actually types
 * in a WhatsApp list («22 12 3»), how the item is counted out loud, and the two rules the
 * catalogue carries — its urgency floor and whether it is a thing you can load on a boat.
 *
 * It shows `entregable` and `pide_detalle` rather than a «perishable» flag: perishability is
 * a property of a specific donated offer (`ofertas.perecedero`), not of a catalogue line, so
 * inventing it here would be a field the data does not have. What the catalogue does carry is
 * the urgency floor (a medical transfer is never logged as routine) and deliverability (some
 * entries, like psychosocial support, are not loaded onto a lancha at all).
 */

const PUEDEN_VER = ['verificador', 'despachador', 'coordinador', 'admin']

const TIPO_ITEM: Record<string, string> = {
  necesidad: 'necesidad',
  dano: 'daño',
}

type Fila = {
  codigo: string
  familia: string
  familia_label: string
  item_label: string
  tipo: string
  ayuda_texto: string | null
  unidad_singular: string | null
  unidad_plural: string | null
  pide_detalle: boolean
  urgencia_min: number
  entregable: boolean
}

export default async function Catalogo() {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  if (!PUEDEN_VER.includes(sesion.rolStaff)) {
    return (
      <main>
        <h1 className="text-xl font-semibold text-barro-900">Catálogo</h1>
        <p className="mt-4 max-w-2xl text-barro-700">Su rol no ve el catálogo de artículos.</p>
      </main>
    )
  }

  const filas = await conSesion(sesion, async (client) => {
    const { rows } = await client.query<Fila>(
      `select codigo, familia, familia_label, item_label, tipo, ayuda_texto,
              unidad_singular, unidad_plural, pide_detalle, urgencia_min, entregable
         from catalogo_items
        where activo
        order by orden, codigo`,
    )
    return rows
  })

  if (filas.length === 0) {
    return (
      <main>
        <h1 className="text-xl font-semibold text-barro-900">Catálogo</h1>
        <p className="mt-6 rounded-lg border border-barro-200 bg-white px-4 py-3 text-barro-700">
          El catálogo está vacío.
        </p>
      </main>
    )
  }

  // Group by family, keeping the catalogue's own ordering within each.
  const porFamilia = new Map<string, { label: string; items: Fila[] }>()
  for (const f of filas) {
    const grupo = porFamilia.get(f.familia) ?? { label: f.familia_label, items: [] }
    grupo.items.push(f)
    porFamilia.set(f.familia, grupo)
  }

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-barro-900">Catálogo</h1>
        <p className="text-sm text-barro-600">
          {filas.length} artículos en {porFamilia.size} familias
        </p>
      </div>

      <p className="mt-2 max-w-3xl text-sm text-barro-700">
        Los artículos que una comunidad puede pedir, con el código de dos dígitos que se usa en
        la lista de WhatsApp y en el SMS de respaldo («22 12 3»). El catálogo es dato, no
        código: se edita acá, sin desplegar nada.
      </p>

      <div className="mt-6 space-y-8">
        {[...porFamilia.entries()].map(([familia, grupo]) => (
          <section key={familia}>
            <h2 className="text-xs font-medium uppercase tracking-wide text-barro-500">
              <span className="font-mono">{familia}</span> · {grupo.label}
            </h2>
            <ul className="mt-2 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
              {grupo.items.map((f) => (
                <ItemFila key={f.codigo} f={f} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  )
}

function ItemFila({ f }: { f: Fila }) {
  const unidad =
    f.unidad_singular && f.unidad_plural
      ? `${f.unidad_singular} / ${f.unidad_plural}`
      : (f.unidad_singular ?? f.unidad_plural)

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-sm text-barro-500">{f.codigo}</span>
        <span className="font-medium text-barro-900">{f.item_label}</span>
        <span className="rounded bg-barro-100 px-1.5 py-0.5 text-xs font-medium text-barro-600">
          {TIPO_ITEM[f.tipo] ?? f.tipo}
        </span>
        {f.urgencia_min > 1 && (
          <span
            className={
              f.urgencia_min >= 3
                ? 'flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-900'
                : 'flex items-center gap-1 rounded bg-atrato-100 px-1.5 py-0.5 text-xs font-medium text-atrato-700'
            }
            title="Piso de urgencia: nunca se registra por debajo de este nivel"
          >
            <TriangleAlert className="size-3" aria-hidden />
            urgencia mín. {f.urgencia_min}
          </span>
        )}
        {!f.entregable && (
          <span
            className="flex items-center gap-1 rounded bg-barro-100 px-1.5 py-0.5 text-xs font-medium text-barro-600"
            title="No es una cosa que se cargue en una lancha"
          >
            <ShipWheel className="size-3" aria-hidden />
            no entregable
          </span>
        )}
        {f.pide_detalle && (
          <span
            className="flex items-center gap-1 rounded bg-barro-100 px-1.5 py-0.5 text-xs font-medium text-barro-600"
            title="El flujo pide una aclaración — texto libre o nota de voz"
          >
            <MessageSquareText className="size-3" aria-hidden />
            pide detalle
          </span>
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-barro-600">
        {unidad && (
          <span className="flex items-center gap-1">
            <BookText className="size-3.5 text-barro-400" aria-hidden />
            se cuenta como {unidad}
          </span>
        )}
      </div>

      {f.ayuda_texto && <p className="mt-1 text-sm text-barro-500">{f.ayuda_texto}</p>}
    </li>
  )
}
