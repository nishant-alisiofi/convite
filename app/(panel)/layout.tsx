import Link from 'next/link'
import { redirect } from 'next/navigation'
import { sesionActual } from '@/lib/sesion'
import { clienteServidor } from '@/lib/supabase/servidor'

/**
 * The coordinator shell. Section 10: light, calm, readable, works on a laptop over a weak
 * connection. Server-rendered — nothing here needs JavaScript to display.
 */

const SECCIONES = [
  { href: '/tablero', etiqueta: 'Tablero', listo: true },
  { href: '/verificacion', etiqueta: 'Verificación', listo: true },
  { href: '/mapa', etiqueta: 'Mapa', listo: true },
  { href: '/inventario', etiqueta: 'Inventario' },
  { href: '/rutas', etiqueta: 'Rutas', listo: true },
  { href: '/recogidas', etiqueta: 'Recogidas', listo: true },
  { href: '/envios', etiqueta: 'Envíos', listo: true },
  { href: '/comunidades', etiqueta: 'Comunidades' },
  { href: '/catalogo', etiqueta: 'Catálogo' },
  { href: '/estado', etiqueta: 'Estado', listo: true },
  { href: '/ajustes', etiqueta: 'Ajustes', listo: true },
]

async function salir() {
  'use server'
  const supabase = await clienteServidor()
  await supabase.auth.signOut()
  redirect('/entrar')
}

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  return (
    <div className="min-h-dvh">
      <header className="border-b border-barro-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/tablero" className="font-semibold text-stone-900">
            Convite
          </Link>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {SECCIONES.map((s) => (
              <span key={s.href}>
                {s.listo ? (
                  <Link href={s.href} className="text-stone-700 hover:text-stone-950">
                    {s.etiqueta}
                  </Link>
                ) : (
                  <span className="text-stone-400" title="En construcción">
                    {s.etiqueta}
                  </span>
                )}
              </span>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-stone-500">
              {sesion.correo} · {sesion.rolStaff}
            </span>
            <form action={salir}>
              <button type="submit" className="text-stone-600 underline hover:text-stone-900">
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
    </div>
  )
}
