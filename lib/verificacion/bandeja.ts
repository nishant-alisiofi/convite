import type { PoolClient } from 'pg'
import { getPool } from '@/db/client'
import type { Canal, TipoReporteRegistrado } from '@/db/schema/vocabulario'
import { emparejar } from '@/lib/matching/persistencia'
import { cargarCatalogo, extraer, type Catalogo } from '@/lib/normalizador'
import { temporadaVigente } from '@/lib/temporada'

/**
 * The verification inbox — the daily work of this system.
 *
 * Section 4.5: unverified voice notes with the transcript beside them, playable, with
 * verify / correct / mark-duplicate. Ordered by urgency then age, because the real question
 * is «what has been waiting longest and still fits on Thursday's boat».
 *
 * The rule underneath all of it is that a `pedido` exists because a person put it there.
 * Intake writes a `reporte` the moment a message lands (2.13) and never more than that; the
 * step from report to request is a judgement someone signs. The database enforces it with a
 * trigger rather than trusting this module (migration 0023), because intake runs as
 * `service_role` and `service_role` bypasses RLS.
 */

/**
 * Above this speech-to-text confidence the machine's transcript is worth offering as a
 * starting point; below it, the correction field is left blank so a tired verifier has to
 * transcribe what they actually hear instead of rubber-stamping a low-confidence guess
 * (PRD v3 D2). One threshold for every audio channel — WhatsApp voice notes, IVR recordings,
 * radio clips — because the risk is the same wherever a machine guessed at Chocoano.
 */
export const UMBRAL_CONFIANZA_TRANSCRIPCION = 0.75

/** Whether a transcript is confident enough to pre-fill the correction field (PRD v3 D2). */
export function confianzaAlta(confianza: number | null): boolean {
  return confianza !== null && confianza >= UMBRAL_CONFIANZA_TRANSCRIPCION
}

export type AdjuntoBandeja = {
  id: string
  tipo: string
  mime: string | null
  duracionSeg: number | null
  /** What speech-to-text heard. Never edited. */
  transcripcion: string | null
  transcripcionConfianza: number | null
  /** What a person says was actually said. */
  transcripcionCorregida: string | null
  corregidaEn: Date | null
}

export type FilaBandeja = {
  id: string
  folio: number
  tipo: TipoReporteRegistrado
  canal: Canal
  estado: string
  descripcion: string | null
  detalleLibre: string | null
  /**
   * What the person actually wrote or dictated, whichever column holds it.
   *
   * Intake stores the inbound text in `detalle_libre` and leaves `descripcion` null; the
   * seed does the opposite. Both are "their words" and the screen shows them as such rather
   * than making a verifier learn which column a row came from.
   */
  textoOriginal: string | null
  /**
   * Why the classifier landed where it did — «ninguna palabra del léxico coincidió»,
   * «marcador vago: "de todo"», «indicio débil para 31 (0.32 < 0.5)».
   *
   * Re-derived at read time rather than read from a column, because intake computes these
   * and discards them. `extraer` is pure and offline, so the same text yields the same
   * reasoning; what it reflects is how the classifier reads this message *now*, which is
   * the more useful thing for somebody deciding what to do with it. `versionLexico` says
   * which lexicon produced it.
   */
  motivos: string[]
  versionLexico: string | null
  familias: number | null
  urgencia: number | null
  severidad: number | null
  dias: number
  comunidadId: string | null
  comunidad: string | null
  municipio: string | null
  contacto: string | null
  codigoItem: string | null
  item: string | null
  /** Section 4.5: items that ask for detail and did not get any do not enter the queue. */
  pideDetalle: boolean
  /** False for needs that are not cargo — a visit, not a box. Kept in a separate list. */
  entregable: boolean
  urgenciaMin: number | null
  adjuntos: AdjuntoBandeja[]
  yaEsPedido: boolean
}

export type Bandeja = {
  /** Waiting on a human, worst first. */
  pendientes: FilaBandeja[]
  /** Verified needs that are not cargo: a referral list, not a shipment (Section 4.5). */
  derivaciones: FilaBandeja[]
}

const SELECCION = `
  select r.id, r.folio, r.tipo, r.canal, r.estado, r.descripcion, r.detalle_libre,
         r.familias, r.urgencia, r.severidad, r.comunidad_id, r.codigo_item,
         extract(day from now() - r.creado_en)::int as dias,
         c.nombre as comunidad, c.municipio,
         ct.nombre as contacto,
         ci.item_label as item, ci.pide_detalle, ci.entregable, ci.urgencia_min,
         exists (select 1 from pedidos p where p.reporte_id = r.id) as ya_es_pedido
    from reportes r
    left join comunidades c on c.id = r.comunidad_id
    left join contactos ct on ct.id = r.contacto_id
    left join catalogo_items ci on ci.codigo = r.codigo_item
`

type FilaCruda = Record<string, never>

function aFila(
  r: Record<string, unknown>,
  adjuntos: AdjuntoBandeja[],
  catalogo: Catalogo | null,
  ahora: Date,
): FilaBandeja {
  const textoOriginal =
    ((r.detalle_libre as string) ?? null) || ((r.descripcion as string) ?? null)

  // The transcript a person corrected outranks the machine's, and both outrank nothing:
  // a voice note's words are what the classifier should be explaining.
  const audio = adjuntos.find((a) => a.tipo === 'audio')
  const texto =
    audio?.transcripcionCorregida ?? audio?.transcripcion ?? textoOriginal

  const propuesta = catalogo ? extraer(texto, { catalogo, ahora }) : null

  return {
    id: r.id as string,
    folio: r.folio as number,
    tipo: r.tipo as TipoReporteRegistrado,
    canal: r.canal as Canal,
    estado: r.estado as string,
    descripcion: (r.descripcion as string) ?? null,
    detalleLibre: (r.detalle_libre as string) ?? null,
    textoOriginal,
    motivos: propuesta?.motivos ?? [],
    versionLexico: propuesta?.versionLexico ?? null,
    familias: (r.familias as number) ?? null,
    urgencia: (r.urgencia as number) ?? null,
    severidad: (r.severidad as number) ?? null,
    dias: (r.dias as number) ?? 0,
    comunidadId: (r.comunidad_id as string) ?? null,
    comunidad: (r.comunidad as string) ?? null,
    municipio: (r.municipio as string) ?? null,
    contacto: (r.contacto as string) ?? null,
    codigoItem: (r.codigo_item as string) ?? null,
    item: (r.item as string) ?? null,
    pideDetalle: Boolean(r.pide_detalle),
    entregable: r.entregable === null || r.entregable === undefined ? true : Boolean(r.entregable),
    urgenciaMin: (r.urgencia_min as number) ?? null,
    adjuntos,
    yaEsPedido: Boolean(r.ya_es_pedido),
  }
}

async function adjuntosDe(
  client: PoolClient,
  reporteIds: string[],
): Promise<Map<string, AdjuntoBandeja[]>> {
  const porReporte = new Map<string, AdjuntoBandeja[]>()
  if (reporteIds.length === 0) return porReporte

  const { rows } = await client.query(
    `select id, reporte_id, tipo, mime, duracion_seg, transcripcion,
            transcripcion_confianza, transcripcion_corregida, corregida_en
       from adjuntos
      where reporte_id = any($1::uuid[])
      order by creado_en`,
    [reporteIds],
  )

  for (const a of rows) {
    const lista = porReporte.get(a.reporte_id) ?? []
    lista.push({
      id: a.id,
      tipo: a.tipo,
      mime: a.mime,
      duracionSeg: a.duracion_seg,
      transcripcion: a.transcripcion,
      transcripcionConfianza:
        a.transcripcion_confianza === null ? null : Number(a.transcripcion_confianza),
      transcripcionCorregida: a.transcripcion_corregida,
      corregidaEn: a.corregida_en,
    })
    porReporte.set(a.reporte_id, lista)
  }
  return porReporte
}

export type FiltroTipo = 'todo' | TipoReporteRegistrado

/**
 * The queue.
 *
 * Sorted by urgency then age, and nothing filters by community here: a verificador scoped to
 * the Atrato medio sees their own because RLS says so, not because this query narrowed it.
 */
export async function cargarBandeja(
  client: PoolClient,
  filtro: FiltroTipo = 'todo',
): Promise<Bandeja> {
  const { rows: pendientesCrudas } = await client.query<FilaCruda>(
    `${SELECCION}
      where r.estado = 'RECIBIDO'
        and ($1 = 'todo' or r.tipo = $1)
      order by r.urgencia desc nulls last, r.creado_en`,
    [filtro],
  )

  // Verified, not cargo, and therefore never a shipment. They still need somebody to act.
  const { rows: derivacionesCrudas } = await client.query<FilaCruda>(
    `${SELECCION}
      where r.estado = 'VERIFICADO' and ci.entregable = false
      order by r.urgencia desc nulls last, r.creado_en`,
  )

  const todas = [...pendientesCrudas, ...derivacionesCrudas] as unknown as Record<
    string,
    unknown
  >[]
  const adjuntos = await adjuntosDe(
    client,
    todas.map((r) => r.id as string),
  )

  const catalogo = await cargarCatalogo(client)
  const ahora = new Date()
  const mapear = (filas: unknown[]) =>
    (filas as Record<string, unknown>[]).map((r) =>
      aFila(r, adjuntos.get(r.id as string) ?? [], catalogo, ahora),
    )

  return {
    pendientes: mapear(pendientesCrudas),
    derivaciones: mapear(derivacionesCrudas),
  }
}

export async function reportePorId(
  client: PoolClient,
  id: string,
): Promise<FilaBandeja | null> {
  const { rows } = await client.query<FilaCruda>(`${SELECCION} where r.id = $1`, [id])
  const fila = rows[0] as unknown as Record<string, unknown> | undefined
  if (!fila) return null

  const adjuntos = await adjuntosDe(client, [id])
  return aFila(fila, adjuntos.get(id) ?? [], await cargarCatalogo(client), new Date())
}

/**
 * Reports that might be the same event as this one.
 *
 * Same community, same item, within three days — deliberately a wide net offered to a
 * person, never an automatic merge. Two families reporting the same flood is two families,
 * and only somebody who knows the place can tell that from one event reported twice.
 */
export async function posiblesDuplicados(
  client: PoolClient,
  reporteId: string,
): Promise<FilaBandeja[]> {
  const { rows } = await client.query<FilaCruda>(
    `${SELECCION}
      where r.id <> $1
        and r.estado in ('RECIBIDO', 'VERIFICADO')
        and r.comunidad_id = (select comunidad_id from reportes where id = $1)
        and r.codigo_item is not distinct from (select codigo_item from reportes where id = $1)
        and abs(extract(epoch from r.creado_en - (select creado_en from reportes where id = $1)))
            < 3 * 86400
      order by r.creado_en`,
    [reporteId],
  )
  // Candidates are shown as one-liners, so the classifier's reasoning is not needed here.
  return (rows as unknown as Record<string, unknown>[]).map((r) => aFila(r, [], null, new Date()))
}

export type Resultado = { ok: true } | { ok: false; error: string }

/**
 * Promotion's result carries the new pedido's id, because the caller has one more thing to do
 * with it: run the matcher so the request lands in a Tablero group instead of sitting in the
 * invisible `ABIERTO` default. See `promoverAPedido` and `emparejarPedido`.
 */
export type ResultadoPromocion = { ok: true; pedidoId: string } | { ok: false; error: string }

function traducirError(error: unknown): string {
  const restriccion = (error as { constraint?: string })?.constraint
  const mensaje = (error as { message?: string })?.message ?? ''

  if (mensaje.includes('reporte verificado por una persona')) {
    return 'Un pedido solo nace de un reporte que alguien verificó.'
  }
  if (restriccion === 'reportes_disposicion_check') {
    return 'Falta registrar quién tomó la decisión.'
  }
  if (restriccion === 'reportes_duplicado_check') {
    return 'Para marcar un duplicado hay que decir de cuál reporte lo es.'
  }
  if (restriccion === 'pedidos_reporte_key') {
    return 'Ese reporte ya tiene un pedido.'
  }
  if (restriccion === 'reportes_sin_clasificar_sin_item_check') {
    return 'Un reporte sin clasificar no puede llevar un ítem del catálogo.'
  }
  return 'No se pudo guardar el cambio.'
}

/** Marks the report verified, with the verifier's name on it (2.1). */
export async function verificar(
  client: PoolClient,
  reporteId: string,
  usuarioId: string,
): Promise<Resultado> {
  try {
    const { rowCount } = await client.query(
      `update reportes
          set estado = 'VERIFICADO', verificado_por = $2, verificado_en = now()
        where id = $1 and estado = 'RECIBIDO'`,
      [reporteId, usuarioId],
    )
    if (rowCount === 0) {
      return { ok: false, error: 'Ese reporte ya salió de la cola, o no tiene permiso.' }
    }
    await auditar(client, usuarioId, 'reporte.verificado', reporteId, null)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: traducirError(error) }
  }
}

/**
 * Marks this report as the same event as an earlier one.
 *
 * The more consequential direction: it makes a need disappear rather than appear, so it
 * carries a name exactly like a verification does.
 */
export async function marcarDuplicado(
  client: PoolClient,
  reporteId: string,
  padreId: string,
  usuarioId: string,
): Promise<Resultado> {
  if (padreId === reporteId) {
    return { ok: false, error: 'Un reporte no puede ser duplicado de sí mismo.' }
  }

  try {
    const { rowCount } = await client.query(
      `update reportes
          set estado = 'DUPLICADO', reporte_padre_id = $2,
              verificado_por = $3, verificado_en = now()
        where id = $1 and estado = 'RECIBIDO'`,
      [reporteId, padreId, usuarioId],
    )
    if (rowCount === 0) {
      return { ok: false, error: 'Ese reporte ya salió de la cola, o no tiene permiso.' }
    }
    await auditar(client, usuarioId, 'reporte.duplicado', reporteId, { padreId })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: traducirError(error) }
  }
}

/**
 * Records what a person says the voice note actually said.
 *
 * `transcripcion` is left exactly as the machine produced it (2.12). Losing it would mean
 * losing the only evidence of how the transcriber handles Chocoano — which is the evidence
 * that decides whether to change provider.
 */
export async function corregirTranscripcion(
  client: PoolClient,
  adjuntoId: string,
  texto: string,
  usuarioId: string,
): Promise<Resultado> {
  const limpio = texto.trim()
  if (limpio.length === 0) {
    return { ok: false, error: 'Escriba lo que dice la nota antes de guardar.' }
  }

  try {
    const { rowCount } = await client.query(
      `update adjuntos
          set transcripcion_corregida = $2, corregida_por = $3, corregida_en = now()
        where id = $1 and tipo = 'audio'`,
      [adjuntoId, limpio, usuarioId],
    )
    if (rowCount === 0) return { ok: false, error: 'No se pudo corregir esa nota.' }

    await auditar(client, usuarioId, 'adjunto.transcripcion_corregida', adjuntoId, null)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: traducirError(error) }
  }
}

/**
 * Sets — or corrects — a report's proposed classification.
 *
 * Two jobs, one path (PRD v3 D3). `sin_clasificar` is a first-class state, not an error (0021)
 * — «Muchas cosas!! De todo!!!» is a phone call somebody makes, and this is where that call
 * ends: a person says what it turned out to be. But a *classified* report can also carry the
 * wrong category — a perfect transcript with a medicine code on an «agua potable» note — and
 * the verifier has to be able to fix that too, independently of the transcript.
 *
 * `tipo` comes from the catalogue rather than the form, because knowing the item is knowing the
 * type and letting them disagree writes half a classification. The machine's original proposal
 * is never lost: it is re-derivable at read time from the raw text by `extraer` (the same way
 * the classifier's reasoning is), and the previous code is recorded in `auditoria` with the
 * name of whoever changed it (Section 6, 11).
 */
export async function clasificar(
  client: PoolClient,
  reporteId: string,
  codigoItem: string,
  usuarioId: string,
): Promise<Resultado> {
  try {
    const { rows } = await client.query<{ codigo_item_anterior: string | null }>(
      // `antes` reads the row as it stood at the start of the statement, so it captures the
      // previously-proposed code before the update overwrites it — that is what gets logged.
      `with antes as (select codigo_item from reportes where id = $1)
       update reportes r
          set codigo_item = ci.codigo,
              tipo = ci.tipo,
              urgencia = greatest(coalesce(r.urgencia, 1), ci.urgencia_min)
         from catalogo_items ci, antes
        where r.id = $1 and ci.codigo = $2 and r.estado = 'RECIBIDO'
       returning antes.codigo_item as codigo_item_anterior`,
      [reporteId, codigoItem],
    )
    if (rows.length === 0) return { ok: false, error: 'No se pudo clasificar ese reporte.' }

    await auditar(
      client,
      usuarioId,
      'reporte.clasificado',
      reporteId,
      { codigoItem },
      { codigoItem: rows[0]!.codigo_item_anterior },
    )
    return { ok: true }
  } catch (error) {
    return { ok: false, error: traducirError(error) }
  }
}

/**
 * Verifies and promotes in one action, because it is one decision.
 *
 * A person read this, believes it, and says it should be served. Both halves land in the
 * same transaction so there is no state where a report is verified and its request silently
 * failed to appear.
 */
export async function promoverAPedido(
  client: PoolClient,
  reporteId: string,
  usuarioId: string,
  familias: number,
): Promise<ResultadoPromocion> {
  if (!Number.isInteger(familias) || familias <= 0) {
    return { ok: false, error: 'Diga a cuántas familias les falta.' }
  }

  try {
    await client.query('savepoint promover')

    const { rowCount } = await client.query(
      `update reportes
          set estado = 'VERIFICADO', verificado_por = $2, verificado_en = now()
        where id = $1 and estado in ('RECIBIDO', 'VERIFICADO')`,
      [reporteId, usuarioId],
    )
    if (rowCount === 0) {
      await client.query('rollback to savepoint promover')
      return { ok: false, error: 'Ese reporte ya salió de la cola, o no tiene permiso.' }
    }

    const insercion = await client.query<{ id: string }>(
      `insert into pedidos (reporte_id, comunidad_id, codigo_item, familias, urgencia)
       select r.id, r.comunidad_id, r.codigo_item, $2,
              greatest(coalesce(r.urgencia, 1), ci.urgencia_min)
         from reportes r
         join catalogo_items ci on ci.codigo = r.codigo_item
        where r.id = $1
          and ci.entregable
          -- Section 4.5: an item that asks for detail and did not get any is incomplete, and
          -- an incomplete row does not enter the queue. «Medicamento crónico» with no idea
          -- which medicine is a trip somebody makes for nothing.
          and not (ci.pide_detalle and r.detalle_libre is null)
       returning id`,
      [reporteId, familias],
    )

    if (insercion.rowCount === 0) {
      await client.query('rollback to savepoint promover')
      return {
        ok: false,
        error:
          'Ese reporte no puede volverse pedido todavía: falta el ítem, falta el detalle que ' +
          'ese ítem pide, o no es carga.',
      }
    }

    await auditar(client, usuarioId, 'reporte.promovido', reporteId, { familias })
    await client.query('release savepoint promover')
    return { ok: true, pedidoId: insercion.rows[0]!.id }
  } catch (error) {
    await client.query('rollback to savepoint promover').catch(() => {})
    return { ok: false, error: traducirError(error) }
  }
}

/**
 * Runs the matcher for a single, freshly-promoted pedido so it lands in a Tablero group with a
 * motivo — instead of sitting in the `ABIERTO` default the board counts in its total but shows
 * in no bucket. Section 8 lists «a new pedido» as one of the five matcher triggers; promotion
 * is where a pedido is born, so this is where that trigger has to fire.
 *
 * It runs on its own pool connection as the table owner, the same footing as the cron worker
 * (`emparejar_pedido`) and `pnpm emparejar`. Two reasons it cannot ride the promoting user's
 * transaction: the matcher writes `pedidos.estado/motivo` and *proposed* `emparejamientos`
 * rows, none of which RLS lets a verificador do (0017); and a separate connection could not
 * see the pedido until its transaction has committed. So the caller promotes first, then calls
 * this. The engine only proposes — it never commits capacity or stock, so «the matcher
 * proposes; a person commits» still holds (2.1).
 */
export async function emparejarPedido(pedidoId: string): Promise<void> {
  const client = await getPool().connect()
  try {
    await client.query('begin')
    const temporada = await temporadaVigente(client)
    await emparejar(client, { temporada, pedidoId })
    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

async function auditar(
  client: PoolClient,
  actorId: string,
  accion: string,
  entidadId: string,
  despues: unknown,
  antes: unknown = null,
): Promise<void> {
  await client.query(
    `insert into auditoria (actor_id, accion, entidad, entidad_id, antes, despues)
     values ($1, $2, 'reportes', $3, $4, $5)`,
    [
      actorId,
      accion,
      entidadId,
      antes ? JSON.stringify(antes) : null,
      despues ? JSON.stringify(despues) : null,
    ],
  )
}

/** The catalogue, for the classify control. Data, never a switch on a code (2.8). */
export async function itemsDelCatalogo(client: PoolClient) {
  const { rows } = await client.query<{
    codigo: string
    item_label: string
    tipo: string
    entregable: boolean
  }>(
    `select codigo, item_label, tipo, entregable from catalogo_items
      where activo order by tipo, orden, codigo`,
  )
  return rows
}
