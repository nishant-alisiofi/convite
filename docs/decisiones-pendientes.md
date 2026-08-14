# Decisiones pendientes

Las cinco decisiones del *Plan de ejecución* §10, con su estado. Ninguna necesita más análisis,
solo respuesta. Las cuatro primeras se resuelven en una llamada con Orgánico Studio; la quinta
define si el proyecto se sostiene.

| # | Decisión | Por qué importa | Estado |
|---|---|---|---|
| 1 | **¿Qué está corriendo el WhatsApp actual?** (API oficial de Meta / BSP / librería no oficial) | Escenario A o B = integración en días. Escenario C = migración, y agrega toda la cadena de trámites de Meta al camino crítico. | **Preguntado** en la carta enviada a Orgánico Studio. Se confirma leyendo el archivo de dependencias del repo. |
| 2 | **¿Hay entidad legal, o se busca padrino fiscal?** | Bloquea verificación de Meta, números, créditos de proveedores y la contratación del verificador (N1 → N2, N3, N4, N9). Es el trámite más lento. | Abierta. Recomendación del plan: padrinazgo para el piloto — un padrino que ya opere en el Chocó resuelve personería y acceso comunitario a la vez. |
| 3 | **¿A nombre de quién está el número de WhatsApp?** | Quien es dueño del número es dueño del canal. Si es el celular de una persona, hay que trasladarlo a la entidad antes de crecer. | Abierta. |
| 4 | **¿Qué capacidad de desarrollo tiene el equipo de Orgánico Studio hoy?** | Define la ruta de ejecución. Propuesta enviada: Ruta B — ellos conservan núcleo, panel y WhatsApp; nosotros entregamos módulos integrados (adaptadores, audio, IVR, accesos). | Abierta; Ruta B propuesta en la carta. |
| 5 | **¿Quién paga y quién verifica?** | El presupuesto del verificador (puesto remunerado, no voluntariado) y del combustible tiene que existir antes de registrar la primera comunidad. Sin eso el sistema documenta necesidades que nadie atenderá. | Abierta. Candidatos de financiación: Twilio.org Impact Access, créditos de nube para ONG, Google for Nonprofits — todos exigen entidad registrada (ver decisión 2). |

## Decisiones ya tomadas de nuestro lado (a confirmar en la llamada)

- **Alcance 2** para el piloto: consolidación + audio + SMS. IVR y envíos programados se deciden
  con datos reales tras ~3 meses de operación.
- **Piloto con dos comunidades** (una tier 1, una tier 2), no con treinta.
- **Topes de gasto de voz desde el día uno** cuando entre el IVR: 2 devoluciones por número / 30
  min, 5 por día, tope global diario con apagado automático, alerta al 70%.
- **Ningún canal nuevo se construye sobre librería no oficial de WhatsApp.** Si el escenario
  resulta ser C, la migración a la API oficial va antes que los mensajes proactivos.

## Registro de cambios

- 2026-08-13 — Documento creado. Carta enviada a Orgánico Studio con la pregunta #1 planteada.
