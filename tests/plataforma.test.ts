import { describe, expect, it } from 'vitest'
import { CORREOS_ADMIN, administradores, correosDelEntorno } from '@/scripts/lib/administradores'

/**
 * Runs without a database. Guards the one piece of logic both bootstrap scripts share:
 * the set of platform admins is CORREOS_ADMIN ∪ CORREOS_STAFF, deduplicated and normalised.
 * sembrar-plataforma.ts invites exactly this set on production, so a silent drift here would
 * either lock the team out or grant the platform tier to the wrong address.
 */
describe('administradores de plataforma', () => {
  it('sin CORREOS_STAFF, es exactamente CORREOS_ADMIN normalizado', () => {
    expect(administradores('')).toEqual(CORREOS_ADMIN.map((c) => c.toLowerCase()))
  })

  it('une CORREOS_ADMIN con CORREOS_STAFF', () => {
    const set = administradores('ana@alisio.org, beto@alisio.org')
    expect(set).toContain('manuel.zamora.86@gmail.com')
    expect(set).toContain('ana@alisio.org')
    expect(set).toContain('beto@alisio.org')
  })

  it('deduplica y normaliza — una dirección repetida es una sola persona', () => {
    const set = administradores('Manuel.Zamora.86@gmail.com, ana@alisio.org, ANA@alisio.org')
    expect(set).toEqual([...new Set(set)])
    expect(set.filter((c) => c === 'manuel.zamora.86@gmail.com')).toHaveLength(1)
    expect(set.filter((c) => c === 'ana@alisio.org')).toHaveLength(1)
  })

  it('ignora entradas vacías o sin @ en CORREOS_STAFF', () => {
    expect(correosDelEntorno('no-es-correo, , ok@alisio.org')).toEqual(['ok@alisio.org'])
  })
})
