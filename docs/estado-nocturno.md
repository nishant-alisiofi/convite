# Convite — estado tras la sesión nocturna (2026-08-14)

Resumen para Manuel y para Nishant. Toda la construcción del PRD (M4–M12 + trabajo transversal)
se llevó a término esta noche, con dos agentes en paralelo (canales / panel) en árboles de trabajo
separados. `origin/main` quedó verde: **488 tests, typecheck limpio, build de producción compila,
sin drift de esquema.** Staging desplegado en Railway.

## Estado por hito

| Hito | Estado | Nota |
|---|---|---|
| M4 Normalizador | **Hecho — sin aceptación de corpus real** | Léxico determinista, casos nombrados del PRD verbatim, nunca adivina / nunca descarta. El arnés de corpus corre y **declara que su tasa no es aceptación**; apunta `CONVITE_CORPUS` al export real de Orgánico y corre sin cambios de código. |
| M5 WhatsApp | **Hecho** | Webhook con verificación de firma sobre bytes crudos, idempotencia, flujo de dos intercambios, pipeline de media (EXIF, storage propio), respuesta con folio. Verificación con número vivo diferida a D3. |
| M6 Enlace adaptativo + SMS | **Hecho** | Telemetría re-derivable, queSolicitar/comoConfirmar, cola piggyback, driver SMS con simulador. Agregador real pendiente de D2. |
| M7 Verificación + bandeja de audio | **Hecho** | Cola urgencia→edad, playback, corrección de transcripción (original inmutable), promoción a pedido garantizada por **trigger** (no política) probado como table owner. |
| M8 Mapas + editor de rutas | **Hecho** | Render por precisión (pin/centroide/referida), editor de rutas fluviales, clustering de recogida, temporada como ajuste auditado. Sin basemap de tiles (fallback GeoJSON, ranura documentada). |
| M9 Despacho | **Hecho** | Planner con confirmación humana, gate de racionamiento (trigger, probado como owner), agregación de ofertas, manifiesto print-CSS con códigos de 4 dígitos, ventana del transportista. |
| M10 IVR + topes | **Hecho** | Llamada perdida → devolución, menú de un nivel, topes de gasto (2/30min, 5/día, presupuesto global con apagado + alerta 70%), grabación → normalizador. Proveedor de voz pendiente de D2. |
| M11 Confirmación + silencio | **Hecho** | Código de 4 dígitos multicanal (idempotente, por-envío), job de silencio tier-aware, alerta de agrupación de daños, reaper opt-in. Panel: `/estado` + vista de daño→ruta. |
| M12 Vista pública | **Hecho** | Solo agregados, servida desde ruta propia. Test de superficie completa sobre HTTP real. **0027 cierra una fuga de identidad k-anónima** (4 de 5 municipios tienen una sola comunidad → se pliegan a un bucket de cuenca). |
| Transversal | **Hecho** | Worker continuo con drain, endpoint de salud honesto (503 cuando algo está mal, mediana RECIBIDO→VERIFICADO), detección de cola atascada, drill de respaldo/restauración probado, guardia sin-analytics, prep de despliegue. |

## Staging

- **URL:** https://convite-app-staging.up.railway.app
- Proyecto Railway `convite`: `convite-app` + `convite-worker` + `convite-db` (PostGIS 16-3.4).
- Salud verificada: `{"ok":true, migraciones:27, alertas:0}`, worker arriba, seed cargado.
- **Modo solo-base-de-datos**: sin proyecto Supabase, el panel devuelve 503 honesto; webhook, salud
  y vista pública funcionan. **El inicio de sesión de staff es la única brecha** — decisión de
  Nishant/founder (claves de su proyecto Supabase, o uno nuevo).
- Datos de prueba marcados `[DATO DE PRUEBA]` donde una persona los ve.
- `/robots.txt` → 404 (no 503), `x-robots-tag: noindex, nofollow` en `/` y en la página 503 —
  staging fuera de índices, verificado en vivo.

## Validación

- **488 tests** verde tras un rebuild limpio; primer all-green de la noche (una falsa alarma de
  bundle stale la enmascaró — ver más abajo).
- **Sondeo externo (adversarial, in-house):** la superficie pública no filtra coordenadas, teléfonos
  E.164, ninguno de los 13 nombres de comunidad, ni los valores de `agrupador` que quitó D6. Fronteras
  de auth fallan cerradas. Marcador de prueba invisible al público.
- **Codex:** el gate de challenge **se colgó dos veces** (rango completo, luego un solo archivo de
  10 KB) — la patología documentada de `cx exec`, no el tamaño del diff. **No es un certificado de
  limpieza.** Pendiente: pase manual de Codex por el founder en Studio (que es como Codex está
  pensado para correr). La validación de esta noche descansa en las dos pasadas adversariales
  in-house y la suite.

## Lecciones de testing de la noche (una ley, tres instancias)

Un test que pasaría sobre la versión rota no es un test. Y la guardia contra un test mentiroso puede
mentir del mismo modo: midiendo algo *correlacionado* con lo que le importa en vez de la cosa misma.

- Plantar la fuga en M12 (coordenada/nombre/teléfono) y ver la suite ponerse roja por cada una.
- El elector de códigos toma su aleatoriedad como argumento — el muestreo pasaría un elector roto el 99.99%.
- El mock de sesión debe fijar los claims como `conSesion` — la conexión de owner enmascara un bug y fabrica otro.
- La guardia de freshness se ancla al **commit** (HEAD), no al mtime — mtime correlaciona con contenido, no es contenido.

## Handoff a Nishant — decisiones y sign-offs

**Decisiones con lead time externo (bloquean verificación viva, no el código):**
- **D3** — cuál WABA del socio + token de System User. Sin esto M5 no verifica contra número vivo.
- **D4** — enviar las 5 plantillas utility (borradores listos en `plantillas-whatsapp.md`).
- **D2** — agregador de SMS colombiano (Hablame/Masivian) para SMS; voz se decide en M10.
- **D8** — proveedor de transcripción. Whisper auto-hospedado recomendado (datos de salud en zona de conflicto).
- **Supabase** para el login de staff en staging (única brecha del despliegue).

**Migraciones locales pendientes de aplicar al hosted (0020–0027)** — incluyen cambios de esquema que
quieren su revisión antes de producción:
- `sin_clasificar` como tipo de reporte (registro-al-recibir sin adivinar).
- `plantilla` en salidas_pendientes (envío fuera de ventana).
- tabla `llamadas` + presupuesto de voz.
- trigger `exigir_reporte_verificado` (pedido solo apunta a reporte verificado por persona).
- transcripción inmutable + corrección con nombre; DUPLICADO requiere actor nombrado.
- `convite_conduce_hacia` **estaba inerte desde 0016** — ahora con 4 políticas.
- índice único de emparejamientos + `oferta_id` (agregación de ofertas).
- 0027 fold k-anónimo de la vista pública.

**Sus archivos que tocamos bajo autorización (marcados para su revisión):**
`middleware.ts` (auth-gap 503, PUBLICAS, noindex), `db/client.ts` (precedencia sslmode),
`lib/env.ts` valida nombres que nada lee (`SUPABASE_URL` vs `NEXT_PUBLIC_SUPABASE_URL`).

**Decisiones de producto pendientes (no técnicas):**
- Mensaje multi-ítem («20 mercados y 5 toldillos»): ¿humano separa siempre, o intake multi-reporte? Hoy: humano separa.
- Cadencia del chequeo_periodico: cada cuánto re-preguntar a una comunidad callada.
- El corpus real de mensajes — **el bloqueador de la aceptación de M4.**
- El «cuello de botella» MER→TAG no aísla a nadie por alcance, pero el acopio que lo sostiene se
  contó hace 19 días: alcance dice OK, frescura de inventario (2.3) dice que puede no existir. Dos
  alarmas, solo una suena hoy.

**Infra:**
- La app de GitHub de Railway no tiene acceso al repo de Nishant → sin auto-deploy; los deploys se
  disparan re-conectando el repo. Instalar la app resuelve.
- `DATA_DIR` necesita un volumen persistente antes del piloto o la media desaparece en cada deploy.
- `app/robots.ts` real pendiente; el caso general de 404-vs-503 para rutas inexistentes necesita un manifest.
