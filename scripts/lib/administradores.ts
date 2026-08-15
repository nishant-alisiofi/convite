/**
 * The platform tier (§2.5): the real people who approve centres and see across organisations.
 *
 * Two sources, so the Alisio team can be granted the platform tier on any environment without
 * touching the demo rigs:
 *
 *   - `CORREOS_ADMIN` — hardcoded here, invited on every environment forever. Editing this
 *     array should be reserved for people who belong on the platform tier permanently.
 *   - `CORREOS_STAFF` — a comma-separated Railway variable, so more of the team can be added
 *     without a deploy.
 *
 * Both `sembrar-staff.ts` (staging, alongside the plus-addressed demo rigs) and
 * `sembrar-plataforma.ts` (production bootstrap: these people and nothing else) invite exactly
 * this set. Pure — no database, no side effects — so the set can be asserted in a unit test.
 */

/** Real people, invited as platform admins on every environment, forever. */
export const CORREOS_ADMIN = ['manuel.zamora.86@gmail.com']

/** Parse the comma-separated `CORREOS_STAFF` value into normalised addresses. */
export function correosDelEntorno(
  valor: string | undefined = process.env.CORREOS_STAFF,
): string[] {
  return (valor ?? '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c.includes('@'))
}

/** Both sources, deduplicated — the same address in the array and the env var is one person. */
export function administradores(valor?: string): string[] {
  return [...new Set([...CORREOS_ADMIN.map((c) => c.toLowerCase()), ...correosDelEntorno(valor)])]
}
