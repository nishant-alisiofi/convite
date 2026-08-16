import 'dotenv/config'
import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { closeDb, getPool } from '@/db/client'
import { resolve } from 'node:path'
import { almacenamientoLocal, raizDatos } from '@/lib/canales/almacenamiento'
import { CATALOGO_SEMILLA, UNIDADES_SEMILLA } from '@/db/seed/catalogo'
import { COMUNIDADES_DEMO, COMUNIDADES_SEMILLA, type ComunidadSemilla } from '@/db/seed/comunidades'
import {
  CAPACIDADES_DEMO,
  CAPACIDADES_SEMILLA,
  CONTACTOS_DEMO,
  CONTACTOS_SEMILLA,
  DESPACHO_DEMO,
  EXISTENCIAS_DEMO,
  EXISTENCIAS_SEMILLA,
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

/** Communities the seeded verificadora is scoped to (Section 11 / M3 RLS tests). */
const COMUNIDADES_DE_LA_VERIFICADORA = ['BTA', 'MER', 'WIN', 'TAG', 'BET', 'BLL']

async function main() {
  const pool = getPool()
  const client = await pool.connect()

  try {
    await client.query('begin')

    const organizacionId = await sembrarOrganizacion(client)
    const comunidades = await sembrarComunidades(client, organizacionId)
    await sembrarCatalogo(client)
    const contactos = await sembrarContactos(client, comunidades)
    await sembrarUsuarios(client, organizacionId, contactos, comunidades)
    await sembrarRutas(client, comunidades)
    const nodos = await sembrarNodos(client, comunidades, contactos)
    await sembrarExistencias(client, nodos)
    await sembrarReportes(client, organizacionId, comunidades, contactos)
    await sembrarMensajes(client, organizacionId, contactos)
    await sembrarCapacidades(client, contactos, nodos, comunidades)
    await sembrarOfertas(client, contactos)
    await sembrarVoluntarios(client, contactos, nodos)
    // Runs after sembrarReportes: the sponsorships apply funds to pedidos it created.
    await sembrarPuntosConexion(client, organizacionId, comunidades)
    await sembrarApadrinamientos(client, organizacionId, comunidades)
    await sembrarCentroPendiente(client)

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

async function sembrarComunidades(
  client: PoolClient,
  organizacionId: string,
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>()

  // The canonical basin is all gazetteer centroids; the demo layer adds a couple of honest
  // exceptions (a GPS pin the field team dropped on Pizarro, radio-relayed circles for the
  // places we have only heard about). The source and radius come from the row, defaulting to
  // 'centroide' / 1000 m — a coordinate is never silently promoted to a pin (non-negotiable 2.2).
  const comunidades: ComunidadSemilla[] = [...COMUNIDADES_SEMILLA, ...COMUNIDADES_DEMO]

  for (const c of comunidades) {
    const fuente = c.ubicacionFuente ?? 'centroide'
    const precision = c.ubicacionPrecisionM ?? 1000
    const { rows } = await client.query<{ id: string }>(
      `insert into comunidades (
         organizacion_id, codigo, nombre, tipo, municipio, agrupador,
         ubicacion, ubicacion_fuente, ubicacion_precision_m,
         familias_estimadas, tier_conectividad, intervalo_chequeo_dias
       ) values (
         $1, $2, $3, $4, $5, $6,
         st_setsrid(st_makepoint($7, $8), 4326), $12, $13,
         $9, $10, $11
       )
       on conflict (codigo) do update set
         nombre = excluded.nombre,
         tipo = excluded.tipo,
         municipio = excluded.municipio,
         agrupador = excluded.agrupador,
         ubicacion = excluded.ubicacion,
         ubicacion_fuente = excluded.ubicacion_fuente,
         ubicacion_precision_m = excluded.ubicacion_precision_m,
         familias_estimadas = excluded.familias_estimadas,
         tier_conectividad = excluded.tier_conectividad,
         intervalo_chequeo_dias = excluded.intervalo_chequeo_dias
       returning id`,
      [
        organizacionId,
        c.codigo,
        c.nombre,
        c.tipo,
        c.municipio,
        c.agrupador,
        c.lon,
        c.lat,
        c.familiasEstimadas,
        c.tierConectividad,
        c.intervaloChequeoDias,
        fuente,
        precision,
      ],
    )
    mapa.set(c.codigo, rows[0]!.id)
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
         unidad_singular, unidad_plural
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
         unidad_plural = excluded.unidad_plural`,
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
      const { rows: peds } = await client.query<{ id: string }>(
        `select p.id
           from pedidos p
           join comunidades c on c.id = p.comunidad_id
          where c.codigo = $1 and p.codigo_item = $2
          order by p.creado_en
          limit 1`,
        [asig.comunidadPedido, asig.codigoItem],
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

    const { rows: caps } = await client.query<{ id: string }>(
      `select c.id
         from capacidades c
         join contactos ct on ct.id = c.contacto_id
         join comunidades com on com.id = c.hasta_comunidad_id
        where ct.telefono = $1 and com.codigo = $2 and c.estado = 'OFRECIDA'
        order by c.creado_en
        limit 1`,
      [DESPACHO_DEMO.transportistaTelefono, DESPACHO_DEMO.hastaComunidad],
    )
    const { rows: peds } = await client.query<{ id: string; familias: number }>(
      `select p.id, p.familias
         from pedidos p
         join comunidades com on com.id = p.comunidad_id
        where com.codigo = $1 and p.codigo_item = $2
        order by p.creado_en
        limit 1`,
      [DESPACHO_DEMO.pedidoComunidad, DESPACHO_DEMO.pedidoCodigoItem],
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
  console.log()
}

main()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error)
    await closeDb()
    process.exit(1)
  })
