'use client'

import { createBrowserClient } from '@supabase/ssr'

/** Browser client. Identity only — no domain data is ever read through PostgREST. */
export function clienteNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
