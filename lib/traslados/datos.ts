import type { PoolClient } from 'pg'
import { MOTIVOS_TRASLADO, type MotivoTraslado } from '@/db/schema/transporte-personas'
import { cargarContexto } from '@/lib/matching/persistencia'
import { temporadaVigente } from '@/lib/temporada'
import { type ContextoTraslado, emparejarTraslado, type SolicitudTraslado } from './emparejador'

/**
 * PRD-8 — reading and recording person-transport requests.
 *
 * Every function runs against the client `conSesion()` hands it, so RLS (0048) is the real
 * boundary: a verificador/lectura session sees nothing, reads are org-scoped, and the person's PII
 * (`persona_nombre`, `motivo_detalle`) never leaves the floor. The panel gates the UI on top; the
 * data boundary does not depend on the UI being right (Section 11).
 */

export const TRASLADO_ROLES = ['coordinador', 'admin', 'despachador'] as const

export type Traslado = {
  id: string
  personaEtiqueta: string
  personaNombre: string | null
  personas: number
  motivoCategoria: string
  origenComunidadId: string
  origenNombre: string | null
  destinoComunidadId: string
  destinoNombre: string | null
  ventanaDesde: Date
  ventanaHasta: Date
  requiereAlojamiento: boolean
  requiereAlimentacion: boolean
  requiereAcompanamiento: boolean
  requiereRegreso: boolean
  regresoVentanaDesde: Date | null
  regresoVentanaHasta: Date | null
  estado: string
  motivo: string | null
  capacidadId: string | null
  /** FR-46: the mode of the assigned vehicle, when one is assigned — 'lancha' surfaces cost/pay. */
  capacidadModo: string | null
  despachadoEn: Date | null
  codigoLlegada: string | null
  llegadaConfirmadaEn: Date | null
  regresoDespachadoEn: Date | null
  codigoRegreso: string | null
  regresoConfirmadoEn: Date | null
  creadoEn: Date
}

/** Every request the caller may see, newest first. */
export async function listarTraslados(client: PoolClient): Promise<Traslado[]> {
  const { rows } = await client.query<{
    id: string
    persona_etiqueta: string
    persona_nombre: string | null
    personas: number
    motivo_categoria: string
    origen_comunidad_id: string
    origen_nombre: string | null
    destino_comunidad_id: string
    destino_nombre: string | null
    ventana_desde: Date
    ventana_hasta: Date
    requiere_alojamiento: boolean
    requiere_alimentacion: boolean
    requiere_acompanamiento: boolean
    requiere_regreso: boolean
    regreso_ventana_desde: Date | null
    regreso_ventana_hasta: Date | null
    estado: string
    motivo: string | null
    capacidad_id: string | null
    capacidad_modo: string | null
    despachado_en: Date | null
    codigo_llegada: string | null
    llegada_confirmada_en: Date | null
    regreso_despachado_en: Date | null
    codigo_regreso: string | null
    regreso_confirmado_en: Date | null
    creado_en: Date
  }>(
    `select t.id, t.persona_etiqueta, t.persona_nombre, t.personas, t.motivo_categoria,
            t.origen_comunidad_id, co.nombre as origen_nombre,
            t.destino_comunidad_id, cd.nombre as destino_nombre,
            t.ventana_desde, t.ventana_hasta,
            t.requiere_alojamiento, t.requiere_alimentacion, t.requiere_acompanamiento,
            t.requiere_regreso, t.regreso_ventana_desde, t.regreso_ventana_hasta,
            t.estado, t.motivo, t.capacidad_id, cap.modo as capacidad_modo, t.despachado_en,
            t.codigo_llegada, t.llegada_confirmada_en, t.regreso_despachado_en, t.codigo_regreso,
            t.regreso_confirmado_en, t.creado_en
       from traslados_persona t
       left join comunidades co on co.id = t.origen_comunidad_id
       left join comunidades cd on cd.id = t.destino_comunidad_id
       left join capacidades cap on cap.id = t.capacidad_id
      order by t.creado_en desc`,
  )

  return rows.map((r) => ({
    id: r.id,
    personaEtiqueta: r.persona_etiqueta,
    personaNombre: r.persona_nombre,
    personas: r.personas,
    motivoCategoria: r.motivo_categoria,
    origenComunidadId: r.origen_comunidad_id,
    origenNombre: r.origen_nombre,
    destinoComunidadId: r.destino_comunidad_id,
    destinoNombre: r.destino_nombre,
    ventanaDesde: r.ventana_desde,
    ventanaHasta: r.ventana_hasta,
    requiereAlojamiento: r.requiere_alojamiento,
    requiereAlimentacion: r.requiere_alimentacion,
    requiereAcompanamiento: r.requiere_acompanamiento,
    requiereRegreso: r.requiere_regreso,
    regresoVentanaDesde: r.regreso_ventana_desde,
    regresoVentanaHasta: r.regreso_ventana_hasta,
    estado: r.estado,
    motivo: r.motivo,
    capacidadId: r.capacidad_id,
    capacidadModo: r.capacidad_modo,
    despachadoEn: r.despachado_en,
    codigoLlegada: r.codigo_llegada,
    llegadaConfirmadaEn: r.llegada_confirmada_en,
    regresoDespachadoEn: r.regreso_despachado_en,
    codigoRegreso: r.codigo_regreso,
    regresoConfirmadoEn: r.regreso_confirmado_en,
    creadoEn: r.creado_en,
  }))
}

/** The matcher's snapshot, from the same loader the goods engine uses. Season read from config. */
export async function contextoParaTraslados(client: PoolClient): Promise<ContextoTraslado> {
  const temporada = await temporadaVigente(client)
  return cargarContexto(client, temporada, new Date())
}

export type NuevoTraslado = {
  organizacionId: string
  reporteId?: string | null
  personaEtiqueta: string
  personaNombre?: string | null
  personaTelefono?: string | null
  personas: number
  motivoCategoria: MotivoTraslado
  motivoDetalle?: string | null
  necesidadAccesibilidad?: string | null
  origenComunidadId: string
  destinoComunidadId: string
  ventanaDesde: Date
  ventanaHasta: Date
  requiereAlojamiento?: boolean
  requiereAlimentacion?: boolean
  requiereAcompanamiento?: boolean
  requiereRegreso?: boolean
  regresoVentanaDesde?: Date | null
  regresoVentanaHasta?: Date | null
  notas?: string | null
}

/**
 * Record a request and classify it in one step. The row is inserted with the matcher's verdict
 * (LISTO / SIN_CAPACIDAD / SIN_RUTA) and its proposed seat, so the board is honest the moment it
 * appears — the same shape the goods engine gives a pedido. `actorId` becomes `creado_por`, checked
 * against `auth.uid()` by the insert policy.
 */
export async function crearTraslado(
  client: PoolClient,
  entrada: NuevoTraslado,
  actorId: string,
): Promise<string> {
  const solicitud: SolicitudTraslado = {
    id: 'nuevo',
    origenComunidadId: entrada.origenComunidadId,
    destinoComunidadId: entrada.destinoComunidadId,
    personas: entrada.personas,
    ventanaDesde: entrada.ventanaDesde,
    ventanaHasta: entrada.ventanaHasta,
  }
  const contexto = await contextoParaTraslados(client)
  const veredicto = emparejarTraslado(solicitud, contexto)

  const { rows } = await client.query<{ id: string }>(
    `insert into traslados_persona
       (organizacion_id, reporte_id, persona_etiqueta, persona_nombre, persona_telefono,
        personas, motivo_categoria, motivo_detalle, necesidad_accesibilidad,
        origen_comunidad_id, destino_comunidad_id, ventana_desde, ventana_hasta,
        requiere_alojamiento, requiere_alimentacion, requiere_acompanamiento,
        requiere_regreso, regreso_ventana_desde, regreso_ventana_hasta,
        estado, motivo, capacidad_id, creado_por, notas)
     values
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24)
     returning id`,
    [
      entrada.organizacionId,
      entrada.reporteId ?? null,
      entrada.personaEtiqueta,
      entrada.personaNombre ?? null,
      entrada.personaTelefono ?? null,
      entrada.personas,
      entrada.motivoCategoria,
      entrada.motivoDetalle ?? null,
      entrada.necesidadAccesibilidad ?? null,
      entrada.origenComunidadId,
      entrada.destinoComunidadId,
      entrada.ventanaDesde,
      entrada.ventanaHasta,
      entrada.requiereAlojamiento ?? false,
      entrada.requiereAlimentacion ?? false,
      entrada.requiereAcompanamiento ?? false,
      entrada.requiereRegreso ?? false,
      entrada.regresoVentanaDesde ?? null,
      entrada.regresoVentanaHasta ?? null,
      veredicto.estado,
      veredicto.motivo,
      veredicto.capacidadId ?? null,
      actorId,
      entrada.notas ?? null,
    ],
  )
  return rows[0]!.id
}

/** A 4-digit arrival code, the §9.7 shape the goods entregas already use. */
function codigoNuevo(): string {
  return String(Math.floor(1000 + Math.random() * 9000))
}

/**
 * The human dispatch (2.1): a person allocates the seat, which produces the manifest (the row is
 * the manifest) and mints the 4-digit arrival code. Only from a pre-dispatch state.
 */
export async function despacharTraslado(
  client: PoolClient,
  id: string,
  capacidadId: string | null,
  actorId: string,
): Promise<void> {
  await client.query(
    `update traslados_persona
        set estado = 'DESPACHADO',
            despachado_por = $2,
            despachado_en = now(),
            capacidad_id = coalesce($3, capacidad_id),
            codigo_llegada = coalesce(codigo_llegada, $4)
      where id = $1
        and estado in ('SOLICITADO', 'SIN_CAPACIDAD', 'LISTO')`,
    [id, actorId, capacidadId, codigoNuevo()],
  )
}

/** Arrival confirmed when the receiving end reads back the 4-digit code (§9.7). */
export async function confirmarLlegada(
  client: PoolClient,
  id: string,
  codigo: string,
  canal: string | null,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `update traslados_persona
        set estado = 'LLEGO',
            llegada_confirmada_en = now(),
            llegada_confirmada_canal = $3
      where id = $1
        and codigo_llegada = $2
        and estado in ('DESPACHADO', 'EN_CAMINO')`,
    [id, codigo, canal],
  )
  return (rowCount ?? 0) > 0
}

/** Dispatch the RETURN leg — only for a trip that asked for one, and only once it has arrived. */
export async function despacharRegreso(
  client: PoolClient,
  id: string,
  regresoCapacidadId: string | null,
  actorId: string,
): Promise<void> {
  await client.query(
    `update traslados_persona
        set estado = 'REGRESO_DESPACHADO',
            regreso_despachado_por = $2,
            regreso_despachado_en = now(),
            regreso_capacidad_id = coalesce($3, regreso_capacidad_id),
            codigo_regreso = coalesce(codigo_regreso, $4)
      where id = $1
        and requiere_regreso
        and estado = 'LLEGO'`,
    [id, actorId, regresoCapacidadId, codigoNuevo()],
  )
}

/** Return arrival confirmed — the person is home. */
export async function confirmarRegreso(
  client: PoolClient,
  id: string,
  codigo: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `update traslados_persona
        set estado = 'REGRESADO',
            regreso_confirmado_en = now()
      where id = $1
        and codigo_regreso = $2
        and estado = 'REGRESO_DESPACHADO'`,
    [id, codigo],
  )
  return (rowCount ?? 0) > 0
}

export { MOTIVOS_TRASLADO }
