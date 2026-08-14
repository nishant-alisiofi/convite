# Checklist de intake — el día que llegue el código

Objetivo: en una sola pasada de lectura del repositorio de Orgánico Studio, responder todo lo que
el *Plan de ejecución* §12 necesita para convertir el diseño en migraciones y módulos concretos.
Nada de esto requiere ejecutar su sistema; con la estructura del repo y el archivo de dependencias
alcanza para empezar.

## 1. Escenario de WhatsApp (la respuesta que cambia el calendario)

Buscar en el archivo de dependencias (`package.json`, `requirements.txt`, `Gemfile`, `go.mod`…):

| Hallazgo | Escenario | Consecuencia |
|---|---|---|
| SDK de Meta / llamadas a `graph.facebook.com` | **A — Cloud API oficial** | Se reutiliza todo. Adaptador en días. |
| `twilio`, `360dialog`, `wati`, `gupshup` u otro BSP | **B — BSP** | Se reutiliza; el adaptador se escribe contra el formato del BSP. Ids de mensaje distintos → cuidar idempotencia. |
| `baileys`, `whatsapp-web.js`, `wppconnect`, `venom-bot`, `puppeteer` sobre WhatsApp Web | **C — no oficial** | Migración a API oficial antes de cualquier mensaje proactivo. Se suman los trámites de Meta al camino crítico. |

Anotar también: ¿el webhook actual responde 200 antes o después de procesar? ¿Hay verificación de
duplicados por id del proveedor?

## 2. Stack y herramientas

- [ ] Lenguaje y framework del backend.
- [ ] ORM y sistema de migraciones (¿existen migraciones versionadas, o el esquema se edita a mano?).
- [ ] ¿Hay cola de trabajos o cron? (el pipeline de audio y los vencimientos la necesitan; si no
      hay, proponer una acorde al stack).
- [ ] Frontend del panel: framework, cómo se autentica.
- [ ] ¿Dónde vive Postgres? ¿Proveedor gestionado? ¿PostGIS habilitado o hay que solicitarlo?
- [ ] ¿Dónde se despliega y cómo (CI, manual, PaaS)?
- [ ] Almacenamiento de archivos: ¿existe? (el audio lo necesita; nunca guardar URLs del proveedor).

## 3. Estado del modelo de datos actual

- [ ] ¿Existe la tabla `necesidades` (o equivalente)? ¿Qué columnas tiene?
- [ ] ¿Tiene datos reales? ¿Cuántas filas, desde cuándo? → decide si esto es **migración con datos
      vivos** o arranque limpio.
- [ ] ¿Cómo se modelan hoy contactos/voluntarios? ¿Hay noción de comunidad o todo es individual?
- [ ] ¿Estados del ciclo de vida actuales y dónde están codificados (enum de Postgres, check,
      constantes en código)?
- [ ] ¿Hay algo parecido a bitácora de mensajes entrantes/salientes?

## 4. Seguridad y accesos (base para T8)

- [ ] ¿Cuántos usuarios/roles existen hoy en el panel? ¿Un solo login compartido?
- [ ] ¿Coordenadas y teléfonos visibles a todo usuario autenticado?
- [ ] ¿Hay algo público hoy (mapa, dashboard)? ¿Qué expone?
- [ ] ¿Secretos en el repo? (avisarles con tacto si los hay).

## 5. Salidas de esta pasada

1. **Dictamen de escenario** (A/B/C) con evidencia (líneas del archivo de dependencias).
2. **Mapa del esquema actual** → borrador de migraciones hacia `reportes` + `comunidades` +
   `catalogo_items`, en SU sistema de migraciones.
3. **Propuesta de reparto de módulos Ruta B** ajustada a lo que realmente existe.
4. **Agenda de la sesión técnica** con lo que haya que decidir en conjunto (contrato del evento
   canónico, cola de trabajos si no hay, almacenamiento de audio).
