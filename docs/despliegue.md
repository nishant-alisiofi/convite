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
| `DATABASE_URL` | Postgres con PostGIS. En Supabase, la cadena del pooler. |
| `DATA_DIR` | Dónde se guardan audios y fotos. **Tiene que ser un volumen persistente**, no el sistema de archivos del contenedor: en Railway se reinicia en cada despliegue y las notas de voz desaparecen. Ver «Media» abajo. |

### Del servidor (`app`)

| Variable | Para qué |
|---|---|
| `PORT` | La pone la plataforma; `next start` la respeta sola. No hay que tocarla. |
| `APP_BASE_URL` | Origen público. Entra en los enlaces mágicos. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Los que hay que poner.** Ver el aviso abajo. |
| `SUPABASE_SERVICE_ROLE_KEY` | Alta de staff desde el servidor. |
| `WHATSAPP_APP_SECRET` | Verificación de firma del webhook. Sin esto el webhook rechaza todo, que es el fallo correcto. |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | El `hub.verify_token` de la suscripción. |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN` | La WABA del socio (D3, sin resolver). |
| `CRON_SECRET` | Protege `/api/jobs/correr` y el detalle de `/api/salud`. **Si falta, en producción esas rutas fallan cerradas** — a propósito. |

### Del worker

Le basta `DATABASE_URL` y `DATA_DIR`, más `WHATSAPP_ACCESS_TOKEN` para bajar media. No
necesita `PORT` ni las claves de Supabase: no atiende tráfico.

---

### ⚠️ Sin Supabase la aplicación no levanta — ni siquiera a medias

Comprobado en el ensayo, no deducido: **si faltan `NEXT_PUBLIC_SUPABASE_URL` y
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, TODAS las rutas devuelven 500.** El middleware corre en cada
petición y construye el cliente de Supabase antes de mirar si la ruta es pública, así que se
cae también `/api/salud` y también el webhook de WhatsApp. No existe un despliegue «solo base
de datos, autenticación después»: sin esas dos variables no hay nada en pie, el monitor no
puede ni preguntar, y Meta reintenta contra un 500.

Y ojo con el nombre: el código lee **`NEXT_PUBLIC_SUPABASE_URL`**, mientras que `.env.example`
y `lib/env.ts` hablaban de `SUPABASE_URL`. Poner las variables documentadas y no las que el
código lee deja exactamente el mismo 500, sin ninguna pista de por qué. Es la trampa más cara
de esta lista.

## Supabase: la configuración que hay que hacer a mano

**Esto no se puede automatizar desde aquí y sin esto el ingreso falla en silencio.** PRD §6 lo
marca como pendiente para todo ambiente desplegado.

En el panel de Supabase, por cada ambiente:

1. **Authentication → URL Configuration → Site URL**: el origen desplegado.
2. **Redirect URLs**: agregar `<origen>/auth/callback`. Sin esto el enlace mágico rebota.
3. **Authentication → Email Templates → Magic Link**: el enlace tiene que apuntar a

   ```
   {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=magiclink
   ```

   No a `?code=`. Supabase manda el token en el **fragmento** de la URL, que el navegador
   nunca envía al servidor, así que una callback que lee `?code=` rebota todo ingreso real de
   vuelta al login. Se descubrió haciendo clic en el enlace, no leyendo el código (PRD §1).

Cada ambiente nuevo repite los tres pasos. Es el error de despliegue más probable de este
sistema, porque no rompe nada visible: la aplicación levanta, el correo sale, y el enlace
simplemente no entra.

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
  {"nombre":"NEXT_PUBLIC_SUPABASE_URL","servicio":"app","secreto":false,"obligatoria":true,"nota":"BLOQUEANTE: sin esto TODAS las rutas dan 500, incluido /api/salud."},
  {"nombre":"NEXT_PUBLIC_SUPABASE_ANON_KEY","servicio":"app","secreto":false,"obligatoria":true,"nota":"BLOQUEANTE, igual que la anterior. La clave anon es pública por diseño."},
  {"nombre":"SUPABASE_SERVICE_ROLE_KEY","servicio":"app","secreto":true,"obligatoria":false,"nota":"Alta de staff desde el servidor."},
  {"nombre":"CRON_SECRET","servicio":"app","secreto":true,"obligatoria":true,"nota":"Protege /api/jobs/correr y el detalle de /api/salud. En producción esas rutas fallan cerradas si falta."},
  {"nombre":"APP_BASE_URL","servicio":"app","secreto":false,"obligatoria":true,"nota":"Origen público; entra en los enlaces mágicos."},
  {"nombre":"PORT","servicio":"app","secreto":false,"obligatoria":false,"nota":"La pone la plataforma. next start la respeta sola."},
  {"nombre":"WHATSAPP_APP_SECRET","servicio":"app","secreto":true,"obligatoria":false,"nota":"Verificación de firma. Sin esto el webhook rechaza todo, que es el fallo correcto. D3."},
  {"nombre":"WHATSAPP_WEBHOOK_VERIFY_TOKEN","servicio":"app","secreto":true,"obligatoria":false,"nota":"hub.verify_token de la suscripción. D3."},
  {"nombre":"WHATSAPP_ACCESS_TOKEN","servicio":"ambos","secreto":true,"obligatoria":false,"nota":"El worker lo necesita para bajar media. D3."},
  {"nombre":"WHATSAPP_PHONE_NUMBER_ID","servicio":"app","secreto":false,"obligatoria":false,"nota":"D3."},
  {"nombre":"WHATSAPP_BUSINESS_ACCOUNT_ID","servicio":"app","secreto":false,"obligatoria":false,"nota":"D3."}
]
```

El worker no necesita `PORT`, ni las claves de Supabase, ni `CRON_SECRET`: no atiende
tráfico. Le basta `DATABASE_URL`, `DATA_DIR` y, para bajar media, `WHATSAPP_ACCESS_TOKEN`.
