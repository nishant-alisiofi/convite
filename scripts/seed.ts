import 'dotenv/config'
import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { closeDb, getPool } from '@/db/client'
import { resolve } from 'node:path'
import { almacenamientoLocal, raizDatos } from '@/lib/canales/almacenamiento'
import { CATALOGO_SEMILLA, UNIDADES_SEMILLA } from '@/db/seed/catalogo'
import { CODIGO_DEMO_A_REGISTRO } from '@/db/seed/comunidades'
import {
  CAPACIDADES_DEMO,
  CAPACIDADES_SEMILLA,
  CONTACTOS_DEMO,
  CONTACTOS_SEMILLA,
  DESPACHO_DEMO,
  EXISTENCIAS_DEMO,
  EXISTENCIAS_SEMILLA,
  LOTES_EXISTENCIA_SEMILLA,
  MENSAJES_DEMO,
  NECESIDADES_DERIVADAS_DEMO,
  NECESIDADES_VERIFICADAS,
  NECESIDADES_VERIFICADAS_DEMO,
  NODOS_DEMO,
  NODOS_SEMILLA,
  NOTA_DE_VOZ_SEMILLA,
  NOTAS_DE_VOZ_DEMO,
  OFERTAS_SEMILLA,
  REPORTES_SIN_VERIFICAR,
  REPORTES_SIN_VERIFICAR_DEMO,
  USUARIOS_SEMILLA,
  VOLUNTARIOS_SEMILLA,
  type NecesidadSemilla,
} from '@/db/seed/operacion'
import { RUTAS_DEMO, RUTAS_SEMILLA } from '@/db/seed/rutas'
import { PUNTOS_CONEXION_DEMO } from '@/db/seed/conexion'
import { APADRINAMIENTOS_DEMO } from '@/db/seed/apadrinamiento'
import { CENTRO_PENDIENTE_DEMO } from '@/db/seed/centros'
import {
  EVALUACIONES_DEMO,
  EVALUACIONES_TECNICAS_DEMO,
  HALLAZGO_BOM_DEMO,
  HALLAZGOS_EVALUACION_DEMO,
  PLANTILLAS_EVALUACION_DEMO,
} from '@/db/seed/evaluaciones'
import {
  JORNADAS_DEMO,
  PROGRAMA_APLICACIONES_DEMO,
  PROGRAMAS_DEMO,
} from '@/db/seed/programas'
import { TRASLADOS_DEMO } from '@/db/seed/traslados'
import {
  COMPRAS_LOCALES_DEMO,
  FONDOS_COMPRA_DEMO,
  PROVEEDORES_LOCALES_DEMO,
} from '@/db/seed/compra-local'
import { ATESTACIONES_RADIO_DEMO, RELEVOS_RADIO_DEMO } from '@/db/seed/radio'
import {
  NODOS_FRIO_DEMO,
  REQUISITOS_ALMACENAMIENTO_DEMO,
  RUTAS_FRIO_DEMO,
  SUMINISTROS_ANTICIPADOS_DEMO,
} from '@/db/seed/cadena-frio'
import { AVALES_ORGANIZACION_DEMO, MEMBRESIAS_DEMO } from '@/db/seed/membresias'
import { aplicarFondos, crearApadrinamiento } from '@/lib/apadrinamiento'
import { crearEnvio, despachar, ordenarPorRecorrido, ponerParada } from '@/lib/despacho/plan'
import { emparejar } from '@/lib/matching/persistencia'
import { temporadaVigente } from '@/lib/temporada'

/**
 * Idempotent seed. Running it twice leaves the same basin — every insert is keyed on a
 * natural key (community code, phone number, node name, item code) or on a `semilla`
 * marker stored in `payload_crudo`.
 *
 * Geometry is written with raw SQL (Section 3: raw SQL for PostGIS operations).
 */

const ORGANIZACION = 'Convite — Chocó (organización aliada)'

/** The seeded staff ids, by role — used to sign the who-decided columns of the PRD-v3 demo data. */
const ID_COORDINADOR = USUARIOS_SEMILLA.find((u) => u.rolStaff === 'coordinador')!.id
const ID_VERIFICADORA = USUARIOS_SEMILLA.find((u) => u.rolStaff === 'verificador')!.id
const ID_DESPACHADOR = USUARIOS_SEMILLA.find((u) => u.rolStaff === 'despachador')!.id
const ID_ADMIN = USUARIOS_SEMILLA.find((u) => u.rolStaff === 'admin')!.id

/** The two real registry organisations planted by `sembrar:territorio` (db/seed/territorio.sql). */
const ORG_HERENCIA = '22222222-0000-0000-0000-000000000002'

/** Communities the seeded verificadora is scoped to (Section 11 / M3 RLS tests). */
const COMUNIDADES_DE_LA_VERIFICADORA = ['BTA', 'MER', 'WIN', 'TAG', 'BET', 'BLL']

async function main() {
  const pool = getPool()
  const client = await pool.connect()

  try {
    await client.query('begin')

    const organizacionId = await sembrarOrganizacion(client)
    const comunidades = await sembrarComunidades(client)
    await sembrarCatalogo(client)
    const contactos = await sembrarContactos(client, comunidades)
    await sembrarUsuarios(client, organizacionId, contactos, comunidades)
    await sembrarRutas(client, comunidades)
    const nodos = await sembrarNodos(client, comunidades, contactos)
    await sembrarExistencias(client, nodos)
    await sembrarLotesExistencia(client, nodos)
    await sembrarReportes(client, organizacionId, comunidades, contactos)
    await sembrarMensajes(client, organizacionId, contactos)
    await sembrarCapacidades(client, contactos, nodos, comunidades)
    await sembrarOfertas(client, contactos)
    await sembrarVoluntarios(client, contactos, nodos)
    // Runs after sembrarReportes: the sponsorships apply funds to pedidos it created.
    await sembrarPuntosConexion(client, organizacionId, comunidades)
    await sembrarApadrinamientos(client, organizacionId, comunidades)
    await sembrarCentroPendiente(client)

    // ── PRD v3 features (STAGING ONLY) ───────────────────────────────────────────────────
    // Each lands on the same demo org so the panel, signed in as ASOREDIPARCHOCÓ, sees them.
    // Cold chain runs before the matcher's clasificar() so item 22's constraint is in place when
    // the Beté pedido is reclassified. Radio attestations run before their relay so the gate passes.
    await sembrarEvaluaciones(client, organizacionId, comunidades)
    await sembrarAgenda(client, organizacionId, comunidades)
    await sembrarTraslados(client, organizacionId, comunidades)
    await sembrarCompraLocal(client, organizacionId, comunidades, contactos)
    await sembrarCadenaFrio(client, organizacionId, comunidades, nodos)
    await sembrarRadio(client, organizacionId, comunidades)
    await sembrarMembresias(client)

    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }

  await clasificar()
  // Runs after the matcher so it dispatches a request the engine has marked LISTO, turning it
  // EN_CAMINO. Its own transaction: a failed dispatch must not roll back the whole seed.
  await sembrarDespacho()
  await resumen()
}

/**
 * Runs one matcher sweep over what was just seeded.
 *
 * A basin where seven requests exist and the engine has never looked at them is not a state
 * any real deployment is ever in — the worker sweeps continuously — so leaving it that way
 * makes the seed a half-built fixture rather than a picture of the system.
 *
 * It also made staging lie. `mapa_publico` counts pedidos in the matcher's OUTPUT states
 * (SIN_RUTA / SIN_EXISTENCIA / SIN_CAPACIDAD / LISTO); freshly seeded ones sit at ABIERTO,
 * which is in none of them. So the public page reported «todavía no hay solicitudes» over a
 * basin holding seven, and anyone walking the deployment — the founder, a reviewer, the
 * partner — saw an empty system that was not empty.
 *
 * Safe on every boot, like the rest of the seed: the matcher is idempotent by design (a
 * second sweep changes nothing), it evaluates zero pedidos on an empty database, and it
 * never decrements stock or commits a boat — it only reclassifies.
 */
async function clasificar(): Promise<void> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    const resultado = await emparejar(client, { temporada: await temporadaVigente(client) })
    if (resultado.cambiados > 0) {
      console.log(`\nEmparejador: ${resultado.cambiados} pedido(s) clasificado(s).`)
    }
  } finally {
    client.release()
  }
}

// ── Blocks ────────────────────────────────────────────────────────────────────────────

async function sembrarOrganizacion(client: PoolClient): Promise<string> {
  // The demo operates AS the earliest-created active organisation — the same «organización
  // activa más antigua» convention sembrar-staff.ts and sembrar-plataforma.ts use, so every
  // bootstrap and all the demo activity converge on ONE org. When the real registry has been
  // planted first (`pnpm sembrar:territorio`, staging boot order) that is ASOREDIPARCHOCÓ, the
  // anchor Chocó network: the demo reports/pedidos/offers become ITS daily work, and staff sign
  // in to it. On a bare `pnpm db:reset` (local, no registry) there is no active org yet, so we
  // fall back to creating the demo org — keeping local dev and the .db tests unchanged.
  const activa = await client.query<{ id: string }>(
    'select id from organizaciones where activo order by creado_en limit 1',
  )
  if (activa.rows[0]) {
    const id = activa.rows[0].id
    // `estado_aprobacion` -> 'aprobada' so the panel is not gated behind the «en revisión»
    // screen (§2.4). This is a STAGING-only flip: the registry leaves partner orgs 'pendiente'
    // (only a platform admin approves them, and `db:seed` never runs on production). WABA ids are
    // filled from env only if still empty, never overwriting a real one already configured.
    await client.query(
      `update organizaciones set
         estado_aprobacion = 'aprobada',
         waba_phone_number_id = coalesce(waba_phone_number_id, $2),
         waba_id = coalesce(waba_id, $3)
       where id = $1`,
      [id, process.env.WHATSAPP_PHONE_NUMBER_ID ?? null, process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? null],
    )
    return id
  }

  // No active organisation (bare local reset). Create the demo centre, already 'aprobada' so the
  // panel renders without a platform approval step — see the note above.
  const { rows } = await client.query<{ id: string }>(
    `insert into organizaciones (nombre, waba_phone_number_id, waba_id, estado_aprobacion)
       values ($1, $2, $3, 'aprobada')
     on conflict (nombre) do update set estado_aprobacion = 'aprobada'
     returning id`,
    [ORGANIZACION, process.env.WHATSAPP_PHONE_NUMBER_ID ?? null, process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? null],
  )
  if (rows[0]) return rows[0].id

  const existente = await client.query<{ id: string }>(
    'select id from organizaciones where nombre = $1',
    [ORGANIZACION],
  )
  const id = existente.rows[0]?.id
  if (!id) throw new Error('No se pudo crear ni encontrar la organización semilla.')
  return id
}

async function sembrarComunidades(client: PoolClient): Promise<Map<string, string>> {
  // PRD-39: the demo no longer mints its own community rows. `sembrar:territorio` has already
  // planted the ONE real registry (long codes like CH-QUI-TAG), so here we only resolve each
  // demo short code to its registry community id. Everything downstream keeps addressing
  // communities by the short code it always used — this map is the single translation point —
  // and the result is one community set with zero duplicate real places (two Quibdós, two
  // Bellavistas… are gone). See db/seed/comunidades.ts CODIGO_DEMO_A_REGISTRO.
  const mapa = new Map<string, string>()
  const faltantes: string[] = []

  for (const [corto, registro] of Object.entries(CODIGO_DEMO_A_REGISTRO)) {
    const { rows } = await client.query<{ id: string }>(
      'select id from comunidades where codigo = $1',
      [registro],
    )
    const id = rows[0]?.id
    if (!id) {
      faltantes.push(`${corto} → ${registro}`)
      continue
    }
    mapa.set(corto, id)
  }

  if (faltantes.length > 0) {
    throw new Error(
      `No se encontraron en el registro las comunidades: ${faltantes.join(', ')}.\n` +
        `Corra 'pnpm sembrar:territorio' antes de 'pnpm db:seed' (así lo hace 'pnpm db:reset').`,
    )
  }

  return mapa
}

async function sembrarCatalogo(client: PoolClient): Promise<void> {
  for (const [i, item] of CATALOGO_SEMILLA.entries()) {
    const unidades = UNIDADES_SEMILLA[item.codigo] ?? null
    await client.query(
      `insert into catalogo_items (
         codigo, familia, familia_label, item_label, tipo,
         ayuda_texto, pide_detalle, urgencia_min, entregable, orden,
         unidad_singular, unidad_plural, familia_ayuda, perecedero
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (codigo) do update set
         familia_label = excluded.familia_label,
         item_label = excluded.item_label,
         tipo = excluded.tipo,
         ayuda_texto = excluded.ayuda_texto,
         pide_detalle = excluded.pide_detalle,
         urgencia_min = excluded.urgencia_min,
         entregable = excluded.entregable,
         orden = excluded.orden,
         unidad_singular = excluded.unidad_singular,
         unidad_plural = excluded.unidad_plural,
         familia_ayuda = excluded.familia_ayuda,
         perecedero = excluded.perecedero`,
      [
        item.codigo,
        // Passed explicitly rather than as left($1, 1): reusing $1 in both a char(2) column
        // and a text function makes Postgres deduce two different types for one parameter.
        item.codigo[0],
        item.familiaLabel,
        item.itemLabel,
        item.tipo,
        item.ayudaTexto,
        item.pideDetalle ?? false,
        item.urgenciaMin ?? 1,
        item.entregable ?? true,
        (i + 1) * 10,
        unidades?.[0] ?? null,
        unidades?.[1] ?? null,
        item.familiaAyuda ?? null,
        item.perecedero ?? false,
      ],
    )
  }
}

async function sembrarContactos(
  client: PoolClient,
  comunidades: Map<string, string>,
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>()

  const filas = [
    ...[...CONTACTOS_SEMILLA, ...CONTACTOS_DEMO].map((c) => ({
      telefono: c.telefono,
      nombre: c.nombre,
      rol: c.rol as string,
      comunidad: c.comunidad,
      canal: c.canalPreferido as string,
    })),
    ...USUARIOS_SEMILLA.map((u) => ({
      telefono: u.telefono,
      nombre: u.nombre,
      rol: u.rolContacto as string,
      comunidad: u.comunidad,
      canal: 'whatsapp',
    })),
  ]

  for (const f of filas) {
    const { rows } = await client.query<{ id: string }>(
      `insert into contactos (telefono, nombre, rol, comunidad_id, canal_preferido)
         values ($1, $2, $3, $4, $5)
       on conflict (telefono) do update set
         nombre = excluded.nombre,
         rol = excluded.rol,
         comunidad_id = excluded.comunidad_id,
         canal_preferido = excluded.canal_preferido
       returning id`,
      [f.telefono, f.nombre, f.rol, comunidades.get(f.comunidad) ?? null, f.canal],
    )
    mapa.set(f.telefono, rows[0]!.id)
  }

  return mapa
}

async function sembrarUsuarios(
  client: PoolClient,
  organizacionId: string,
  contactos: Map<string, string>,
  comunidades: Map<string, string>,
): Promise<void> {
  for (const u of USUARIOS_SEMILLA) {
    await client.query(
      `insert into usuarios (id, contacto_id, rol_staff, organizacion_id)
         values ($1, $2, $3, $4)
       on conflict (id) do update set
         contacto_id = excluded.contacto_id,
         rol_staff = excluded.rol_staff`,
      [u.id, contactos.get(u.telefono) ?? null, u.rolStaff, organizacionId],
    )
  }

  const verificadora = USUARIOS_SEMILLA.find((u) => u.rolStaff === 'verificador')
  if (verificadora) {
    for (const codigo of COMUNIDADES_DE_LA_VERIFICADORA) {
      const comunidadId = comunidades.get(codigo)
      if (!comunidadId) continue
      await client.query(
        `insert into usuarios_comunidades (usuario_id, comunidad_id)
           values ($1, $2)
         on conflict do nothing`,
        [verificadora.id, comunidadId],
      )
    }
  }
}

async function sembrarRutas(client: PoolClient, comunidades: Map<string, string>): Promise<void> {
  for (const r of [...RUTAS_SEMILLA, ...RUTAS_DEMO]) {
    const origen = comunidades.get(r.origen)
    const destino = comunidades.get(r.destino)
    if (!origen || !destino) {
      throw new Error(`Ruta ${r.origen}→${r.destino}: comunidad desconocida.`)
    }

    await client.query(
      `insert into rutas (
         origen_id, destino_id, modo, minutos, distancia_m,
         costo_estimado_cop, temporada, fuente, activa, notas
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (origen_id, destino_id, modo, temporada) do update set
         minutos = excluded.minutos,
         distancia_m = excluded.distancia_m,
         costo_estimado_cop = excluded.costo_estimado_cop,
         fuente = excluded.fuente,
         activa = excluded.activa,
         notas = excluded.notas`,
      [
        origen,
        destino,
        r.modo,
        r.minutos,
        r.distanciaM,
        r.costoEstimadoCop,
        r.temporada,
        r.fuente,
        r.activa,
        r.notas ?? null,
      ],
    )
  }
}

async function sembrarNodos(
  client: PoolClient,
  comunidades: Map<string, string>,
  contactos: Map<string, string>,
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>()

  for (const n of [...NODOS_SEMILLA, ...NODOS_DEMO]) {
    const comunidadId = comunidades.get(n.comunidad)
    if (!comunidadId) throw new Error(`Nodo ${n.nombre}: comunidad ${n.comunidad} desconocida.`)

    const { rows } = await client.query<{ id: string }>(
      `insert into nodos (
         comunidad_id, nombre, tipo, responsable_id,
         ubicacion, ubicacion_fuente, ubicacion_precision_m
       ) values (
         $1, $2, $3, $4,
         case when $5::double precision is null then null
              else st_setsrid(st_makepoint($5, $6), 4326) end,
         $7, $8
       )
       on conflict do nothing
       returning id`,
      [
        comunidadId,
        n.nombre,
        n.tipo,
        n.responsableTelefono ? (contactos.get(n.responsableTelefono) ?? null) : null,
        n.lon,
        n.lat,
        n.ubicacionFuente,
        n.ubicacionPrecisionM,
      ],
    )

    const id =
      rows[0]?.id ??
      (
        await client.query<{ id: string }>(
          'select id from nodos where comunidad_id = $1 and nombre = $2',
          [comunidadId, n.nombre],
        )
      ).rows[0]?.id

    if (!id) throw new Error(`No se pudo crear ni encontrar el nodo ${n.nombre}.`)
    mapa.set(n.clave, id)
  }

  return mapa
}

async function sembrarExistencias(client: PoolClient, nodos: Map<string, string>): Promise<void> {
  for (const bloque of [...EXISTENCIAS_SEMILLA, ...EXISTENCIAS_DEMO]) {
    const nodoId = nodos.get(bloque.nodo)
    if (!nodoId) throw new Error(`Existencias: nodo ${bloque.nodo} desconocido.`)

    for (const [codigoItem, cantidad] of Object.entries(bloque.items)) {
      await client.query(
        `insert into existencias (nodo_id, codigo_item, cantidad, contado_en, contado_por)
           values ($1, $2, $3, now() - make_interval(days => $4), $5)
         on conflict (nodo_id, codigo_item) do update set
           cantidad = excluded.cantidad,
           contado_en = excluded.contado_en,
           contado_por = excluded.contado_por`,
        [nodoId, codigoItem, cantidad, bloque.diasDesdeConteo, bloque.contadoPor],
      )
    }
  }
}

/**
 * FR-43 — expiry lots against the `existencias` rows `sembrarExistencias` just wrote. Runs
 * after it on purpose: a lot's FK needs the parent existencia to already exist. Idempotent by
 * clearing every lot under a seeded existencia once before re-inserting the seed's own set, so
 * a re-run of `db:seed` does not pile up duplicates.
 */
async function sembrarLotesExistencia(client: PoolClient, nodos: Map<string, string>): Promise<void> {
  const limpiados = new Set<string>()

  for (const lote of LOTES_EXISTENCIA_SEMILLA) {
    const nodoId = nodos.get(lote.nodo)
    if (!nodoId) throw new Error(`Lote: nodo ${lote.nodo} desconocido.`)

    const { rows } = await client.query<{ id: string }>(
      `select id from existencias where nodo_id = $1 and codigo_item = $2`,
      [nodoId, lote.codigoItem],
    )
    const existenciaId = rows[0]?.id
    if (!existenciaId) {
      throw new Error(`Lote: no hay existencia para ${lote.nodo}/${lote.codigoItem}.`)
    }

    if (!limpiados.has(existenciaId)) {
      await client.query(`delete from existencia_lotes where existencia_id = $1`, [existenciaId])
      limpiados.add(existenciaId)
    }

    await client.query(
      `insert into existencia_lotes (existencia_id, cantidad, fecha_caducidad, contado_por)
         values (
           $1, $2,
           case when $3::int is null then null else current_date + make_interval(days => $3::int) end,
           $4
         )`,
      [existenciaId, lote.cantidad, lote.diasHastaVencer, lote.contadoPor],
    )
  }
}

async function sembrarReportes(
  client: PoolClient,
  organizacionId: string,
  comunidades: Map<string, string>,
  contactos: Map<string, string>,
): Promise<void> {
  // Verified needs — the canonical basin (all WhatsApp) and the demo layer (each carrying the
  // channel it arrived on). Both promote to a `pedido` the matcher will classify.
  for (const [i, n] of NECESIDADES_VERIFICADAS.entries()) {
    await insertarNecesidadVerificada(client, organizacionId, comunidades, contactos, n, `nec-${n.comunidad}-${n.codigoItem}-${i}`, true)
  }
  for (const [i, n] of NECESIDADES_VERIFICADAS_DEMO.entries()) {
    await insertarNecesidadVerificada(client, organizacionId, comunidades, contactos, n, `demo-nec-${n.comunidad}-${n.codigoItem}-${i}`, true)
  }

  // Verified needs that are NOT cargo (apoyo psicosocial): a person travels, no box ships, so
  // no `pedido` is created. They surface in the «derivaciones» list of the verification screen.
  for (const [i, n] of NECESIDADES_DERIVADAS_DEMO.entries()) {
    await insertarNecesidadVerificada(client, organizacionId, comunidades, contactos, n, `demo-der-${n.comunidad}-${n.codigoItem}-${i}`, false)
  }

  // The canonical verification queue (all WhatsApp).
  for (const [i, r] of REPORTES_SIN_VERIFICAR.entries()) {
    const semilla = `sinver-${r.comunidad}-${r.codigoItem}-${i}`
    if (await yaSembrado(client, semilla)) continue

    await client.query(
      `insert into reportes (
         organizacion_id, tipo, canal, contacto_id, comunidad_id, codigo_item,
         familias, urgencia, severidad, descripcion, estado, payload_crudo, creado_en
       ) values (
         $1, $2, 'whatsapp', $3, $4, $5,
         $6, $7, $8, $9, 'RECIBIDO', $10, now() - make_interval(days => $11)
       )`,
      [
        organizacionId,
        r.tipo,
        contactos.get(r.telefono) ?? null,
        comunidades.get(r.comunidad),
        r.codigoItem,
        r.familias ?? null,
        r.urgencia ?? null,
        r.severidad ?? null,
        marcado(r.descripcion),
        JSON.stringify({ semilla }),
        r.diasAtras,
      ],
    )
  }

  // The demo verification queue: the same daily work, across all four channels, with a couple
  // of things nobody could classify on arrival (item null → clarification, not a guess).
  for (const r of REPORTES_SIN_VERIFICAR_DEMO) {
    if (await yaSembrado(client, r.semilla)) continue

    const payload: Record<string, unknown> = { semilla: r.semilla }
    // A radio relay is two people: the speaker and the operator who keyed it in (PRD §5.8).
    // Second-hand, so it waits for a human to confirm — which is what RECIBIDO already means.
    if (r.relatadoPor) payload.relatado_por = r.relatadoPor

    await client.query(
      `insert into reportes (
         organizacion_id, tipo, canal, contacto_id, comunidad_id, codigo_item,
         familias, urgencia, severidad, detalle_libre, descripcion, estado, payload_crudo, creado_en
       ) values (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11, 'RECIBIDO', $12, now() - make_interval(days => $13)
       )`,
      [
        organizacionId,
        r.tipo,
        r.canal,
        contactos.get(r.telefono) ?? null,
        comunidades.get(r.comunidad),
        r.codigoItem,
        r.familias ?? null,
        r.urgencia ?? null,
        r.severidad ?? null,
        r.detalleLibre ? marcado(r.detalleLibre) : null,
        r.descripcion ? marcado(r.descripcion) : null,
        JSON.stringify(payload),
        r.diasAtras,
      ],
    )
  }

  await sembrarNotasDeVoz(client)
}

/**
 * Inserts one verified need, carrying the channel it arrived on. Creates the `pedido` the
 * matcher works on unless the need is not cargo (`crearPedido = false`), in which case it
 * stays a verified report only — the referral list, never a shipment (Section 4.5).
 *
 * Location stays null: a WhatsApp or radio report has no pin unless the person sent one, and
 * borrowing the community centroid would be inventing a precision (non-negotiable 2.2).
 */
async function insertarNecesidadVerificada(
  client: PoolClient,
  organizacionId: string,
  comunidades: Map<string, string>,
  contactos: Map<string, string>,
  n: NecesidadSemilla,
  semilla: string,
  crearPedido: boolean,
): Promise<void> {
  if (await yaSembrado(client, semilla)) return

  const { rows } = await client.query<{ id: string }>(
    `insert into reportes (
       organizacion_id, tipo, canal, contacto_id, comunidad_id, codigo_item,
       familias, urgencia, detalle_libre, descripcion,
       estado, verificado_por, verificado_en, payload_crudo, creado_en
     ) values (
       $1, 'necesidad', $2, $3, $4, $5,
       $6, $7, $8, $9,
       'VERIFICADO', $10, now() - make_interval(days => $11), $12, now() - make_interval(days => $11)
     )
     returning id`,
    [
      organizacionId,
      n.canal ?? 'whatsapp',
      contactos.get(n.telefono) ?? null,
      comunidades.get(n.comunidad),
      n.codigoItem,
      n.familias,
      n.urgencia,
      n.detalleLibre ?? null,
      marcado(n.descripcion),
      n.verificadoPor,
      n.diasAtras,
      JSON.stringify({ semilla }),
    ],
  )

  if (!crearPedido) return

  await client.query(
    `insert into pedidos (reporte_id, comunidad_id, codigo_item, familias, urgencia, estado)
       values ($1, $2, $3, $4, $5, 'ABIERTO')`,
    [rows[0]!.id, comunidades.get(n.comunidad), n.codigoItem, n.familias, n.urgencia],
  )
}

/**
 * Attaches one playable voice note, so the audio inbox can actually be looked at.
 *
 * The bytes are a generated tone written into DATA_DIR — operational data, never the repo
 * (2.6 wants our own key, and a seeded provider URL would be a guaranteed 404). A WAV
 * because it can be synthesised here without pulling in an encoder, and every browser plays
 * one.
 */
async function sembrarNotasDeVoz(client: PoolClient): Promise<void> {
  // `raizDatos()` reads DATA_DIR with `??`, and `.env.example` ships `DATA_DIR=` empty — an
  // empty string is not nullish, so it resolves to the repo root and media lands in the
  // working tree. Operational data belongs outside the repo, so refuse rather than pollute.
  // Checked once: if DATA_DIR is wrong, no voice note seeds and the warning prints once.
  const raiz = raizDatos()
  if (!raiz || resolve(raiz) === resolve(process.cwd())) {
    console.warn(
      '\n  ⚠️  Notas de voz omitidas: DATA_DIR está vacío, y el audio caería dentro del repo.\n' +
        '     Póngale una ruta absoluta fuera del proyecto y vuelva a sembrar.\n',
    )
    return
  }

  for (const nota of [NOTA_DE_VOZ_SEMILLA, ...NOTAS_DE_VOZ_DEMO]) {
    const { rows } = await client.query<{ id: string }>(
      `select id from reportes where payload_crudo->>'semilla' = $1`,
      [nota.semillaReporte],
    )
    const reporteId = rows[0]?.id
    if (!reporteId) continue

    const { rowCount } = await client.query(
      `select 1 from adjuntos where reporte_id = $1 and tipo = 'audio'`,
      [reporteId],
    )
    if (rowCount) continue

    const bytes = tonoWav(nota.segundos)
    const hash = createHash('sha256').update(bytes).digest('hex')
    const clave = `audio/${hash.slice(0, 2)}/${hash}.wav`
    await almacenamientoLocal(raiz).guardar(clave, bytes)

    await client.query(
      `insert into adjuntos (reporte_id, tipo, storage_key, mime, bytes, duracion_seg,
                             hash_sha256, transcripcion, transcripcion_confianza)
       values ($1, 'audio', $2, 'audio/wav', $3, $4, $5, $6, $7)`,
      [reporteId, clave, bytes.byteLength, nota.segundos, hash, nota.transcripcion, nota.confianza],
    )
  }
}

/** A quiet sine tone as a 16-bit mono WAV. Placeholder audio, never a person's voice. */
function tonoWav(segundos: number, hz = 220, muestreo = 8000): Buffer {
  const muestras = segundos * muestreo
  const datos = Buffer.alloc(muestras * 2)
  for (let i = 0; i < muestras; i += 1) {
    // Fades in and out so it does not click, and stays quiet: nobody needs to be startled.
    const sobre = Math.min(1, i / muestreo, (muestras - i) / muestreo)
    datos.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / muestreo) * 6000 * sobre), i * 2)
  }

  const cabecera = Buffer.alloc(44)
  cabecera.write('RIFF', 0)
  cabecera.writeUInt32LE(36 + datos.length, 4)
  cabecera.write('WAVEfmt ', 8)
  cabecera.writeUInt32LE(16, 16)
  cabecera.writeUInt16LE(1, 20)
  cabecera.writeUInt16LE(1, 22)
  cabecera.writeUInt32LE(muestreo, 24)
  cabecera.writeUInt32LE(muestreo * 2, 28)
  cabecera.writeUInt16LE(2, 32)
  cabecera.writeUInt16LE(16, 34)
  cabecera.write('data', 36)
  cabecera.writeUInt32LE(datos.length, 40)
  return Buffer.concat([cabecera, datos])
}

async function sembrarCapacidades(
  client: PoolClient,
  contactos: Map<string, string>,
  nodos: Map<string, string>,
  comunidades: Map<string, string>,
): Promise<void> {
  for (const c of [...CAPACIDADES_SEMILLA, ...CAPACIDADES_DEMO]) {
    const contactoId = contactos.get(c.telefono)
    const nodoId = nodos.get(c.origenNodo)
    const comunidadId = comunidades.get(c.hastaComunidad)
    if (!contactoId || !nodoId || !comunidadId) {
      throw new Error(`Capacidad de ${c.telefono}: referencia desconocida.`)
    }

    const { rowCount } = await client.query(
      'select 1 from capacidades where contacto_id = $1 and hasta_comunidad_id = $2 and notas = $3',
      [contactoId, comunidadId, marcado(c.notas)],
    )
    if (rowCount) continue

    await client.query(
      `insert into capacidades (
         contacto_id, modo, origen_nodo_id, hasta_comunidad_id,
         sale_en, cupo_familias, estado, notas
       ) values ($1, $2, $3, $4, now() + make_interval(days => $5), $6, 'OFRECIDA', $7)`,
      [contactoId, c.modo, nodoId, comunidadId, c.enDias, c.cupoFamilias, marcado(c.notas)],
    )
  }
}

async function sembrarOfertas(
  client: PoolClient,
  contactos: Map<string, string>,
): Promise<void> {
  for (const o of OFERTAS_SEMILLA) {
    const contactoId = contactos.get(o.telefono)
    if (!contactoId) throw new Error(`Oferta de ${o.telefono}: contacto desconocido.`)

    // `texto_original` is the natural key here: it is the one thing that never changes.
    const { rowCount } = await client.query(
      'select 1 from ofertas where contacto_id = $1 and texto_original = $2',
      [contactoId, marcado(o.textoOriginal)],
    )
    if (rowCount) continue

    const tieneUbicacion = o.lat !== undefined && o.lon !== undefined
    await client.query(
      `insert into ofertas (
         contacto_id, texto_original, codigo_item, cantidad, unidad, confianza,
         requiere_aclaracion, ubicacion, ubicacion_fuente, ubicacion_precision_m,
         direccion_texto, perecedero, vence_en, necesita_recogida, estado
       ) values (
         $1, $2, $3, $4, $5, $6,
         $7,
         case when $8::double precision is null then null
              else st_setsrid(st_makepoint($8, $9), 4326) end,
         $10, $11,
         $12, $13,
         case when $14::int is null then null else now() + make_interval(hours => $14::int) end,
         $15, $16
       )`,
      [
        contactoId,
        marcado(o.textoOriginal),
        o.codigoItem,
        o.cantidad,
        o.unidad,
        o.confianza,
        o.requiereAclaracion ?? false,
        tieneUbicacion ? o.lon : null,
        tieneUbicacion ? o.lat : null,
        // Staff placed these on the map from a dictated address: 'manual', not 'gps'.
        tieneUbicacion ? 'manual' : null,
        tieneUbicacion ? 300 : null,
        o.direccionTexto ?? null,
        o.perecedero ?? false,
        o.venceEnHoras ?? null,
        o.necesitaRecogida ?? true,
        o.estado,
      ],
    )
  }
}

async function sembrarVoluntarios(
  client: PoolClient,
  contactos: Map<string, string>,
  nodos: Map<string, string>,
): Promise<void> {
  for (const v of VOLUNTARIOS_SEMILLA) {
    const contactoId = contactos.get(v.telefono)
    const nodoId = nodos.get(v.nodo)
    if (!contactoId || !nodoId) throw new Error(`Voluntario ${v.telefono}: referencia desconocida.`)

    const { rowCount } = await client.query(
      'select 1 from voluntarios where contacto_id = $1 and nodo_id = $2 and tipo_labor = $3',
      [contactoId, nodoId, v.tipoLabor],
    )
    if (rowCount) continue

    await client.query(
      `insert into voluntarios (
         contacto_id, nodo_id, tipo_labor, disponible_desde, disponible_hasta
       ) values (
         $1, $2, $3, now() + make_interval(days => $4), now() + make_interval(days => $5)
       )`,
      [contactoId, nodoId, v.tipoLabor, v.desdeEnDias, v.hastaEnDias],
    )
  }
}

/**
 * §5.9 — Connection points, the "where can I go" surface. STAGING ONLY.
 *
 * Kept SEPARATE from `nodos` on purpose (§5.9): supply and connectivity never merge, so the one
 * place a person runs both never hides it. Each point declares its own location source and radius
 * (2.2) — a GPS pin, a staff-placed radius, or no location at all when it is known by name before
 * anyone pinned it. Name and note are marked so a partner walking staging cannot mistake a demo
 * point for a surveyed one. Idempotent on (organizacion_id, nombre).
 */
async function sembrarPuntosConexion(
  client: PoolClient,
  organizacionId: string,
  comunidades: Map<string, string>,
): Promise<void> {
  for (const p of PUNTOS_CONEXION_DEMO) {
    const tieneUbicacion = p.lat !== undefined && p.lon !== undefined
    const { rows } = await client.query<{ id: string }>(
      `insert into puntos_conexion (
         organizacion_id, nombre, tipo,
         ubicacion, ubicacion_fuente, ubicacion_precision_m,
         tiene_senal, internet_disponible, vende_pines, atendido,
         seguridad, privacidad, permanencia, accesibilidad, energia, costo,
         notas
       ) values (
         $1, $2, $3,
         case when $4::double precision is null then null
              else st_setsrid(st_makepoint($4, $5), 4326) end,
         $6, $7,
         $8, $9, $10, $11,
         $12, $13, $14, $15, $16, $17,
         $18
       )
       on conflict (organizacion_id, nombre) do update set
         tipo = excluded.tipo,
         ubicacion = excluded.ubicacion,
         ubicacion_fuente = excluded.ubicacion_fuente,
         ubicacion_precision_m = excluded.ubicacion_precision_m,
         tiene_senal = excluded.tiene_senal,
         internet_disponible = excluded.internet_disponible,
         vende_pines = excluded.vende_pines,
         atendido = excluded.atendido,
         seguridad = excluded.seguridad,
         privacidad = excluded.privacidad,
         permanencia = excluded.permanencia,
         accesibilidad = excluded.accesibilidad,
         energia = excluded.energia,
         costo = excluded.costo,
         notas = excluded.notas
       returning id`,
      [
        organizacionId,
        marcado(p.nombre),
        p.tipo,
        tieneUbicacion ? p.lon : null,
        tieneUbicacion ? p.lat : null,
        tieneUbicacion ? (p.ubicacionFuente ?? null) : null,
        tieneUbicacion ? (p.ubicacionPrecisionM ?? null) : null,
        p.tieneSenal,
        p.internetDisponible,
        p.vendePines,
        p.atendido,
        p.seguridad,
        p.privacidad,
        p.permanencia,
        p.accesibilidad,
        p.energia,
        p.costo,
        marcado(p.notas),
      ],
    )
    const puntoId = rows[0]!.id

    for (const codigo of p.comunidades) {
      const comunidadId = comunidades.get(codigo)
      if (!comunidadId) throw new Error(`Punto ${p.nombre}: comunidad ${codigo} desconocida.`)
      await client.query(
        `insert into puntos_conexion_comunidades (punto_id, comunidad_id)
           values ($1, $2)
         on conflict (punto_id, comunidad_id) do nothing`,
        [puntoId, comunidadId],
      )
    }
  }
}

/**
 * PRD-12 «Apadrina una partera». STAGING ONLY.
 *
 * Records the demo sponsorships and their funding trace through the real lib helpers, so the
 * insert path (and the RLS-signed `creado_por` / `aplicado_por`) is the same one the panel uses.
 * `creado_por` is the seeded coordinador. Idempotent: the seed key lives in `notas`, and if a
 * sponsorship is already present its assignments are too (both are written in one transaction).
 *
 * The consent invariant (a named community cannot be `activo` without consent) is satisfied by
 * `consentimiento: true` on every named-community row; the pool carries no community and needs
 * none. The database enforces it regardless (apadrinamientos_consentida_check).
 */
async function sembrarApadrinamientos(
  client: PoolClient,
  organizacionId: string,
  comunidades: Map<string, string>,
): Promise<void> {
  const { rows: coord } = await client.query<{ id: string }>(
    `select id from usuarios where rol_staff = 'coordinador' order by creado_en limit 1`,
  )
  const actorId = coord[0]?.id
  if (!actorId) {
    console.warn('\n  ⚠️  Apadrinamientos demo omitidos: no hay un coordinador sembrado.\n')
    return
  }

  for (const a of APADRINAMIENTOS_DEMO) {
    const notas = `${MARCA_PRUEBA} semilla:apadrinamiento-${a.semilla}`
    const { rowCount } = await client.query(
      'select 1 from apadrinamientos where organizacion_id = $1 and notas = $2',
      [organizacionId, notas],
    )
    if (rowCount) continue

    const comunidadId = a.comunidad ? (comunidades.get(a.comunidad) ?? null) : null
    if (a.comunidad && !comunidadId) {
      throw new Error(`Apadrinamiento ${a.semilla}: comunidad ${a.comunidad} desconocida.`)
    }

    const apadrinamientoId = await crearApadrinamiento(
      client,
      {
        organizacionId,
        comunidadId,
        beneficiarioEtiqueta: marcado(a.beneficiarioEtiqueta),
        padrinoNombre: marcado(a.padrinoNombre),
        padrinoContacto: a.padrinoContacto ?? null,
        padrinoTipo: a.padrinoTipo,
        proposito: marcado(a.proposito),
        montoCop: a.montoCop,
        recurrencia: a.recurrencia,
        consentimientoBeneficiario: a.consentimiento,
        notas,
      },
      actorId,
    )

    for (const asig of a.asignaciones ?? []) {
      // PRD-39: `comunidadPedido` is a demo short code; resolve it through the same registry
      // map every other demo row uses, then find the pedido by community id.
      const comunidadPedidoId = comunidades.get(asig.comunidadPedido)
      if (!comunidadPedidoId) {
        throw new Error(
          `Apadrinamiento ${a.semilla}: comunidad ${asig.comunidadPedido} desconocida.`,
        )
      }
      const { rows: peds } = await client.query<{ id: string }>(
        `select p.id
           from pedidos p
          where p.comunidad_id = $1 and p.codigo_item = $2
          order by p.creado_en
          limit 1`,
        [comunidadPedidoId, asig.codigoItem],
      )
      const pedidoId = peds[0]?.id
      if (!pedidoId) {
        throw new Error(
          `Apadrinamiento ${a.semilla}: no hay pedido ${asig.comunidadPedido}/${asig.codigoItem} que financiar.`,
        )
      }
      await aplicarFondos(
        client,
        { apadrinamientoId, pedidoId, montoAplicadoCop: asig.montoCop, concepto: marcado(asig.concepto) },
        actorId,
      )
    }
  }
}

/**
 * §2.4 / §4 — one centre waiting for platform approval, for the /centros screen. STAGING ONLY.
 *
 * A DISTINCT organisation (a community council asking to operate) in `estado_aprobacion =
 * 'pendiente'`, its pending center-admin invitation, and the `centro.solicitado` audit row the
 * screen reads for the applicant and zone — so the platform-admin Centros screen shows a real
 * "waiting for approval" card whose Aprobar/Rechazar run through `convite_decidir_centro`. It is
 * created after the partner org, so the partner stays the earliest-created org where staff land;
 * this one has only the pending invitation. Idempotent on the org name, the invitation email and
 * the audit action.
 */
async function sembrarCentroPendiente(client: PoolClient): Promise<void> {
  const nombre = marcado(CENTRO_PENDIENTE_DEMO.nombre)
  const { rows } = await client.query<{ id: string }>(
    `insert into organizaciones (nombre, estado_aprobacion)
       values ($1, 'pendiente')
     on conflict (nombre) do nothing
     returning id`,
    [nombre],
  )
  const orgId =
    rows[0]?.id ??
    (
      await client.query<{ id: string }>('select id from organizaciones where nombre = $1', [nombre])
    ).rows[0]?.id
  if (!orgId) throw new Error('No se pudo crear ni encontrar el centro pendiente demo.')

  // `invitaciones_correo_key` is a PARTIAL unique index (where correo is not null, 0029), so a
  // bare ON CONFLICT (correo) does not match it — a select-guard keeps the insert idempotent.
  const { rowCount: yaHayInvitacion } = await client.query(
    'select 1 from invitaciones_staff where correo = $1',
    [CENTRO_PENDIENTE_DEMO.adminCorreo],
  )
  if (!yaHayInvitacion) {
    await client.query(
      `insert into invitaciones_staff (correo, rol_staff, organizacion_id, es_plataforma)
         values ($1, 'admin', $2, false)`,
      [CENTRO_PENDIENTE_DEMO.adminCorreo, orgId],
    )
  }

  const { rowCount: yaHayAuditoria } = await client.query(
    `select 1 from auditoria
      where entidad = 'organizaciones' and entidad_id = $1 and accion = 'centro.solicitado'`,
    [orgId],
  )
  if (!yaHayAuditoria) {
    await client.query(
      `insert into auditoria (accion, entidad, entidad_id, despues)
         values ('centro.solicitado', 'organizaciones', $1, $2)`,
      [
        orgId,
        JSON.stringify({
          solicitante: marcado(CENTRO_PENDIENTE_DEMO.solicitante),
          contacto: CENTRO_PENDIENTE_DEMO.contacto,
          detalle: CENTRO_PENDIENTE_DEMO.detalle,
        }),
      ],
    )
  }
}

/**
 * PRD-29 «Evaluaciones y recuperación». STAGING ONLY.
 *
 * Templates, assessment sweeps, findings routed by `via_de_respuesta`, and one costed bill of
 * materials — so /evaluaciones shows coverage, findings and a fundable balance instead of empty
 * states. Signed against the seeded coordinador; the audit trigger (0044) records each insert.
 * Idempotent: fixed ids / the template's (org, codigo) key.
 */
async function sembrarEvaluaciones(
  client: PoolClient,
  organizacionId: string,
  comunidades: Map<string, string>,
): Promise<void> {
  for (const p of PLANTILLAS_EVALUACION_DEMO) {
    await client.query(
      `insert into plantillas_evaluacion (
         id, organizacion_id, dominio, codigo, nombre, descripcion,
         materiales_cop, transporte_cop, asistencia_tecnica_cop, mano_de_obra_dias, creado_por
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (organizacion_id, codigo) do nothing`,
      [
        p.id, organizacionId, p.dominio, p.codigo, marcado(p.nombre),
        p.descripcion ? marcado(p.descripcion) : null,
        p.materialesCop, p.transporteCop, p.asistenciaTecnicaCop, p.manoDeObraDias, ID_COORDINADOR,
      ],
    )
  }

  for (const e of EVALUACIONES_DEMO) {
    const comunidadId = comunidades.get(e.comunidad)
    if (!comunidadId) throw new Error(`Evaluación ${e.id}: comunidad ${e.comunidad} desconocida.`)
    await client.query(
      `insert into evaluaciones (
         id, organizacion_id, comunidad_id, dominio, evaluador_nombre, fecha_visita,
         total_estimado, vence_en, registrado_por, notas
       ) values (
         $1,$2,$3,$4,$5,(now() - make_interval(days => $6::int))::date,
         $7,
         case when $8::int is null then null else (now() + make_interval(days => $8::int))::date end,
         $9,$10
       )
       on conflict (id) do nothing`,
      [
        e.id, organizacionId, comunidadId, e.dominio, marcado(e.evaluadorNombre),
        e.fechaVisitaDiasAtras, e.totalEstimado, e.venceEnEnDias, ID_COORDINADOR,
        e.notas ? marcado(e.notas) : null,
      ],
    )
  }

  for (const h of HALLAZGOS_EVALUACION_DEMO) {
    const comunidadId = comunidades.get(h.comunidad)
    if (!comunidadId) throw new Error(`Hallazgo ${h.id}: comunidad ${h.comunidad} desconocida.`)
    await client.query(
      `insert into evaluacion_hallazgos (
         id, organizacion_id, evaluacion_id, comunidad_id, dominio, descripcion,
         severidad, via_de_respuesta, derivacion_destino, registrado_por
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (id) do nothing`,
      [
        h.id, organizacionId, h.evaluacion, comunidadId, h.dominio, marcado(h.descripcion),
        h.severidad, h.viaDeRespuesta, h.derivacionDestino ? marcado(h.derivacionDestino) : null,
        ID_COORDINADOR,
      ],
    )
  }

  for (const b of HALLAZGO_BOM_DEMO) {
    await client.query(
      `insert into hallazgo_bom (
         id, hallazgo_id, organizacion_id, origen, plantilla_id,
         materiales_cop, transporte_cop, asistencia_tecnica_cop, mano_de_obra_dias,
         materiales_cubierto_cop, transporte_cubierto_cop, asistencia_tecnica_cubierto_cop,
         mano_de_obra_cubierta_dias, editado_por
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (id) do nothing`,
      [
        b.id, b.hallazgo, organizacionId, b.origen, b.plantilla,
        b.materialesCop, b.transporteCop, b.asistenciaTecnicaCop, b.manoDeObraDias,
        b.materialesCubiertoCop, b.transporteCubiertoCop, b.asistenciaTecnicaCubiertoCop,
        b.manoDeObraCubiertaDias, ID_COORDINADOR,
      ],
    )
  }

  // FR-48 — servicios de ingeniería: technical-evaluation tickets. No total_estimado (that is
  // what marks a row as a ticket rather than a census sweep — see lib/evaluaciones.ts).
  for (const e of EVALUACIONES_TECNICAS_DEMO) {
    const comunidadId = comunidades.get(e.comunidad)
    if (!comunidadId) throw new Error(`Evaluación técnica ${e.id}: comunidad ${e.comunidad} desconocida.`)
    await client.query(
      `insert into evaluaciones
         (id, organizacion_id, comunidad_id, dominio, asignado_a, estado, detalle, notas, registrado_por)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (id) do nothing`,
      [
        e.id, organizacionId, comunidadId, e.dominio, marcado(e.asignadoA), e.estado,
        e.detalle ? marcado(e.detalle) : null, e.notas ? marcado(e.notas) : null, ID_COORDINADOR,
      ],
    )
  }
}

/**
 * PRD-30 / PRD-31 «Agenda › Programas y Jornadas». STAGING ONLY.
 *
 * Programas with budget, cadence, target communities, a persistent roster, programa-level
 * sponsorship and a spend ledger; the jornadas that realise them, with ordered stops and per-session
 * attendance. One target community (Winandó) is reachable only in `lluvias`, so the feasibility
 * calendar shows the seasonal gap. Jornadas need the Chocó region planted by `sembrar:territorio`.
 * Idempotent: programa/jornada on their `codigo`, join rows on their natural keys, the rest on fixed ids.
 */
async function sembrarAgenda(
  client: PoolClient,
  organizacionId: string,
  comunidades: Map<string, string>,
): Promise<void> {
  const { rows: reg } = await client.query<{ id: string }>(
    `select id from regiones where nombre = 'Chocó' limit 1`,
  )
  const regionId = reg[0]?.id
  if (!regionId) {
    throw new Error(
      "Agenda demo: no existe la región 'Chocó'. Corra 'pnpm sembrar:territorio' antes de 'pnpm db:seed'.",
    )
  }

  for (const p of PROGRAMAS_DEMO) {
    await client.query(
      `insert into programas (
         id, codigo, organizacion_id, titulo, objetivo, poblacion_objetivo, familias_objetivo,
         cadencia, fecha_inicio, fecha_fin, renueva, estado, presupuesto_comprometido_cop,
         financiador, financiador_reporte, notas, creado_por
       ) values (
         $1,$2,$3,$4,$5,$6,$7,$8,
         case when $9::int is null then null else (now() - make_interval(days => $9::int))::date end,
         case when $10::int is null then null else (now() + make_interval(days => $10::int))::date end,
         $11,$12,$13,$14,$15,$16,$17
       )
       on conflict (codigo) do nothing`,
      [
        p.id, p.codigo, organizacionId, marcado(p.titulo), marcado(p.objetivo),
        p.poblacionObjetivo ? marcado(p.poblacionObjetivo) : null, p.familiasObjetivo,
        p.cadencia, p.fechaInicioDiasAtras, p.fechaFinEnDias, p.renueva, p.estado,
        p.presupuestoComprometidoCop,
        p.financiador ? marcado(p.financiador) : null,
        p.financiadorReporte ? marcado(p.financiadorReporte) : null,
        p.notas ? marcado(p.notas) : null, ID_COORDINADOR,
      ],
    )

    for (const c of p.comunidades) {
      const comunidadId = comunidades.get(c.codigo)
      if (!comunidadId) throw new Error(`Programa ${p.codigo}: comunidad ${c.codigo} desconocida.`)
      await client.query(
        `insert into programa_comunidades (programa_id, comunidad_id, familias_estimadas)
           values ($1,$2,$3)
         on conflict (programa_id, comunidad_id) do nothing`,
        [p.id, comunidadId, c.familiasEstimadas],
      )
    }

    for (const pt of p.participantes) {
      await client.query(
        `insert into programa_participantes (id, programa_id, nombre, contacto, completado, completado_en)
           values (
             $1,$2,$3,$4,$5,
             case when $6::int is null then null else now() - make_interval(days => $6::int) end
           )
         on conflict (id) do nothing`,
        [pt.id, p.id, marcado(pt.nombre), pt.contacto ? marcado(pt.contacto) : null, pt.completado, pt.completadoDiasAtras],
      )
    }

    for (const a of p.apadrinamientos) {
      await client.query(
        `insert into programa_apadrinamientos (
           id, programa_id, etiqueta, padrino_nombre, padrino_contacto, padrino_tipo,
           monto_cop, recurrencia, estado, consentimiento,
           consentimiento_en, creado_por
         ) values (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
           case when $10 then now() else null end,
           $11
         )
         on conflict (id) do nothing`,
        [
          a.id, p.id, marcado(a.etiqueta), marcado(a.padrinoNombre), a.padrinoContacto,
          a.padrinoTipo, a.montoCop, a.recurrencia, a.estado, a.consentimiento, ID_COORDINADOR,
        ],
      )
    }
  }

  for (const j of JORNADAS_DEMO) {
    await client.query(
      `insert into jornadas (
         id, codigo, tipo, organizacion_id, titulo, region_id, programa_id,
         fecha_inicio, fecha_fin, estado, familias_atendidas, notas
       ) values (
         $1,$2,$3,$4,$5,$6,$7,
         case when $8::int is null then null else (now() - make_interval(days => $8::int))::date end,
         case when $9::int is null then null else (now() - make_interval(days => $9::int))::date end,
         $10,$11,$12
       )
       on conflict (codigo) do nothing`,
      [
        j.id, j.codigo, j.tipo, organizacionId, marcado(j.titulo), regionId, j.programa,
        j.fechaInicioDiasAtras, j.fechaFinDiasAtras, j.estado, j.familiasAtendidas,
        j.notas ? marcado(j.notas) : null,
      ],
    )

    for (const pa of j.paradas) {
      const comunidadId = comunidades.get(pa.codigo)
      if (!comunidadId) throw new Error(`Jornada ${j.codigo}: comunidad ${pa.codigo} desconocida.`)
      await client.query(
        `insert into jornada_paradas (jornada_id, comunidad_id, orden, notas)
           values ($1,$2,$3,$4)
         on conflict (jornada_id, orden) do nothing`,
        [j.id, comunidadId, pa.orden, pa.notas ? marcado(pa.notas) : null],
      )
    }

    for (const participanteId of j.asistieron) {
      await client.query(
        `insert into programa_asistencias (participante_id, jornada_id, asistio)
           values ($1,$2,true)
         on conflict (participante_id, jornada_id) do nothing`,
        [participanteId, j.id],
      )
    }
  }

  for (const ap of PROGRAMA_APLICACIONES_DEMO) {
    await client.query(
      `insert into programa_aplicaciones (
         id, programa_id, apadrinamiento_id, jornada_id, monto_aplicado_cop, concepto, aplicado_por
       ) values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (id) do nothing`,
      [
        ap.id, ap.programa, ap.apadrinamiento, ap.jornada, ap.montoAplicadoCop,
        ap.concepto ? marcado(ap.concepto) : null, ID_COORDINADOR,
      ],
    )
  }
}

/**
 * PRD-8 «Traslado de personas». STAGING ONLY.
 *
 * Two person-transport records — one DESPACHADO with its 4-digit arrival code and a return leg, one
 * stuck at SIN_CAPACIDAD — so /traslados shows the seats, the §25 needs and the PII posture. States
 * are set directly (the person-transport matcher is not run by the seed). Idempotent on fixed ids.
 */
async function sembrarTraslados(
  client: PoolClient,
  organizacionId: string,
  comunidades: Map<string, string>,
): Promise<void> {
  for (const t of TRASLADOS_DEMO) {
    const origen = comunidades.get(t.origen)
    const destino = comunidades.get(t.destino)
    if (!origen || !destino) throw new Error(`Traslado ${t.id}: comunidad de origen o destino desconocida.`)
    await client.query(
      `insert into traslados_persona (
         id, organizacion_id, persona_etiqueta, persona_nombre, persona_telefono, personas,
         motivo_categoria, motivo_detalle, necesidad_accesibilidad,
         origen_comunidad_id, destino_comunidad_id, ventana_desde, ventana_hasta,
         requiere_alojamiento, requiere_alimentacion, requiere_acompanamiento, requiere_regreso,
         regreso_ventana_desde, regreso_ventana_hasta, estado, motivo,
         despachado_por, despachado_en, codigo_llegada, creado_por, notas
       ) values (
         $1,$2,$3,$4,$5,$6,
         $7,$8,$9,
         $10,$11,
         now() - make_interval(days => $12::int),
         now() - make_interval(days => $13::int),
         $14,$15,$16,$17,
         case when $18::int is null then null else now() + make_interval(days => $18::int) end,
         case when $19::int is null then null else now() + make_interval(days => $19::int) end,
         $20,$21,
         case when $22::int is null then null else $23::uuid end,
         case when $22::int is null then null else now() - make_interval(days => $22::int) end,
         $24,$25,$26
       )
       on conflict (id) do nothing`,
      [
        t.id, organizacionId, marcado(t.personaEtiqueta),
        t.personaNombre ? marcado(t.personaNombre) : null, t.personaTelefono, t.personas,
        t.motivoCategoria, t.motivoDetalle ? marcado(t.motivoDetalle) : null,
        t.necesidadAccesibilidad ? marcado(t.necesidadAccesibilidad) : null,
        origen, destino, t.ventanaDesdeDiasAtras, t.ventanaHastaDiasAtras,
        t.requiereAlojamiento, t.requiereAlimentacion, t.requiereAcompanamiento, t.requiereRegreso,
        t.regresoVentanaDesdeEnDias, t.regresoVentanaHastaEnDias, t.estado,
        t.motivo ? marcado(t.motivo) : null,
        t.despachadoDiasAtras, ID_DESPACHADOR, t.codigoLlegada, ID_COORDINADOR,
        t.notas ? marcado(t.notas) : null,
      ],
    )
  }
}

/**
 * PRD-9 «Compra local financiada». STAGING ONLY.
 *
 * One funding pool with a ceiling, two vendors and two purchases at different points of the six-step
 * chain (one COMPRADA, one DISTRIBUIDA with evidence). Each purchase is inserted directly at its
 * target state with every earlier step filled (the authorisation core is immutable after recording),
 * and pre-checked by id so the ceiling guardrail never double-counts on a re-run.
 */
async function sembrarCompraLocal(
  client: PoolClient,
  organizacionId: string,
  comunidades: Map<string, string>,
  contactos: Map<string, string>,
): Promise<void> {
  for (const f of FONDOS_COMPRA_DEMO) {
    await client.query(
      `insert into fondos_compra (id, organizacion_id, nombre, techo_cop, umbral_alerta_cop, activo, creado_por)
         values ($1,$2,$3,$4,$5,true,$6)
       on conflict (id) do nothing`,
      [f.id, organizacionId, marcado(f.nombre), f.techoCop, f.umbralAlertaCop, ID_COORDINADOR],
    )
  }

  for (const p of PROVEEDORES_LOCALES_DEMO) {
    const comunidadId = p.comunidad ? (comunidades.get(p.comunidad) ?? null) : null
    await client.query(
      `insert into proveedores_locales (
         id, organizacion_id, nombre, comunidad_id, municipio, suministra, contacto, es_farmacia, activo, creado_por
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,true,$9)
       on conflict (id) do update set es_farmacia = excluded.es_farmacia`,
      [
        p.id, organizacionId, marcado(p.nombre), comunidadId, p.municipio,
        p.suministra ? marcado(p.suministra) : null, p.contacto, p.esFarmacia ?? false, ID_COORDINADOR,
      ],
    )

    // FR-44: a pharmacy's structured stock, item by item.
    for (const e of p.existencias ?? []) {
      await client.query(
        `insert into proveedor_existencias (organizacion_id, proveedor_id, codigo_item, cantidad, contado_por)
           values ($1,$2,$3,$4,$5)
         on conflict (proveedor_id, codigo_item) do update set
           cantidad = excluded.cantidad,
           contado_en = now(),
           contado_por = excluded.contado_por`,
        [organizacionId, p.id, e.codigoItem, e.cantidad, ID_COORDINADOR],
      )
    }
  }

  for (const c of COMPRAS_LOCALES_DEMO) {
    // Pre-check by id so the BEFORE INSERT ceiling guardrail never double-counts on a re-run.
    const { rowCount } = await client.query('select 1 from compras_locales where id = $1', [c.id])
    if (rowCount) continue

    const responsableId = contactos.get(c.responsableTelefono)
    if (!responsableId) {
      throw new Error(`Compra ${c.id}: responsable ${c.responsableTelefono} desconocido.`)
    }
    const comunidadId = c.comunidad ? (comunidades.get(c.comunidad) ?? null) : null

    await client.query(
      `insert into compras_locales (
         id, organizacion_id, fondo_id, pedido_id, proveedor_id, responsable_id, comunidad_id,
         concepto, monto_autorizado_cop, monto_real_cop, estado,
         autorizado_por, autorizado_en, recibo_ref,
         comprado_por, comprado_en, verificado_por, verificado_en,
         distribuido_por, distribuido_en, cerrado_por, cerrado_en, notas
       ) values (
         $1,$2,$3,null,$4,$5,$6,
         $7,$8,$9,$10,
         $11::uuid, now() - make_interval(days => $12::int), $13,
         case when $14::int is null then null else $11::uuid end,
         case when $14::int is null then null else now() - make_interval(days => $14::int) end,
         case when $15::int is null then null else $11::uuid end,
         case when $15::int is null then null else now() - make_interval(days => $15::int) end,
         case when $16::int is null then null else $11::uuid end,
         case when $16::int is null then null else now() - make_interval(days => $16::int) end,
         case when $17::int is null then null else $11::uuid end,
         case when $17::int is null then null else now() - make_interval(days => $17::int) end,
         $18
       )`,
      [
        c.id, organizacionId, c.fondo, c.proveedor, responsableId, comunidadId,
        marcado(c.concepto), c.montoAutorizadoCop, c.montoRealCop, c.estado,
        ID_COORDINADOR, c.autorizadoDiasAtras, c.reciboRef,
        c.compradoDiasAtras, c.verificadoDiasAtras, c.distribuidoDiasAtras, c.cerradoDiasAtras,
        c.notas ? marcado(c.notas) : null,
      ],
    )

    for (const it of c.items) {
      await client.query(
        `insert into compra_local_items (compra_id, codigo_item, cantidad, costo_cop)
           values ($1,$2,$3,$4)`,
        [c.id, it.codigoItem, it.cantidad, it.costoCop],
      )
    }
    for (const ev of c.evidencias) {
      await client.query(
        `insert into compra_local_evidencias (compra_id, tipo, referencia, descripcion, subido_por)
           values ($1,$2,$3,$4,$5)`,
        [c.id, ev.tipo, ev.referencia, ev.descripcion ? marcado(ev.descripcion) : null, ID_COORDINADOR],
      )
    }
  }
}

/**
 * PRD-33 «Cadena de frío y suministro anticipado». STAGING ONLY.
 *
 * Marks item 22 (chronic meds / insulin) as cold-chain, leaves the open-boat leg into Beté
 * explicitly not apt and the Quibdó warehouse cold-holding — so the matcher's later clasificar()
 * sweep reclassifies the real Beté chronic-meds pedido to SIN_RUTA with a cold-chain motivo. One
 * anticipatory subscription is added for the anticipatory side of §24. Runs BEFORE clasificar().
 */
async function sembrarCadenaFrio(
  client: PoolClient,
  organizacionId: string,
  comunidades: Map<string, string>,
  nodos: Map<string, string>,
): Promise<void> {
  for (const r of REQUISITOS_ALMACENAMIENTO_DEMO) {
    await client.query(
      `insert into catalogo_requisitos_almacenamiento (
         codigo_item, cadena_frio, sensible_luz, max_minutos_transito, notas
       ) values ($1,$2,$3,$4,$5)
       on conflict (codigo_item) do update set
         cadena_frio = excluded.cadena_frio,
         sensible_luz = excluded.sensible_luz,
         max_minutos_transito = excluded.max_minutos_transito,
         notas = excluded.notas`,
      [r.codigoItem, r.cadenaFrio, r.sensibleLuz, r.maxMinutosTransito, r.notas ? marcado(r.notas) : null],
    )
  }

  for (const rf of RUTAS_FRIO_DEMO) {
    const comunidadId = comunidades.get(rf.destino)
    if (!comunidadId) continue
    const { rows } = await client.query<{ id: string }>(
      `select id from rutas where destino_id = $1 order by creado_en limit 1`,
      [comunidadId],
    )
    const rutaId = rows[0]?.id
    if (!rutaId) {
      console.warn(`\n  ⚠️  Cadena de frío: sin ruta hacia ${rf.destino}; no se marca su aptitud.\n`)
      continue
    }
    await client.query(
      `insert into rutas_restriccion_cadena_frio (ruta_id, apta_cadena_frio, notas)
         values ($1,$2,$3)
       on conflict (ruta_id) do update set
         apta_cadena_frio = excluded.apta_cadena_frio, notas = excluded.notas`,
      [rutaId, rf.aptaCadenaFrio, rf.notas ? marcado(rf.notas) : null],
    )
  }

  for (const nf of NODOS_FRIO_DEMO) {
    const nodoId = nodos.get(nf.nodoClave)
    if (!nodoId) {
      console.warn(`\n  ⚠️  Cadena de frío: nodo ${nf.nodoClave} desconocido; no se marca su aptitud.\n`)
      continue
    }
    await client.query(
      `insert into nodos_almacenamiento_frio (nodo_id, apta_cadena_frio, notas)
         values ($1,$2,$3)
       on conflict (nodo_id) do update set
         apta_cadena_frio = excluded.apta_cadena_frio, notas = excluded.notas`,
      [nodoId, nf.aptaCadenaFrio, nf.notas ? marcado(nf.notas) : null],
    )
  }

  for (const s of SUMINISTROS_ANTICIPADOS_DEMO) {
    const comunidadId = comunidades.get(s.comunidad)
    if (!comunidadId) throw new Error(`Suministro ${s.id}: comunidad ${s.comunidad} desconocida.`)
    await client.query(
      `insert into suministros_anticipados (
         id, organizacion_id, comunidad_id, beneficiario_ref, codigo_item, familias,
         cadencia_dias, dias_anticipacion, ultimo_suministro_en, creado_por, activo
       ) values (
         $1,$2,$3,$4,$5,$6,$7,$8, now() - make_interval(days => $9::int), $10, true
       )
       on conflict (id) do nothing`,
      [
        s.id, organizacionId, comunidadId, marcado(s.beneficiarioRef), s.codigoItem, s.familias,
        s.cadenciaDias, s.diasAnticipacion, s.ultimoSuministroDiasAtras, ID_COORDINADOR,
      ],
    )
  }
}

/**
 * PRD-11 «Radio». STAGING ONLY.
 *
 * One VALID attestation (Docampadó) and one EXPIRED (Winandó), plus one relayed report on the valid
 * community — second-hand, RECIBIDO, naming the speaker and the operator. The relay is inserted
 * directly, so its community must already carry a live, safe attestation (the 0050 gate trigger
 * enforces it); the attestations are seeded first. Idempotent on (org, comunidad) and the report semilla.
 */
async function sembrarRadio(
  client: PoolClient,
  organizacionId: string,
  comunidades: Map<string, string>,
): Promise<void> {
  for (const a of ATESTACIONES_RADIO_DEMO) {
    const comunidadId = comunidades.get(a.comunidad)
    if (!comunidadId) throw new Error(`Radio: comunidad ${a.comunidad} desconocida.`)
    await client.query(
      `insert into radio_permitido (
         organizacion_id, comunidad_id, atestado_por, red_descrita, uso_seguro,
         atestado_en, expira_en, notas
       ) values (
         $1,$2,$3,$4,$5,
         now() - make_interval(days => $6::int),
         now() + make_interval(days => $7::int),
         $8
       )
       on conflict (organizacion_id, comunidad_id) do nothing`,
      [
        organizacionId, comunidadId, ID_COORDINADOR, marcado(a.redDescrita), a.usoSeguro,
        a.atestadoDiasAtras, a.expiraEnDias, a.notas ? marcado(a.notas) : null,
      ],
    )
  }

  for (const r of RELEVOS_RADIO_DEMO) {
    if (await yaSembrado(client, r.semilla)) continue
    const comunidadId = comunidades.get(r.comunidad)
    if (!comunidadId) throw new Error(`Relevo de radio: comunidad ${r.comunidad} desconocida.`)

    const { rows } = await client.query<{ id: string }>(
      `insert into reportes (
         organizacion_id, tipo, canal, comunidad_id, detalle_libre, estado, payload_crudo, creado_en
       ) values (
         $1, $2, 'radio', $3, $4, 'RECIBIDO', $5, now() - make_interval(days => $6::int)
       )
       returning id`,
      [
        organizacionId, r.tipo, comunidadId, marcado(r.detalle),
        JSON.stringify({ semilla: r.semilla, segunda_mano: true, hablante: r.hablante, relatado_por: r.operador }),
        r.diasAtras,
      ],
    )
    const reporteId = rows[0]!.id

    await client.query(
      `insert into radio_relevos (reporte_id, organizacion_id, comunidad_id, hablante, operador, capturado_por)
         values ($1,$2,$3,$4,$5,$6)`,
      [reporteId, organizacionId, comunidadId, marcado(r.hablante), marcado(r.operador), ID_VERIFICADORA],
    )
  }
}

/**
 * PRD-16 / PRD-35 «Membresías y admisión». STAGING ONLY.
 *
 * The home-org membership is created automatically by the 0047 trigger; this adds a SECOND
 * membership (the same person, a second org, a different role) so the multi-org permissions story is
 * concrete, and vouches one organisation into the `avalada` tier. Idempotent on the membership key
 * and on the org not already being avalada.
 */
async function sembrarMembresias(client: PoolClient): Promise<void> {
  const idPorTelefono = new Map(USUARIOS_SEMILLA.map((u) => [u.telefono, u.id]))

  for (const m of MEMBRESIAS_DEMO) {
    const usuarioId = idPorTelefono.get(m.usuarioTelefono)
    if (!usuarioId) continue
    const { rowCount } = await client.query('select 1 from organizaciones where id = $1', [m.organizacionId])
    if (!rowCount) {
      console.warn(`\n  ⚠️  Membresía demo omitida: la organización ${m.organizacionId} no existe.\n`)
      continue
    }
    await client.query(
      `insert into membresias (usuario_id, organizacion_id, rol, otorgado_por, estado)
         values ($1,$2,$3,$4,'activa')
       on conflict (usuario_id, organizacion_id, rol) do nothing`,
      [usuarioId, m.organizacionId, m.rol, idPorTelefono.get(m.otorgadoPorTelefono) ?? null],
    )
  }

  for (const a of AVALES_ORGANIZACION_DEMO) {
    await client.query(
      `update organizaciones
          set nivel_admision = 'avalada', avalado_por = $2, aval_motivo = $3
        where id = $1 and (nivel_admision is null or nivel_admision <> 'avalada')`,
      [a.organizacionId, a.avaladoPorId, marcado(a.motivo)],
    )
  }
}

/**
 * The seed is realistic on purpose — real community names, real Chocoano phrasing — which is
 * exactly what makes it dangerous once it is sitting on a staging URL somebody from the
 * partner organisation might open. «Rosa Palacios, Tagachí, necesita mercados» reads as a
 * family waiting for food, and nobody looking at a screen can tell it is furniture.
 *
 * `payload_crudo.semilla` already marks these rows for machines. This marks them for people,
 * in the one field the verification inbox actually prints.
 */
export const MARCA_PRUEBA = '[DATO DE PRUEBA]'

/**
 * A note on `ofertas.texto_original`, which this also marks.
 *
 * That column holds what a person said, and 2.11 is emphatic that it is never rewritten.
 * The rule protects real inbound text from being edited after the fact — it does not oblige
 * us to invent fake testimony and then present it as somebody's actual words. These strings
 * were written by us; the marker says so.
 *
 * It is also the natural key the offer de-duplication compares, so the marker has to be
 * applied on BOTH sides or the guard stops matching and the seed inserts a fresh copy on
 * every boot. Same for `capacidades.notas`. Verified: three consecutive runs leave 10
 * reportes, 7 ofertas, 1 capacidad, 1 voluntario.
 */

function marcado(descripcion: string | null): string {
  return descripcion ? `${MARCA_PRUEBA} ${descripcion}` : MARCA_PRUEBA
}

async function yaSembrado(client: PoolClient, semilla: string): Promise<boolean> {
  const { rowCount } = await client.query(
    "select 1 from reportes where payload_crudo->>'semilla' = $1",
    [semilla],
  )
  return Boolean(rowCount)
}

/**
 * Raw inbound messages, one per demo report plus the standalone that makes Bebedó go quiet.
 * This is the layer the whole «AI ingestion from multiple channels» story rests on: the same
 * pipeline behind WhatsApp, SMS, an IVR callback and radio relay. Idempotent on the provider
 * message id, exactly the way real intake is (non-negotiable 2.7).
 */
async function sembrarMensajes(
  client: PoolClient,
  organizacionId: string,
  contactos: Map<string, string>,
): Promise<void> {
  for (const m of MENSAJES_DEMO) {
    let reporteId: string | null = null
    if (m.reporteSemilla) {
      const { rows } = await client.query<{ id: string }>(
        `select id from reportes where payload_crudo->>'semilla' = $1`,
        [m.reporteSemilla],
      )
      reporteId = rows[0]?.id ?? null
    }

    await client.query(
      `insert into mensajes (
         organizacion_id, proveedor, proveedor_mensaje_id, direccion, canal,
         telefono, contacto_id, reporte_id, cuerpo, estado, payload, creado_en
       ) values (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10, $11, now() - make_interval(days => $12)
       )
       on conflict (proveedor, proveedor_mensaje_id) where proveedor_mensaje_id is not null
         do nothing`,
      [
        organizacionId,
        m.proveedor,
        m.id,
        m.direccion,
        m.canal,
        m.telefono,
        contactos.get(m.telefono) ?? null,
        reporteId,
        marcado(m.cuerpo),
        m.direccion === 'entrante' ? 'recibido' : 'entregado',
        m.payload ? JSON.stringify(m.payload) : null,
        m.diasAtras,
      ],
    )
  }
}

/**
 * The demo dispatch, run after the matcher so it acts on a request the engine has already
 * marked LISTO. Sends one trip end to end through the real dispatch path — plan, load, send —
 * so Envíos, the manifest, and its four-digit codes are populated and one request shows
 * EN_CAMINO. Idempotent: it is skipped once any shipment exists.
 *
 * The trip fully covers its one stop (50 of a 60 cupo), so no rationing decision is required
 * and the shipment leaves clean. See DESPACHO_DEMO.
 */
async function sembrarDespacho(): Promise<void> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('begin')

    const yaHay = await client.query('select 1 from envios limit 1')
    if ((yaHay.rowCount ?? 0) > 0) {
      await client.query('commit')
      return
    }

    // PRD-39: DESPACHO_DEMO addresses communities by demo short code; the registry stores the
    // real code (CH-RQU for Paimadó), so translate before matching against `comunidades.codigo`.
    const hastaComunidadRegistro = CODIGO_DEMO_A_REGISTRO[DESPACHO_DEMO.hastaComunidad]
    const pedidoComunidadRegistro = CODIGO_DEMO_A_REGISTRO[DESPACHO_DEMO.pedidoComunidad]

    const { rows: caps } = await client.query<{ id: string }>(
      `select c.id
         from capacidades c
         join contactos ct on ct.id = c.contacto_id
         join comunidades com on com.id = c.hasta_comunidad_id
        where ct.telefono = $1 and com.codigo = $2 and c.estado = 'OFRECIDA'
        order by c.creado_en
        limit 1`,
      [DESPACHO_DEMO.transportistaTelefono, hastaComunidadRegistro],
    )
    const { rows: peds } = await client.query<{ id: string; familias: number }>(
      `select p.id, p.familias
         from pedidos p
         join comunidades com on com.id = p.comunidad_id
        where com.codigo = $1 and p.codigo_item = $2
        order by p.creado_en
        limit 1`,
      [pedidoComunidadRegistro, DESPACHO_DEMO.pedidoCodigoItem],
    )
    const { rows: desp } = await client.query<{ id: string }>(
      `select id from usuarios where rol_staff = 'despachador' order by creado_en limit 1`,
    )

    const capacidadId = caps[0]?.id
    const pedido = peds[0]
    const despachadorId = desp[0]?.id
    if (!capacidadId || !pedido || !despachadorId) {
      console.warn('\n  ⚠️  Despacho demo omitido: falta la capacidad, el pedido o el despachador.\n')
      await client.query('commit')
      return
    }

    const abierto = await crearEnvio(client, capacidadId, despachadorId)
    if (!abierto.ok || !abierto.id) {
      throw new Error(`No se pudo abrir el envío demo: ${abierto.ok ? 'sin id' : abierto.error}`)
    }
    const puesta = await ponerParada(client, abierto.id, pedido.id, pedido.familias)
    if (!puesta.ok) throw new Error(`No se pudo armar el envío demo: ${puesta.error}`)
    await ordenarPorRecorrido(client, abierto.id, await temporadaVigente(client))
    const enviado = await despachar(client, abierto.id, despachadorId)
    if (!enviado.ok) throw new Error(`No se pudo despachar el envío demo: ${enviado.error}`)

    // While it was LISTO the matcher left an unconfirmed proposal on this request; now that it
    // is EN_CAMINO the engine will never revisit it to tidy up (it only touches open states),
    // so drop the stale proposal here. Keeps «only LISTO requests carry a proposal» true.
    await client.query(
      `delete from emparejamientos where pedido_id = $1 and confirmado_por is null`,
      [pedido.id],
    )

    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

// ── Report ────────────────────────────────────────────────────────────────────────────

async function resumen(): Promise<void> {
  const pool = getPool()
  const { rows } = await pool.query<{ tabla: string; filas: string }>(`
    select 'comunidades' as tabla, count(*)::text as filas from comunidades
    union all select 'rutas',            count(*)::text from rutas
    union all select 'rutas activas',    count(*)::text from rutas where activa
    union all select 'catalogo_items',   count(*)::text from catalogo_items
    union all select 'contactos',        count(*)::text from contactos
    union all select 'usuarios',         count(*)::text from usuarios
    union all select 'nodos',            count(*)::text from nodos
    union all select 'existencias',      count(*)::text from existencias
    union all select 'reportes',         count(*)::text from reportes
    union all select 'pedidos',          count(*)::text from pedidos
    union all select 'capacidades',      count(*)::text from capacidades
  `)

  console.log('\nCuenca sembrada:')
  for (const r of rows) console.log(`  ${r.tabla.padEnd(16)} ${r.filas}`)

  const { rows: pendientes } = await pool.query<{ estado: string; n: string }>(
    'select estado, count(*)::text as n from pedidos group by estado order by estado',
  )
  console.log('\nPedidos por estado (ya pasaron por el emparejador):')
  for (const p of pendientes) console.log(`  ${p.estado.padEnd(16)} ${p.n}`)

  const { rows: porCanal } = await pool.query<{ canal: string; n: string }>(
    'select canal, count(*)::text as n from reportes group by canal order by canal',
  )
  console.log('\nReportes por canal (ingesta multicanal):')
  for (const c of porCanal) console.log(`  ${c.canal.padEnd(16)} ${c.n}`)

  const { rows: extra } = await pool.query<{ tabla: string; filas: string }>(`
    select 'mensajes' as tabla, count(*)::text as filas from mensajes
    union all select 'reportes RECIBIDO', count(*)::text from reportes where estado = 'RECIBIDO'
    union all select 'notas de voz',      count(*)::text from adjuntos where tipo = 'audio'
    union all select 'ofertas',           count(*)::text from ofertas
    union all select 'envios',            count(*)::text from envios
    union all select 'entregas',          count(*)::text from entregas
    union all select 'comunidades calladas', count(*)::text from comunidades c
      where c.activa and exists (
        select 1 from (
          select co.comunidad_id as cid, m.creado_en as cuando from mensajes m
            join contactos co on co.id = m.contacto_id where m.direccion = 'entrante'
          union all select r.comunidad_id, r.creado_en from reportes r where r.comunidad_id is not null
        ) s where s.cid = c.id
        group by s.cid having max(s.cuando) < now() - make_interval(days => c.intervalo_chequeo_dias)
      )
  `)
  console.log('\nCapa de canales y despacho:')
  for (const e of extra) console.log(`  ${e.tabla.padEnd(22)} ${e.filas}`)

  const { rows: paneles } = await pool.query<{ tabla: string; filas: string }>(`
    select 'puntos de conexión' as tabla, count(*)::text as filas from puntos_conexion
    union all select 'apadrinamientos',       count(*)::text from apadrinamientos
    union all select 'apadrin. activos',      count(*)::text from apadrinamientos where estado = 'activo'
    union all select 'asignaciones de fondos', count(*)::text from apadrinamiento_asignaciones
    union all select 'centros pendientes',    count(*)::text from organizaciones where estado_aprobacion = 'pendiente'
  `)
  console.log('\nPaneles §5.9 / PRD-12 / plataforma:')
  for (const p of paneles) console.log(`  ${p.tabla.padEnd(24)} ${p.filas}`)

  const { rows: prdv3 } = await pool.query<{ tabla: string; filas: string }>(`
    select 'plantillas evaluación' as tabla, count(*)::text as filas from plantillas_evaluacion
    union all select 'evaluaciones (barridos)', count(*)::text from evaluaciones where total_estimado is not null
    union all select 'evaluaciones técnicas (FR-48)', count(*)::text from evaluaciones where total_estimado is null
    union all select 'hallazgos',              count(*)::text from evaluacion_hallazgos
    union all select 'hallazgo BoM',           count(*)::text from hallazgo_bom
    union all select 'programas',              count(*)::text from programas
    union all select 'programa comunidades',   count(*)::text from programa_comunidades
    union all select 'programa participantes', count(*)::text from programa_participantes
    union all select 'programa asistencias',   count(*)::text from programa_asistencias
    union all select 'programa apadrinam.',    count(*)::text from programa_apadrinamientos
    union all select 'programa aplicaciones',  count(*)::text from programa_aplicaciones
    union all select 'jornadas (org demo)',    count(*)::text from jornadas where organizacion_id = (
      select id from organizaciones where activo order by creado_en limit 1)
    union all select 'jornada paradas',        count(*)::text from jornada_paradas
    union all select 'traslados de persona',   count(*)::text from traslados_persona
    union all select 'fondos de compra',       count(*)::text from fondos_compra
    union all select 'proveedores locales',    count(*)::text from proveedores_locales
    union all select 'compras locales',        count(*)::text from compras_locales
    union all select 'compra local ítems',     count(*)::text from compra_local_items
    union all select 'compra local evidencia', count(*)::text from compra_local_evidencias
    union all select 'ítems cadena de frío',   count(*)::text from catalogo_requisitos_almacenamiento where cadena_frio
    union all select 'suministros anticipados', count(*)::text from suministros_anticipados
    union all select 'radio permitido',        count(*)::text from radio_permitido
    union all select 'radio relevos',          count(*)::text from radio_relevos
    union all select 'membresías',             count(*)::text from membresias
  `)
  console.log('\nFunciones PRD v3 (evaluaciones, agenda, traslados, compra local, cadena de frío, radio, membresías):')
  for (const r of prdv3) console.log(`  ${r.tabla.padEnd(26)} ${r.filas}`)
  console.log()
}

main()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error)
    await closeDb()
    process.exit(1)
  })
