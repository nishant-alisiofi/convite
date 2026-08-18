import type { PoolClient } from 'pg'
import { TIPOS_EVIDENCIA_COMPRA, type TipoEvidenciaCompra } from '@/db/schema/compra-local'

/**
 * PRD-9 — reading and recording funded local purchases.
 *
 * Every function runs against the client `conSesion()` hands it, so RLS (0049) is the real
 * boundary: reads are org-scoped, the authorisation core is immutable at the database, and the
 * pool ceiling is enforced by a trigger — this module never re-implements those guards, it drives
 * them. The panel gates the UI on top (Section 11).
 *
 * Money is plain COP; pg returns bigint as a string, so the mappers convert with `Number()`.
 */

export const COMPRA_LOCAL_ROLES = ['coordinador', 'admin', 'despachador'] as const
export const FONDO_ROLES = ['coordinador', 'admin'] as const

// ── Funding pools ───────────────────────────────────────────────────────────────────────────

export type Fondo = {
  id: string
  nombre: string
  techoCop: number
  umbralAlertaCop: number | null
  activo: boolean
  /** Committed COP across the pool's non-cancelled purchases. */
  comprometidoCop: number
  /** Ceiling minus committed — what a new purchase can still draw. */
  disponibleCop: number
  /** True once committed spend has crossed the soft alert threshold. */
  enAlerta: boolean
  creadoEn: Date
}

export async function listarFondos(client: PoolClient): Promise<Fondo[]> {
  const { rows } = await client.query<{
    id: string
    nombre: string
    techo_cop: string
    umbral_alerta_cop: string | null
    activo: boolean
    comprometido_cop: string
    creado_en: Date
  }>(
    `select f.id, f.nombre, f.techo_cop, f.umbral_alerta_cop, f.activo,
            coalesce(sum(c.monto_autorizado_cop) filter (where c.estado <> 'CANCELADA'), 0)
              as comprometido_cop,
            f.creado_en
       from fondos_compra f
       left join compras_locales c on c.fondo_id = f.id
      group by f.id
      order by f.creado_en desc`,
  )

  return rows.map((r) => {
    const techoCop = Number(r.techo_cop)
    const comprometidoCop = Number(r.comprometido_cop)
    const umbralAlertaCop = r.umbral_alerta_cop === null ? null : Number(r.umbral_alerta_cop)
    return {
      id: r.id,
      nombre: r.nombre,
      techoCop,
      umbralAlertaCop,
      activo: r.activo,
      comprometidoCop,
      disponibleCop: Math.max(0, techoCop - comprometidoCop),
      enAlerta: umbralAlertaCop !== null && comprometidoCop >= umbralAlertaCop,
      creadoEn: r.creado_en,
    }
  })
}

export type NuevoFondo = {
  organizacionId: string
  nombre: string
  techoCop: number
  umbralAlertaCop?: number | null
  notas?: string | null
}

export async function crearFondo(
  client: PoolClient,
  entrada: NuevoFondo,
  actorId: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into fondos_compra (organizacion_id, nombre, techo_cop, umbral_alerta_cop, creado_por, notas)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      entrada.organizacionId,
      entrada.nombre,
      entrada.techoCop,
      entrada.umbralAlertaCop ?? null,
      actorId,
      entrada.notas ?? null,
    ],
  )
  return rows[0]!.id
}

// ── Local vendors ───────────────────────────────────────────────────────────────────────────

export type Proveedor = {
  id: string
  nombre: string
  comunidadId: string | null
  comunidadNombre: string | null
  municipio: string | null
  suministra: string | null
  /** FR-44. Whether this vendor's stock is tracked structurally (see `proveedor_existencias`). */
  esFarmacia: boolean
  activo: boolean
}

export async function listarProveedores(client: PoolClient): Promise<Proveedor[]> {
  const { rows } = await client.query<{
    id: string
    nombre: string
    comunidad_id: string | null
    comunidad_nombre: string | null
    municipio: string | null
    suministra: string | null
    es_farmacia: boolean
    activo: boolean
  }>(
    `select p.id, p.nombre, p.comunidad_id, c.nombre as comunidad_nombre, p.municipio,
            p.suministra, p.es_farmacia, p.activo
       from proveedores_locales p
       left join comunidades c on c.id = p.comunidad_id
      order by p.nombre`,
  )
  return rows.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    comunidadId: r.comunidad_id,
    comunidadNombre: r.comunidad_nombre,
    municipio: r.municipio,
    suministra: r.suministra,
    esFarmacia: r.es_farmacia,
    activo: r.activo,
  }))
}

export type NuevoProveedor = {
  organizacionId: string
  nombre: string
  comunidadId?: string | null
  municipio?: string | null
  suministra?: string | null
  contacto?: string | null
  esFarmacia?: boolean
}

export async function crearProveedor(
  client: PoolClient,
  entrada: NuevoProveedor,
  actorId: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into proveedores_locales
       (organizacion_id, nombre, comunidad_id, municipio, suministra, contacto, es_farmacia, creado_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      entrada.organizacionId,
      entrada.nombre,
      entrada.comunidadId ?? null,
      entrada.municipio ?? null,
      entrada.suministra ?? null,
      entrada.contacto ?? null,
      entrada.esFarmacia ?? false,
      actorId,
    ],
  )
  return rows[0]!.id
}

// ── Pharmacy stock (FR-44) ──────────────────────────────────────────────────────────────────

export type ExistenciaProveedor = {
  id: string
  proveedorId: string
  proveedorNombre: string
  comunidadNombre: string | null
  codigoItem: string
  itemLabel: string
  cantidad: number
  contadoEn: Date
}

/** Every pharmacy's structured stock, for the Existencias/Compra local screens. */
export async function listarExistenciasFarmacias(client: PoolClient): Promise<ExistenciaProveedor[]> {
  const { rows } = await client.query<{
    id: string
    proveedor_id: string
    proveedor_nombre: string
    comunidad_nombre: string | null
    codigo_item: string
    item_label: string
    cantidad: number
    contado_en: Date
  }>(
    `select pe.id, pe.proveedor_id, p.nombre as proveedor_nombre, c.nombre as comunidad_nombre,
            pe.codigo_item, ci.item_label, pe.cantidad, pe.contado_en
       from proveedor_existencias pe
       join proveedores_locales p on p.id = pe.proveedor_id
       left join comunidades c on c.id = p.comunidad_id
       join catalogo_items ci on ci.codigo = pe.codigo_item
      where p.es_farmacia and pe.cantidad > 0
      order by ci.orden, p.nombre`,
  )
  return rows.map((r) => ({
    id: r.id,
    proveedorId: r.proveedor_id,
    proveedorNombre: r.proveedor_nombre,
    comunidadNombre: r.comunidad_nombre,
    codigoItem: r.codigo_item,
    itemLabel: r.item_label,
    cantidad: r.cantidad,
    contadoEn: r.contado_en,
  }))
}

/**
 * The pharmacies that can fulfil a given medical need locally (FR-44 AC #2) — the supply-side
 * twin of `pedidosSinExistencia` above. Community-matched first so "the pharmacy across the
 * street" outranks one three days upriver, but every pharmacy with stock is returned; the
 * coordinator decides who is close enough to matter.
 */
export async function farmaciasConStock(
  client: PoolClient,
  codigoItem: string,
  comunidadId?: string | null,
): Promise<ExistenciaProveedor[]> {
  const { rows } = await client.query<{
    id: string
    proveedor_id: string
    proveedor_nombre: string
    comunidad_nombre: string | null
    codigo_item: string
    item_label: string
    cantidad: number
    contado_en: Date
  }>(
    `select pe.id, pe.proveedor_id, p.nombre as proveedor_nombre, c.nombre as comunidad_nombre,
            pe.codigo_item, ci.item_label, pe.cantidad, pe.contado_en
       from proveedor_existencias pe
       join proveedores_locales p on p.id = pe.proveedor_id
       left join comunidades c on c.id = p.comunidad_id
       join catalogo_items ci on ci.codigo = pe.codigo_item
      where p.es_farmacia and pe.cantidad > 0 and pe.codigo_item = $1
      order by (p.comunidad_id is not distinct from $2) desc, pe.cantidad desc`,
    [codigoItem, comunidadId ?? null],
  )
  return rows.map((r) => ({
    id: r.id,
    proveedorId: r.proveedor_id,
    proveedorNombre: r.proveedor_nombre,
    comunidadNombre: r.comunidad_nombre,
    codigoItem: r.codigo_item,
    itemLabel: r.item_label,
    cantidad: r.cantidad,
    contadoEn: r.contado_en,
  }))
}

export type NuevaExistenciaProveedor = { proveedorId: string; codigoItem: string; cantidad: number }

/** Records or updates a pharmacy's stock count for one item. */
export async function registrarExistenciaProveedor(
  client: PoolClient,
  organizacionId: string,
  entrada: NuevaExistenciaProveedor,
  actorId: string,
): Promise<void> {
  await client.query(
    `insert into proveedor_existencias (organizacion_id, proveedor_id, codigo_item, cantidad, contado_por)
       values ($1, $2, $3, $4, $5)
     on conflict (proveedor_id, codigo_item) do update set
       cantidad = excluded.cantidad,
       contado_en = now(),
       contado_por = excluded.contado_por`,
    [organizacionId, entrada.proveedorId, entrada.codigoItem, entrada.cantidad, actorId],
  )
}

// ── Purchases + the traceability chain ──────────────────────────────────────────────────────

export type CompraLocalItem = {
  codigoItem: string
  cantidad: number
  costoCop: number | null
}

export type CompraLocalEvidencia = {
  id: string
  tipo: string
  referencia: string
  descripcion: string | null
  creadoEn: Date
}

export type CompraLocal = {
  id: string
  fondoId: string
  fondoNombre: string | null
  pedidoId: string | null
  responsableNombre: string | null
  proveedorNombre: string | null
  comunidadNombre: string | null
  concepto: string
  montoAutorizadoCop: number
  montoRealCop: number | null
  estado: string
  reciboRef: string | null
  autorizadoEn: Date
  compradoEn: Date | null
  verificadoEn: Date | null
  distribuidoEn: Date | null
  cerradoEn: Date | null
  items: CompraLocalItem[]
  evidencias: CompraLocalEvidencia[]
  creadoEn: Date
}

export async function listarCompras(client: PoolClient): Promise<CompraLocal[]> {
  const { rows } = await client.query<{
    id: string
    fondo_id: string
    fondo_nombre: string | null
    pedido_id: string | null
    responsable_nombre: string | null
    proveedor_nombre: string | null
    comunidad_nombre: string | null
    concepto: string
    monto_autorizado_cop: string
    monto_real_cop: string | null
    estado: string
    recibo_ref: string | null
    autorizado_en: Date
    comprado_en: Date | null
    verificado_en: Date | null
    distribuido_en: Date | null
    cerrado_en: Date | null
    creado_en: Date
  }>(
    `select c.id, c.fondo_id, f.nombre as fondo_nombre, c.pedido_id,
            r.nombre as responsable_nombre, p.nombre as proveedor_nombre,
            cm.nombre as comunidad_nombre,
            c.concepto, c.monto_autorizado_cop, c.monto_real_cop, c.estado, c.recibo_ref,
            c.autorizado_en, c.comprado_en, c.verificado_en, c.distribuido_en, c.cerrado_en,
            c.creado_en
       from compras_locales c
       left join fondos_compra f on f.id = c.fondo_id
       left join contactos r on r.id = c.responsable_id
       left join proveedores_locales p on p.id = c.proveedor_id
       left join comunidades cm on cm.id = c.comunidad_id
      order by c.creado_en desc`,
  )

  const compras: CompraLocal[] = []
  for (const r of rows) {
    const { rows: items } = await client.query<{
      codigo_item: string
      cantidad: number
      costo_cop: string | null
    }>(
      `select codigo_item, cantidad, costo_cop from compra_local_items where compra_id = $1
        order by creado_en`,
      [r.id],
    )
    const { rows: evidencias } = await client.query<{
      id: string
      tipo: string
      referencia: string
      descripcion: string | null
      creado_en: Date
    }>(
      `select id, tipo, referencia, descripcion, creado_en from compra_local_evidencias
        where compra_id = $1 order by creado_en`,
      [r.id],
    )

    compras.push({
      id: r.id,
      fondoId: r.fondo_id,
      fondoNombre: r.fondo_nombre,
      pedidoId: r.pedido_id,
      responsableNombre: r.responsable_nombre,
      proveedorNombre: r.proveedor_nombre,
      comunidadNombre: r.comunidad_nombre,
      concepto: r.concepto,
      montoAutorizadoCop: Number(r.monto_autorizado_cop),
      montoRealCop: r.monto_real_cop === null ? null : Number(r.monto_real_cop),
      estado: r.estado,
      reciboRef: r.recibo_ref,
      autorizadoEn: r.autorizado_en,
      compradoEn: r.comprado_en,
      verificadoEn: r.verificado_en,
      distribuidoEn: r.distribuido_en,
      cerradoEn: r.cerrado_en,
      items: items.map((i) => ({
        codigoItem: i.codigo_item,
        cantidad: i.cantidad,
        costoCop: i.costo_cop === null ? null : Number(i.costo_cop),
      })),
      evidencias: evidencias.map((e) => ({
        id: e.id,
        tipo: e.tipo,
        referencia: e.referencia,
        descripcion: e.descripcion,
        creadoEn: e.creado_en,
      })),
      creadoEn: r.creado_en,
    })
  }
  return compras
}

/** The SIN_EXISTENCIA demands a funded purchase can resolve (AC #1). */
export async function pedidosSinExistencia(client: PoolClient): Promise<
  { id: string; codigoItem: string; familias: number; comunidad: string | null }[]
> {
  const { rows } = await client.query<{
    id: string
    codigo_item: string
    familias: number
    comunidad: string | null
  }>(
    `select p.id, p.codigo_item, p.familias, c.nombre as comunidad
       from pedidos p
       left join comunidades c on c.id = p.comunidad_id
      where p.estado = 'SIN_EXISTENCIA'
      order by p.urgencia desc, p.creado_en desc
      limit 100`,
  )
  return rows.map((r) => ({
    id: r.id,
    codigoItem: r.codigo_item,
    familias: r.familias,
    comunidad: r.comunidad,
  }))
}

export type NuevaCompra = {
  organizacionId: string
  fondoId: string
  pedidoId?: string | null
  proveedorId?: string | null
  responsableId: string
  comunidadId?: string | null
  concepto: string
  montoAutorizadoCop: number
  items: CompraLocalItem[]
  notas?: string | null
}

/**
 * Authorise a purchase (step 1) with its territorial responsible (step 2) and its line items. The
 * pool guardrail (trigger, 0049) refuses it if it would breach the ceiling — that rejection surfaces
 * as a thrown error the caller shows plainly. `actorId` becomes `autorizado_por`, checked against
 * `auth.uid()`; the authorisation is immutable from here (trigger).
 */
export async function crearCompra(
  client: PoolClient,
  entrada: NuevaCompra,
  actorId: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into compras_locales
       (organizacion_id, fondo_id, pedido_id, proveedor_id, responsable_id, comunidad_id,
        concepto, monto_autorizado_cop, autorizado_por, notas)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [
      entrada.organizacionId,
      entrada.fondoId,
      entrada.pedidoId ?? null,
      entrada.proveedorId ?? null,
      entrada.responsableId,
      entrada.comunidadId ?? null,
      entrada.concepto,
      entrada.montoAutorizadoCop,
      actorId,
      entrada.notas ?? null,
    ],
  )
  const id = rows[0]!.id

  for (const item of entrada.items) {
    await client.query(
      `insert into compra_local_items (compra_id, codigo_item, cantidad, costo_cop)
       values ($1, $2, $3, $4)`,
      [id, item.codigoItem, item.cantidad, item.costoCop ?? null],
    )
  }
  return id
}

/** Step 3: record the receipt and what was actually spent, moving the chain to COMPRADA. */
export async function registrarRecibo(
  client: PoolClient,
  id: string,
  reciboRef: string,
  montoRealCop: number | null,
  actorId: string,
): Promise<void> {
  await client.query(
    `update compras_locales
        set estado = 'COMPRADA', recibo_ref = $2, monto_real_cop = $3,
            comprado_por = $4, comprado_en = now()
      where id = $1 and estado = 'AUTORIZADA'`,
    [id, reciboRef, montoRealCop, actorId],
  )
  await client.query(
    `insert into compra_local_evidencias (compra_id, tipo, referencia, descripcion, subido_por)
     values ($1, 'recibo', $2, 'Recibo de compra', $3)`,
    [id, reciboRef, actorId],
  )
}

/** Step 4: verify the materials were received, moving to VERIFICADA. */
export async function verificarCompra(client: PoolClient, id: string, actorId: string): Promise<void> {
  await client.query(
    `update compras_locales
        set estado = 'VERIFICADA', verificado_por = $2, verificado_en = now()
      where id = $1 and estado = 'COMPRADA'`,
    [id, actorId],
  )
}

/** Step 5: distribution in/near the municipality, moving to DISTRIBUIDA. */
export async function distribuirCompra(client: PoolClient, id: string, actorId: string): Promise<void> {
  await client.query(
    `update compras_locales
        set estado = 'DISTRIBUIDA', distribuido_por = $2, distribuido_en = now()
      where id = $1 and estado = 'VERIFICADA'`,
    [id, actorId],
  )
}

/**
 * Step 6: close the purchase, which §24 requires photographic/documentary evidence for. Refuses
 * to close a purchase that has no evidence beyond the receipt — the trail is the point.
 */
export async function cerrarCompra(client: PoolClient, id: string, actorId: string): Promise<boolean> {
  const { rows } = await client.query<{ n: string }>(
    `select count(*) as n from compra_local_evidencias
      where compra_id = $1 and tipo in ('foto', 'documento', 'acta')`,
    [id],
  )
  if (Number(rows[0]?.n ?? 0) === 0) return false

  const { rowCount } = await client.query(
    `update compras_locales
        set estado = 'CERRADA', cerrado_por = $2, cerrado_en = now()
      where id = $1 and estado = 'DISTRIBUIDA'`,
    [id, actorId],
  )
  return (rowCount ?? 0) > 0
}

/** Add a piece of documentary/photographic evidence (steps 3 and 6). Append-only. */
export async function agregarEvidencia(
  client: PoolClient,
  id: string,
  tipo: TipoEvidenciaCompra,
  referencia: string,
  descripcion: string | null,
  actorId: string,
): Promise<void> {
  await client.query(
    `insert into compra_local_evidencias (compra_id, tipo, referencia, descripcion, subido_por)
     values ($1, $2, $3, $4, $5)`,
    [id, tipo, referencia, descripcion, actorId],
  )
}

export { TIPOS_EVIDENCIA_COMPRA }
