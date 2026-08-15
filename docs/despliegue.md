# Despliegue

> **Estado:** el código está listo para desplegar; **no hay nada desplegado todavía** y no se
> han creado recursos. La decisión de dónde corre el servidor es D5 (PRD §2). Este documento
> es lo que hay que hacer el día que se cree el proyecto, no un registro de algo ya hecho.

Dos servicios sobre la misma imagen. Una base de datos. Nada más.

| Servicio | Comando de arranque | Qué hace |
|---|---|---|
| `app` | `pnpm start` | Next.js: el panel del coordinador y los webhooks |
| `worker` | `npx tsx scripts/worker.ts` | La cola de trabajos, corriendo de continuo |

---

## ⚠️ El comando del worker no es `pnpm worker`

**Es `npx tsx scripts/worker.ts`, directo.** No es una preferencia de estilo.

`pnpm` **no reenvía SIGTERM** a su proceso hijo — está comprobado en esta máquina: se le manda
SIGTERM al `pnpm` y el worker sigue vivo. En un redespliegue la plataforma manda SIGTERM,
espera unos segundos y luego SIGKILL. Con `pnpm` de por medio el worker nunca se entera de que
lo están apagando, así que nunca drena, y lo matan a mitad de un job.

Un job muerto a mitad **no se reintenta**: `tomarUno` solo reclama filas en `pendiente`, así
que la que quedó en `corriendo` se queda ahí para siempre. El trabajo no se retrasa, se
pierde. Un redespliegue de rutina se comería la nota de voz de alguien sin dejar rastro más
que una fila `corriendo` que la ruta `/api/salud` reporta días después.

El worker sí drena bien cuando la señal le llega:

```
[worker] SIGTERM: terminando el lote en curso antes de salir
[worker] salida limpia
```

Correr `app` y `worker` a la vez es seguro por diseño: comparten el mismo
`for update skip locked`, así que dos workers nunca toman el mismo job. La ruta
`/api/jobs/correr` sigue existiendo como respaldo y como lo que usan las pruebas.

---

## Variables de entorno

Solo los **nombres**. Los valores no viven en el repo ni en este documento.

### Obligatorias en ambos servicios

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Postgres con PostGIS. Aquí vive también la identidad (migración 0028): no hay una segunda base que configurar. |
| `DATA_DIR` | Dónde se guardan audios y fotos. **Tiene que ser un volumen persistente**, no el sistema de archivos del contenedor: en Railway se reinicia en cada despliegue y las notas de voz desaparecen. Ver «Media» abajo. |

### Del servidor (`app`)

| Variable | Para qué |
|---|---|
| `PORT` | La pone la plataforma; `next start` la respeta sola. No hay que tocarla. |
| `APP_BASE_URL` | Origen público. Entra en los enlaces mágicos. |
| `BETTER_AUTH_SECRET` | **Obligatoria.** Firma la cookie de sesión. `openssl rand -hex 32`. Sin ella el panel responde 503 y dice cuál falta. No tiene valor por defecto: un secreto compartido deja que cualquiera se fabrique una sesión con el correo que quiera. |
| `BETTER_AUTH_URL` | Opcional. Si falta se usa `APP_BASE_URL`, que es lo correcto aquí: el panel y `/api/auth` son el mismo servidor. |
| `RESEND_API_KEY` | Manda el enlace de ingreso. Si falta, el enlace se **imprime en el log del servidor** en vez de enviarse — útil en local, inservible para una coordinadora. |
| `EMAIL_FROM` | Remitente. Tiene que ser un dominio **verificado en Resend**; uno sin verificar da 422 en cada envío. Nunca el dominio raíz. |
| `WHATSAPP_APP_SECRET` | Verificación de firma del webhook. Sin esto el webhook rechaza todo, que es el fallo correcto. |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | El `hub.verify_token` de la suscripción. |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN` | La WABA del socio (D3, sin resolver). |
| `CRON_SECRET` | Protege `/api/jobs/correr` y el detalle de `/api/salud`. **Si falta, en producción esas rutas fallan cerradas** — a propósito. |

### Del worker

Le basta `DATABASE_URL` y `DATA_DIR`, más `WHATSAPP_ACCESS_TOKEN` para bajar media. No
necesita `PORT` ni el secreto de sesión: no atiende tráfico.

---

## Entrar al panel

La identidad vive en la misma base que todo lo demás (migración 0028). **No hay un segundo
servicio que levantar**: con `DATABASE_URL` y `BETTER_AUTH_SECRET`, el inicio de sesión
funciona. Antes esto dependía de un proyecto de Supabase que nunca se creó, y por eso el
panel llevaba semanas respondiendo 503 en staging.

### Habilitar a alguien

Nadie entra por escribir su correo. Un admin tiene que ponerlo en la lista primero
(no-negociable 2.10) y solo entonces el enlace sirve:

```bash
pnpm invitar rosa@organizacion.org coordinador
pnpm invitar nubia@organizacion.org verificador TAG,MER,BET
```

Para una demostración, uno de cada rol de una vez, a direcciones que controlamos:

```bash
pnpm sembrar:staff                                   # talos+convite-<rol>@downshiftit.com
CORREO_BASE=alguien@ejemplo.org pnpm sembrar:staff   # o a otra bandeja
```

Eso crea **invitaciones, no cuentas**. La cuenta se crea cuando la persona pide su enlace y
lo abre, que es el mismo camino que sigue una coordinadora real. No existe forma de entrar
sin pasar por el correo, y no la va a haber: un atajo «entrar como este usuario de prueba»
se agrega para una demo y sigue ahí dos años después.

### Recuperar el enlace en una demo

El correo llega a la bandeja compartida. Con las direcciones `talos+…`, todo cae en
`talos@downshiftit.com`:

```bash
bash ~/Github/Base/scripts/email.sh inbox
```

Si `RESEND_API_KEY` no está puesta, el enlace no se manda: se **imprime en el log del
servidor**, que en Railway se lee así:

```bash
bash ~/Github/Base/scripts/railway-api.sh convite logs staging deploy 100
```

Es un recurso para diagnosticar, no la forma de operar. Un despliegue de verdad manda
correos.

---

### Sin el secreto: se despliega igual, sin inicio de sesión

**Sí se puede desplegar solo con base de datos.** Si falta `BETTER_AUTH_SECRET`:

| Superficie | Qué pasa |
|---|---|
| `/api/webhooks/whatsapp`, `/api/jobs/correr`, `/api/salud`, `/`, `/entrar` | Funcionan normal |
| El worker | Funciona normal: no toca la identidad para nada |
| El panel (`/tablero`, `/verificacion`, …) | **503** con una página que dice exactamente qué falta |

No es un bypass: con la variable puesta el comportamiento es el normal, y sin ella el panel
sigue negándose — solo que explica por qué en vez de reventar. Se mantiene porque un
despliegue que olvidó el secreto debería decir cuál olvidó, no caerse.

**Antes fallaba de la peor manera posible:** el middleware construía el cliente de identidad
antes de mirar si la ruta era pública, así que sin esas variables TODAS las rutas devolvían
500 — incluidos el webhook (Meta reintentando contra un 500) y `/api/salud` (el monitor sin
poder ni preguntar).

## Configuración manual de identidad: ya no hay

Aquí había tres pasos a mano en el panel de Supabase por cada ambiente — Site URL, Redirect
URLs, y una plantilla de correo que tenía que apuntar a `?token_hash=` y no a `?code=`
porque el token viajaba en el fragmento de la URL, que el navegador nunca manda al servidor.
Estaba marcado como «el error de despliegue más probable de este sistema, porque no rompe
nada visible».

**Ya no aplica.** El panel y `/api/auth/*` son el mismo servidor y el mismo origen, así que
no hay URL que registrar ni redirección que autorizar, y la plantilla del correo la escribe
`lib/correo.ts` — está en el repositorio, se revisa en un diff y no se puede desincronizar
de un ambiente. Un ambiente nuevo necesita variables de entorno y nada más.

Lo único externo que queda es el dominio remitente: `EMAIL_FROM` tiene que estar verificado
en Resend. Eso sí falla en silencio si se equivoca — con 422 en cada envío.

---

## Migraciones

Las migraciones son SQL escrito a mano y las corre `scripts/migrate.ts`, no drizzle-kit.

```bash
pnpm db:migrate     # aplica lo pendiente, en su propia transacción cada una
```

Va como **paso de release**, antes de que arranque la versión nueva. `migrate.ts` se niega a
correr una migración ya aplicada cuyo contenido cambió, así que un despliegue con el historial
tocado falla ruidosamente en vez de dejar la base a medias.

**Sin aplicar en el proyecto alojado hoy: 0020 a 0024.** Incluyen dos cambios que necesitan el
visto bueno de Nishant antes de tocar datos reales (`sin_clasificar` en 0021, la columna
`plantilla` en 0022).

---

## Media

`adjuntos.storage_key` guarda una clave propia, nunca la URL del proveedor (2.6) — las de
WhatsApp expiran en minutos. Hoy el driver local escribe bajo `DATA_DIR`.

En un contenedor eso desaparece en cada despliegue. Antes del piloto hay que elegir: un volumen
persistente montado en `DATA_DIR`, o implementar `Almacenamiento` contra almacenamiento de
objetos (R2, S3). La interfaz existe justamente para que esa decisión no toque nada más:
`lib/canales/almacenamiento.ts`, un objeto con cuatro métodos.

---

## Después de desplegar

```bash
curl -s https://<origen>/api/salud            # liveness público
curl -s -H "Authorization: Bearer $CRON_SECRET" \
        "https://<origen>/api/salud?detalle=1" # el estado completo
```

`/api/salud` devuelve **503** cuando algo anda mal de verdad — cola detenida, jobs colgados,
presupuesto de voz agotado, verificación estancada — así que sirve directo como health check
de la plataforma y como destino de un monitor externo. Un 200 no significa «el proceso está
vivo», significa «el sistema está haciendo su trabajo».

Lo primero que hay que mirar después del primer despliegue es que el worker esté procesando:
si `jobs.sinProcesarMin` crece mientras `jobs.pendientes` es mayor que cero, el servicio del
worker no está corriendo o no tiene `DATABASE_URL`.

---

## Checklist de variables, en formato legible por máquina

Para empujar con los wrappers sin leer ningún valor. `secreto: false` no quiere decir
inofensivo — quiere decir que ese valor viaja al navegador de todos modos y no es un secreto
que proteger.

```json
[
  {"nombre":"DATABASE_URL","servicio":"ambos","secreto":true,"obligatoria":true,"nota":"Postgres con PostGIS. Sin PostGIS las migraciones fallan en 0000."},
  {"nombre":"DATA_DIR","servicio":"ambos","secreto":false,"obligatoria":true,"nota":"Volumen persistente. En un contenedor efímero las notas de voz desaparecen en cada despliegue."},
  {"nombre":"BETTER_AUTH_SECRET","servicio":"app","secreto":true,"obligatoria":true,"nota":"Firma la cookie de sesion. openssl rand -hex 32. Sin esto el panel da 503 y no hay inicio de sesion; el webhook, la cola y /api/salud siguen funcionando. Sin valor por defecto a proposito."},
  {"nombre":"BETTER_AUTH_URL","servicio":"app","secreto":false,"obligatoria":false,"nota":"Si falta se usa APP_BASE_URL. El panel y /api/auth son el mismo servidor."},
  {"nombre":"RESEND_API_KEY","servicio":"app","secreto":true,"obligatoria":true,"nota":"Manda el enlace de ingreso. Si falta, el enlace se imprime en el log en vez de enviarse: sirve para diagnosticar, no para operar."},
  {"nombre":"EMAIL_FROM","servicio":"app","secreto":false,"obligatoria":false,"nota":"Remitente. Dominio VERIFICADO en Resend; uno sin verificar da 422 en cada envio. Nunca el dominio raiz."},
  {"nombre":"CRON_SECRET","servicio":"app","secreto":true,"obligatoria":true,"nota":"Protege /api/jobs/correr y el detalle de /api/salud. En producción esas rutas fallan cerradas si falta."},
  {"nombre":"APP_BASE_URL","servicio":"app","secreto":false,"obligatoria":true,"nota":"Origen público; entra en los enlaces mágicos."},
  {"nombre":"PORT","servicio":"app","secreto":false,"obligatoria":false,"nota":"La pone la plataforma. next start la respeta sola."},
  {"nombre":"CONVITE_NOINDEX","servicio":"app","secreto":false,"obligatoria":false,"nota":"Poner en 1 SOLO en staging: agrega x-robots-tag noindex. Produccion no la define. Explicita a proposito, nunca deducida del hostname."},
  {"nombre":"WHATSAPP_APP_SECRET","servicio":"app","secreto":true,"obligatoria":false,"nota":"Verificación de firma. Sin esto el webhook rechaza todo, que es el fallo correcto. D3."},
  {"nombre":"WHATSAPP_WEBHOOK_VERIFY_TOKEN","servicio":"app","secreto":true,"obligatoria":false,"nota":"hub.verify_token de la suscripción. D3."},
  {"nombre":"WHATSAPP_ACCESS_TOKEN","servicio":"ambos","secreto":true,"obligatoria":false,"nota":"El worker lo necesita para bajar media. D3."},
  {"nombre":"WHATSAPP_PHONE_NUMBER_ID","servicio":"app","secreto":false,"obligatoria":false,"nota":"D3."},
  {"nombre":"WHATSAPP_BUSINESS_ACCOUNT_ID","servicio":"app","secreto":false,"obligatoria":false,"nota":"D3."}
]
```

El worker no necesita `PORT`, ni el secreto de sesión, ni `CRON_SECRET`: no atiende
tráfico. Le basta `DATABASE_URL`, `DATA_DIR` y, para bajar media, `WHATSAPP_ACCESS_TOKEN`.
