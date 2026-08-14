# Convite — Red de Ayuda

Extensión del sistema de reportes de ayuda humanitaria de **Orgánico Studio** (Pereira) hacia
zonas rurales de baja o nula conectividad — piloto propuesto en el **Chocó**, junto al clúster
humanitario local. Modelo de tiers por comunidad y canales adicionales: SMS con tarjeta impresa,
IVR por llamada perdida, notas de voz con transcripción, lotes offline.

Colaboración Alisio (Nishant Dixit, Manuel Zamora) ↔ Orgánico Studio.

**En una frase: "Rappi + Waze" para ayuda humanitaria.** El lado Rappi: la comunidad reporta lo
que necesita y el sistema lo agrupa en envíos despachables. El lado Waze: la misma red reporta
vías, puentes y pasos dañados, y eso desactiva rutas en el grafo para que nadie planifique una
entrega por un camino que ya no existe — con la diferencia de que quien reporta nunca paga, y de
que la verificación y el despacho siempre los decide una persona.

## Estado

**Fase: M1–M3 construidos y verificados; M4–M12 por delante.** Este repo ya contiene el sistema
nuevo (Next.js 15 + Drizzle sobre Supabase con PostGIS y RLS): esquema con 18 migraciones SQL,
motor de emparejamiento con cola de trabajos, auth por magic-link con allowlist de staff, y el
Tablero del coordinador leyendo datos vivos. **Ningún canal de entrada existe todavía** — nada ha
recibido un mensaje real.

La fuente de verdad de lo que falta es **[`PRD.md`](PRD.md)** (M4–M12, decisiones D1–D10, riesgos).
Los documentos originales de especificación y plan siguen aquí como contexto de diseño; donde
contradigan al PRD o al código, **ganan el PRD y el código**.

Las dos preguntas con lead time externo siguen abiertas: **cuál cuenta de WhatsApp Business
(WABA) del socio y su token** (D3), y **el corpus de mensajes reales** sin el cual el
normalizador (M4) no se puede validar.

## Documentos

| Documento | Qué es | Vigencia |
|---|---|---|
| [`PRD.md`](PRD.md) | **El documento rector**: estado real, M4–M12, decisiones D1–D10, riesgos | **Vigente** |
| [`decisiones-pendientes.md`](decisiones-pendientes.md) | Estado de las decisiones originales + nuestras recomendaciones sobre D1–D10 | Vigente |
| [`plantillas-whatsapp.md`](plantillas-whatsapp.md) | Borradores de las 5 plantillas *utility* — listas para D4 cuando exista la WABA | Vigente |
| [`contrato-evento-canonico.md`](contrato-evento-canonico.md) | Borrador v0.1 del sobre canónico — a reconciliar con `lib/canales/` en M5 | Vigente como insumo |
| [`especificacion-tecnica.md`](especificacion-tecnica.md) | Arquitectura, tiers, catálogo, canales — el diseño original | Contexto; el PRD registra sus conflictos internos |
| [`plan-de-ejecucion.md`](plan-de-ejecucion.md) | Permisos, costos, financiación, calendario | Contexto; trámites y costos siguen vigentes |
| [`intake-codigo.md`](intake-codigo.md) | Checklist de intake del código — **ya corrido**, respuestas al inicio del archivo | Cerrado |
| [`esquema-referencia.sql`](esquema-referencia.sql) | SQL de referencia del diseño original | **Superado** por `db/migrations/` |

## Postura vigente

- **Código nuevo, no integración.** El plan original suponía integrarse al sistema existente de
  Orgánico Studio; lo que ocurrió fue una construcción nueva (este repo). Orgánico Studio sigue
  siendo el socio de territorio: su línea de WhatsApp, su red de reportantes y su acceso
  comunitario son lo que el sistema necesita para operar — y la fuente del corpus para M4.
- **WhatsApp primero para comunidades; formulario web después para donantes** (D10, acordado).
  El canal vive detrás de un puerto (`lib/canales/`), así que agregar un driver web no es un
  rewrite.
- **SMS entra a v1** (recomendación sobre D1); IVR es M10. Piloto con **dos comunidades**, no
  con treinta.
- Los topes de gasto de voz del plan original siguen siendo ley cuando llegue M10.

## Qué sigue (PRD §9)

1. Responder **D1/D2** (SMS y proveedor) y arrancar **D3/D4** con el socio — tienen lead time
   externo.
2. **Conseguir el corpus de mensajes reales** — de la línea existente de Orgánico o de un grupo
   piloto. M4 no arranca sin esto.
3. Construir **M4 (normalizador)** — el hito de mayor riesgo del proyecto.
4. Decidir **D5** y desplegar (app + worker de la cola).
