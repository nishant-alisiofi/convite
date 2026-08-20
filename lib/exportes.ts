import type { PoolClient } from 'pg'
import type { EstadoJornada, TipoJornada } from '@/db/schema/vocabulario'
import { fechaSoloDia } from '@/lib/fechas'
import { ETIQUETA_ESTADO_JORNADA, ETIQUETA_TIPO_JORNADA, listarJornadas, paradasDe } from '@/lib/jornadas'

/**
 * The Agenda export — PRD-34 §28's Informes-exports item (CSV half), still missing as of the
 * Codex review that reopened this slice (aa02969: «no CSV/XLSX export»).
 *
 * XLSX is deliberately not produced here: the codebase carries no spreadsheet dependency today
 * (checked before writing this — same call `envios/[id]/manifiesto` already made about a PDF
 * library, choosing print-styled HTML instead), and PRD-34's own scope note says «a hand-rolled
 * CSV is fine». Hand-rolling XLSX (a zipped OOXML package) is a different order of effort and
 * risk than hand-rolling CSV, so this ships CSV only; adding a `.xlsx` writer is a follow-up
 * once a library is actually approved.
 *
 * One row per (jornada, parada), sourced from the same reads the Jornadas screen already uses
 * (`lib/jornadas.ts`), so RLS is the only boundary — this can never produce a row the caller
 * could not already see there.
 */
export type FilaExporteAgenda = {
  codigo: string
  tipo: string
  titulo: string
  estado: string
  region: string
  programa: string
  fechaInicio: string
  fechaFin: string
  familiasAtendidas: string
  paradaOrden: string
  paradaComunidad: string
  paradaNotas: string
}

const CABECERA_EXPORTE_AGENDA = [
  'Código',
  'Tipo',
  'Título',
  'Estado',
  'Región',
  'Programa',
  'Fecha inicio',
  'Fecha fin',
  'Familias atendidas',
  'Parada #',
  'Parada — comunidad',
  'Parada — notas',
] as const

/**
 * Every jornada this session may see, flattened to one row per stop — a jornada with three
 * stops is three rows sharing the same jornada columns; a jornada with none is one row with the
 * parada columns empty, so nothing silently disappears from the file.
 */
export async function filasExporteAgenda(client: PoolClient): Promise<FilaExporteAgenda[]> {
  const jornadas = await listarJornadas(client)
  const filas: FilaExporteAgenda[] = []

  for (const j of jornadas) {
    const base = {
      codigo: j.codigo,
      tipo: ETIQUETA_TIPO_JORNADA[j.tipo as TipoJornada] ?? j.tipo,
      titulo: j.titulo,
      estado: ETIQUETA_ESTADO_JORNADA[j.estado as EstadoJornada] ?? j.estado,
      region: j.regionNombre ?? '',
      programa: j.programaTitulo ?? '',
      fechaInicio: j.fechaInicio ? fechaSoloDia(j.fechaInicio) : '',
      fechaFin: j.fechaFin ? fechaSoloDia(j.fechaFin) : '',
      familiasAtendidas: j.familiasAtendidas === null ? '' : String(j.familiasAtendidas),
    }

    const paradas = j.paradas > 0 ? await paradasDe(client, j.id) : []
    if (paradas.length === 0) {
      filas.push({ ...base, paradaOrden: '', paradaComunidad: '', paradaNotas: '' })
      continue
    }
    for (const p of paradas) {
      filas.push({
        ...base,
        paradaOrden: String(p.orden + 1),
        paradaComunidad: p.comunidadNombre ?? '',
        paradaNotas: p.notas ?? '',
      })
    }
  }

  return filas
}

/**
 * One CSV field, RFC 4180: quoted (with internal quotes doubled) whenever the raw value carries
 * a comma, a quote or a newline — the three characters that would otherwise be read as
 * structure. Everything else passes through unquoted.
 */
function celda(valor: string): string {
  return /[",\n\r]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor
}

function filaAValores(f: FilaExporteAgenda): string[] {
  return [
    f.codigo,
    f.tipo,
    f.titulo,
    f.estado,
    f.region,
    f.programa,
    f.fechaInicio,
    f.fechaFin,
    f.familiasAtendidas,
    f.paradaOrden,
    f.paradaComunidad,
    f.paradaNotas,
  ]
}

/**
 * Renders rows as CSV text: CRLF line endings (RFC 4180), and a leading UTF-8 BOM so Excel —
 * which guesses Windows-1252 without one — opens «Distribución», «región», etc. with the right
 * accents instead of mangling them.
 */
export function csvDeFilas(filas: FilaExporteAgenda[]): string {
  const lineas = [Array.from(CABECERA_EXPORTE_AGENDA), ...filas.map(filaAValores)]
  const cuerpo = lineas.map((l) => l.map(celda).join(',')).join('\r\n')
  return `﻿${cuerpo}\r\n`
}
