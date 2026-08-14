import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { env } from '@/lib/env'

/**
 * Supabase client for Server Components, actions and route handlers.
 *
 * Used only for identity — sign-in, sign-out, reading the session. Data access goes through
 * Postgres directly (see lib/sesion.ts), so no schema is exposed through PostgREST and
 * `anon` has no network path to anything.
 */
export async function clienteServidor() {
  const almacen = await cookies()
  const url = env().SUPABASE_URL
  const clave = env().SUPABASE_ANON_KEY
  if (!url || !clave) throw new Error('Falta configurar SUPABASE_URL y SUPABASE_ANON_KEY.')

  return createServerClient(url, clave, {
    cookies: {
      getAll: () => almacen.getAll(),
      setAll: (cookiesNuevas) => {
        try {
          for (const { name, value, options } of cookiesNuevas) {
            almacen.set(name, value, options)
          }
        } catch {
          // Server Components cannot set cookies. The middleware refreshes the session, so
          // this is safe to ignore rather than something to work around.
        }
      },
    },
  })
}

export type SesionStaff = {
  authId: string
  correo: string
  rolStaff: string
  organizacionId: string
}
