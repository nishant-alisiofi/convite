import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The secret in an Agenda subscribe URL — PRD-34 §28.1.
 *
 * §28.1: «Each URL is a secret tied to a membership and revoked on offboarding.» This mints and
 * verifies that secret without a new column or a migration: the token is the membership id signed
 * with a key derived from `BETTER_AUTH_SECRET`. It carries no data of its own — it is a signed
 * *pointer* to a membership — and it is only ever honoured after the handler confirms the
 * membership is still `activa`, so offboarding (suspending or terminating the membership) revokes
 * every URL that points at it, which is exactly the §29.6 coupling the PRD asks for. A membership
 * that is deleted and re-created gets a new id, so its old URLs stay dead.
 *
 * The signing key is *derived* from the auth secret rather than being it, so a feed URL leaking
 * (they end up in calendar-app logs and referrers — that is the nature of a subscribe URL) can
 * never be turned back into anything that signs a session. Read straight from `process.env`, like
 * the middleware does, so this module needs no database and no other configuration to verify a
 * token — a request for a bad token fails closed with nothing else standing up.
 */

const ETIQUETA_DERIVACION = 'convite:agenda:feed:v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The default the rest of the app uses for its public origin (mirrors lib/env.ts). */
const ORIGEN_POR_DEFECTO = 'http://localhost:3000'

function b64url(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function deB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/** The derived signing key, or null when identity is not configured (fail closed). */
function claveDeFeed(): Buffer | null {
  const secreto = process.env.BETTER_AUTH_SECRET
  if (!secreto) return null
  return createHmac('sha256', secreto).update(ETIQUETA_DERIVACION).digest()
}

function firmar(cuerpo: string, clave: Buffer): string {
  return b64url(createHmac('sha256', clave).update(cuerpo).digest())
}

/**
 * Mints the token for a membership. Throws if identity is not configured, because a caller minting
 * a URL for a coordinator has to know it will not verify — unlike verification, which fails quietly.
 */
export function tokenDeAgenda(membresiaId: string): string {
  const clave = claveDeFeed()
  if (!clave) throw new Error('BETTER_AUTH_SECRET ausente: no se puede firmar un feed de agenda')
  const cuerpo = b64url(Buffer.from(membresiaId, 'utf8'))
  return `${cuerpo}.${firmar(cuerpo, clave)}`
}

/**
 * The membership id a token points at, or null if the token is missing, malformed, tampered, or
 * signed with a different secret. A trailing `.ics` is tolerated so the human-friendly
 * `…/<token>.ics` subscribe URL resolves. The signature is compared in constant time.
 */
export function membresiaDeToken(token: string): string | null {
  const clave = claveDeFeed()
  if (!clave) return null

  const limpio = token.endsWith('.ics') ? token.slice(0, -4) : token
  const partes = limpio.split('.')
  if (partes.length !== 2) return null
  const [cuerpo, firma] = partes
  if (!cuerpo || !firma) return null

  const esperada = firmar(cuerpo, clave)
  const a = Buffer.from(firma)
  const b = Buffer.from(esperada)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  let id: string
  try {
    id = deB64url(cuerpo).toString('utf8')
  } catch {
    return null
  }
  return UUID.test(id) ? id : null
}

/**
 * The full subscribe URL a coordinator pastes into a calendar app. The panel surfaces this next to
 * a membership (that wiring is the lead's; this is the value it displays). The `.ics` suffix is
 * cosmetic — some clients key off it — and is stripped back off on the way in.
 */
export function urlDeSuscripcion(membresiaId: string, origen?: string): string {
  const base = (origen ?? process.env.APP_BASE_URL ?? ORIGEN_POR_DEFECTO).replace(/\/$/, '')
  return `${base}/api/agenda/${tokenDeAgenda(membresiaId)}.ics`
}
