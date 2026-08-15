# Convite — ACTUALIZACIÓN 2026-08-15: demoable, en el estándar de la plataforma

## Dominios propios + producción limpia (última tanda)

- **`staging.convite.ai` EN VIVO (HTTPS 200).** Dominio propio de staging. `APP_BASE_URL` de
  staging apuntado a `https://staging.convite.ai`. DNS en Cloudflare (CNAME + TXT de verificación
  de Railway); cert emitido (~8.5 min tras healthy).
- **`convite.ai` (producción) — stand-up LIMPIO, sin datos de prueba.** Producción estaba vacía
  (sin DB, sin secrets, en crash-loop). Configurada correctamente: DATABASE_URL compuesta sobre
  el `convite-db` de producción (su propia instancia, separada de staging), `BETTER_AUTH_SECRET`
  y `CRON_SECRET` frescos, correo desde `mail.convite.ai`, `APP_BASE_URL=https://convite.ai`,
  `CONVITE_NOINDEX=1` (no indexar hasta lanzar). App **SUCCESS/healthy**; el cert del ápice se
  estaba emitiendo (Railway completa el reto ACME solo cuando el destino está sano — pasó a sano
  21:54).
- **Regla cumplida: NUNCA sembrar datos de prueba en producción.** El arranque de prod es
  `db:migrate && start` — migraciones 0000–0033 aplicadas a la DB vacía, **sin `db:seed`** (nada
  de comunidades/reportes «[DATO DE PRUEBA]»). El primer intento incluía `sembrar:staff`, que
  **exige una organización previa** («No hay ninguna organización») → crash-loop; se quitó. El
  staff real (admins de plataforma / Alisio, cross-org) se sembrará limpio cuando aterrice el RBAC
  (los admins de plataforma no dependen de una organización). Ver `tipos-de-usuario-y-accesos.md`.
- **En construcción (RBAC Fase 1):** admin de plataforma (Alisio, cross-org, vía `CORREOS_STAFF`)
  + aprobación de centros + admin por-organización. Se construye en worktree aislado; luego a
  staging, verificación en vivo, y **Codex valida el 0→1 completo** (registro, admin, admins
  internos). Pendiente: bootstrap de staff en prod sin dependencia de organización.

Cambios desde la nota nocturna, todos en `origin/main`, desplegados en staging y verificados
en vivo:

- **Auth movido de Supabase a nuestro estándar** — better-auth sobre nuestro Postgres de
  Railway, correo por Resend. Supabase eliminado por completo. RLS intacto (0 políticas
  tocadas; `conSesion` fija `request.jwt.claims` igual que antes). Migración `0028` (tablas
  `auth_user/session/account/verification`). 507/507 tests.
- **[CORRECCIÓN 17:05] El último salto del login estaba roto en staging** — el redirect de
  `/auth/callback` se construía desde `request.url` (la dirección interna del contenedor detrás
  del proxy de Railway), así que al hacer clic en el enlace real se terminaba en
  `https://localhost:8080/tablero` (inalcanzable). El panel, la sesión, la cookie y RLS sí
  funcionan; solo el salto final fallaba — y es el último paso del único camino de entrada. No
  se detectó porque en local las dos URLs coinciden, y tanto la caminata con curl como los
  tests pasaban. **Hubo un primer intento fallido**: `fdb9889` cambió a `nextUrl.clone()` —el
  middleware lo usa y su redirect siempre fue correcto— pero se desplegó y falló idéntico. Next
  reconstruye `nextUrl` desde el host reenviado **solo en middleware**; un route handler no
  recibe ni eso ni un `request.url` utilizable. Detrás del proxy, nada en el request conoce el
  origen público, así que ninguna lectura del request iba a servir.
  **[VERIFICADO EN VIVO — d209b0a]** El arreglo real no lee el request en absoluto: construye el
  redirect desde `APP_BASE_URL` (`urlBase()`), configuración que ya teníamos, correcta en cada
  ambiente y fuera del alcance de quien llama —es también lo que Better Auth usa como su propio
  `baseURL`, y su mitad de la cadena estuvo bien todo el tiempo. Confirmado siguiendo el enlace
  real del buzón talos de punta a punta: verify → 302 `/auth/callback` (origen staging) → 307
  `https://convite-app-staging.up.railway.app/tablero` (staging, NO localhost) → panel renderiza
  con la sesión de coordinador y datos reales. Prueba nueva que llama al handler desde
  `http://localhost:8080` y exige el origen configurado de vuelta: **las dos versiones rotas
  fallan esa prueba**. 512/512.
  **[810ab80 — VERIFICADO EN VIVO]** Rate-limit por IP en el sign-in. El intento previo
  (`ipAddressHeaders`) era **no-op**: `x-forwarded-for` ya es el default de Better Auth. La
  negativa real está en `getIPFromHeader` —«without valid trusted proxies a multi-hop chain is
  unresolvable»—, así que cualquier cadena de más de un salto devuelve null; el proxy de Railway
  añade uno, luego nunca se resolvió. `trustedProxies` con rangos RFC1918 lo arregla sin abrir
  spoofing (se recorre de derecha a izquierda y se devuelve el primer salto NO confiable; lo que
  inyecte un cliente queda a la izquierda de lo que añade el proxy). Confirmado en el
  despliegue de las 17:51: una petición real a `/api/auth/*` ya **no** dispara el WARN de Better
  Auth, que es exactamente la señal —se emite una vez por proceso en la primera petición—. Antes
  de esto el rate-limit del sign-in era **un solo bucket compartido** para todos, así que
  cualquier 429 visto durante las pruebas de hoy gastaba la cuota de todos, no la del que
  probaba.
- **El panel del coordinador está vivo en staging** — login por magic-link
  (5 roles sembrados: coordinador/verificador/despachador/admin/lectura →
  `talos+convite-<rol>@downshiftit.com`, llegan al buzón talos). Tablero renderiza la salida
  real del emparejador (clasificación-como-llamada). RLS por comunidad verificado en vivo
  (verificador ve solo su comunidad). Mobile 360px sin overflow (tablero + verificación).
- **Landing-as-root** — `/` = landing (estático), `/respuesta` = respuesta en vivo (dinámico,
  cache + rate-limit + k-anon), `/acerca`→`/`. Diseño world-class (Dante) en marketing + panel.
- **Correo de sign-in** on-brand, charset arreglado (acentos intactos).
- **Ya no bloquea nada del lado del founder** para el demo. La decisión de Supabase que se
  citaba abajo quedó obsoleta: no usamos Supabase.

Pendientes reales (ninguno bloquea el demo):
- **Dominio de envío de producción** — hoy `dev.downshiftit.com` (verificado) para el demo;
  producción querrá un dominio Convite/Alisio propio en Resend.
- **Nishant / migraciones** — solo relevante si algún día se migran sus datos de la Supabase
  original; el app corre 100% sobre nuestro Railway DB.
- **Liveness endpoint** — el healthcheck de Railway apunta a `/` (no a `/api/salud`, que da 503
  ante cualquier alerta operativa); vale un endpoint de liveness dedicado para no confundir
  «app viva» con «sin alertas».

URLs vivas: landing `https://convite-app-staging.up.railway.app/` · respuesta `/respuesta` ·
panel `/entrar`.

---

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
- **Worker:** vivo y conectado a la base en el deploy actual (log de arranque «5 tipos de job
  registrados», sin crash-loop). El procesamiento de jobs de punta a punta **no es observable con
  cola vacía** — sin credenciales de WhatsApp no entran webhooks, así que `alertas:0` es consistente
  con un worker sano *y* con uno muerto. Se probará solo con el primer webhook real; hasta entonces
  «worker arriba» descansa en el log de arranque, no en el endpoint de salud.
- Datos de prueba marcados `[DATO DE PRUEBA]` donde una persona los ve.
- `/robots.txt` → 404 (no 503), `x-robots-tag: noindex, nofollow` en `/` y en la página 503 —
  staging fuera de índices, verificado en vivo.

## Hallazgos del walk manual (post-cierre, founder pidió prueba propia)

Probando la superficie pública en vivo aparecieron tres defectos que la suite no podía atrapar
—todas sus aserciones sobre la página pública eran negativas («no filtra X»), y una página que
dice «no hay solicitudes» las pasa todas. Corregidos en `778c5fe`, verificados en vivo:

1. **La página pública mostraba el basin vacío** («Todavía no hay solicitudes registradas», todo en
   0) pese a 10 reportes + 7 pedidos sembrados — el seed nunca corría el emparejador y `mapa_publico`
   solo cuenta estados post-matcher. Quien caminara staging (Codex, founder) veía un sistema vacío.
   Fix: el seed corre una pasada del emparejador. Ahora la página muestra «7 solicitudes en espera».
2. **El vacío-copy contradecía la tabla** — el mensaje se decidía por la suma de conteos, la tabla
   por el número de filas; filas todo-en-cero mostraban ambos a la vez. Fix: se descartan filas sin
   información, así las dos condiciones concuerdan por construcción.
3. **Un test anclado a reloj de pared** (`enlace.db.test.ts`, `AHORA=15:00Z`) empezó a fallar al
   cruzar las 15:00Z UTC reales, sin cambio de código. Anclado al reloj real.

**Verificado en vivo por mí:** página pública muestra 7 pendientes en 6 filas, sin fugas, solo
«Quibdó»/«Otras zonas». El resto del producto (panel autenticado) sigue sin caminarse — bloqueado
por Supabase, ver arriba.

## Qué se puede demostrar hoy (para hablar con organizaciones)

Superficie pública, en vivo, sin login — segura para mostrar a cualquiera:
- **Landing `/acerca`** — qué es Convite, el modelo multicanal (nadie paga por pedir ayuda), la
  postura de privacidad como rasgo de confianza, para quién es. Mobile-first, sin JS de cliente.
- **Página pública `/`** — el tamaño real de la respuesta en conteos agregados, con la explicación
  de por qué no muestra más. k-anonimato verificado (solo «Quibdó»/«Otras zonas», sin veredas).
- **`robots.txt`** — indexa lo público, mantiene a los crawlers fuera del panel.

**NO demostrable aún** (hay que decirlo antes de agendar un recorrido):
- **Todo el panel del coordinador** (tablero, verificación, despacho, mapas) — 503 sin auth
  Supabase. Es la decisión que desbloquea el recorrido completo del producto.
- **Ningún mensaje real fluye todavía** — WhatsApp/SMS/IVR probados contra payloads grabados,
  no contra un teléfono vivo (falta WABA + proveedores).

Traducción: hoy se demuestra la visión y el modelo de confianza público; el bucle operativo
completo del coordinador espera la decisión de Supabase.

**Buenaventura (2026-08-14):** el founder lo agregó al PRD; la arquitectura es agnóstica de
territorio por diseño (el tier es la única variable geográfica, el catálogo es configuración,
el esquema se escopa por `organizacion_id`), así que un segundo territorio es la extensión
prevista. Dos cosas a revisar por-territorio: el pliegue k-anónimo de 0027 (afinado a los
tamaños de municipio del Atrato — Buenaventura necesita su propia verificación para no
re-identificar una vereda) y el seed + grafo de rutas (hoy específicos del Atrato).

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
