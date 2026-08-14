# Contrato del evento canónico — borrador v0.1

> **Nota (2026-08-13):** el PRD §3 fija la misma idea como "el canal es un puerto" —
> `lib/canales/` tendrá un sobre normalizado y dos drivers (WhatsApp + simulador sin
> credenciales), con la regla de 24 h por encima del driver. Este borrador es el insumo para
> definir ese sobre en M5; reconciliar campo por campo contra el esquema real
> (`db/migrations/`) antes de escribir el primer driver.

Acordar esto **antes** de escribir el primer adaptador. Nada aquí es definitivo hasta que quede
versionado junto al código en `lib/canales/`.

**Idea central:** cada canal tiene un adaptador cuya única responsabilidad es (1) traducir su
payload nativo a este evento y (2) descartar duplicados. Nada aguas abajo sabe qué canal existe.

## 1. Forma del evento

```json
{
  "version": "0.1",
  "canal": "whatsapp",
  "tipo": "necesidad",
  "id_externo": "wamid.HBg...",
  "recibido_en": "2026-08-13T14:02:11-05:00",

  "telefono": "+573001234567",
  "comunidad_codigo": "BJ-14",

  "codigo_item": "22",
  "familias": 12,
  "urgencia": 3,
  "severidad": null,

  "texto": "medicamento para la tensión, 12 familias",
  "media": [
    { "tipo": "audio", "ref": "media-id-o-url-temporal", "mime": "audio/ogg", "duracion_seg": 31 }
  ],
  "ubicacion": { "lat": 5.31, "lng": -76.65, "fuente": "pin_whatsapp" },

  "payload_crudo": { "...": "el webhook tal cual llegó" }
}
```

## 2. Campos

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `version` | string | sí | Versión del contrato. Cambios incompatibles suben la versión; los adaptadores declaran cuál emiten. |
| `canal` | string | sí | `whatsapp` · `sms` · `ivr` · `kobo` · `radio` · `papel` · `web`. Lista abierta: valores nuevos no rompen el núcleo. |
| `tipo` | string | sí | `necesidad` · `dano` · `confirmacion_entrega` · `texto_libre` (no clasificable aún). |
| `id_externo` | string | sí | Id del mensaje según el proveedor (`wamid`, `MessageSid`, `CallSid`…). **Clave de idempotencia.** Para canales sin proveedor (radio, papel) el adaptador lo genera determinístico: `radio:<estacion>:<fecha>:<consecutivo>`. |
| `recibido_en` | ISO-8601 con zona | sí | Momento de recepción en el adaptador, no de procesamiento. |
| `telefono` | E.164 | no | Nulo en radio/papel. Nunca se expone aguas abajo del núcleo salvo a roles autorizados. |
| `comunidad_codigo` | string | no | El código impreso en la tarjeta. Si falta, el núcleo intenta resolver por teléfono del contacto; si tampoco, queda para clasificación humana. |
| `codigo_item` | char(2) | no | Del catálogo. Nulo si el mensaje fue texto/voz libre — el extractor lo **propone**, nunca lo fija. |
| `familias` | int | no | Solo `tipo=necesidad`. |
| `urgencia` | 1–3 | no | Solo necesidades. El núcleo aplica `urgencia_min` del catálogo (ej. `23` ⇒ 3) — el adaptador no lo hace. |
| `severidad` | 1–3 | no | Solo `tipo=dano`. |
| `texto` | string | no | Texto libre del usuario, o transcripción cuando ya existe. |
| `media` | array | no | `tipo` (`audio`/`foto`/`documento`), `ref`, `mime`, `duracion_seg`. La `ref` del proveedor **expira en minutos**: el pipeline descarga ya y guarda clave propia. |
| `ubicacion` | objeto | no | `lat`, `lng`, `fuente` (`pin_whatsapp` · `declarada` · `manual`). Si falta, el núcleo hereda la de la comunidad. Un reporte nunca se bloquea por falta de coordenadas. |
| `payload_crudo` | objeto | sí | El payload nativo tal cual. Salva vidas al depurar. |

## 3. Reglas de idempotencia (obligatorias para todo adaptador)

1. Insertar `(canal, id_externo)` en la bitácora de mensajes con restricción única **antes** de
   procesar. Si el insert falla por duplicado → descartar y responder 200.
2. **Responder 200 primero, procesar después** (encolar). Todo proveedor reintenta si el servidor
   tarda o responde distinto de 200.
3. El reintento de un job interno no debe crear un segundo reporte: la creación del reporte cuelga
   del registro de bitácora, no del webhook.

## 4. Responsabilidades

| Hace el adaptador | Hace el núcleo |
|---|---|
| Traducir payload nativo → evento | Resolver comunidad y contacto |
| Verificar firma/token del webhook | Aplicar reglas del catálogo (`pide_detalle`, `urgencia_min`, `entregable`) |
| Idempotencia por `id_externo` | Crear el reporte en estado `RECIBIDO` |
| Responder 200 rápido | Encolar transcripción/extracción si hay audio |
| Adjuntar `payload_crudo` | Todo lo demás |

El adaptador **no** clasifica, **no** fija urgencias, **no** decide canal de respuesta (eso es del
despachador de salida) y **no** escribe en tablas del núcleo distintas de la bitácora.

## 5. Ejemplos mínimos por canal

**SMS** (`22 12 3` desde la tarjeta): `canal=sms`, `tipo=necesidad`, `codigo_item=22`,
`familias=12`, `urgencia=3`, `id_externo=<MessageSid>`. El parser detecta daño por primer dígito
`9` (y entonces el segundo número es severidad, no familias). Si `codigo_item` tiene
`pide_detalle`, el núcleo dispara la respuesta pidiendo el segundo SMS — no el adaptador.

**IVR** (llamada perdida + devolución): `canal=ivr`, `id_externo=<CallSid de la devolución>`,
`media=[{tipo:audio, ...grabación}]`, `texto=null` (la transcripción llega después por el
pipeline), más la ruta tecleada dentro de `payload_crudo`.

**Radio/papel** (digitación manual): `canal=radio|papel`, `id_externo` determinístico generado,
`telefono=null`, `recibido_en` = momento del evento real si se conoce, no el de la digitación.

## 6. Abierto para la sesión técnica

- Nombre y forma reales según su stack (¿tabla + JSON? ¿clase/DTO? ¿tópico de cola?).
- Dónde vive la bitácora de mensajes hoy, si existe.
- Si su webhook actual ya responde-200-primero; si no, ese es el primer cambio de la fase 2.
- Códigos de comunidad: formato acordado (`XX-NN`) y quién los asigna.
