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

**Fase: pre-código.** Ya se envió la carta de propuesta a Orgánico Studio con la especificación y
el plan adjuntos; esperamos acceso de solo lectura a su repositorio. Mientras tanto, este repo
contiene los artefactos que se pueden acordar antes de tocar código.

La pregunta abierta más importante ya está planteada en la carta: **¿el WhatsApp actual corre
sobre la API oficial de Meta, un BSP, o una librería no oficial (Baileys y similares)?** Eso
define si el trabajo es integración (días) o migración (semanas).

## Documentos

| Documento | Qué es |
|---|---|
| [`especificacion-tecnica.md`](especificacion-tecnica.md) | Arquitectura, tiers, catálogo, canales, esquema de datos |
| [`plan-de-ejecucion.md`](plan-de-ejecucion.md) | Permisos, costos, financiación, rutas de trabajo, calendario |
| [`decisiones-pendientes.md`](decisiones-pendientes.md) | Las 5 decisiones que se responden en una llamada — con su estado |
| [`intake-codigo.md`](intake-codigo.md) | Checklist a correr el día que llegue el código de ellos |
| [`contrato-evento-canonico.md`](contrato-evento-canonico.md) | Borrador v0.1 del evento canónico — el prerequisito de la Ruta B |
| [`plantillas-whatsapp.md`](plantillas-whatsapp.md) | Borradores de las 5 plantillas *utility* para enviar a aprobación |
| [`esquema-referencia.sql`](esquema-referencia.sql) | SQL de referencia de la especificación (se adapta a su ORM) |

## Postura acordada (propuesta, pendiente de confirmar con el equipo)

- **Alcance 2 — alcance rural mínimo**: consolidar lo existente + pipeline de audio + adaptador
  SMS con tarjeta impresa. IVR y envíos programados quedan para después del piloto.
- **Ruta B — construcción conjunta por módulos**: ellos conservan núcleo, panel y adaptador de
  WhatsApp; nosotros tomamos capa de adaptadores, pipeline de audio, IVR con topes y políticas de
  acceso, entregados integrados a su repositorio.
- Piloto con **dos comunidades** (una tier 1, una tier 2), no con treinta.

## Orden de trabajo al llegar el código

1. Correr [`intake-codigo.md`](intake-codigo.md) — determina el escenario de WhatsApp (A/B/C) y el
   stack real.
2. Sesión técnica: acordar el [contrato del evento canónico](contrato-evento-canonico.md) sobre el
   borrador v0.1.
3. Escribir las migraciones concretas (`necesidades` → `reportes` + `comunidades` +
   `catalogo_items`) contra su ORM.
4. Empezar T1/T2 con adaptador falso — nada de esto depende de trámites ni de permisos de Meta.
