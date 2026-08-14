# Red de Ayuda — Especificación técnica
## Arquitectura agnóstica de territorio, para extender alcance a zonas rurales

Documento de trabajo para el equipo de desarrollo.
Acompaña al *Plan de ejecución*, que cubre permisos, costos y rutas de trabajo.

---

## 0. De qué se trata

La versión que ustedes construyeron funciona bien donde funciona: cobertura de datos estable,
voluntarios individuales, respuesta en horas. Eso describe a Pereira y a la mayoría de cabeceras
municipales.

No describe a buena parte del territorio colombiano.

Este documento no propone reemplazar lo que existe. Propone **generalizarlo**: mantener el sistema
actual como el caso más fácil de una escala, y agregar las capas que permiten operar donde no hay
datos, donde no hay saldo, o donde no hay señal.

El beneficio es de alcance. Un sistema que solo atiende zonas con buena conectividad atiende
exactamente a la población que tiene más alternativas.

**Principio rector:** quien necesita ayuda nunca paga por reportarla.

**Segundo principio:** todo canal escribe en la misma tabla. Un solo registro, un campo `canal`.
Si terminamos con cuatro sistemas paralelos, no sabemos qué está cubierto.

---

## 1. El modelo de tiers — la única variable geográfica

En lugar de codificar supuestos sobre un territorio, cada comunidad se clasifica en un tier de
conectividad. Todo el comportamiento del sistema se deriva de ese campo.

| Tier | Realidad | Entrada | Salida | Ciclo |
|---|---|---|---|---|
| **1** | Datos estables | WhatsApp: lista, voz, pin, foto | Plantilla WhatsApp | Horas |
| **2** | 2G intermitente, poco saldo | SMS con código, o IVR por llamada perdida | SMS o llamada | Días |
| **3** | Sin cobertura; se viaja a un punto con señal | Lote al llegar a cobertura | Al siguiente contacto | Semanas |
| **4** | Sin cobertura | Radio, papel, formulario offline | Relevo humano | Semanas |

**Pereira hoy es tier 1.** No hay que reescribirlo: hay que reconocerlo como un caso de la escala
y construir los otros tres al lado.

El tier determina, automáticamente: qué adaptador aplica, por qué canal responde el despachador,
qué ventanas de vencimiento se usan, y cada cuánto esperamos noticias — y por lo tanto cuándo el
silencio es una alerta.

---

## 2. Arquitectura

```
┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────────┐
│ WhatsApp  │  │    SMS    │  │  Voz/IVR  │  │ Radio, papel  │
└─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └───────┬───────┘
      │              │              │                │
      ▼              ▼              ▼                ▼
┌──────────────────────────────────────────────────────────────┐
│  CAPA DE ADAPTADORES                                         │
│  Normaliza a un evento canónico · descarta duplicados        │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  NÚCLEO CANÓNICO                                             │
│  reportes · comunidades · contactos · envíos · entregas      │
└──────────────┬───────────────────────────┬───────────────────┘
               ▼                           ▼
┌──────────────────────────┐  ┌───────────────────────────────┐
│ TRABAJOS EN SEGUNDO PLANO│  │ DESPACHADOR DE SALIDA         │
│ Media, transcripción,    │  │ Elige canal según el tier     │──┐
│ vencimientos, alertas    │  │ Aplica topes de costo         │  │
└──────────┬───────────────┘  └───────────────┬───────────────┘  │
           ▼                                  ▼                  │
┌──────────────────────────┐  ┌───────────────────────────────┐  │
│ PANEL DEL COORDINADOR    │  │ VISTA PÚBLICA                 │  │
│ Cola y bandeja de audio  │  │ Solo agregados                │  │
└──────────────────────────┘  └───────────────────────────────┘  │
      └──────────────────── retorno a los canales ───────────────┘
```

### 2.1 La capa de adaptadores es lo importante

Cada canal tiene un módulo cuya única responsabilidad es convertir su payload nativo en una forma
canónica y verificar que no sea duplicado:

```json
{
  "canal": "whatsapp",
  "tipo": "necesidad",
  "telefono": "+57...",
  "comunidad_codigo": "BJ-14",
  "codigo_item": "22",
  "familias": 12,
  "urgencia": 3,
  "texto": "...",
  "media": [{ "tipo": "audio", "ref": "..." }],
  "ubicacion": { "lat": 5.31, "lng": -76.65, "fuente": "pin_whatsapp" },
  "id_externo": "wamid.HBg..."
}
```

Nada aguas abajo sabe que WhatsApp existe. Esto permite agregar SMS sin tocar el núcleo, agregar
IVR sin tocar SMS, y —lo más relevante para ustedes— **convertir el manejador de WhatsApp que ya
tienen en un adaptador en vez de reescribirlo**.

### 2.2 Idempotencia, obligatoria

Todo proveedor de mensajería reintenta el webhook si el servidor tarda o responde distinto de 200.
El mismo mensaje llega dos o tres veces. Antes de procesar: insertar el `id_externo` con
restricción única; si el insert falla, descartar y responder 200. Responder 200 primero, procesar
después.

Sin esto, un solo toque de "Tomar y entregar" puede generar tres reservas.

### 2.3 El despachador concentra canal y costo

Es el único componente que decide *cómo* alcanzar a alguien. Como la decisión vive en un solo
lugar, los topes de gasto también viven en un solo lugar. Esto importa: el canal de voz es el más
caro y el más fácil de disparar por error.

---

## 3. Catálogo de categorías

### 3.1 Por qué dos niveles

Cinco categorías no alcanzan. "Medicina" no distingue entre un analgésico y el medicamento crónico
de un hipertenso que lleva tres semanas sin tomarlo. "Refugio" no distingue entre una cobija y una
teja.

Pero tampoco caben veinte opciones en un menú: WhatsApp permite **tres botones** o **diez filas**
en un mensaje de lista; el IVR aguanta cuatro opciones por nivel; y una tarjeta impresa con veinte
renglones no la lee nadie.

Solución: taxonomía de dos niveles con **código numérico de dos dígitos**. El primer dígito es la
familia, el segundo el ítem. El mismo código funciona en los tres canales — quien manda `31` por
SMS y quien elige "Cobijas, hamacas" en WhatsApp generan el mismo registro.

### 3.2 Necesidades

| Código | Familia / ítem | Notas operativas |
|---|---|---|
| **1** | **Alimentos y agua** | |
| 11 | Mercado, alimentos secos | La solicitud más común |
| 12 | Agua potable | Distinguir de tratamiento (44) |
| 13 | Alimentación infantil | Leche, fórmula, papilla |
| **2** | **Salud** | |
| 21 | Medicamento general | Analgésico, antipirético, antidiarreico |
| 22 | **Medicamento crónico** | Diabetes, tensión, epilepsia. **Requiere texto libre** |
| 23 | Atención médica o traslado | Escala a urgencia 3 automáticamente |
| 24 | Insumos de curación | Gasas, antisépticos, jeringas |
| **3** | **Abrigo y albergue** | |
| 31 | Cobijas, hamacas, toldillos | El toldillo es control de vectores, no confort |
| 32 | Colchonetas, esteras | |
| 33 | Plásticos, tejas, materiales | Techo temporal |
| 34 | Kit de cocina | Ollas, platos, cubiertos |
| **4** | **Higiene** | |
| 41 | Kit de aseo personal | |
| 42 | Pañales | Especificar talla en texto libre |
| 43 | Salud menstrual | Categoría propia a propósito |
| 44 | Tratamiento de agua | Pastillas, filtros |
| **5** | **Niñez y educación** | |
| 51 | Ropa infantil | |
| 52 | Kit escolar | |
| 53 | Apoyo psicosocial | Deriva a protección, no a entrega |
| **6** | **Medios de vida** | |
| 61 | Herramientas | |
| 62 | Semillas, insumos agrícolas | Estacional; sirve poco fuera de ventana de siembra |
| **9** | **Reportar un daño** | Ver 3.4 |

### 3.3 Reglas del catálogo

**`22` siempre pide texto libre o nota de voz.** "Medicamento crónico" sin nombre del medicamento
no es accionable. El bot lo pregunta explícitamente.

**`23` sube la urgencia a 3 automáticamente** y aparece resaltado en la cola. Es el único caso
donde el sistema fija una urgencia sin intervención humana, porque un traslado médico no espera a
la verificación de la mañana siguiente.

**`53` no entra a la cola de entrega.** Se marca para derivación. Un envío de mercados no resuelve
eso, y meterlo en la misma cola lo hace invisible.

**`43` es categoría propia.** Cuando la salud menstrual va escondida dentro de "higiene" se pide
menos de lo que se necesita. Es una de las causas más comunes de ausencia escolar en zonas rurales.

**El catálogo es configuración, no código.** Va en una tabla, no en un `check` ni en un `switch`.
Distintos territorios necesitan distintos ítems: en zona costera puede hacer falta combustible para
lancha; en zona de heladas, más abrigo. Cambiar el catálogo no debe requerir un despliegue.

### 3.4 Reporte de daños

Es un tipo de reporte distinto, no una categoría más. Un daño **no se entrega**: se verifica, y
cambia lo que el sistema cree que es posible.

| Código | Daño | Efecto en el sistema |
|---|---|---|
| 91 | Vía o camino bloqueado | **Desactiva rutas terrestres afectadas** |
| 92 | Puente o paso fluvial | **Desactiva rutas fluviales afectadas** |
| 93 | Vivienda afectada o destruida | Anticipa necesidad de albergue |
| 94 | Acueducto, pozo o bocatoma | Anticipa necesidad de agua (12, 44) |
| 95 | Escuela o puesto de salud | Señal de impacto en servicios |
| 96 | Cultivo o medio de vida | Señal de impacto económico |

**Cierra el bucle con el grafo de rutas.** Un reporte 91 verificado marca `rutas.activa = false` en
los tramos afectados, y el despachador deja de proponer envíos por un camino que ya no existe. Sin
esto el sistema planifica entregas imposibles y el transportista se entera al llegar.

**Es alerta temprana.** Tres daños en un mismo agrupador dentro de 48 horas es un evento, no tres
incidentes. Amerita alerta antes de que lleguen las solicitudes de ayuda — que llegan después,
cuando ya se agotó lo que había en casa.

**Da contexto.** Un pedido de agua tras un reporte 94 en la misma comunidad se explica solo.

**La foto aquí sí es segura y sí es útil**: es infraestructura, no un hogar. Aun así, **quitar EXIF
igual**, porque puede traer GPS.

| | Necesidad | Daño |
|---|---|---|
| Magnitud | Familias afectadas | Severidad 1–3 |
| Estado final | `ENTREGADO` | `VERIFICADO` o `RESUELTO` |
| Entra a envíos | Sí | No |
| Foto | Opcional, riesgo de privacidad | Recomendada, bajo riesgo |
| Efecto secundario | — | **Puede desactivar rutas** |

**Regla:** la desactivación de rutas la hace una persona, no el reporte. El daño llega, el
coordinador lo verifica, y ahí se desactiva el tramo. Un solo reporte falso o exagerado no puede
paralizar la logística de una cuenca.

---

## 4. Interfaz por canal

### 4.1 Tier 1 — WhatsApp, mensaje de lista

Tres botones no alcanzan para seis familias. Se usa **mensaje de lista**: un botón que abre una
hoja con secciones y hasta diez filas.

```
Bot:  ¿Qué necesita la comunidad?
      [ Ver opciones ]                    ← abre la lista

Lista: ── Alimentos y agua ──
       Mercado, alimentos secos        11
       Agua potable                    12
       Alimentación infantil           13
       ── Salud ──
       Medicamento general             21
       Medicamento crónico             22
       Atención médica o traslado      23
       ── Abrigo y albergue ──
       Cobijas, hamacas                31
       Plásticos, tejas                33
       ── Otro ──
       Ver más opciones                 0
       Reportar un daño                 9
```

Diez filas es el tope de la plataforma. La fila `0` reabre la lista con las familias que no
cupieron. **El código va visible en cada fila**: así la gente aprende los códigos por uso, y el día
que se queda sin datos ya sabe qué mandar por SMS.

**El audio es entrada de primera clase**, no un caso borde. La gente ya manda notas de voz; pelear
contra eso es perder.

```
Nota de voz de 30 seg
  → webhook con media_id
  → descargar YA (la URL del proveedor expira en minutos)
  → subir a almacenamiento propio, guardar la clave (nunca la URL del proveedor)
  → transcribir
  → un extractor PROPONE código / familias / urgencia
  → queda en RECIBIDO
  → una persona verifica antes de que entre a la cola
```

El extractor nunca autoverifica. Puede ser regex al principio.

**Pin de ubicación:** el mensaje tipo `location` trae lat/lng directo. Si no llega pin, se hereda la
ubicación de la comunidad. Un reporte nunca se bloquea por falta de coordenadas.

**Fotos:** comprimir en el servidor y **eliminar EXIF siempre**.

**Restricción de plataforma:** fuera de la ventana de 24 horas solo se puede escribir con plantillas
pre-aprobadas. Enviarlas a aprobación desde el día uno — el trámite tarda y bloquea todo el flujo
de notificaciones.

### 4.2 Tier 2 — SMS, con la tarjeta impresa como parte de la interfaz

```
  RED DE AYUDA  ·  Envíe al 8 5 0 0 0
  Formato:  CÓDIGO  FAMILIAS  URGENCIA

  1 ALIMENTOS Y AGUA        4 HIGIENE
    11 mercado                41 aseo personal
    12 agua potable           42 pañales
    13 leche, papilla         43 salud menstrual
                              44 tratar agua
  2 SALUD
    21 medicamento          5 NIÑEZ
    22 medicina crónica       51 ropa
    23 médico urgente         52 kit escolar
    24 curación
                            9 REPORTAR DAÑO
  3 ABRIGO                    91 vía bloqueada
    31 cobijas, hamacas       92 puente, paso
    32 colchonetas            93 vivienda
    33 plásticos, tejas       94 acueducto
    34 olla, platos           95 escuela, salud

  EJEMPLO:  22 12 3
  (medicina crónica · 12 familias · urgente)

  DAÑO:     91 2
  (vía bloqueada · severidad media)

  Su código de comunidad:  ______
```

El parser detecta el tipo por el primer dígito: `9` es daño, y entonces el segundo número es
severidad, no familias. Acepta separadores flexibles. Si no entiende, responde con el ejemplo —
nunca con un error técnico. Para `22` contesta pidiendo el detalle en un segundo SMS.

La tarjeta plastificada es parte del producto. Presupuestar impresión y distribución.

### 4.3 Tier 2 y 3 — IVR por llamada perdida

El único canal que funciona con cero saldo y teléfono básico. También el único que sirve para
personas que no leen.

```
1. La persona marca y cuelga            → costo para ella: CERO
2. Webhook: rechazar sin contestar      → registrar 'perdida_entrante'
3. Verificar topes anti-abuso           → encolar
4. El sistema devuelve la llamada       → nosotros pagamos el minuto
5. IVR: menú de tonos + grabación libre
6. Descargar, transcribir, crear reporte
7. Dictar el folio en voz alta y colgar
```

Rechazar la llamada (no contestar y colgar) evita que se conecte: no se le cobra a quien llama.

```
Nivel 1   1 · Pedir ayuda
          2 · Confirmar una entrega
          3 · Reportar un daño
          0 · Hablar con una persona

Nivel 2   (tras 1)              (tras 3)
          1 · Alimentos, agua   1 · Vía o puente
          2 · Salud             2 · Vivienda
          3 · Abrigo, albergue  3 · Agua, acueducto
          4 · Otra cosa         4 · Otra cosa

Nivel 3   (tras 1>2 Salud)
          1 · Medicamento general
          2 · Medicina crónica  → graba y pide el nombre
          3 · Médico urgente    → urgencia 3, alerta inmediata
          4 · Otra cosa         → graba libre

Cierre    "¿Cuántas familias? Marque el número y luego numeral."
          "Después del tono, diga su comunidad y cualquier detalle."
          [grabación de 60 segundos]
          "Recibido. Su reporte es el número 4. 7. 2."
```

**"Otra cosa" siempre existe** en cada nivel y siempre lleva a grabación libre. Es la válvula de
escape: quien no encuentra su caso habla, y una persona clasifica después. En la práctica esa
opción recoge lo que el catálogo no previó, y es la mejor fuente para saber qué agregar.

**El `0` a persona está en todos los niveles**, no solo en el primero. Nunca dejar a alguien
atrapado en el menú.

**Topes desde el día uno, no como optimización posterior:** máximo 2 devoluciones por número cada
30 minutos, máximo 5 por día, tope global de minutos diarios con apagado automático, y alerta al
coordinador al 70% del tope.

Guardar la ruta tecleada. Si muchos abandonan en el mismo paso, ese prompt está mal grabado.
Grabar los prompts con voz local: con tres niveles la síntesis de voz cansa y la gente cuelga.

### 4.4 Tier 3 y 4 — lotes, radio y papel

Formularios offline que encolan y sincronizan al llegar a cobertura. **No construir esto**:
KoboToolbox y ODK Collect ya lo resuelven, corren en Android barato y son estándar en trabajo
humanitario. Se integran por API.

Para tier 4: bitácora escrita en la estación receptora, digitada una vez al día con `canal='radio'`.
Lento, pero es la diferencia entre que una comunidad exista en el sistema o no.

### 4.5 Panel del coordinador — la única interfaz rica

**Cola, no mapa.** El mapa responde "dónde"; la pregunta real es "qué lleva más tiempo esperando y
todavía cabe en el envío del jueves". Orden primario: urgencia y días de espera.

**Bandeja de audio.** Notas de voz sin verificar, con transcripción al lado, reproducibles, con
botones de verificar / corregir / marcar duplicado. Este es el trabajo diario real.

**Alerta de silencio.** Comunidades que pasaron su intervalo esperado sin reportar. El silencio es
una señal, no una ausencia de necesidad.

**Filtro por tipo** — necesidades, daños, todo. Los daños se muestran aparte, con su foto y un
botón de "desactivar ruta afectada" que pide confirmación y registra quién lo hizo.

**Alerta de agrupación:** tres o más daños en el mismo agrupador dentro de 48 horas.

**Ítems con `pide_detalle` sin detalle** se marcan incompletos y no entran a la cola hasta que
alguien complete o descarte. **Ítems con `entregable = false`** van a una lista de derivación
separada.

Mostrar siempre el canal de origen: si un reporte llegó por IVR, el coordinador necesita saber de
inmediato que esa persona no tiene saldo y no se le puede escribir gratis.

---

## 5. Ciclo de vida — dos velocidades

El ciclo actual (reservar, 2 horas, entregar) es correcto para tier 1 y no aplica más abajo. Donde
el transporte es programado, la unidad atómica no es "un voluntario toma una necesidad" sino "un
vehículo sale el jueves con combustible presupuestado y capacidad limitada".

```
Tier 1:   RECIBIDO → VERIFICADO → RESERVADO → EN_TRANSITO → ENTREGADO
                                  (ventana en horas)

Tier 2-4: RECIBIDO → VERIFICADO → EN_COLA → ASIGNADO → DESPACHADO → ENTREGADO
                                  (ventana en semanas, agrupado en un envío)

Daños:    RECIBIDO → VERIFICADO → RESUELTO
```

Mismos estados iniciales, distinta ruta intermedia. La ventana se deriva del tier, no se codifica
en la lógica.

Agregar `CANCELADO` y `DUPLICADO` en todas las rutas. Sin ellos la única salida es "entregado", y
la gente marcará como entregadas cosas que nunca se entregaron.

**Verificación sin ancho de banda:** un código de 4 dígitos generado al despachar, impreso en el
manifiesto. Quien recibe lo manda por SMS, lo dicta por IVR o lo lee por radio. No requiere datos,
ni cámara, ni señal en el momento de la entrega. Se concilia después.

---

## 6. Quién administra, y qué se automatiza

Tres funciones distintas. **No pueden vivir en el mismo usuario**, y no principalmente por carga de
trabajo.

| Función | Quién | Dónde |
|---|---|---|
| **Verificación** | Persona local que conoce el territorio y reconoce las voces | En zona, remunerada |
| **Despacho** | Quien controla el presupuesto de transporte | Organización operadora |
| **Plataforma** | Despliegues, llaves, topes, base de datos | Equipo técnico, remoto |

Quien tenga acceso total tiene una base de hogares vulnerables con coordenadas exactas más un
calendario de cuándo se mueven los vehículos. En territorios con presencia de actores armados eso
es un activo de seguridad. Concentrarlo en un solo login es la decisión más riesgosa disponible.

| Automático | Humano |
|---|---|
| Ingesta, deduplicación, idempotencia | Verificar que un reporte es real |
| Transcripción y extracción propuesta | Priorizar bajo escasez |
| Cálculo de rutas y costos, **propuestas** de envío | Comprometer combustible y despachar |
| Vencimientos, alertas de silencio, topes de gasto | Decidir a quién se posterga |
| Agregación pública y exportes a coordinación | Detectar un reporte hecho bajo presión |
| — | **Desactivar una ruta por daño reportado** |

**Automatizar la aritmética, no el juicio.** El sistema calcula que once reportes caben en un envío
con cierto costo y lo presenta como propuesta. Una persona confirma.

Bajo escasez, lo que ordena la cola está decidiendo quién espera. Una comunidad acepta una decisión
dura cuando sabe quién la tomó y puede reclamarle. "El sistema lo decidió" no es una respuesta que
alguien pueda controvertir, y cuesta la red de reportantes la primera vez que produce un resultado
evidentemente equivocado.

Además: una regla automática publicada se aprende en semanas y todo pasa a ser urgencia 3. Una
persona nota el patrón y ajusta.

**El costo que casi siempre se subestima:** la verificación es un puesto remunerado, no trabajo
voluntario sobrante. Estos sistemas mueren cuando la cola de verificación supera a la persona: se
atrasa, los reportantes dejan de recibir respuesta, y el reporte se detiene. La falla se ve como
"no hay necesidades reportadas" — indistinguible del éxito en un tablero.

Instrumentar desde el día uno: **mediana de tiempo de RECIBIDO a VERIFICADO**. Si pasa de 24 horas,
falta una persona, no falta automatización.

---

## 7. Esquema de datos

SQL genérico; adaptarlo al ORM y al sistema de migraciones que ya usen.

> `text` + `check` en lugar de `enum` de Postgres: agregar un valor a un enum en producción es
> doloroso; a un check constraint no.

### 7.1 Comunidades

La unidad deja de ser el individuo. Un reporte cubre "42 familias en la vereda X", no 42 registros.
Reduce el problema de 30.000 contactos a 300 confiables, y coincide con cómo estas comunidades ya
se organizan.

```sql
create table comunidades (
    id                     uuid primary key default gen_random_uuid(),
    codigo                 text unique not null,   -- va impreso en la tarjeta
    nombre                 text not null,
    tipo                   text not null,          -- vereda, corregimiento, resguardo...
    municipio              text not null,
    agrupador              text,                   -- cuenca, subregión: el agrupador operativo
    ubicacion              geometry(Point,4326) not null,
    familias_estimadas     int,
    tier_conectividad      smallint not null check (tier_conectividad between 1 and 4),
    intervalo_chequeo_dias int,                    -- alimenta la alerta de silencio
    organizacion_aliada    text,
    activa                 boolean not null default true,
    creado_en              timestamptz not null default now()
);
create index idx_comunidades_ubicacion on comunidades using gist (ubicacion);
```

### 7.2 Catálogo configurable

```sql
create table catalogo_items (
    codigo        char(2) primary key,        -- '31'
    familia       char(1) not null,           -- '3'
    familia_label text not null,              -- 'Abrigo y albergue'
    item_label    text not null,              -- 'Cobijas, hamacas, toldillos'
    tipo          text not null default 'necesidad' check (tipo in ('necesidad','dano')),
    ayuda_texto   text,                       -- lo que dice el bot al elegirlo
    pide_detalle  boolean not null default false,  -- fuerza texto o voz (ej. 22)
    urgencia_min  smallint,                   -- ej. 23 => 3
    entregable    boolean not null default true,   -- false para 53
    orden         int not null,
    activo        boolean not null default true
);
```

### 7.3 Reportes (era `necesidades`)

```sql
create table reportes (
    id               uuid primary key default gen_random_uuid(),
    folio            serial unique,          -- corto, para dictarlo por teléfono
    tipo             text not null default 'necesidad' check (tipo in ('necesidad','dano')),
    canal            text not null,          -- whatsapp, sms, ivr, kobo, radio, papel, web
    contacto_id      uuid references contactos(id),
    comunidad_id     uuid not null references comunidades(id),

    codigo_item      char(2) references catalogo_items(codigo),
    familias         int,                    -- necesidades
    urgencia         smallint check (urgencia between 1 and 3),
    severidad        smallint check (severidad between 1 and 3),   -- daños
    detalle_libre    text,                   -- ítems con pide_detalle
    descripcion      text,
    afecta_ruta_id   uuid references rutas(id),

    ubicacion        geometry(Point,4326),   -- null => se usa la de la comunidad
    ubicacion_fuente text,                   -- pin_whatsapp, comunidad, declarada, manual

    estado           text not null default 'RECIBIDO',
    motivo_cierre    text,
    verificado_por   uuid references contactos(id),
    verificado_en    timestamptz,
    reporte_padre_id uuid references reportes(id),   -- si es DUPLICADO

    payload_crudo    jsonb,                  -- lo que llegó tal cual; salva vidas al depurar
    creado_en        timestamptz not null default now(),
    actualizado_en   timestamptz not null default now()
);

create index idx_reportes_cola on reportes(tipo, estado, urgencia desc, creado_en);
```

> `familias` queda nulo en daños y `severidad` en necesidades. Es una tabla con columnas opcionales
> según el tipo — aceptable a esta escala, y mucho más simple que dos tablas paralelas con dos
> colas y dos secuencias de folio. Si el volumen de daños crece, se separa después.

### 7.4 Adjuntos

```sql
create table adjuntos (
    id            uuid primary key default gen_random_uuid(),
    reporte_id    uuid references reportes(id) on delete cascade,
    entrega_id    uuid,
    tipo          text not null,            -- audio, foto, firma, documento
    storage_key   text not null,            -- clave propia, NUNCA la URL del proveedor
    mime          text,
    bytes         int,
    duracion_seg  int,
    hash_sha256   text,
    transcripcion text,
    transcripcion_confianza numeric(3,2),
    exif_removido boolean not null default false,
    creado_en     timestamptz not null default now()
);
```

### 7.5 Resto de tablas

Resumen de propósito; el detalle de columnas se ajusta al ORM.

- **`contactos`** — teléfono en E.164, rol (`reportante`, `verificador`, `transportista`,
  `coordinador`), comunidad, canal preferido, idioma, último contacto.
- **`envios`** — modo de transporte, responsable, salida programada, capacidad, costo de
  combustible, estado. La unidad de despacho para tier 2-4.
- **`envio_items`** — relación envío ↔ reportes, con familias asignadas y orden de parada.
- **`entregas`** — código de confirmación de 4 dígitos, canal de confirmación, familias atendidas.
- **`mensajes`** — bitácora de entrada y salida con **índice único sobre el id del proveedor**.
  Esta es la tabla de idempotencia. No es opcional.
- **`llamadas`** — perdidas y devoluciones, con costo y ruta tecleada. Sostiene los topes de gasto.
- **`rutas`** — grafo origen-destino con modo, minutos y costo. Un radio de 5 km en línea recta no
  significa nada cuando el camino real es fluvial o de trocha. El mismo par puede tener filas
  distintas según temporada. **Un daño verificado desactiva filas de esta tabla.**

### 7.6 Vista pública — agregada por diseño

```sql
create view mapa_publico as
select c.municipio, c.agrupador, ci.familia_label,
       count(*) filter (where r.estado in ('VERIFICADO','EN_COLA','ASIGNADO')) as pendientes,
       count(*) filter (where r.estado = 'ENTREGADO')                          as atendidos,
       st_centroid(st_collect(c.ubicacion))                                    as centroide
from reportes r
join comunidades c    on c.id = r.comunidad_id
join catalogo_items ci on ci.codigo = r.codigo_item
where r.tipo = 'necesidad'
group by c.municipio, c.agrupador, ci.familia_label;
```

Nada público consulta las tablas base. Coordenadas exactas, teléfonos y nombres solo detrás de
autenticación, y solo para el transportista asignado durante su ventana.

Un mapa en vivo que muestra qué hogares son vulnerables, más quién se mueve hacia ellos y cuándo,
es información de targeting en cualquier territorio con presencia armada. La restricción se
implementa como estructura, no como una regla que alguien tenga que recordar.

---

## 8. Orden de construcción

| Fase | Entregable | Qué habilita |
|---|---|---|
| 1 | `comunidades`, `catalogo_items`, `tier_conectividad`; el manejador actual pasa a adaptador | Base para todo; nada se rompe |
| 2 | Idempotencia y bitácora de mensajes | Confiabilidad de lo que ya existe |
| 3 | Audio: descarga, almacenamiento, transcripción, bandeja de verificación | Tier 1 mucho más usable |
| 4 | Panel: cola, verificación, alerta de silencio, vista de daños | Operación real con roles separados |
| 5 | Adaptador SMS + tarjetas impresas | **Tier 2 entra al sistema** |
| 6 | Envíos, manifiesto, código de confirmación | Ciclo completo para transporte programado |
| 7 | IVR con devolución de llamada | **Tier 2 y 3 sin saldo** |
| 8 | Grafo de rutas, formularios offline, relevo por radio | Tier 4 |

Las fases 1 y 2 mejoran lo que ya tienen sin agregar canales. La fase 5 es donde empieza a aumentar
el alcance de verdad.

**Lo que no debe bloquear la v1:** USSD (`*XXX#`) es el mejor canal de texto sin costo para el
usuario, pero requiere acuerdos con cada operador que tardan meses. Iniciar esa conversación en
paralelo; construir sin eso.

---

## 9. Coordinación externa

En zonas rurales normalmente ya operan estructuras de coordinación: diócesis, consejos comunitarios,
organizaciones locales, clústeres humanitarios. Un sistema paralelo que no les entrega datos genera
duplicación y, peor, la falsa confianza de que una necesidad quedó cubierta.

Diseñar esto como capa de datos que se conecta a la coordinación existente, no como plataforma
independiente. En la práctica: un export periódico en el formato que ya usan, y el campo
`organizacion_aliada` para filtrar por quién responde qué.

Donde hay consejos comunitarios o resguardos con autoridad territorial reconocida, corresponde que
administren los datos de sus propios territorios y tengan voz sobre qué expone la vista pública.
No es solo lo correcto: es lo que hace que la red de reportantes siga contestando.

---

## 10. Cómo podemos aportar

Nos interesa que esto llegue más lejos de donde llega hoy, y estamos dispuestos a poner trabajo, no
solo documentos.

- **Programar con ustedes.** Podemos tomar módulos concretos y entregarlos integrados a su código:
  la capa de adaptadores, el pipeline de audio y transcripción, el IVR con devolución de llamada, o
  el panel del coordinador. En su stack, no en uno nuevo.
- **Las migraciones de esquema**, escritas contra su base actual y probadas, para que el paso a
  `reportes` + `comunidades` + `catalogo_items` no interrumpa la operación existente.
- **El diseño de los canales de baja conectividad**: guiones de IVR, parser de SMS, diseño de la
  tarjeta impresa, y los topes de gasto que evitan que el canal de voz se vuelva insostenible.
- **Llevarlo a territorios más difíciles**, apoyando el registro de comunidades, el pilotaje de los
  canales sin datos, y la coordinación con las organizaciones que ya operan allá.

El siguiente paso natural es una sesión técnica sobre el repositorio para decidir qué módulo se
toma primero. El *Plan de ejecución* que acompaña este documento detalla permisos, costos y rutas.
