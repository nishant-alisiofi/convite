import type { PoolClient } from 'pg'
import type { FaseRespuesta } from '@/db/schema/vocabulario'
import { comunidadesEnSilencio } from '@/lib/observabilidad/silencio'
import { ordenarBandeja, type Rankeable, type TipoItem } from './rango'

/**
 * The single queue §18 asked for: everything awaiting a person, in one place, in one order.
 *
 * Three sources, deliberately read separately rather than unioned in SQL. They live in different
 * tables with different RLS policies and different notions of «waiting», and a UNION would force
 * one shape on all three and hide which policy refused what. Merging in TypeScript costs one
 * extra round trip and keeps each read legible.
 *
 * All three run under the caller's session, so RLS decides what is in the queue. That matters for
 * silence specifically: `/estado` reads it with the owner pool (justified there — it counts jobs
 * and migrations), and reusing that path here would have shown every coordinator every
 * community's quiet regardless of their organisation's scope.
 */

export type ItemBandeja = Rankeable & {
  id: string
  /** Where the coordinator goes to act on it. */
  href: string
  comunidad: string
  municipio: string | null
  /** The one line that says what this is: a motivo, the person's own words, or the silence. */
  detalle: string
  /** Item + families, or the channel that last worked. Secondary, may be absent. */
  contexto: string | null
  canal: string | null
  transcrito: boolean
  folio: number | null
}

export type BandejaUnificada = {
  items: ItemBandeja[]
  /** Per-type counts, for the summary line. Computed here so the screen does no arithmetic. */
  conteos: Record<TipoItem, number>
  fase: FaseRespuesta
}

/** Pedido states that mean «stuck, and a person has to decide something». */
const ESTADOS_ATASCADOS = ['SIN_RUTA', 'SIN_EXISTENCIA', 'SIN_CAPACIDAD', 'LISTO'] as const

export async function cargarBandejaUnificada(
  client: PoolClient,
  fase: FaseRespuesta,
  ahora: Date = new Date(),
): Promise<BandejaUnificada> {
  const [porVerificar, atascados, silencios] = await Promise.all([
    // 1. Reports intake wrote that nobody has judged yet. `sensible` is selected, never its
    //    content — PRD-49 redaction is physical, so a flagged row simply has no detail by the
    //    time it reaches here (migration 0063).
    client.query<{
      id: string
      folio: number
      comunidad: string
      municipio: string | null
      texto: string | null
      canal: string
      sensible: boolean
      urgencia: number | null
      dias: number
      transcrito: boolean
    }>(
      `select r.id, r.folio, c.nombre as comunidad, c.municipio,
              coalesce(r.detalle_libre, r.descripcion) as texto,
              r.canal, r.sensible, r.urgencia,
              extract(day from now() - r.creado_en)::int as dias,
              exists (
                select 1 from adjuntos a
                 where a.reporte_id = r.id and a.tipo = 'audio'
                   and coalesce(a.transcripcion_corregida, a.transcripcion) is not null
              ) as transcrito
         from reportes r
         join comunidades c on c.id = r.comunidad_id
        where r.estado = 'RECIBIDO'`,
    ),
    // 2. Pedidos the matcher could not move. `motivo` is the matcher's own sentence and is
    //    load-bearing copy (v3 Part II) — carried through verbatim, never re-worded here.
    client.query<{
      id: string
      comunidad: string
      municipio: string | null
      motivo: string | null
      estado: string
      item: string
      familias: number | null
      urgencia: number | null
      dias: number
      canal: string | null
    }>(
      `select p.id, c.nombre as comunidad, c.municipio, p.motivo, p.estado,
              ci.item_label as item, p.familias, p.urgencia,
              extract(day from now() - p.creado_en)::int as dias,
              r.canal
         from pedidos p
         join comunidades c on c.id = p.comunidad_id
         join catalogo_items ci on ci.codigo = p.codigo_item
         left join reportes r on r.id = p.reporte_id
        where p.estado = any($1::text[])`,
      [ESTADOS_ATASCADOS],
    ),
    // 3. Silence — §19's «the only signal that fires when nobody reports».
    comunidadesEnSilencio(client, ahora),
  ])

  const items: ItemBandeja[] = [
    ...porVerificar.rows.map((r) => ({
      tipo: 'verificar' as const,
      id: r.id,
      href: '/verificacion',
      folio: r.folio,
      comunidad: r.comunidad,
      municipio: r.municipio,
      detalle: r.sensible
        ? 'Reporte sensible — acceso restringido.'
        : (r.texto ?? 'Llegó sin texto: hay que escucharlo.'),
      contexto: null,
      canal: r.canal,
      transcrito: r.transcrito,
      sensible: r.sensible,
      urgencia: r.urgencia,
      dias: r.dias,
    })),
    ...atascados.rows.map((p) => ({
      tipo: 'atascado' as const,
      id: p.id,
      href: '/tablero',
      folio: null,
      comunidad: p.comunidad,
      municipio: p.municipio,
      detalle: p.motivo ?? 'Sin motivo registrado todavía.',
      contexto: p.familias ? `${p.item} · ${p.familias} familias` : p.item,
      canal: p.canal,
      transcrito: false,
      sensible: false,
      urgencia: p.urgencia,
      dias: p.dias,
    })),
    ...silencios.map((s) => {
      const nuncaVista = s.diasEnSilencio === null || s.diasEnSilencio < 0
      return {
        tipo: 'silencio' as const,
        id: s.comunidadId,
        href: '/comunidades',
        folio: null,
        comunidad: s.nombre,
        municipio: null,
        // BUG-24's distinction, carried here rather than collapsed. A tier-1/2 community we have
        // never heard from is a broken contact to fix; a tier-3/4 one is «alta, no alarma».
        detalle: nuncaVista
          ? s.tier <= 2
            ? 'Nunca hemos sabido nada de aquí, y debería llegarnos. Contacto roto.'
            : 'Nunca hemos sabido nada de aquí. Es alta, no alarma.'
          : `Sin señal hace ${s.diasEnSilencio} días; se revisa cada ${s.intervaloDias}.`,
        contexto: s.ultimoCanal ? `Último canal que sirvió: ${s.ultimoCanal}` : null,
        canal: null,
        transcrito: false,
        sensible: false,
        urgencia: null,
        dias: s.diasEnSilencio ?? 0,
        tier: s.tier,
        nuncaVista,
        intervaloDias: s.intervaloDias,
      }
    }),
  ]

  const conteos: Record<TipoItem, number> = { verificar: 0, atascado: 0, silencio: 0 }
  for (const it of items) conteos[it.tipo] += 1

  return { items: ordenarBandeja(items, fase), conteos, fase }
}
