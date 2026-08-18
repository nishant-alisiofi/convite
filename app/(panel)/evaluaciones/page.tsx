import {
  ClipboardCheck,
  FileStack,
  HardHat,
  Hourglass,
  MapPinned,
  Share2,
  TriangleAlert,
  Wrench,
} from 'lucide-react'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  avanzarEvaluacionTecnica,
  bomDe,
  cobertura,
  comunidadesParaEvaluar,
  costoFundableCop,
  crearEvaluacion,
  crearEvaluacionTecnica,
  crearHallazgo,
  crearPlantilla,
  DOMINIOS_EVALUACION,
  type DominioEvaluacion,
  type EstadoEvaluacion,
  estadoReparacion,
  ETIQUETA_DOMINIO,
  ETIQUETA_ESTADO_EVALUACION,
  ETIQUETA_VIA,
  type EvaluacionTecnica,
  filasCobertura,
  generarBom,
  guardarBom,
  type Hallazgo,
  listarEvaluaciones,
  listarEvaluacionesTecnicas,
  listarPlantillas,
  listarHallazgos,
  type Plantilla,
  saldoFundableCop,
  siguienteEstado,
  transicionValida,
  VIAS_DE_RESPUESTA,
  type ViaDeRespuesta,
} from '@/lib/evaluaciones'
import { conSesion, sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

/**
 * PRD-29 «Assessments and recovery» — the review surface for levels 2–4.
 *
 * It shows the territorial coverage (Level 4, assessed out of estimated total with its date), the
 * assessment sweeps and their findings routed by `via_de_respuesta` (Level 3), and the bill of
 * materials that costs a matchable finding into something Apadrinar can fund (Level 2). Recording
 * and costing are coordination work, so the screen is for coordinador/admin; RLS (0044) is the real
 * boundary and this gate merely spares everyone else a screen they could not use.
 */

const PUEDEN_EVALUAR = ['coordinador', 'admin']

const pesos = (n: number) => `$${n.toLocaleString('es-CO')}`
const hoyISO = () => new Date().toISOString().slice(0, 10)
const soloDigitos = (v: FormDataEntryValue | null) => Number(String(v ?? '').replace(/[^\d]/g, ''))

type Params = Promise<{ ver?: string; error?: string }>

export default async function Evaluaciones({ searchParams }: { searchParams: Params }) {
  const sesion = await sesionActual()
  if (!sesion) redirect('/entrar')

  const { ver, error } = await searchParams

  if (!PUEDEN_EVALUAR.includes(sesion.rolStaff)) {
    return (
      <main>
        <h1 className="text-xl font-semibold text-barro-900">Evaluaciones</h1>
        <p className="mt-4 max-w-2xl text-barro-700">
          Levantar un barrido, costear una reparación y leer la cobertura de un territorio es trabajo
          de coordinación. Su rol no lo ve, y eso es a propósito.
        </p>
      </main>
    )
  }

  const { plantillas, evaluaciones, evaluacionesTecnicas, hallazgos, comunidades, cob, detalle } =
    await conSesion(sesion, async (client) => {
      const plantillas = await listarPlantillas(client)
      const evaluaciones = await listarEvaluaciones(client)
      const evaluacionesTecnicas = await listarEvaluacionesTecnicas(client)
      const hallazgos = await listarHallazgos(client)
      const comunidades = await comunidadesParaEvaluar(client)
      const cob = cobertura(await filasCobertura(client))
      const elegido = ver ? hallazgos.find((h) => h.id === ver) : undefined
      const detalle = elegido
        ? { hallazgo: elegido, bom: await bomDe(client, elegido.id) }
        : null
      return { plantillas, evaluaciones, evaluacionesTecnicas, hallazgos, comunidades, cob, detalle }
    })

  const porVia = (via: ViaDeRespuesta) => hallazgos.filter((h) => h.viaDeRespuesta === via)

  // ── Server actions ────────────────────────────────────────────────────────────────────────
  async function registrarPlantilla(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_EVALUAR.includes(sesion.rolStaff)) {
      redirect('/evaluaciones?error=Solo+coordinación+registra+plantillas')
    }
    const dominio = String(formData.get('dominio') ?? '') as DominioEvaluacion
    const codigo = String(formData.get('codigo') ?? '').trim()
    const nombre = String(formData.get('nombre') ?? '').trim()
    if (!DOMINIOS_EVALUACION.includes(dominio)) {
      redirect('/evaluaciones?error=Dominio+desconocido')
    }
    if (!codigo || !nombre) redirect('/evaluaciones?error=Falta+el+código+o+el+nombre')
    try {
      await conSesion(
        sesion,
        (client) =>
          crearPlantilla(
            client,
            {
              organizacionId: sesion.organizacionId,
              dominio,
              codigo,
              nombre,
              descripcion: String(formData.get('descripcion') ?? '').trim() || null,
              materialesCop: soloDigitos(formData.get('materialesCop')),
              transporteCop: soloDigitos(formData.get('transporteCop')),
              asistenciaTecnicaCop: soloDigitos(formData.get('asistenciaTecnicaCop')),
              manoDeObraDias: soloDigitos(formData.get('manoDeObraDias')),
            },
            sesion.authId,
          ),
        { escribe: true },
      )
    } catch {
      redirect('/evaluaciones?error=No+se+pudo+registrar+la+plantilla+(¿código+repetido?)')
    }
    revalidatePath('/evaluaciones')
    redirect('/evaluaciones')
  }

  async function registrarEvaluacion(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_EVALUAR.includes(sesion.rolStaff)) {
      redirect('/evaluaciones?error=Solo+coordinación+registra+barridos')
    }
    const comunidadId = String(formData.get('comunidadId') ?? '')
    const dominio = String(formData.get('dominio') ?? '') as DominioEvaluacion
    const evaluadorNombre = String(formData.get('evaluadorNombre') ?? '').trim()
    const fechaVisita = String(formData.get('fechaVisita') ?? '').trim()
    const totalEstimado = soloDigitos(formData.get('totalEstimado'))
    const venceEn = String(formData.get('venceEn') ?? '').trim() || null
    if (!comunidadId) redirect('/evaluaciones?error=Elija+la+comunidad')
    if (!DOMINIOS_EVALUACION.includes(dominio)) redirect('/evaluaciones?error=Dominio+desconocido')
    if (!evaluadorNombre) redirect('/evaluaciones?error=Falta+quién+hizo+la+visita')
    if (!fechaVisita) redirect('/evaluaciones?error=Falta+la+fecha+de+la+visita')
    if (!Number.isFinite(totalEstimado) || totalEstimado <= 0) {
      redirect('/evaluaciones?error=El+total+estimado+debe+ser+mayor+que+cero')
    }
    if (venceEn && venceEn < fechaVisita) {
      redirect('/evaluaciones?error=El+vencimiento+no+puede+ser+antes+de+la+visita')
    }
    try {
      await conSesion(
        sesion,
        (client) =>
          crearEvaluacion(
            client,
            {
              organizacionId: sesion.organizacionId,
              comunidadId,
              dominio,
              evaluadorNombre,
              fechaVisita,
              totalEstimado,
              venceEn,
              notas: String(formData.get('notas') ?? '').trim() || null,
            },
            sesion.authId,
          ),
        { escribe: true },
      )
    } catch {
      redirect('/evaluaciones?error=No+se+pudo+registrar+el+barrido')
    }
    revalidatePath('/evaluaciones')
    redirect('/evaluaciones')
  }

  async function registrarHallazgo(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_EVALUAR.includes(sesion.rolStaff)) {
      redirect('/evaluaciones?error=Solo+coordinación+registra+hallazgos')
    }
    const comunidadId = String(formData.get('comunidadId') ?? '')
    const dominio = String(formData.get('dominio') ?? '') as DominioEvaluacion
    const descripcion = String(formData.get('descripcion') ?? '').trim()
    const via = String(formData.get('viaDeRespuesta') ?? '') as ViaDeRespuesta
    const severidadRaw = String(formData.get('severidad') ?? '').trim()
    const severidad = severidadRaw ? Number(severidadRaw) : null
    const derivacionDestino = String(formData.get('derivacionDestino') ?? '').trim() || null
    const evaluacionId = String(formData.get('evaluacionId') ?? '') || null
    if (!comunidadId) redirect('/evaluaciones?error=Elija+la+comunidad')
    if (!DOMINIOS_EVALUACION.includes(dominio)) redirect('/evaluaciones?error=Dominio+desconocido')
    if (!descripcion) redirect('/evaluaciones?error=Falta+la+descripción+del+hallazgo')
    if (!VIAS_DE_RESPUESTA.includes(via)) redirect('/evaluaciones?error=Vía+de+respuesta+desconocida')
    if (severidad !== null && ![1, 2, 3].includes(severidad)) {
      redirect('/evaluaciones?error=La+severidad+es+1,+2+o+3')
    }
    if (via === 'derivacion' && !derivacionDestino) {
      redirect('/evaluaciones?error=Una+derivación+debe+nombrar+a+qué+mandato+va')
    }
    try {
      await conSesion(
        sesion,
        (client) =>
          crearHallazgo(
            client,
            {
              organizacionId: sesion.organizacionId,
              comunidadId,
              dominio,
              descripcion,
              severidad,
              viaDeRespuesta: via,
              derivacionDestino,
              evaluacionId,
            },
            sesion.authId,
          ),
        { escribe: true },
      )
    } catch {
      redirect('/evaluaciones?error=No+se+pudo+registrar+el+hallazgo')
    }
    revalidatePath('/evaluaciones')
    redirect('/evaluaciones')
  }

  // FR-48 — servicios de ingeniería y evaluación técnica ───────────────────────────────────────
  async function registrarEvaluacionTecnica(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_EVALUAR.includes(sesion.rolStaff)) {
      redirect('/evaluaciones?error=Solo+coordinación+solicita+evaluaciones+técnicas')
    }
    const comunidadId = String(formData.get('comunidadId') ?? '')
    const dominio = String(formData.get('dominio') ?? '') as DominioEvaluacion
    const asignadoA = String(formData.get('asignadoA') ?? '').trim()
    if (!comunidadId) redirect('/evaluaciones?error=Elija+la+comunidad')
    if (!DOMINIOS_EVALUACION.includes(dominio)) redirect('/evaluaciones?error=Dominio+desconocido')
    if (!asignadoA) redirect('/evaluaciones?error=Falta+el+técnico+asignado')
    try {
      await conSesion(
        sesion,
        (client) =>
          crearEvaluacionTecnica(
            client,
            {
              organizacionId: sesion.organizacionId,
              comunidadId,
              dominio,
              asignadoA,
              notas: String(formData.get('notas') ?? '').trim() || null,
            },
            sesion.authId,
          ),
        { escribe: true },
      )
    } catch {
      redirect('/evaluaciones?error=No+se+pudo+solicitar+la+evaluación+técnica')
    }
    revalidatePath('/evaluaciones')
    redirect('/evaluaciones')
  }

  async function avanzarEvaluacionTecnicaAccion(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_EVALUAR.includes(sesion.rolStaff)) {
      redirect('/evaluaciones?error=Solo+coordinación+avanza+evaluaciones+técnicas')
    }
    const id = String(formData.get('id') ?? '')
    const desde = String(formData.get('desde') ?? '') as EstadoEvaluacion
    const hacia = String(formData.get('hacia') ?? '') as EstadoEvaluacion
    const detalle = String(formData.get('detalle') ?? '').trim()
    if (!id) redirect('/evaluaciones?error=Falta+la+evaluación+técnica')
    if (!transicionValida(desde, hacia)) {
      redirect('/evaluaciones?error=Ese+cambio+de+estado+no+es+válido')
    }
    if (hacia === 'completada' && !detalle) {
      redirect('/evaluaciones?error=Falta+el+hallazgo+para+completar+la+evaluación')
    }
    try {
      await conSesion(
        sesion,
        (client) =>
          avanzarEvaluacionTecnica(client, {
            id,
            organizacionId: sesion.organizacionId,
            estado: hacia,
            detalle: hacia === 'completada' ? detalle : null,
          }),
        { escribe: true },
      )
    } catch {
      redirect('/evaluaciones?error=No+se+pudo+avanzar+la+evaluación+técnica')
    }
    revalidatePath('/evaluaciones')
    redirect('/evaluaciones')
  }

  async function generarDesdePlantilla(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_EVALUAR.includes(sesion.rolStaff)) {
      redirect('/evaluaciones?error=Solo+coordinación+costea+reparaciones')
    }
    const hallazgoId = String(formData.get('hallazgoId') ?? '')
    const plantillaId = String(formData.get('plantillaId') ?? '')
    const severidadRaw = String(formData.get('severidad') ?? '').trim()
    const severidad = severidadRaw ? Number(severidadRaw) : null
    if (!hallazgoId) redirect('/evaluaciones?error=Falta+el+hallazgo')
    if (!plantillaId) redirect(`/evaluaciones?ver=${hallazgoId}&error=Elija+una+plantilla`)
    try {
      await conSesion(
        sesion,
        async (client) => {
          const plantillas = await listarPlantillas(client)
          const plantilla = plantillas.find((p) => p.id === plantillaId)
          if (!plantilla) throw new Error('plantilla no encontrada')
          const propuesta = generarBom(plantilla, severidad)
          await guardarBom(
            client,
            {
              hallazgoId,
              organizacionId: sesion.organizacionId,
              origen: 'plantilla',
              plantillaId,
              ...propuesta,
            },
            sesion.authId,
          )
        },
        { escribe: true },
      )
    } catch {
      redirect(`/evaluaciones?ver=${hallazgoId}&error=No+se+pudo+generar+el+presupuesto`)
    }
    revalidatePath('/evaluaciones')
    redirect(`/evaluaciones?ver=${hallazgoId}`)
  }

  async function editarBom(formData: FormData) {
    'use server'
    const sesion = await sesionActual()
    if (!sesion || !PUEDEN_EVALUAR.includes(sesion.rolStaff)) {
      redirect('/evaluaciones?error=Solo+coordinación+costea+reparaciones')
    }
    const hallazgoId = String(formData.get('hallazgoId') ?? '')
    if (!hallazgoId) redirect('/evaluaciones?error=Falta+el+hallazgo')
    try {
      await conSesion(
        sesion,
        (client) =>
          guardarBom(
            client,
            {
              hallazgoId,
              organizacionId: sesion.organizacionId,
              origen: 'manual',
              plantillaId: String(formData.get('plantillaId') ?? '') || null,
              materialesCop: soloDigitos(formData.get('materialesCop')),
              transporteCop: soloDigitos(formData.get('transporteCop')),
              asistenciaTecnicaCop: soloDigitos(formData.get('asistenciaTecnicaCop')),
              manoDeObraDias: soloDigitos(formData.get('manoDeObraDias')),
              materialesCubiertoCop: soloDigitos(formData.get('materialesCubiertoCop')),
              transporteCubiertoCop: soloDigitos(formData.get('transporteCubiertoCop')),
              asistenciaTecnicaCubiertoCop: soloDigitos(formData.get('asistenciaTecnicaCubiertoCop')),
              manoDeObraCubiertaDias: soloDigitos(formData.get('manoDeObraCubiertaDias')),
            },
            sesion.authId,
          ),
        { escribe: true },
      )
    } catch {
      redirect(`/evaluaciones?ver=${hallazgoId}&error=No+se+pudo+guardar+el+presupuesto`)
    }
    revalidatePath('/evaluaciones')
    redirect(`/evaluaciones?ver=${hallazgoId}`)
  }

  return (
    <main>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-barro-900">Evaluaciones</h1>
        <p className="text-sm text-barro-600">
          {evaluaciones.length} {evaluaciones.length === 1 ? 'barrido' : 'barridos'} ·{' '}
          {hallazgos.length} {hallazgos.length === 1 ? 'hallazgo' : 'hallazgos'} ·{' '}
          {evaluacionesTecnicas.length}{' '}
          {evaluacionesTecnicas.length === 1
            ? 'evaluación técnica'
            : 'evaluaciones técnicas'}
        </p>
      </div>

      <p className="mt-2 max-w-3xl text-sm text-barro-700">
        El barrido cuenta todo lo que hay, no solo lo que reportó. La cobertura es{' '}
        <span className="font-medium">evaluado sobre el total estimado, con su fecha</span>: cuarenta
        de cien casas visitadas no es lo mismo que cuarenta casas dañadas. Un hallazgo de convite se
        costea en cuatro componentes y se vuelve algo que Apadrinar puede financiar; una derivación
        se registra pero no entra a despacho.
      </p>

      {error && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      )}

      {/* Level 4 — the territorial picture. */}
      <Cobertura cob={cob} />

      {/* Level 3 — the sweeps. */}
      <section className="mt-8">
        <h2 className="flex items-center gap-2 font-semibold text-barro-900">
          <ClipboardCheck className="size-4" aria-hidden />
          Barridos
          <span className="font-normal text-barro-600">{evaluaciones.length}</span>
        </h2>
        {evaluaciones.length === 0 ? (
          <p className="mt-3 rounded-lg border border-barro-200 bg-white px-4 py-3 text-barro-700">
            Todavía no hay barridos. Registre uno abajo para empezar a medir cobertura.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
            {evaluaciones.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 px-4 py-3 text-sm">
                <span className="font-medium text-barro-900">{e.comunidadNombre}</span>
                <span className="text-barro-500">{e.municipio}</span>
                <DominioPill dominio={e.dominio} />
                <span className="text-barro-700">
                  {e.evaluados} de {e.totalEstimado} ({e.porcentaje}%)
                </span>
                {e.vencida && (
                  <span className="flex items-center gap-1 text-xs text-atrato-700">
                    <Hourglass className="size-3" aria-hidden />
                    vencido
                  </span>
                )}
                <span className="ml-auto text-barro-500">
                  {e.evaluadorNombre} · {e.fechaVisita}
                  {e.venceEn && ` · vence ${e.venceEn}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        <RegistrarBarrido action={registrarEvaluacion} comunidades={comunidades} />
      </section>

      {/* FR-48 — servicios de ingeniería: technical/engineering evaluation tickets. */}
      <ServiciosDeIngenieria
        evaluacionesTecnicas={evaluacionesTecnicas}
        comunidades={comunidades}
        registrar={registrarEvaluacionTecnica}
        avanzar={avanzarEvaluacionTecnicaAccion}
      />

      {/* Level 3 — the findings, routed by via_de_respuesta. */}
      <section className="mt-8">
        <h2 className="font-semibold text-barro-900">Hallazgos</h2>

        <GrupoHallazgos
          titulo="Convite — matchables"
          ayuda="Se pueden costear y financiar. Aquí se arma el presupuesto de reparación."
          icono={<HardHat className="size-4" aria-hidden />}
          hallazgos={porVia('convite')}
          ver={ver}
          costos
        />
        <GrupoHallazgos
          titulo="Derivaciones — otro mandato"
          ayuda="Verificadas, atendidas por una visita y no por una caja. No entran a despacho: no son carga."
          icono={<Share2 className="size-4" aria-hidden />}
          hallazgos={porVia('derivacion')}
          ver={ver}
        />
        <GrupoHallazgos
          titulo="Sin vía — registradas"
          ayuda="Necesidad vista sin ruta para responderla. Se anota; nunca se encola."
          icono={<ClipboardCheck className="size-4" aria-hidden />}
          hallazgos={porVia('sin_via')}
          ver={ver}
        />

        <RegistrarHallazgo
          action={registrarHallazgo}
          comunidades={comunidades}
          evaluaciones={evaluaciones}
        />
      </section>

      {/* Level 2 — the bill of materials for the selected finding. */}
      {detalle && detalle.hallazgo.viaDeRespuesta === 'convite' && (
        <BomDetalle
          hallazgo={detalle.hallazgo}
          bom={detalle.bom}
          plantillas={plantillas}
          generar={generarDesdePlantilla}
          editar={editarBom}
        />
      )}

      {/* Templates — multi-domain, what drives the sweep and the bill of materials. */}
      <Plantillas plantillas={plantillas} action={registrarPlantilla} />
    </main>
  )
}

const CLASE_CAMPO = 'mt-1 w-full rounded border border-barro-200 bg-white px-2 py-1.5 text-sm'

function Cobertura({ cob }: { cob: ReturnType<typeof cobertura> }) {
  if (cob.municipios.length === 0) {
    return (
      <section className="mt-6">
        <h2 className="flex items-center gap-2 font-semibold text-barro-900">
          <MapPinned className="size-4" aria-hidden />
          Cobertura
        </h2>
        <p className="mt-3 rounded-lg border border-barro-200 bg-white px-4 py-3 text-sm text-barro-600">
          Sin barridos todavía, no hay cobertura que mostrar.
        </p>
      </section>
    )
  }
  return (
    <section className="mt-6">
      <h2 className="flex items-center gap-2 font-semibold text-barro-900">
        <MapPinned className="size-4" aria-hidden />
        Cobertura
      </h2>

      <h3 className="mt-3 text-xs uppercase tracking-wide text-barro-500">Por municipio</h3>
      <ul className="mt-2 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
        {cob.municipios.map((m) => (
          <li key={m.municipio} className="flex flex-wrap items-baseline gap-x-2 px-4 py-2.5 text-sm">
            <span className="font-medium text-barro-900">{m.municipio}</span>
            <Barra porcentaje={m.porcentaje} />
            <span className="text-barro-700">
              {m.evaluados} de {m.totalEstimado} ({m.porcentaje}%)
            </span>
            <span className="ml-auto text-barro-500">al {m.fecha}</span>
          </li>
        ))}
      </ul>

      <h3 className="mt-4 text-xs uppercase tracking-wide text-barro-500">Por vereda y dominio</h3>
      <ul className="mt-2 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
        {cob.veredas.map((v) => (
          <li
            key={`${v.comunidadId}-${v.dominio}`}
            className="flex flex-wrap items-baseline gap-x-2 px-4 py-2.5 text-sm"
          >
            <span className="font-medium text-barro-900">{v.comunidadNombre}</span>
            <span className="text-barro-500">{v.municipio}</span>
            <DominioPill dominio={v.dominio} />
            <Barra porcentaje={v.porcentaje} />
            <span className="text-barro-700">
              {v.evaluados} de {v.totalEstimado} ({v.porcentaje}%)
            </span>
            {v.vencida && <span className="text-xs text-atrato-700">vencido</span>}
            <span className="ml-auto text-barro-500">al {v.fecha}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Barra({ porcentaje }: { porcentaje: number }) {
  const ancho = Math.min(100, Math.max(0, porcentaje))
  return (
    <span className="inline-block h-1.5 w-20 overflow-hidden rounded-full bg-barro-100" aria-hidden>
      <span className="block h-full rounded-full bg-selva-500" style={{ width: `${ancho}%` }} />
    </span>
  )
}

function GrupoHallazgos({
  titulo,
  ayuda,
  icono,
  hallazgos,
  ver,
  costos,
}: {
  titulo: string
  ayuda: string
  icono: React.ReactNode
  hallazgos: Hallazgo[]
  ver?: string
  costos?: boolean
}) {
  return (
    <div className="mt-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-barro-800">
        {icono}
        {titulo}
        <span className="font-normal text-barro-500">{hallazgos.length}</span>
      </h3>
      <p className="mt-0.5 text-xs text-barro-600">{ayuda}</p>
      {hallazgos.length === 0 ? (
        <p className="mt-2 rounded-lg border border-barro-200 bg-white px-4 py-2.5 text-sm text-barro-600">
          Ninguno.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
          {hallazgos.map((h) => (
            <li key={h.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                {costos ? (
                  <Link
                    href={`/evaluaciones?ver=${h.id}`}
                    className={`font-medium underline-offset-2 hover:underline ${
                      h.id === ver ? 'text-selva-700' : 'text-barro-900'
                    }`}
                  >
                    {h.comunidadNombre}
                  </Link>
                ) : (
                  <span className="font-medium text-barro-900">{h.comunidadNombre}</span>
                )}
                <span className="text-barro-500">{h.municipio}</span>
                <DominioPill dominio={h.dominio} />
                {h.severidad !== null && (
                  <span className="text-xs text-barro-600">sev. {h.severidad}</span>
                )}
                {h.vencida && <span className="text-xs text-atrato-700">vencido</span>}
                {costos && (
                  <span className="ml-auto text-barro-600">
                    {h.tieneBom
                      ? h.reparacionCompleta
                        ? 'reparación completa'
                        : `falta ${pesos(h.saldoFundableCop)}`
                      : 'sin costear'}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-barro-700">
                {h.descripcion}
                {h.derivacionDestino && ` · → ${h.derivacionDestino}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function BomDetalle({
  hallazgo,
  bom,
  plantillas,
  generar,
  editar,
}: {
  hallazgo: Hallazgo
  bom: Awaited<ReturnType<typeof bomDe>>
  plantillas: Plantilla[]
  generar: (formData: FormData) => Promise<void>
  editar: (formData: FormData) => Promise<void>
}) {
  const delDominio = plantillas.filter((p) => p.dominio === hallazgo.dominio && p.activa)
  const estado = bom ? estadoReparacion(bom) : null
  return (
    <section className="mt-8">
      <h2 className="flex items-center gap-2 font-semibold text-barro-900">
        <HardHat className="size-4" aria-hidden />
        Presupuesto: {hallazgo.comunidadNombre} · {ETIQUETA_DOMINIO[hallazgo.dominio]}
      </h2>
      <p className="mt-1 text-sm text-barro-700">{hallazgo.descripcion}</p>

      {!bom ? (
        <form
          action={generar}
          className="mt-4 grid gap-3 rounded-lg border border-barro-200 bg-white p-4 sm:grid-cols-2"
        >
          <input type="hidden" name="hallazgoId" value={hallazgo.id} />
          <input type="hidden" name="severidad" value={hallazgo.severidad ?? ''} />
          <Campo etiqueta="Plantilla" ayuda="Propone los cuatro componentes; luego se ajustan.">
            <select name="plantillaId" defaultValue="" required className={CLASE_CAMPO}>
              <option value="" disabled>
                {delDominio.length ? 'Elija una plantilla' : 'No hay plantilla de este dominio'}
              </option>
              {delDominio.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo} · {p.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={delDominio.length === 0}
              className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700 disabled:opacity-50"
            >
              Generar presupuesto (sev. {hallazgo.severidad ?? '—'})
            </button>
          </div>
        </form>
      ) : (
        <>
          <section className="mt-4 grid gap-3 sm:grid-cols-3">
            <Tarjeta etiqueta="Costo fundable" valor={pesos(costoFundableCop(bom))} />
            <Tarjeta etiqueta="Falta financiar" valor={pesos(saldoFundableCop(bom))} destacado />
            <Tarjeta
              etiqueta="Mano de obra"
              valor={`${bom.manoDeObraCubiertaDias}/${bom.manoDeObraDias} días`}
            />
          </section>

          {estado && (
            <p className="mt-3 text-sm text-barro-700">
              {estado.completo ? (
                <span className="text-selva-700">Los cuatro componentes están cubiertos.</span>
              ) : (
                <>
                  Falta: <span className="text-atrato-700">{estado.faltantes.join(', ')}</span>. Los
                  componentes sin cubrir alimentan los estados atascados de la Bandeja.
                </>
              )}
            </p>
          )}

          <form
            action={editar}
            className="mt-4 grid gap-3 rounded-lg border border-barro-200 bg-white p-4 sm:grid-cols-2"
          >
            <input type="hidden" name="hallazgoId" value={hallazgo.id} />
            <input type="hidden" name="plantillaId" value={bom.plantillaId ?? ''} />
            <ParComponente
              etiqueta="Materiales (COP)"
              nombreReq="materialesCop"
              reqValor={bom.materialesCop}
              nombreCub="materialesCubiertoCop"
              cubValor={bom.materialesCubiertoCop}
            />
            <ParComponente
              etiqueta="Transporte (COP)"
              nombreReq="transporteCop"
              reqValor={bom.transporteCop}
              nombreCub="transporteCubiertoCop"
              cubValor={bom.transporteCubiertoCop}
            />
            <ParComponente
              etiqueta="Asistencia técnica (COP)"
              nombreReq="asistenciaTecnicaCop"
              reqValor={bom.asistenciaTecnicaCop}
              nombreCub="asistenciaTecnicaCubiertoCop"
              cubValor={bom.asistenciaTecnicaCubiertoCop}
            />
            <ParComponente
              etiqueta="Mano de obra local (días)"
              nombreReq="manoDeObraDias"
              reqValor={bom.manoDeObraDias}
              nombreCub="manoDeObraCubiertaDias"
              cubValor={bom.manoDeObraCubiertaDias}
            />
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
              >
                Guardar presupuesto
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  )
}

function ParComponente({
  etiqueta,
  nombreReq,
  reqValor,
  nombreCub,
  cubValor,
}: {
  etiqueta: string
  nombreReq: string
  reqValor: number
  nombreCub: string
  cubValor: number
}) {
  return (
    <fieldset className="rounded border border-barro-100 p-2">
      <legend className="px-1 text-xs font-medium text-barro-700">{etiqueta}</legend>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-barro-600">
          Requerido
          <input name={nombreReq} inputMode="numeric" defaultValue={reqValor} className={CLASE_CAMPO} />
        </label>
        <label className="block text-xs text-barro-600">
          Cubierto
          <input name={nombreCub} inputMode="numeric" defaultValue={cubValor} className={CLASE_CAMPO} />
        </label>
      </div>
    </fieldset>
  )
}

function RegistrarBarrido({
  action,
  comunidades,
}: {
  action: (formData: FormData) => Promise<void>
  comunidades: { id: string; nombre: string; municipio: string }[]
}) {
  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-sm font-medium text-selva-700">
        Registrar un barrido
      </summary>
      <form
        action={action}
        className="mt-3 grid gap-3 rounded-lg border border-barro-200 bg-white p-4 sm:grid-cols-2"
      >
        <Campo etiqueta="Comunidad">
          <select name="comunidadId" defaultValue="" required className={CLASE_CAMPO}>
            <option value="" disabled>
              Elija una comunidad
            </option>
            {comunidades.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre} · {c.municipio}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Dominio">
          <SelectDominio />
        </Campo>
        <Campo etiqueta="Quién visitó" ayuda="Provenance: un visitante con una fecha.">
          <input name="evaluadorNombre" required className={CLASE_CAMPO} />
        </Campo>
        <Campo etiqueta="Fecha de la visita">
          <input type="date" name="fechaVisita" defaultValue={hoyISO()} required className={CLASE_CAMPO} />
        </Campo>
        <Campo etiqueta="Total estimado en el lugar" ayuda="El denominador de la cobertura.">
          <input name="totalEstimado" inputMode="numeric" required className={CLASE_CAMPO} />
        </Campo>
        <Campo etiqueta="Vence (opcional)" ayuda="Cuándo el hallazgo queda viejo.">
          <input type="date" name="venceEn" className={CLASE_CAMPO} />
        </Campo>
        <div className="sm:col-span-2">
          <button
            type="submit"
            className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
          >
            Registrar barrido
          </button>
        </div>
      </form>
    </details>
  )
}

/**
 * FR-48 — servicios de ingeniería y evaluación técnica. A técnico assesses one piece of a
 * community's infrastructure (agua, puente, vivienda, eléctrico…), tracked solicitada → en curso →
 * completada, closed with a finding. Reuses PRD-29's `evaluaciones` table (a ticket, not a sweep —
 * see lib/evaluaciones.ts), so it lives in the same screen right next to the sweeps it borrows from.
 */
function ServiciosDeIngenieria({
  evaluacionesTecnicas,
  comunidades,
  registrar,
  avanzar,
}: {
  evaluacionesTecnicas: EvaluacionTecnica[]
  comunidades: { id: string; nombre: string; municipio: string }[]
  registrar: (formData: FormData) => Promise<void>
  avanzar: (formData: FormData) => Promise<void>
}) {
  return (
    <section className="mt-8">
      <h2 className="flex items-center gap-2 font-semibold text-barro-900">
        <Wrench className="size-4" aria-hidden />
        Servicios de ingeniería
        <span className="font-normal text-barro-600">{evaluacionesTecnicas.length}</span>
      </h2>
      <p className="mt-0.5 max-w-2xl text-xs text-barro-600">
        Evaluación técnica de infraestructura — ¿es segura esta obra, funciona este sistema, es
        habitable esta vivienda? Se solicita, se asigna a un técnico y se sigue hasta un hallazgo.
      </p>

      {evaluacionesTecnicas.length === 0 ? (
        <p className="mt-3 rounded-lg border border-barro-200 bg-white px-4 py-3 text-barro-700">
          Todavía no hay evaluaciones técnicas solicitadas.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
          {evaluacionesTecnicas.map((e) => (
            <li key={e.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-barro-900">{e.comunidadNombre}</span>
                <span className="text-barro-500">{e.municipio}</span>
                <DominioPill dominio={e.dominio} />
                <EstadoPill estado={e.estado} />
                {e.asignadoA && <span className="text-barro-600">→ {e.asignadoA}</span>}
                <span className="ml-auto text-barro-500">
                  {e.creadoEn.toISOString().slice(0, 10)}
                </span>
              </div>
              {e.notas && <p className="mt-0.5 text-barro-700">{e.notas}</p>}
              {e.detalle && (
                <p className="mt-1 rounded bg-selva-50 px-2 py-1 text-selva-800">{e.detalle}</p>
              )}
              <AvanzarEvaluacionTecnica evaluacion={e} avanzar={avanzar} />
            </li>
          ))}
        </ul>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium text-selva-700">
          Solicitar una evaluación técnica
        </summary>
        <form
          action={registrar}
          className="mt-3 grid gap-3 rounded-lg border border-barro-200 bg-white p-4 sm:grid-cols-2"
        >
          <Campo etiqueta="Comunidad">
            <select name="comunidadId" defaultValue="" required className={CLASE_CAMPO}>
              <option value="" disabled>
                Elija una comunidad
              </option>
              {comunidades.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} · {c.municipio}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Tipo de infraestructura">
            <SelectDominio />
          </Campo>
          <Campo etiqueta="Técnico asignado" ayuda="Quién hace la evaluación.">
            <input name="asignadoA" required className={CLASE_CAMPO} />
          </Campo>
          <Campo etiqueta="Notas (opcional)">
            <input name="notas" className={CLASE_CAMPO} />
          </Campo>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
            >
              Solicitar evaluación
            </button>
          </div>
        </form>
      </details>
    </section>
  )
}

function EstadoPill({ estado }: { estado: EstadoEvaluacion }) {
  const clase =
    estado === 'completada'
      ? 'bg-selva-100 text-selva-800'
      : estado === 'en_curso'
        ? 'bg-atrato-100 text-atrato-800'
        : 'bg-barro-100 text-barro-700'
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${clase}`}>
      {ETIQUETA_ESTADO_EVALUACION[estado]}
    </span>
  )
}

function AvanzarEvaluacionTecnica({
  evaluacion,
  avanzar,
}: {
  evaluacion: EvaluacionTecnica
  avanzar: (formData: FormData) => Promise<void>
}) {
  const siguiente = siguienteEstado(evaluacion.estado)
  if (!siguiente) return null

  if (siguiente === 'completada') {
    return (
      <form action={avanzar} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={evaluacion.id} />
        <input type="hidden" name="desde" value={evaluacion.estado} />
        <input type="hidden" name="hacia" value={siguiente} />
        <label className="block text-xs">
          <span className="font-medium text-barro-700">Hallazgo</span>
          <input name="detalle" required className={`${CLASE_CAMPO} w-64`} />
        </label>
        <button
          type="submit"
          className="rounded bg-selva-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-selva-700"
        >
          Completar
        </button>
      </form>
    )
  }

  return (
    <form action={avanzar} className="mt-2">
      <input type="hidden" name="id" value={evaluacion.id} />
      <input type="hidden" name="desde" value={evaluacion.estado} />
      <input type="hidden" name="hacia" value={siguiente} />
      <button
        type="submit"
        className="rounded border border-selva-600 px-3 py-1 text-xs font-medium text-selva-700 hover:bg-selva-50"
      >
        Iniciar
      </button>
    </form>
  )
}

function RegistrarHallazgo({
  action,
  comunidades,
  evaluaciones,
}: {
  action: (formData: FormData) => Promise<void>
  comunidades: { id: string; nombre: string; municipio: string }[]
  evaluaciones: { id: string; comunidadNombre: string; dominio: DominioEvaluacion; fechaVisita: string }[]
}) {
  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-sm font-medium text-selva-700">
        Registrar un hallazgo
      </summary>
      <form
        action={action}
        className="mt-3 grid gap-3 rounded-lg border border-barro-200 bg-white p-4 sm:grid-cols-2"
      >
        <Campo etiqueta="Barrido (opcional)" ayuda="El hallazgo hereda su fecha y su vencimiento.">
          <select name="evaluacionId" defaultValue="" className={CLASE_CAMPO}>
            <option value="">Sin barrido (suelto)</option>
            {evaluaciones.map((e) => (
              <option key={e.id} value={e.id}>
                {e.comunidadNombre} · {ETIQUETA_DOMINIO[e.dominio]} · {e.fechaVisita}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Comunidad">
          <select name="comunidadId" defaultValue="" required className={CLASE_CAMPO}>
            <option value="" disabled>
              Elija una comunidad
            </option>
            {comunidades.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre} · {c.municipio}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Dominio">
          <SelectDominio />
        </Campo>
        <Campo etiqueta="Vía de respuesta">
          <select name="viaDeRespuesta" defaultValue="convite" required className={CLASE_CAMPO}>
            {VIAS_DE_RESPUESTA.map((v) => (
              <option key={v} value={v}>
                {ETIQUETA_VIA[v]}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Severidad (opcional)" ayuda="1, 2 o 3. Escala el presupuesto propuesto.">
          <select name="severidad" defaultValue="" className={CLASE_CAMPO}>
            <option value="">Sin severidad</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
          </select>
        </Campo>
        <Campo etiqueta="Derivación a (si aplica)" ayuda="Obligatorio si la vía es derivación.">
          <input name="derivacionDestino" className={CLASE_CAMPO} placeholder="p. ej. Secretaría de Salud" />
        </Campo>
        <Campo etiqueta="Descripción">
          <input name="descripcion" required className={CLASE_CAMPO} />
        </Campo>
        <div className="sm:col-span-2">
          <button
            type="submit"
            className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
          >
            Registrar hallazgo
          </button>
        </div>
      </form>
    </details>
  )
}

function Plantillas({
  plantillas,
  action,
}: {
  plantillas: Plantilla[]
  action: (formData: FormData) => Promise<void>
}) {
  return (
    <section className="mt-8">
      <h2 className="flex items-center gap-2 font-semibold text-barro-900">
        <FileStack className="size-4" aria-hidden />
        Plantillas
        <span className="font-normal text-barro-600">{plantillas.length}</span>
      </h2>
      <p className="mt-0.5 text-xs text-barro-600">
        Multidominio: vivienda, educación, salud, agua, ambiente, capacidad organizacional. Proponen
        el presupuesto base a severidad 2.
      </p>
      {plantillas.length === 0 ? (
        <p className="mt-2 rounded-lg border border-barro-200 bg-white px-4 py-2.5 text-sm text-barro-600">
          Sin plantillas todavía.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-barro-200 rounded-lg border border-barro-200 bg-white">
          {plantillas.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline gap-x-2 px-4 py-2.5 text-sm">
              <span className="font-medium text-barro-900">
                {p.codigo} · {p.nombre}
              </span>
              <DominioPill dominio={p.dominio} />
              <span className="ml-auto text-barro-500">
                {pesos(p.materialesCop + p.transporteCop + p.asistenciaTecnicaCop)} ·{' '}
                {p.manoDeObraDias} días
              </span>
            </li>
          ))}
        </ul>
      )}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium text-selva-700">
          Nueva plantilla
        </summary>
        <form
          action={action}
          className="mt-3 grid gap-3 rounded-lg border border-barro-200 bg-white p-4 sm:grid-cols-2"
        >
          <Campo etiqueta="Dominio">
            <SelectDominio />
          </Campo>
          <Campo etiqueta="Código">
            <input name="codigo" required className={CLASE_CAMPO} placeholder="VIV-2" />
          </Campo>
          <Campo etiqueta="Nombre">
            <input name="nombre" required className={CLASE_CAMPO} placeholder="Reparación de vivienda" />
          </Campo>
          <Campo etiqueta="Descripción (opcional)">
            <input name="descripcion" className={CLASE_CAMPO} />
          </Campo>
          <Campo etiqueta="Materiales base (COP, sev. 2)">
            <input name="materialesCop" inputMode="numeric" defaultValue="0" className={CLASE_CAMPO} />
          </Campo>
          <Campo etiqueta="Transporte base (COP, sev. 2)">
            <input name="transporteCop" inputMode="numeric" defaultValue="0" className={CLASE_CAMPO} />
          </Campo>
          <Campo etiqueta="Asistencia técnica base (COP, sev. 2)">
            <input name="asistenciaTecnicaCop" inputMode="numeric" defaultValue="0" className={CLASE_CAMPO} />
          </Campo>
          <Campo etiqueta="Mano de obra base (días, sev. 2)">
            <input name="manoDeObraDias" inputMode="numeric" defaultValue="0" className={CLASE_CAMPO} />
          </Campo>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded bg-selva-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-selva-700"
            >
              Crear plantilla
            </button>
          </div>
        </form>
      </details>
    </section>
  )
}

function SelectDominio() {
  return (
    <select name="dominio" defaultValue="vivienda" required className={CLASE_CAMPO}>
      {DOMINIOS_EVALUACION.map((d) => (
        <option key={d} value={d}>
          {ETIQUETA_DOMINIO[d]}
        </option>
      ))}
    </select>
  )
}

function DominioPill({ dominio }: { dominio: DominioEvaluacion }) {
  return (
    <span className="rounded bg-barro-100 px-1.5 py-0.5 text-xs font-medium text-barro-700">
      {ETIQUETA_DOMINIO[dominio]}
    </span>
  )
}

function Tarjeta({ etiqueta, valor, destacado }: { etiqueta: string; valor: string; destacado?: boolean }) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        destacado ? 'border-selva-200 bg-selva-50' : 'border-barro-200 bg-white'
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-barro-500">{etiqueta}</p>
      <p className={`mt-1 text-lg font-semibold ${destacado ? 'text-selva-800' : 'text-barro-900'}`}>
        {valor}
      </p>
    </div>
  )
}

function Campo({
  etiqueta,
  ayuda,
  children,
}: {
  etiqueta: string
  ayuda?: string
  children: React.ReactNode
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-barro-800">{etiqueta}</span>
      {children}
      {ayuda && <span className="mt-0.5 block text-xs text-barro-600">{ayuda}</span>}
    </label>
  )
}
