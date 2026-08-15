import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  cargarBandeja,
  clasificar,
  corregirTranscripcion,
  marcarDuplicado,
  posiblesDuplicados,
  promoverAPedido,
  verificar,
} from '@/lib/verificacion/bandeja'

/**
 * M7 acceptance: «nothing reaches `pedidos` without a human action».
 *
 * The important half of this file is the set of cases that try to get demand into the system
 * without a person, including as the table owner — which is what `service_role` effectively
 * is, and what intake runs as. A policy would not stop those; the trigger in 0023 does.
 *
 * Everything runs inside a transaction that is always rolled back.
 */

const url = process.env.DATABASE_URL
const conBase = describe.skipIf(!url)

const VERIFICADORA = '00000000-0000-4000-8000-000000000002'
const COORDINADOR = '00000000-0000-4000-8000-000000000001'
const DESPACHADOR = '00000000-0000-4000-8000-000000000003'

let pool: Pool
let client: PoolClient

beforeAll(async () => {
  if (!url) return
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  })
  client = await pool.connect()
  await client.query('begin')
})

afterAll(async () => {
  if (!url) return
  await client.query('rollback')
  client.release()
  await pool.end()
})

afterEach(async () => {
  if (!url) return
  await client.query('rollback to savepoint caso').catch(() => {})
  await client.query('release savepoint caso').catch(() => {})
})

async function como<T>(usuarioId: string, fn: () => Promise<T>): Promise<T> {
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: usuarioId, role: 'authenticated', email: 'staff@convite.test' }),
  ])
  await client.query('set local role authenticated')
  try {
    return await fn()
  } finally {
    await client.query('reset role').catch(() => {})
  }
}

/** A seeded report waiting in the queue, in a community the verifier is scoped to. */
async function reporteEnCola(codigoComunidad = 'BLL'): Promise<{ id: string; folio: number }> {
  const { rows } = await client.query<{ id: string; folio: number }>(
    `select r.id, r.folio from reportes r
       join comunidades c on c.id = r.comunidad_id
      where r.estado = 'RECIBIDO' and c.codigo = $1
      order by r.creado_en limit 1`,
    [codigoComunidad],
  )
  return rows[0]!
}

async function cuentaPedidos(): Promise<number> {
  const { rows } = await client.query<{ n: string }>(`select count(*)::text as n from pedidos`)
  return Number(rows[0]!.n)
}

conBase('nada llega a pedidos sin que una persona lo ponga ahí', () => {
  it('la base rechaza un pedido cuyo reporte nadie verificó, incluso como dueño', async () => {
    await client.query('savepoint caso')
    const reporte = await reporteEnCola()

    // Sin `set role`: esto corre como el dueño de las tablas, que se salta RLS por completo
    // — que es exactamente lo que es `service_role`, y lo que corre el webhook de intake.
    await expect(
      client.query(
        `insert into pedidos (reporte_id, comunidad_id, codigo_item, familias, urgencia)
         select id, comunidad_id, coalesce(codigo_item, '11'), 5, 1 from reportes where id = $1`,
        [reporte.id],
      ),
    ).rejects.toThrow(/reporte verificado por una persona/)
  })

  it('ni repuntando un pedido ya existente a un reporte sin verificar', async () => {
    /*
     * The hole the insert-only trigger left. `pedidos_coordina` lets a despachador update
     * every column, so the guarantee lasted exactly as long as nobody ran an UPDATE — and
     * repointing `reporte_id` at a RECIBIDO report put unverified demand on the board with a
     * verified pedido's history behind it. Reproduced as `UPDATE 1` before 0031.
     */
    await client.query('savepoint caso')
    const reporte = await reporteEnCola()
    const { rows } = await client.query<{ id: string }>('select id from pedidos limit 1')

    await expect(
      client.query('update pedidos set reporte_id = $2 where id = $1', [rows[0]!.id, reporte.id]),
    ).rejects.toThrow(/reporte verificado por una persona/)
  })

  it('ni desde un reporte de DAÑO, aunque esté verificado y firmado', async () => {
    /*
     * The other half: the check asked for estado and verificado_por, never for tipo. «The
     * bridge is out» is not a request for anything, and promoting it to a pedido is the
     * schema guessing what somebody meant — which is the one thing 2.12 forbids.
     */
    await client.query('savepoint caso')
    const reporte = await reporteEnCola()
    const { rows: quien } = await client.query<{ id: string }>('select id from usuarios limit 1')

    await client.query(
      `update reportes set tipo = 'dano', estado = 'VERIFICADO', verificado_por = $2,
              verificado_en = now() where id = $1`,
      [reporte.id, quien[0]!.id],
    )

    await expect(
      client.query(
        `insert into pedidos (reporte_id, comunidad_id, codigo_item, familias, urgencia)
         select id, comunidad_id, coalesce(codigo_item, '11'), 5, 1 from reportes where id = $1`,
        [reporte.id],
      ),
    ).rejects.toThrow(/reporte de necesidad/)
  })

  it('ni describiendo una comunidad distinta a la del reporte que lo origina', async () => {
    // A pedido that claims a verified source while describing somebody else's need.
    await client.query('savepoint caso')
    const reporte = await reporteEnCola()
    const { rows: quien } = await client.query<{ id: string }>('select id from usuarios limit 1')
    await client.query(
      `update reportes set estado = 'VERIFICADO', verificado_por = $2, verificado_en = now(),
              codigo_item = coalesce(codigo_item, '11') where id = $1`,
      [reporte.id, quien[0]!.id],
    )

    await expect(
      client.query(
        `insert into pedidos (reporte_id, comunidad_id, codigo_item, familias, urgencia)
         select r.id, (select c.id from comunidades c where c.id <> r.comunidad_id limit 1),
                r.codigo_item, 5, 1
           from reportes r where r.id = $1`,
        [reporte.id],
      ),
    ).rejects.toThrow(/comunidad distinta/)
  })

  it('tampoco si alguien marca el reporte como verificado sin poner su nombre', async () => {
    await client.query('savepoint caso')
    const reporte = await reporteEnCola()

    // El atajo obvio: mover el estado a mano y saltarse la firma.
    await expect(
      client.query(`update reportes set estado = 'VERIFICADO' where id = $1`, [reporte.id]),
    ).rejects.toThrow(/reportes_disposicion_check/)
  })

  it('el emparejador no crea demanda: solo reclasifica la que ya existe', async () => {
    await client.query('savepoint caso')
    const antes = await cuentaPedidos()
    const { emparejar } = await import('@/lib/matching/persistencia')
    await emparejar(client, { temporada: 'lluvias' })
    expect(await cuentaPedidos()).toBe(antes)
  })

  it('una verificadora sí lo promueve, y queda su nombre en el reporte', async () => {
    await client.query('savepoint caso')
    const reporte = await reporteEnCola()
    const antes = await cuentaPedidos()

    await como(VERIFICADORA, async () => {
      expect(await promoverAPedido(client, reporte.id, VERIFICADORA, 12)).toEqual({ ok: true })
    })

    expect(await cuentaPedidos()).toBe(antes + 1)

    const { rows } = await client.query<{
      estado: string
      verificado_por: string
      verificado_en: Date
      familias: number
    }>(
      `select r.estado, r.verificado_por, r.verificado_en, p.familias
         from reportes r join pedidos p on p.reporte_id = r.id
        where r.id = $1`,
      [reporte.id],
    )
    expect(rows[0]!.estado).toBe('VERIFICADO')
    expect(rows[0]!.verificado_por).toBe(VERIFICADORA)
    expect(rows[0]!.verificado_en).not.toBeNull()
    expect(rows[0]!.familias).toBe(12)
  })

  it('no promueve dos veces el mismo reporte', async () => {
    await client.query('savepoint caso')
    const reporte = await reporteEnCola()

    await como(VERIFICADORA, async () => {
      await promoverAPedido(client, reporte.id, VERIFICADORA, 12)
      const segunda = await promoverAPedido(client, reporte.id, VERIFICADORA, 12)
      expect(segunda.ok).toBe(false)
    })

    const { rows } = await client.query<{ n: string }>(
      `select count(*)::text as n from pedidos where reporte_id = $1`,
      [reporte.id],
    )
    expect(rows[0]!.n).toBe('1')
  })

  it('un despachador no verifica ni promueve', async () => {
    await client.query('savepoint caso')
    const reporte = await reporteEnCola()

    await como(DESPACHADOR, async () => {
      // Separación de funciones: quien despacha no confirma que la necesidad sea real.
      expect((await verificar(client, reporte.id, DESPACHADOR)).ok).toBe(false)
      expect((await promoverAPedido(client, reporte.id, DESPACHADOR, 5)).ok).toBe(false)
    })
  })

  it('una verificadora no toca reportes fuera de sus comunidades', async () => {
    await client.query('savepoint caso')
    // La verificadora sembrada está limitada al Atrato medio; Pacurita no es suya.
    const ajeno = await reporteEnCola('PAC')

    await como(VERIFICADORA, async () => {
      expect((await verificar(client, ajeno.id, VERIFICADORA)).ok).toBe(false)
    })
  })
})

conBase('la bandeja', () => {
  it('ordena por urgencia y luego por antigüedad', async () => {
    await client.query('savepoint caso')
    const bandeja = await como(COORDINADOR, () => cargarBandeja(client))

    expect(bandeja.pendientes.length).toBeGreaterThan(0)
    for (let i = 1; i < bandeja.pendientes.length; i += 1) {
      const previo = bandeja.pendientes[i - 1]!
      const actual = bandeja.pendientes[i]!
      const u = (f: { urgencia: number | null }) => f.urgencia ?? 0
      expect(u(previo)).toBeGreaterThanOrEqual(u(actual))
      // A igual urgencia, primero lo que lleva más tiempo esperando.
      if (u(previo) === u(actual)) expect(previo.dias).toBeGreaterThanOrEqual(actual.dias)
    }
  })

  it('marca el ítem que pide detalle y no lo trae', async () => {
    await client.query('savepoint caso')
    const bandeja = await como(COORDINADOR, () => cargarBandeja(client))
    // El dato lo trae la bandeja para que la pantalla pueda avisar; no lo esconde.
    for (const fila of bandeja.pendientes) {
      expect(typeof fila.pideDetalle).toBe('boolean')
    }
  })

  it('filtra por tipo', async () => {
    await client.query('savepoint caso')
    const danos = await como(COORDINADOR, () => cargarBandeja(client, 'dano'))
    expect(danos.pendientes.length).toBeGreaterThan(0)
    expect(danos.pendientes.every((f) => f.tipo === 'dano')).toBe(true)
  })
})

conBase('corregir lo que la máquina oyó mal', () => {
  async function unAudio(): Promise<{ adjuntoId: string; reporteId: string }> {
    const reporte = await reporteEnCola()
    const { rows } = await client.query<{ id: string }>(
      `insert into adjuntos (reporte_id, tipo, storage_key, mime, duracion_seg,
                             transcripcion, transcripcion_confianza)
       values ($1, 'audio', 'audio/ab/prueba.ogg', 'audio/ogg', 7,
               'necesitamos toldillos para los pelaos', 0.62)
       returning id`,
      [reporte.id],
    )
    return { adjuntoId: rows[0]!.id, reporteId: reporte.id }
  }

  it('guarda la corrección sin borrar lo que oyó la máquina', async () => {
    await client.query('savepoint caso')
    const { adjuntoId } = await unAudio()

    await como(VERIFICADORA, async () => {
      expect(
        await corregirTranscripcion(
          client,
          adjuntoId,
          'necesitamos toldillos para los peladitos',
          VERIFICADORA,
        ),
      ).toEqual({ ok: true })
    })

    const { rows } = await client.query<{
      transcripcion: string
      transcripcion_corregida: string
      corregida_por: string
    }>(
      `select transcripcion, transcripcion_corregida, corregida_por from adjuntos where id = $1`,
      [adjuntoId],
    )
    // 2.12: el original nunca se sobrescribe. Es la única evidencia de qué tan bien
    // transcribe el proveedor, y eso es lo que decide si se cambia de proveedor.
    expect(rows[0]!.transcripcion).toBe('necesitamos toldillos para los pelaos')
    expect(rows[0]!.transcripcion_corregida).toBe('necesitamos toldillos para los peladitos')
    expect(rows[0]!.corregida_por).toBe(VERIFICADORA)
  })

  it('la base rechaza una corrección sin nombre', async () => {
    await client.query('savepoint caso')
    const { adjuntoId } = await unAudio()

    await expect(
      client.query(`update adjuntos set transcripcion_corregida = 'algo' where id = $1`, [
        adjuntoId,
      ]),
    ).rejects.toThrow(/adjuntos_correccion_check/)
  })

  it('no acepta una corrección vacía', async () => {
    await client.query('savepoint caso')
    const { adjuntoId } = await unAudio()

    await como(VERIFICADORA, async () => {
      expect(await corregirTranscripcion(client, adjuntoId, '   ', VERIFICADORA)).toEqual({
        ok: false,
        error: 'Escriba lo que dice la nota antes de guardar.',
      })
    })
  })
})

conBase('duplicados', () => {
  it('marcar duplicado saca el reporte de la cola y deja el nombre de quien lo decidió', async () => {
    await client.query('savepoint caso')
    const hijo = await reporteEnCola()
    const { rows: padres } = await client.query<{ id: string }>(
      `select r.id from reportes r join comunidades c on c.id = r.comunidad_id
        where r.estado = 'VERIFICADO' and c.codigo = 'BLL' limit 1`,
    )
    const padre = padres[0]!.id

    await como(VERIFICADORA, async () => {
      expect(await marcarDuplicado(client, hijo.id, padre, VERIFICADORA)).toEqual({ ok: true })
    })

    const { rows } = await client.query<{
      estado: string
      reporte_padre_id: string
      verificado_por: string
    }>(`select estado, reporte_padre_id, verificado_por from reportes where id = $1`, [hijo.id])
    expect(rows[0]!.estado).toBe('DUPLICADO')
    expect(rows[0]!.reporte_padre_id).toBe(padre)
    // Hacer desaparecer una necesidad pesa más que confirmarla, así que también lleva nombre.
    expect(rows[0]!.verificado_por).toBe(VERIFICADORA)
  })

  it('un reporte no es duplicado de sí mismo', async () => {
    await client.query('savepoint caso')
    const r = await reporteEnCola()
    await como(VERIFICADORA, async () => {
      expect(await marcarDuplicado(client, r.id, r.id, VERIFICADORA)).toEqual({
        ok: false,
        error: 'Un reporte no puede ser duplicado de sí mismo.',
      })
    })
  })

  it('propone candidatos de la misma comunidad y el mismo ítem, sin unirlos solo', async () => {
    await client.query('savepoint caso')
    const r = await reporteEnCola()
    const candidatos = await como(COORDINADOR, () => posiblesDuplicados(client, r.id))
    // Es una red amplia que se le ofrece a una persona, nunca una fusión automática.
    for (const c of candidatos) expect(c.id).not.toBe(r.id)
  })
})

conBase('clasificar lo que nadie pudo clasificar', () => {
  it('un reporte sin clasificar recibe ítem y tipo del catálogo', async () => {
    await client.query('savepoint caso')
    const { rows } = await client.query<{ id: string }>(
      `insert into reportes (organizacion_id, tipo, canal, comunidad_id, descripcion, estado)
       select o.id, 'sin_clasificar', 'whatsapp', c.id, 'Muchas cosas!! De todo!!!', 'RECIBIDO'
         from organizaciones o, comunidades c where c.codigo = 'BLL' limit 1
       returning id`,
    )
    const id = rows[0]!.id

    await como(VERIFICADORA, async () => {
      expect(await clasificar(client, id, '11', VERIFICADORA)).toEqual({ ok: true })
    })

    const { rows: despues } = await client.query<{ tipo: string; codigo_item: string }>(
      `select tipo, codigo_item from reportes where id = $1`,
      [id],
    )
    // El tipo lo decide el catálogo, no el formulario: saber el ítem es saber el tipo.
    expect(despues[0]!.codigo_item).toBe('11')
    expect(despues[0]!.tipo).toBe('necesidad')
  })

  it('la base impide que un reporte sin clasificar cargue un ítem', async () => {
    await client.query('savepoint caso')
    await expect(
      client.query(
        `insert into reportes (organizacion_id, tipo, canal, codigo_item, estado)
         select id, 'sin_clasificar', 'whatsapp', '11', 'RECIBIDO' from organizaciones limit 1`,
      ),
    ).rejects.toThrow(/reportes_sin_clasificar_sin_item_check/)
  })
})

conBase('el audio de una nota de voz', () => {
  /**
   * La consulta exacta que hace la ruta que sirve el audio. Va por `reportes` a propósito:
   * `adjuntos_lectura` le da a cualquier rol de staff la tabla entera, mientras que
   * `reportes_lectura` limita a la verificadora a sus comunidades — así que pasar por el
   * reporte hereda ese alcance sin tocar la política.
   */
  async function claveComo(usuarioId: string, adjuntoId: string): Promise<string | null> {
    return como(usuarioId, async () => {
      const { rows } = await client.query<{ storage_key: string }>(
        `select a.storage_key from adjuntos a
           join reportes r on r.id = a.reporte_id
          where a.id = $1 and a.tipo = 'audio'`,
        [adjuntoId],
      )
      return rows[0]?.storage_key ?? null
    })
  }

  async function audioEn(codigoComunidad: string): Promise<string> {
    const reporte = await reporteEnCola(codigoComunidad)
    const { rows } = await client.query<{ id: string }>(
      `insert into adjuntos (reporte_id, tipo, storage_key, mime)
       values ($1, 'audio', 'audio/cd/nota.ogg', 'audio/ogg') returning id`,
      [reporte.id],
    )
    return rows[0]!.id
  }

  it('la verificadora saca el audio de sus comunidades', async () => {
    await client.query('savepoint caso')
    expect(await claveComo(VERIFICADORA, await audioEn('BLL'))).toBe('audio/cd/nota.ogg')
  })

  it('pero no el de una comunidad ajena, ni conociendo el id', async () => {
    await client.query('savepoint caso')
    // Pacurita no es suya. Sin fila no hay clave, y sin clave no hay audio.
    expect(await claveComo(VERIFICADORA, await audioEn('PAC'))).toBeNull()
  })

  it('un coordinador sí, porque su alcance es toda la cuenca', async () => {
    await client.query('savepoint caso')
    expect(await claveComo(COORDINADOR, await audioEn('PAC'))).toBe('audio/cd/nota.ogg')
  })
})

conBase('un ítem que pide detalle y no lo trae está incompleto', () => {
  it('no se vuelve pedido hasta que alguien complete el detalle', async () => {
    await client.query('savepoint caso')

    // '22' es medicamento crónico: pide detalle, porque «pastillas» no es una receta.
    const { rows } = await client.query<{ id: string }>(
      `insert into reportes (organizacion_id, tipo, canal, comunidad_id, codigo_item,
                             familias, urgencia, descripcion, estado)
       select o.id, 'necesidad', 'whatsapp', c.id, '22', 8, 2,
              'Se acabaron las pastillas', 'RECIBIDO'
         from organizaciones o, comunidades c where c.codigo = 'BLL' limit 1
       returning id`,
    )
    const id = rows[0]!.id

    await como(VERIFICADORA, async () => {
      const sinDetalle = await promoverAPedido(client, id, VERIFICADORA, 8)
      expect(sinDetalle.ok).toBe(false)
    })

    // Y el reporte sigue en la cola, no desaparecido: alguien tiene que preguntar.
    const { rows: despues } = await client.query<{ estado: string }>(
      `select estado from reportes where id = $1`,
      [id],
    )
    expect(despues[0]!.estado).toBe('RECIBIDO')

    // Con el detalle puesto, sí entra.
    await client.query(
      `update reportes set detalle_libre = 'Losartán 50mg y metformina 850mg' where id = $1`,
      [id],
    )
    await como(VERIFICADORA, async () => {
      expect(await promoverAPedido(client, id, VERIFICADORA, 8)).toEqual({ ok: true })
    })
  })
})

conBase('el razonamiento del clasificador, en pantalla', () => {
  it('la bandeja explica por qué un mensaje quedó sin clasificar', async () => {
    await client.query('savepoint caso')

    const { rows } = await client.query<{ id: string }>(
      `insert into reportes (organizacion_id, tipo, canal, comunidad_id, detalle_libre, estado)
       select o.id, 'sin_clasificar', 'whatsapp', c.id, 'Muchas cosas!! De todo!!!', 'RECIBIDO'
         from organizaciones o, comunidades c where c.codigo = 'BLL' limit 1
       returning id`,
    )
    const id = rows[0]!.id

    const bandeja = await como(COORDINADOR, () => cargarBandeja(client))
    const fila = bandeja.pendientes.find((f) => f.id === id)!

    // `motivos` lo construyó el normalizador para esta pantalla, y el intake lo descarta:
    // se vuelve a derivar acá con la misma función pura, sobre el mismo texto.
    expect(fila.motivos.length).toBeGreaterThan(0)
    expect(fila.motivos.join(' · ')).toMatch(/vago|léxico|lexico/i)
    expect(fila.versionLexico).toBeTruthy()
    // Y las palabras de la persona salen tal cual, vengan de la columna que vengan.
    expect(fila.textoOriginal).toBe('Muchas cosas!! De todo!!!')
  })

  it('explica sobre la transcripción corregida cuando existe', async () => {
    await client.query('savepoint caso')
    const reporte = await reporteEnCola()
    const { rows } = await client.query<{ id: string }>(
      `insert into adjuntos (reporte_id, tipo, storage_key, transcripcion)
       values ($1, 'audio', 'audio/ef/nota.ogg', 'muchas cosas de todo')
       returning id`,
      [reporte.id],
    )

    await como(VERIFICADORA, () =>
      corregirTranscripcion(client, rows[0]!.id, 'necesitamos veinte mercados', VERIFICADORA),
    )

    const bandeja = await como(COORDINADOR, () => cargarBandeja(client))
    const fila = bandeja.pendientes.find((f) => f.id === reporte.id)!
    // Lo que una persona corrigió manda sobre lo que oyó la máquina.
    expect(fila.motivos.join(' · ')).not.toMatch(/vago/i)
  })
})
