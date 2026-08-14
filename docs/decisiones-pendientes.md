# Decisiones — estado y recomendaciones

**El registro maestro de decisiones es [`PRD.md`](PRD.md) §2 (D1–D10).** Este documento no lo
duplica: registra (a) qué pasó con las cinco preguntas originales del plan de ejecución, y
(b) nuestra recomendación sobre cada decisión abierta del PRD.

## Las cinco preguntas originales

| # | Pregunta original | Estado hoy |
|---|---|---|
| 1 | ¿Qué corre el WhatsApp actual? | **Reformulada.** El código nuevo no depende del manejador de Orgánico; la pregunta ahora es D3: ¿cuál WABA, y hay token? Si Orgánico está en librería no oficial, no existe WABA y la cadena entidad → verificación Meta → plantillas entra al camino crítico. |
| 2 | ¿Entidad legal o padrino fiscal? | **Abierta.** Sigue gateando D3/D4 (la WABA exige entidad verificada) y todos los créditos de proveedores. |
| 3 | ¿A nombre de quién está el número? | **Abierta.** Parte de D3. Quien es dueño del número es dueño del canal. |
| 4 | ¿Capacidad de desarrollo del equipo? | **Respondida por los hechos.** Se construyó sistema nuevo (M1–M3). Orgánico Studio es socio de territorio, no co-desarrollador del núcleo. |
| 5 | ¿Quién paga y quién verifica? | **Abierta y sigue siendo la existencial.** El verificador es un puesto remunerado (el flujo M7 lo asume); el presupuesto de combustible tiene que existir antes del primer despacho real. |

## Nuestras recomendaciones sobre D1–D10

| D | Recomendación nuestra | Nota |
|---|---|---|
| D1 | **SMS sí entra a v1.** | Coincide con el Alcance 2 del plan original. Enmendar §13 de la spec. |
| D2 | **Agregador local para SMS** (Hablame / Masivian / Infobip). **Voz se decide en M10** — ahí Twilio vuelve a la mesa por el descuento de Twilio.org sobre voz, el renglón de costo dominante. | Separar la decisión SMS de la de voz. |
| D3 | Pregunta al socio — **la respuesta más urgente de conseguir.** | Ver pregunta original #1 y #3. |
| D4 | Enviar apenas exista la WABA. **Los cinco textos ya están redactados** en [`plantillas-whatsapp.md`](plantillas-whatsapp.md). | |
| D5 | **Railway, us-east**, junto a la base. App + proceso worker para la cola. | Co-locación con Postgres pesa más que latencia al coordinador (app RLS-intensiva). |
| D6 | **Quitar `agrupador` de `mapa_publico`.** | El modelo de amenaza de 2.4 es explícito. |
| D7 | **Confirmar lectura mínima** (`mapa_publico` y nada más). Ampliar solo con una necesidad nombrada. | |
| D8 | **Whisper auto-hospedado desde el día uno.** Notas de voz con nombres, ubicaciones y datos de salud en zona de conflicto no salen de nuestra infraestructura. | Volumen de piloto corre en CPU. Si se usara proveedor: DPA + nombrarlo en la política. |
| D9 | **Fijar retención antes del lanzamiento:** borrar audio crudo ~90 días después de transcripción verificada, podar `payload_crudo`, seudonimizar teléfonos al cerrar el caso. | La eliminación es medida de protección, no solo cumplimiento. Abogado valida plazos (Ley 1581). |
| D10 | **Resuelta: WhatsApp para comunidades; formulario web como canal de donantes después.** Si D3 revela que no hay WABA, el driver web sube de prioridad como desbloqueador del piloto. | Acordada por ambas partes. |

## El bloqueador que no es una decisión

**El corpus de mensajes reales.** M4 no se valida con ejemplos inventados — el vocabulario
chocoano (*mercado* = remesa de comida, *pañitos*, *colada de plátano*) es exactamente donde
falla un clasificador genérico. Pedir a Orgánico un export anonimizado de su línea existente
(con historia de consentimiento — esto también es Ley 1581) o montar un grupo piloto de
recolección. Va en la misma llamada que D3.

## Registro de cambios

- 2026-08-13 — Creado con las 5 preguntas del plan de ejecución.
- 2026-08-13 — Reescrito tras M1–M3 y el PRD: el registro maestro pasa a PRD.md §2; aquí quedan
  el estado de las preguntas originales y nuestras recomendaciones D1–D10.
