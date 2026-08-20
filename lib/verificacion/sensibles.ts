import type { Pool, PoolClient } from 'pg'
import { proveedorSmsActivo } from '@/lib/canales'

/**
 * PRD-49 — the sensitive-disclosure mechanism: distress-term detection, manual flagging, and
 * escalation delivery.
 *
 * Redaction itself is NOT here — it is physical (migration 0063 moves the content to
 * `reportes_contenido_protegido` the instant a report is flagged, so every existing reader of
 * `reportes` already gets the redacted view with no code change). This module is the three
 * pieces that stay in TypeScript because they are not row-security concerns: matching text
 * against a configured term list, wrapping the SECURITY DEFINER manual-flag function for an
 * authenticated caller, and actually delivering the escalation alert over the network.
 */

export type TerminoRiesgo = { termino: string; activo: boolean }

/**
 * PARTNER DATA. Reads `terminos_riesgo` — deliberately empty until Red de Mujeres /
 * ASOREDIPARCHOCÓ hand over a real list (PRD-49 Out-of-scope). An empty result is the normal,
 * expected state, not an error: `coincideTerminoRiesgo` returns false for everything against an
 * empty list, which is exactly "no false triggers".
 */
export async function cargarTerminosActivos(client: PoolClient | Pool): Promise<string[]> {
  const { rows } = await client.query<{ termino: string }>(
    `select termino from terminos_riesgo where activo`,
  )
  return rows.map((r) => r.termino)
}

/**
 * Whole-word, case- and accent-insensitive. Deliberately dumb and legible rather than fuzzy —
 * this is a safety routing decision (never a diagnosis, v3 §27b.3), and a match a person can
 * explain by reading the term list beats a score nobody can audit. Word-bounded so a term like
 * «el» does not fire on «abuelo».
 */
export function coincideTerminoRiesgo(texto: string | null | undefined, terminos: string[]): boolean {
  if (!texto || terminos.length === 0) return false
  const normalizado = normaliza(texto)
  return terminos.some((termino) => {
    const t = normaliza(termino).trim()
    if (t.length === 0) return false
    const patron = new RegExp(`(^|\\W)${escaparRegex(t)}($|\\W)`, 'i')
    return patron.test(normalizado)
  })
}

function normaliza(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export type DatosProtegidosIntake = {
  reporteId: string
  organizacionId: string
  folio: number
  detalleLibre: string | null
  lat: number | null
  lon: number | null
  ubicacionFuente: string | null
  ubicacionPrecisionM: number | null
  contactoId: string | null
}

/**
 * The automated half of PRD-49's flagging path. Called from `lib/canales/intake.ts` right after
 * a term-matched report is inserted (with its identifying columns already NULL — see that call
 * site) — never through `convite_marcar_reporte_sensible`, which requires `auth.uid()` and intake
 * has no session to offer it. Runs on intake's own owner-privileged connection, exactly like the
 * INSERT into `reportes` beside it, so this is additive to the same transaction: either the whole
 * report (redacted row + protected payload + escalation signal) commits, or none of it does.
 */
export async function marcarProtegidoAlIngresar(
  client: PoolClient,
  datos: DatosProtegidosIntake,
): Promise<void> {
  await client.query(
    `insert into reportes_contenido_protegido
       (reporte_id, detalle_libre, ubicacion, ubicacion_fuente, ubicacion_precision_m, contacto_id)
     values ($1, $2,
       case when $3::double precision is null then null
            else st_setsrid(st_makepoint($4::double precision, $3::double precision), 4326) end,
       $5, $6, $7)`,
    [
      datos.reporteId,
      datos.detalleLibre,
      datos.lat,
      datos.lon,
      datos.ubicacionFuente,
      datos.ubicacionPrecisionM,
      datos.contactoId,
    ],
  )

  await client.query(
    `insert into auditoria (actor_id, accion, entidad, entidad_id, despues)
       values (null, 'reporte.marcado_sensible', 'reportes', $1,
               jsonb_build_object('motivo', 'termino_detectado'))`,
    [datos.reporteId],
  )

  await client.query(
    `insert into alertas_proteccion (reporte_id, organizacion_id, contacto_proteccion_id, folio, canal)
     select $1, $2, cp.id, $3, cp.canal_preferido
       from contactos_proteccion cp
      where cp.organizacion_id = $2 and cp.activo`,
    [datos.reporteId, datos.organizacionId, datos.folio],
  )
}

export type ResultadoMarcarSensible =
  | { ok: true }
  | { ok: false; error: string }

const ERRORES_MARCAR: Record<string, string> = {
  sin_sesion: 'No hay una sesión activa.',
  no_existe: 'Ese reporte no existe.',
  ya_sensible: 'Ese reporte ya está marcado como sensible.',
  sin_permiso: 'No tiene permiso para marcar ese reporte.',
}

/**
 * A verifier/coordinador/admin flags an already-received report sensible by hand (Scope §1).
 * Everything — moving the content, nulling the columns, the audit row, writing the escalation
 * signal — happens atomically inside `convite_marcar_reporte_sensible` (SECURITY DEFINER,
 * migration 0063). Run this under `conSesion(sesion, fn, { escribe: true })` exactly like
 * `verificar`/`marcarDuplicado` in bandeja.ts, so RLS and the function's own permission check
 * both see the real caller.
 */
export async function marcarReporteSensibleManual(
  client: PoolClient,
  reporteId: string,
): Promise<ResultadoMarcarSensible> {
  const { rows } = await client.query<{ convite_marcar_reporte_sensible: string }>(
    `select convite_marcar_reporte_sensible($1)`,
    [reporteId],
  )
  const resultado = rows[0]?.convite_marcar_reporte_sensible ?? 'sin_sesion'
  if (resultado === 'marcado' || resultado === 'ya_sensible') {
    return { ok: true }
  }
  return { ok: false, error: ERRORES_MARCAR[resultado] ?? 'No se pudo marcar el reporte.' }
}

/** «folio · tipo» and nothing else — PRD-34 §28.1's discretion rule, applied to this alert. */
export function copiaAlertaProteccion(folio: number): string {
  return `Convite: reporte sensible #${folio}. Revisar de inmediato en el panel — no se envía el contenido por este medio.`
}

export type AlertaPendiente = {
  id: string
  folio: number
  telefono: string
}

/**
 * Every `alertas_proteccion` row still `pendiente`, joined to its (already validated E.164)
 * protection-lead contact. Rows with no `contacto_proteccion_id` — none configured for that org
 * at the moment the report was flagged — are excluded on purpose: there is genuinely nowhere to
 * send them, and they stay `pendiente` rather than being force-marked `fallido`, so backfilling a
 * contact later does not require re-flagging the report to get a send.
 */
async function alertasPendientes(ejecutor: Pool | PoolClient): Promise<AlertaPendiente[]> {
  const { rows } = await ejecutor.query<{ id: string; folio: number; telefono: string }>(
    `select a.id, a.folio, cp.telefono
       from alertas_proteccion a
       join contactos_proteccion cp on cp.id = a.contacto_proteccion_id and cp.activo
      where a.estado = 'pendiente'
      order by a.creado_en`,
  )
  return rows
}

export type ResultadoEnvioAlertas = { intentadas: number; enviadas: number; fallidas: number }

/**
 * Delivers every pending protection-lead alert.
 *
 * Runs on its own connection with owner privileges — mirrors `emparejarPedido` in bandeja.ts:
 * the row was already written, atomically, inside `convite_marcar_reporte_sensible`'s
 * transaction; this is the separate, idempotent delivery step network I/O has no business being
 * inside a SQL function for. Safe to call repeatedly (a cron tick, or right after flagging one
 * report) — a `pendiente` row is claimed by moving it to `enviado`/`fallido` before the next
 * caller could double-send it, because each row is updated individually right after its own send
 * attempt completes.
 *
 * Transport is SMS regardless of `contactos_proteccion.canal_preferido` — WhatsApp's Cloud API
 * requires a Meta-approved message template for any send outside a 24h service window (the same
 * D3 gap `lib/canales/whatsapp/envio.ts` documents for the sign-in code), and no such template
 * exists for this alert. `canal_preferido` stays as data for the day that template is approved;
 * this is the function to branch in when it is.
 */
export async function enviarAlertasPendientes(
  ejecutor: Pool | PoolClient,
): Promise<ResultadoEnvioAlertas> {
  const pendientes = await alertasPendientes(ejecutor)
  const proveedor = proveedorSmsActivo()

  let enviadas = 0
  let fallidas = 0

  for (const alerta of pendientes) {
    try {
      await proveedor.enviar(alerta.telefono, copiaAlertaProteccion(alerta.folio))
      await ejecutor.query(
        `update alertas_proteccion set estado = 'enviado', enviado_en = now(), error = null
          where id = $1 and estado = 'pendiente'`,
        [alerta.id],
      )
      enviadas += 1
    } catch (error) {
      await ejecutor.query(
        `update alertas_proteccion set estado = 'fallido', error = $2
          where id = $1 and estado = 'pendiente'`,
        [alerta.id, error instanceof Error ? error.message : 'Error desconocido al enviar.'],
      )
      fallidas += 1
    }
  }

  return { intentadas: pendientes.length, enviadas, fallidas }
}

export type ReporteSensibleUrgente = {
  id: string
  folio: number
  tipo: string
  comunidad: string | null
  dias: number
}

/**
 * The escalation surface (§6.3): every flagged report, worst-first by age, with NOTHING beyond
 * folio/tipo/comunidad/age — the same discretion-rule payload as the alert itself. RLS narrows
 * this to what the caller may actually see: a general coordinador/despachador sees the row
 * (folio, tipo, community) because `reportes_lectura`/`reportes_lectura_vulnerable` both allow
 * it; a verificador_vulnerable sees the same plus, separately, the un-redacted content via
 * `reportesContenidoProtegido`/adjuntos. Meant for Bandeja/Silencio to surface as urgent —
 * bypassing the ordinary urgencia-sorted queue entirely, per reportes_sensible_idx.
 */
export async function reportesSensiblesUrgentes(
  client: PoolClient,
): Promise<ReporteSensibleUrgente[]> {
  const { rows } = await client.query<{
    id: string
    folio: number
    tipo: string
    comunidad: string | null
    dias: number
  }>(
    `select r.id, r.folio, r.tipo, c.nombre as comunidad,
            extract(day from now() - r.creado_en)::int as dias
       from reportes r
       left join comunidades c on c.id = r.comunidad_id
      where r.sensible
      order by r.creado_en`,
  )
  return rows
}
