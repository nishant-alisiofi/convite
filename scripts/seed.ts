import 'dotenv/config'
import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { closeDb, getPool } from '@/db/client'
import { resolve } from 'node:path'
import { almacenamientoLocal, raizDatos } from '@/lib/canales/almacenamiento'
import { CATALOGO_SEMILLA, UNIDADES_SEMILLA } from '@/db/seed/catalogo'
import { COMUNIDADES_SEMILLA } from '@/db/seed/comunidades'
import {
  CAPACIDADES_SEMILLA,
  CONTACTOS_SEMILLA,
  EXISTENCIAS_SEMILLA,
  NECESIDADES_VERIFICADAS,
  NODOS_SEMILLA,
  OFERTAS_SEMILLA,
  NOTA_DE_VOZ_SEMILLA,
  REPORTES_SIN_VERIFICAR,
  USUARIOS_SEMILLA,
  VOLUNTARIOS_SEMILLA,
} from '@/db/seed/operacion'
import { RUTAS_SEMILLA } from '@/db/seed/rutas'
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
    await sembrarCapacidades(client, contactos, nodos, comunidades)
    await sembrarOfertas(client, contactos)
    await sembrarVoluntarios(client, contactos, nodos)

    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }

  await clasificar()
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
  const { rows } = await client.query<{ id: string }>(
    `insert into organizaciones (nombre, waba_phone_number_id, waba_id)
       values ($1, $2, $3)
     on conflict do nothing
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

  for (const c of COMUNIDADES_SEMILLA) {
    // ubicacion_fuente stays 'centroide' with a 1000 m radius: these are gazetteer
    // centroids, not pins (non-negotiable 2.2).
    const { rows } = await client.query<{ id: string }>(
      `insert into comunidades (
         organizacion_id, codigo, nombre, tipo, municipio, agrupador,
         ubicacion, ubicacion_fuente, ubicacion_precision_m,
         familias_estimadas, tier_conectividad, intervalo_chequeo_dias
       ) values (
         $1, $2, $3, $4, $5, $6,
         st_setsrid(st_makepoint($7, $8), 4326), 'centroide', 1000,
         $9, $10, $11
       )
       on conflict (codigo) do update set
         nombre = excluded.nombre,
         tipo = excluded.tipo,
         municipio = excluded.municipio,
         agrupador = excluded.agrupador,
         ubicacion = excluded.ubicacion,
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
    ...CONTACTOS_SEMILLA.map((c) => ({
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
  for (const r of RUTAS_SEMILLA) {
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

  for (const n of NODOS_SEMILLA) {
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
  for (const bloque of EXISTENCIAS_SEMILLA) {
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
  for (const [i, n] of NECESIDADES_VERIFICADAS.entries()) {
    const semilla = `nec-${n.comunidad}-${n.codigoItem}-${i}`
    if (await yaSembrado(client, semilla)) continue

    // Reports arrive by WhatsApp without a location pin unless the person sent one. None of
    // these did, so ubicacion stays null rather than borrowing the community centroid —
    // "we do not know" is a valid and honest answer (non-negotiable 2.2).
    const { rows } = await client.query<{ id: string }>(
      `insert into reportes (
         organizacion_id, tipo, canal, contacto_id, comunidad_id, codigo_item,
         familias, urgencia, detalle_libre, descripcion,
         estado, verificado_por, verificado_en, payload_crudo, creado_en
       ) values (
         $1, 'necesidad', 'whatsapp', $2, $3, $4,
         $5, $6, $7, $8,
         'VERIFICADO', $9, now() - make_interval(days => $10), $11, now() - make_interval(days => $10)
       )
       returning id`,
      [
        organizacionId,
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

    // The pedido is what the matcher works on. It is created here because a human already
    // verified the report above; M2 leaves it ABIERTO until the engine classifies it.
    await client.query(
      `insert into pedidos (reporte_id, comunidad_id, codigo_item, familias, urgencia, estado)
         values ($1, $2, $3, $4, $5, 'ABIERTO')`,
      [rows[0]!.id, comunidades.get(n.comunidad), n.codigoItem, n.familias, n.urgencia],
    )
  }

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

  await sembrarNotaDeVoz(client)
}

/**
 * Attaches one playable voice note, so the audio inbox can actually be looked at.
 *
 * The bytes are a generated tone written into DATA_DIR — operational data, never the repo
 * (2.6 wants our own key, and a seeded provider URL would be a guaranteed 404). A WAV
 * because it can be synthesised here without pulling in an encoder, and every browser plays
 * one.
 */
async function sembrarNotaDeVoz(client: PoolClient): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `select id from reportes where payload_crudo->>'semilla' = $1`,
    [NOTA_DE_VOZ_SEMILLA.semillaReporte],
  )
  const reporteId = rows[0]?.id
  if (!reporteId) return

  const { rowCount } = await client.query(
    `select 1 from adjuntos where reporte_id = $1 and tipo = 'audio'`,
    [reporteId],
  )
  if (rowCount) return

  // `raizDatos()` reads DATA_DIR with `??`, and `.env.example` ships `DATA_DIR=` empty — an
  // empty string is not nullish, so it resolves to the repo root and media lands in the
  // working tree. Operational data belongs outside the repo, so refuse rather than pollute.
  const raiz = raizDatos()
  if (!raiz || resolve(raiz) === resolve(process.cwd())) {
    console.warn(
      '\n  ⚠️  Nota de voz omitida: DATA_DIR está vacío, y el audio caería dentro del repo.\n' +
        '     Póngale una ruta absoluta fuera del proyecto y vuelva a sembrar.\n',
    )
    return
  }

  const bytes = tonoWav(NOTA_DE_VOZ_SEMILLA.segundos)
  const hash = createHash('sha256').update(bytes).digest('hex')
  const clave = `audio/${hash.slice(0, 2)}/${hash}.wav`
  await almacenamientoLocal(raiz).guardar(clave, bytes)

  await client.query(
    `insert into adjuntos (reporte_id, tipo, storage_key, mime, bytes, duracion_seg,
                           hash_sha256, transcripcion, transcripcion_confianza)
     values ($1, 'audio', $2, 'audio/wav', $3, $4, $5, $6, $7)`,
    [
      reporteId,
      clave,
      bytes.byteLength,
      NOTA_DE_VOZ_SEMILLA.segundos,
      hash,
      NOTA_DE_VOZ_SEMILLA.transcripcion,
      NOTA_DE_VOZ_SEMILLA.confianza,
    ],
  )
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
  for (const c of CAPACIDADES_SEMILLA) {
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
  console.log()
}

main()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error)
    await closeDb()
    process.exit(1)
  })
