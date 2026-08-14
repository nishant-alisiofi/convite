# Red de Ayuda — Plan de ejecución
## Canal existente, permisos, costos, esfuerzo y rutas

Acompaña a la *Especificación técnica*. Aquí está lo que hay que tramitar, cuánto cuesta operar,
de dónde puede salir el dinero, y por qué rutas se puede llegar.

> **Verificar antes de comprometer presupuesto.** Las tarifas de mensajería cambian por trimestre y
> por país. Todo número aquí es orden de magnitud para planear, no cotización.

---

## 1. ¿Se usa el canal de WhatsApp que ya existe?

Depende de qué estén corriendo hoy, y la respuesta cambia por completo entre los tres casos.
**Esta es la primera pregunta a resolver, porque uno de los tres escenarios no es integración sino
migración.**

### Escenario A — API oficial de Meta (Cloud API), con cuenta verificada

**Sí, se reutiliza todo.** Es el mejor caso.

- La cuenta de WhatsApp Business, la verificación de negocio y el nombre a mostrar ya están.
- El manejador actual pasa a ser el **adaptador de WhatsApp**. No se reescribe: se le agrega la
  traducción al evento canónico y la verificación de idempotencia.
- Las plantillas nuevas se envían a aprobación bajo la misma cuenta.
- **Un mismo número atiende Pereira y las zonas rurales.** El ruteo lo hace el tier de la comunidad,
  no la línea telefónica.

Trabajo: **días**.

### Escenario B — A través de un proveedor intermediario (BSP)

Twilio, 360dialog, Wati, Gupshup o similar. **También se reutiliza**, con dos matices.

- El adaptador se escribe contra el formato del BSP, no contra el de Meta. Funciona igual, pero el
  payload y los ids de mensaje son distintos — importa para la idempotencia.
- El BSP cobra un margen sobre las tarifas de Meta. **No migrar ahora**: es optimización posterior,
  no requisito.

Trabajo: **días**.

### Escenario C — Librería no oficial

Baileys, whatsapp-web.js, WPPConnect, o cualquier automatización sobre WhatsApp Web o un número
personal. **Aquí sí hay que migrar, y conviene decirlo claro.**

1. **No hay mensajes proactivos.** Fuera de la ventana de 24 horas la API oficial exige plantillas
   aprobadas; las librerías no oficiales no tienen ese mecanismo. Todo el flujo de avisos —alertar a
   un transportista, romper el silencio de una comunidad tier 3, pedir confirmación de entrega—
   **no se puede construir** sobre esa base.
2. **El número se puede bloquear en cualquier momento**, sin aviso ni apelación. Perder el número es
   perder el canal y la confianza de la red de reportantes a la vez.
3. Viola los términos de servicio, lo cual es un problema aparte cuando hay entidad legal y
   financiadores de por medio.

La migración no es catastrófica —el flujo conversacional se conserva casi igual— pero **agrega toda
la cadena de trámites de la sección 3 al camino crítico**.

Trabajo: **semanas**, mayormente de espera administrativa.

### Lo que hay que averiguar

- ¿Qué librería o SDK aparece en el archivo de dependencias?
- ¿Existe ya una cuenta de Meta Business verificada, y a nombre de qué entidad?
- ¿El número actual es de la organización o el celular de alguien?

Esa última pregunta importa más de lo que parece. **Quien es dueño del número es dueño del canal.**
Si está a nombre de una persona, hay que trasladarlo a la entidad antes de que el sistema crezca.

---

## 2. La entidad legal es el desbloqueador

Casi todo lo demás depende de esto, y es el trámite más lento.

- **Meta** exige verificación de negocio con documentos de una entidad legalmente constituida. Sin
  eso no hay API de WhatsApp en producción.
- **Los programas de crédito para organizaciones sociales** exigen sin excepción entidad registrada.
- **Los números telefónicos en Colombia** requieren paquete regulatorio con identidad y dirección
  verificable.

**Si el equipo hoy es informal, ese es el bloqueo real, no el código.**

| | Padrinazgo fiscal | Entidad propia |
|---|---|---|
| Tiempo | Días a semanas | Semanas a meses |
| Costo | Bajo o nulo | Notaría, cámara, contabilidad |
| Autonomía | Limitada; decide el padrino | Total |
| Créditos y donaciones | Sí, a nombre del padrino | Sí, propios |
| Coordinación local | **Ya resuelta** si el padrino opera en zona | Hay que construirla |

**Padrinazgo para el piloto; entidad propia si el proyecto se sostiene.** Un padrino que ya opera
en el territorio resuelve simultáneamente la personería jurídica y el acceso comunitario, que son
los dos cuellos de botella no técnicos.

---

## 3. Escalera de permisos

Ordenada por tiempo de trámite. Empezar los lentos hoy.

### 3.1 Meta / WhatsApp Business Platform — semanas

| Paso | Qué implica | Tiempo típico |
|---|---|---|
| Cuenta de Meta Business | Gratis, inmediato | Horas |
| **Verificación de negocio** | Documentos legales de la entidad | 1–3 semanas, con rechazos |
| Cuenta de WhatsApp Business | Ligada a la entidad verificada | Días |
| Número telefónico | **No puede estar registrado en WhatsApp de consumidor** | Inmediato si está limpio |
| Aprobación del nombre a mostrar | Debe corresponder a la entidad real | Días |
| **Aprobación de plantillas** | Una por una, con rechazos frecuentes | Días por plantilla |
| Subida de nivel de mensajería | Empieza limitado; sube con volumen y calidad | Semanas de operación |

**Dos trampas concretas.** El número no puede tener WhatsApp de consumidor instalado; si alguien ya
lo usó en su celular, hay que borrar esa cuenta primero y no se recupera. Y los límites de
mensajería arrancan bajos y suben según volumen y calificación de calidad — un piloto de 300
comunidades no toca el techo, pero conviene saber que existe antes de prometer escala.

**Plantillas a enviar a aprobación desde el día uno.** Todas categoría *utility*, nunca *marketing*
— la diferencia de precio es de un orden de magnitud:

- `reporte_recibido` — confirmación con folio
- `envio_programado` — aviso al transportista
- `entrega_pendiente` — solicitud de confirmación con código
- `chequeo_periodico` — el que rompe el silencio en comunidades tier 2 y 3
- `dano_verificado` — aviso de ruta desactivada a transportistas afectados

### 3.2 Proveedor de voz y SMS — días a semanas

Cuenta, método de pago, y **paquete regulatorio para números colombianos**. Se necesitan dos
números: uno de voz para el IVR, uno de SMS.

### 3.3 Código corto de SMS y USSD — meses

Requiere acuerdos con cada operador (Claro, Movistar, Tigo, WOM), con costos de establecimiento y
mensualidad. **No debe bloquear la v1**: arrancar con número largo normal — funciona igual, solo es
un número de diez dígitos en la tarjeta en vez de cinco.

### 3.4 Protección de datos — obligatorio, y frecuentemente ignorado

Colombia: **Ley 1581 de 2012** (habeas data). Aplica de lleno.

- Registro de bases de datos ante la **SIC** según el tamaño de la entidad.
- **Autorización previa, expresa e informada** de cada titular: mensaje de consentimiento en el
  flujo de WhatsApp y casilla firmada en el registro de comunidades.
- Datos de salud y de pertenencia étnica son **datos sensibles** con protección reforzada. Un
  reporte de "medicamento crónico para 12 familias" ligado a un teléfono roza esa categoría.
- Política de tratamiento publicada, y un canal para ejercer derechos.

No es cosmético. También es lo que permite decir con seriedad, ante una comunidad o una ONG socia,
quién ve qué.

### 3.5 Permisos que no son trámites

Acceso territorial en zonas con consejos comunitarios o resguardos no se pide a una autoridad
central: se acuerda con las autoridades étnicas, que tienen jurisdicción reconocida. Es
relacionamiento, no un formulario, y toma su tiempo.

---

## 4. Costos de operación

### 4.1 WhatsApp — el cambio que importa

Se cobra por mensaje de plantilla entregado, según país y categoría. Las respuestas dentro de la
ventana de servicio de 24 horas han sido gratuitas.

**Meta comienza a cobrar los mensajes de servicio el 1 de octubre de 2026**, a la misma tarifa que
utility y authentication en cada país. Las tarifas exactas se publican antes del 1 de septiembre.

Implicaciones directas:

- El diseño "que el usuario escriba primero y todo lo demás es gratis" deja de funcionar. Cada
  respuesta del bot pasa a costar. Conviene **acortar los flujos** y aceptar más entrada libre por
  voz — una nota de voz reemplaza tres o cuatro intercambios de menú.
- **SMS e IVR se vuelven relativamente más atractivos.** Vale recalcular cuál canal es más barato
  por reporte una vez publicadas las tarifas de octubre.
- El presupuesto debe asumir mensajes de servicio pagos desde el arranque.

Categoría *utility* cuesta un orden de magnitud menos que *marketing*. Todas nuestras plantillas son
utility. Que ninguna se clasifique mal.

### 4.2 Voz — el renglón que se dispara

La devolución de llamada es gratis para quien reporta y la pagamos nosotros. Es el costo unitario
más alto y el más fácil de disparar por accidente o por abuso. Controles obligatorios desde el día
uno: 2 devoluciones por número cada 30 minutos, 5 por día, tope global de minutos con apagado
automático, y alerta al 70% del tope.

### 4.3 Forma del costo mensual — piloto de ~300 comunidades

| Concepto | Peso relativo |
|---|---|
| Voz (devoluciones de llamada) | **El más grande, y el más variable** |
| SMS entrantes y salientes | Medio |
| Plantillas y mensajes de servicio de WhatsApp | Medio, creciente desde octubre |
| Base de datos y hosting | Bajo y estable |
| Transcripción de audio | Bajo |
| Números telefónicos | Bajo y fijo |

Orden de magnitud: **cientos de dólares al mes, no miles**, siempre que los topes de voz estén
puestos. Sin topes, el renglón de voz solo tiene techo cuando se acaba el saldo.

### 4.4 Los costos que no aparecen en ninguna factura de API

Y que dominan el total real:

- **El salario de quien verifica.** Es un puesto, no trabajo voluntario sobrante. Si la cola de
  verificación supera a la persona, el sistema muere y el tablero muestra "sin necesidades
  reportadas".
- **Impresión y distribución de las tarjetas**, incluido el viaje para entregarlas.
- **Grabación de los prompts de IVR** con voz local, en cada idioma.
- **El combustible.** Ninguna plataforma entrega nada. El sistema hace visible una escasez que sigue
  existiendo.

---

## 5. Créditos y financiación

### Lo que existe y aplica

**Twilio.org Impact Access Program.** Descuentos y un crédito único de USD 100 al ingresar, para
organizaciones sin ánimo de lucro con designación 501(c)(3) o equivalente internacional, empresas
sociales y otras entidades. **El descuento continuo sobre voz y mensajería vale más que el crédito
inicial**, porque el renglón de voz es el que domina. Se aplica desde la consola; algunos tipos de
entidad se verifican al instante, el resto sube documentación y recibe respuesta en unos días
hábiles. Conviene aplicar antes de empezar a gastar.

**Twilio.org Impact Fund.** Donaciones e inversión para transformación digital, asistencia
humanitaria y acción climática. También existe una modalidad donde Twilio.org selecciona un socio
tecnológico y financia el diseño o la implementación. Relevante si el proyecto crece más allá del
piloto.

**Créditos de nube.** Los tres grandes proveedores tienen programas para organizaciones sociales con
créditos anuales. Cubren cómodamente la base de datos y el hosting de un piloto de este tamaño.

**Google for Nonprofits.** Workspace sin costo y crédito publicitario. No cubre lo técnico, pero sí
la operación de la organización.

### Lo que no existe

**No hay descuento de Meta para organizaciones sin ánimo de lucro en la API de WhatsApp.** Las
tarifas son iguales para todos. El ahorro viene del diseño: flujos cortos, plantillas utility, y no
mandar lo que no hace falta.

### El requisito común

Todos piden entidad registrada. **La constitución legal, o el padrinazgo fiscal, desbloquea todo lo
demás.**

---

## 6. Inventario de trabajo

### 6.1 Técnico

| # | Módulo | Esfuerzo | Depende de |
|---|---|---|---|
| T1 | Esquema, `comunidades`, `catalogo_items`, migración desde `necesidades` | 2–3 sem | — |
| T2 | Capa de adaptadores + idempotencia + parser de códigos | 2 sem | T1 |
| T3 | Pipeline de audio: descarga, almacenamiento, transcripción | 1–2 sem | T1, T2 |
| T4 | Panel: cola, bandeja de audio, silencio, vista de daños | 2–3 sem | T1 |
| T5 | Adaptador SMS + tarjeta impresa | 1 sem | T2 |
| T6 | Envíos, manifiesto, códigos de confirmación | 2 sem | T1 |
| T7 | IVR con devolución de llamada + topes de gasto | 2–3 sem | T2, T3 |
| T8 | Roles y políticas de acceso por fila | 1 sem | T1, T4 |

**Total: 13–18 semanas-persona.** Con un desarrollador de tiempo completo, entre tres y cuatro
meses. Con dos, entre seis y ocho semanas para el grueso. Son estimaciones para un equipo que ya
conoce su propio código.

### 6.2 No técnico — y esto suele ser el camino crítico

| # | Frente | Tiempo | Se puede empezar |
|---|---|---|---|
| N1 | Entidad legal o padrinazgo fiscal | Semanas a meses | **Hoy** |
| N2 | Verificación de negocio en Meta | 1–3 semanas | Tras N1 |
| N3 | Aprobación de plantillas | Días por plantilla | Tras N2 |
| N4 | Números y paquete regulatorio | Días | Tras N1 |
| N5 | Ley 1581: registro, política, consentimientos | Semanas | **Hoy** |
| N6 | Registro de comunidades y reclutamiento de reportantes | Continuo | **Hoy** |
| N7 | Diseño, impresión y distribución de tarjetas | Semanas | Tras definir catálogo |
| N8 | Grabación de prompts de IVR con voz local | Días | Tras guiones |
| N9 | Contratación del verificador | Semanas | Tras N1 |

**N1 bloquea N2, N3, N4 y N9.** Es el único trámite del que cuelga casi todo lo demás, y el más
lento.

**El código no está bloqueado por nada de esto.** T1 a T4 se construyen y se prueban con un
adaptador falso que inyecta reportes de prueba, sin enviar un solo mensaje real y sin ningún permiso
otorgado. Esa es la razón para arrancar los trámites hoy y programar durante la espera.

### 6.3 Personas necesarias

| Rol | Dedicación en piloto | Remoto |
|---|---|---|
| Desarrollador backend | Tiempo completo | Sí |
| Frontend (panel) | Medio tiempo | Sí |
| Coordinación de campo y relacionamiento | Medio tiempo | No |
| **Verificador** | Medio tiempo, **remunerado** | Debe conocer el territorio |
| Apoyo legal (habeas data) | Puntual | Sí |

El verificador aparece en la lista de personal, no en la de voluntarios. Es la decisión de
presupuesto que determina si el sistema sobrevive al mes tres.

---

## 7. Rutas de alcance — cuánto construir

**Alcance 1 · Consolidar lo que existe.** T1, T2, T4, T8. Sin canales nuevos. El sistema actual
queda confiable, con roles separados y estructura de comunidades lista. Ninguna zona nueva entra
todavía. Elegirlo si hay usuarios reales que estabilizar antes de crecer.

**Alcance 2 · Alcance rural mínimo ← recomendado para el piloto.** Alcance 1 + T3 (audio) + T5
(SMS). **Entra el tier 2 completo**: comunidades con 2G intermitente y sin saldo pueden reportar por
SMS con tarjeta impresa. Se dejan fuera el IVR y los envíos programados — con dos comunidades
piloto, el despacho se maneja a mano. Es el punto donde el alcance aumenta de verdad, con el menor
trámite.

**Alcance 3 · Completo.** T1–T8, envíos programados, IVR, grafo de rutas, formularios offline.
Después de que el alcance 2 tenga tres meses de operación real y se sepa dónde falla.

---

## 8. Rutas de ejecución — quién construye

**Ruta A · El equipo de Pereira construye; nosotros especificamos y revisamos.**
A favor: una sola base de código, un solo dueño, todo el conocimiento queda en el equipo.
En contra: la más lenta; el IVR y los topes de gasto son fáciles de hacer mal, y los trámites
compiten con el tiempo de desarrollo del mismo equipo.

**Ruta B · Construcción conjunta por módulos ← recomendada.**
Ellos conservan lo que ya conocen: núcleo, panel, adaptador de WhatsApp. Nosotros tomamos módulos
completos y los entregamos integrados a su repositorio: capa de adaptadores, pipeline de audio, IVR
con topes, políticas de acceso.
A favor: la más rápida sin fragmentar el código; los módulos que tomamos son justamente los que
tienen más trampas.
En contra: exige acordar el contrato del evento canónico antes de empezar, acceso al repositorio, y
revisión conjunta.

**Ruta C · Implementación de referencia separada.**
A favor: cero dependencia de coordinación, arranque inmediato.
En contra: **riesgo alto de dos bases de código que nadie mantiene.** El territorio y las relaciones
son suyas; una plataforma paralela que ellos no operan no sobrevive al primer relevo de personal.
Solo si no hay capacidad de desarrollo de su lado y el proyecto necesita moverse igual.

---

## 9. Forma del calendario

Asumiendo alcance 2, ruta B, y que hoy no existe entidad constituida.

```
Mes 1   │ Trámites: entidad/padrinazgo · Ley 1581 · registro de comunidades
        │ Código: T1 esquema y catálogo · T2 adaptadores (con adaptador falso)
        │
Mes 2   │ Trámites: verificación Meta · números · plantillas a aprobación
        │ Código: T3 audio · T4 panel · T8 accesos
        │ Campo: guiones, diseño de tarjetas, contratación del verificador
        │
Mes 3   │ Trámites: aprobaciones llegando · impresión y distribución de tarjetas
        │ Código: T5 SMS · integración end to end
        │ Piloto: UNA comunidad tier 1 y UNA tier 2
        │
Mes 4+  │ Corregir lo que se rompió · ampliar comunidades por tandas
        │ Decidir sobre IVR y envíos programados con datos reales
```

**El mes 1 no tiene entregable visible** y es el más importante: es donde se destraba todo lo demás.
Conviene que quien financia lo sepa de antemano, o el proyecto parecerá estancado justo cuando va
bien.

**El piloto arranca con dos comunidades, no con treinta.** Las transcripciones malas, los prompts
confusos y las tarjetas mal impresas aparecen igual con dos, y cuestan mucho menos corregir.

---

## 10. Decisiones pendientes

En orden de urgencia. Ninguna necesita más análisis, solo respuesta:

1. **¿Qué está corriendo el WhatsApp actual?** Determina si el escenario es A, B o C — y el C
   agrega semanas al camino crítico.
2. **¿Hay entidad legal, o se busca padrino?** Bloquea casi todo lo no técnico.
3. **¿A nombre de quién está el número de WhatsApp?** Si es de una persona, hay que trasladarlo.
4. **¿Qué capacidad de desarrollo tiene el equipo hoy?** Define ruta A, B o C.
5. **¿Quién paga y quién verifica?** El presupuesto del verificador y del combustible tiene que
   existir antes de que se registre la primera comunidad. Sin eso, el sistema documenta necesidades
   que nadie va a atender — que es peor que no tener sistema.

Las cuatro primeras se responden en una llamada. La quinta define si esto se sostiene.

---

## 11. Lo que todavía falta escribir

1. **Roles y políticas de acceso por fila**, que traduzcan la separación de funciones de la
   especificación en permisos concretos de base de datos: qué ve el verificador, qué ve quien
   despacha, qué ve el transportista y durante cuánto tiempo.
2. **Textos de consentimiento y política de tratamiento de datos** conformes a la Ley 1581.
3. **Guiones completos de IVR** en español, listos para grabar.
4. **Migraciones concretas** contra el código existente — pendientes de ver el repositorio.

Podemos escribir cualquiera de los cuatro. El primero es el más urgente si el piloto va a manejar
datos reales de personas.

---

## 12. Qué necesitamos ver de su código

Para convertir esto en un plan concreto —migraciones en su sistema, no SQL genérico— necesitamos:

1. **Lenguaje, framework y si ya hay ORM con migraciones.**
2. **Qué está manejando WhatsApp hoy** (sección 1).
3. **Si ya hay cola de trabajos o cron.** El pipeline de audio y los vencimientos necesitan una.
4. **Dónde vive Postgres y si PostGIS está habilitado.** En algunos proveedores gestionados la
   extensión requiere solicitud.
5. **Qué tanto avanzó la versión actual.** Si `necesidades` ya tiene datos y el webhook funciona,
   esto es una migración, no un proyecto nuevo — y preferimos escribir la migración.

Con la estructura del repositorio y el archivo de dependencias es suficiente para empezar.
