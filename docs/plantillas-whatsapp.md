# Plantillas de WhatsApp — borradores para aprobación

Las cinco plantillas del *Plan de ejecución* §3.1, redactadas para enviar a aprobación el día que
exista la cuenta verificada (N2 → N3). La aprobación tarda días por plantilla y tiene rechazos
frecuentes: conviene tener los textos listos y enviarlos todos el día uno.

**Categoría `UTILITY` salvo la §6, que es `AUTHENTICATION`. Idioma `es_CO` (o `es`).** Nunca
`MARKETING` — cuesta un orden de magnitud más y estas plantillas son transaccionales por
naturaleza. Revisar la categoría asignada tras la aprobación: Meta a veces reclasifica.

Consejos para pasar la revisión: variables `{{n}}` siempre con ejemplo, texto concreto y
transaccional, sin promoción, sin URL acortadas.

---

## 1. `reporte_recibido`

> Confirmación con folio. Se envía al crear el reporte si la ventana de 24 h ya cerró.

```
Recibimos su reporte para la comunidad {{1}}.
Su número de folio es {{2}}.
Guárdelo para consultar o confirmar la entrega.
```

Ejemplos: `{{1}}` = "Bajo Jurado", `{{2}}` = "472".

## 2. `envio_programado`

> Aviso al transportista asignado.

```
Hay un envío programado para el {{1}} con destino {{2}}.
Paradas: {{3}}. Responda a este mensaje para confirmar disponibilidad.
```

Ejemplos: `{{1}}` = "jueves 21 de agosto", `{{2}}` = "cuenca del San Juan", `{{3}}` = "3".

## 3. `entrega_pendiente`

> Solicitud de confirmación con código de 4 dígitos.

```
¿Recibió la entrega del envío {{1}}?
Si la recibió, responda con el código de 4 dígitos que aparece en el manifiesto.
Si no ha llegado, responda NO.
```

Ejemplos: `{{1}}` = "E-118".

## 4. `chequeo_periodico`

> Rompe el silencio en comunidades tier 2 y 3 que pasaron su intervalo sin reportar.

```
Hola, es la Red de Ayuda. Hace {{1}} días no recibimos noticias de {{2}}.
¿Cómo están? Responda con una nota de voz o un mensaje, o con el código de lo que
necesiten. Si todo está bien, responda BIEN.
```

Ejemplos: `{{1}}` = "15", `{{2}}` = "la vereda La Playa".

## 5. `dano_verificado`

> Aviso de ruta desactivada a los transportistas afectados.

```
Aviso de ruta: {{1}} está {{2}} desde el {{3}}.
Los envíos por ese tramo quedan suspendidos hasta nuevo aviso.
Si tiene información nueva sobre el estado del paso, respóndanos por aquí.
```

Ejemplos: `{{1}}` = "el paso del río Munguidó", `{{2}}` = "bloqueado por derrumbe",
`{{3}}` = "12 de agosto".

---

## 6. `codigo_ingreso` — categoría `AUTHENTICATION`

> Código de un solo uso para que el equipo coordinador entre al panel. **No es del mismo tipo que
> las cinco de arriba**: `AUTHENTICATION` es otra categoría de Meta, con su propia pista de
> aprobación, su propio precio y un cuerpo de forma fija. No admite prosa: el código es el
> mensaje. Se envía a personal invitado, nunca a una comunidad — quien reporta no entra al panel
> (no-negociable 2.10).

```
{{1}} es su código para entrar a Convite.
```

Ejemplos: `{{1}}` = "462813".

Configuración de la plantilla en Meta:

| Campo | Valor |
|---|---|
| Categoría | `AUTHENTICATION` |
| Idioma | `es_CO` (o `es`) |
| Tipo de código | Copiar código (*copy code*) |
| Caducidad en el cuerpo | No — la decimos en la pantalla, no en el mensaje |
| Pie de seguridad | «Por su seguridad, no comparta este código.» (lo añade Meta) |

Notas para quien la registre:

- **Seis dígitos, no cuatro.** Cuatro chocan con los códigos de confirmación de entrega: la
  bandeja de entrada trata cualquier mensaje de cuatro dígitos de un contacto conocido como una
  confirmación de entrega (`pareceCodigo`, `lib/canales/confirmacion.ts`), así que un código de
  ingreso de cuatro dígitos que alguien responda por WhatsApp se lo traga ese camino.
- Es la única plantilla que **tiene** que poder llegar con la ventana de 24 h cerrada. Un ingreso
  es por definición no solicitado; `AUTHENTICATION` existe justamente para eso.
- El código no se guarda en `mensajes` ni en `salidas_pendientes`: va directo por
  `lib/codigo-whatsapp.ts` y vive en `auth_verification` mientras dura. Un código de un solo uso
  no debe quedar en la bitácora de conversación.

---

## Pendiente antes de enviar a aprobación

- Nombre a mostrar definitivo de la cuenta (debe corresponder a la entidad legal — decisión #2).
- Confirmar si se necesita versión en otra lengua además del español para el piloto en el Chocó
  (las plantillas se aprueban por idioma).
- Definir el opt-in: la autorización de la Ley 1581 y el consentimiento de WhatsApp se capturan en
  el mismo flujo de registro del reportante.
