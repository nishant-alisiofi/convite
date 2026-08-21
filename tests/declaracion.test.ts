import { describe, expect, it } from 'vitest'
import { debeDeclarar, faltaDeclaracionAjena } from '@/lib/declaracion'

/**
 * Who gets asked to declare, and — more to the point — who does not.
 *
 * Every case below is somebody who would be stranded if the rule were slightly wrong: sent to
 * a form that refuses them, or gated behind a question they cannot answer, or asked which
 * disaster phase their one-person boat operation is in. The rule is pure precisely so these can
 * be pinned without a database.
 */

const base = {
  esPlataforma: false,
  estadoOrganizacion: 'aprobada',
  nivelAdmision: 'ancla' as string | null,
  rolStaff: 'admin',
  organizacionDeclarada: false,
}

describe('a quién se le pide la declaración', () => {
  it('al admin de una organización aprobada que todavía no ha declarado', () => {
    expect(debeDeclarar(base)).toBe(true)
  })

  it('a nadie, una vez declarada', () => {
    expect(debeDeclarar({ ...base, organizacionDeclarada: true })).toBe(false)
  })

  it('nunca al admin de plataforma: aprueba organizaciones, y quedaría encerrado tras lo que aprueba', () => {
    expect(debeDeclarar({ ...base, esPlataforma: true })).toBe(false)
  })

  it('nunca antes de la aprobación: primero se acepta que la organización exista', () => {
    for (const estado of ['pendiente', 'rechazada']) {
      expect(debeDeclarar({ ...base, estadoOrganizacion: estado })).toBe(false)
    }
  })

  it('nunca a un aportante: un transportista autorregistrado no está en ninguna «fase de la respuesta»', () => {
    expect(debeDeclarar({ ...base, nivelAdmision: 'aportante' })).toBe(false)
  })

  it('nunca a quien no es admin: la función SQL lo rechazaría y quedaría atrapado en el formulario', () => {
    for (const rol of ['coordinador', 'verificador', 'despachador', 'lectura']) {
      expect(debeDeclarar({ ...base, rolStaff: rol })).toBe(false)
    }
  })
})

describe('a quién se le avisa que falta', () => {
  it('al resto del equipo de una organización sin declarar', () => {
    expect(faltaDeclaracionAjena({ ...base, rolStaff: 'coordinador' })).toBe(true)
  })

  it('no al admin, que ya está en el formulario', () => {
    expect(faltaDeclaracionAjena(base)).toBe(false)
  })

  it('no a un aportante ni a plataforma, a quienes no se les pide nada', () => {
    expect(faltaDeclaracionAjena({ ...base, rolStaff: 'lectura', nivelAdmision: 'aportante' })).toBe(false)
    expect(faltaDeclaracionAjena({ ...base, rolStaff: 'coordinador', esPlataforma: true })).toBe(false)
  })

  it('las dos reglas nunca se disparan a la vez', () => {
    for (const rol of ['admin', 'coordinador', 'verificador', 'lectura']) {
      for (const declarada of [true, false]) {
        const s = { ...base, rolStaff: rol, organizacionDeclarada: declarada }
        expect(debeDeclarar(s) && faltaDeclaracionAjena(s)).toBe(false)
      }
    }
  })
})
