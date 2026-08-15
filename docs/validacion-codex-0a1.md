# Convite — recorrido 0→1 para que Codex lo valide

Este es un recorrido de producto, de punta a punta, para confirmar que Convite hace lo que
promete. No es una auditoría de seguridad: es «entra como cada tipo de persona y comprueba que
puede hacer lo suyo, y solo lo suyo».

## Dónde validar

- **Valida en staging: `https://staging.convite.ai`.** Tiene datos de demostración y cuentas de
  prueba (abajo). Acá se puede crear, aprobar, invitar, sin ensuciar nada real.
- **NO validar en `https://convite.ai` (producción).** Está limpia a propósito —sin datos de
  prueba, sin cuentas de prueba— y así debe quedar. No crear cuentas ni enviar formularios ahí.

## El recorrido, en orden

1. **Lo público.**
   - `/` — la página que explica qué es Convite. Debe leerse para el **Chocó y el Pacífico
     colombiano** (ya no solo el Atrato).
   - `/respuesta` — la respuesta en vivo, agregada por municipio. No debe mostrar nunca nombres
     de familias ni coordenadas exactas (lo público va agregado, nunca por comunidad).

2. **Entrar (así se «registra» alguien del equipo).** En `/entrar`, una persona **invitada** pide
   su enlace por correo (o un código por WhatsApp, o su contraseña). Al abrir el enlace / poner el
   código, se crea la cuenta y entra al panel. Lo que hay que confirmar:
   - Una persona **no invitada** no logra entrar (pide el enlace, pero no obtiene panel).
   - No hay auto-registro: la cuenta existe solo si (a) fue invitada y (b) probó que controla el
     correo o el número.

3. **El panel según el rol.**
   - **Coordinador** — ve el tablero con lo que el emparejador propone (qué falta, cómo llegar,
     qué mandar, quién lo lleva).
   - **Verificador** — ve **solo las comunidades que le tocan**, no todas. Es el corazón del
     modelo: entrar como verificador y comprobar que no ve las demás.

4. **Un centro se registra solo.** En `/solicitar-centro` (público), alguien pide operar un
   centro: nombre de la organización + su correo/número. Eso crea un centro **pendiente**. Confirmar
   que ese centro **no puede operar todavía** —no entra al panel— hasta que lo aprueben.

5. **Admin de plataforma (nosotros / Alisio) — el «admin interno».** Entra como admin de
   plataforma y en `/centros`:
   - Ve el centro pendiente del paso 4 y lo **aprueba** (o rechaza).
   - Ve **a través de todas las organizaciones** (no solo la suya).

6. **Admin de centro.** Ya aprobado el centro, su admin entra y en `/equipo`:
   - Invita/gestiona a **su** gente (coordinador, verificador, despachador, lectura).
   - Confirmar que **no puede** tocar a la gente de **otra** organización, ni darle a nadie el
     nivel de plataforma.

## Cuentas de prueba (solo en staging)

Todas llegan al buzón `talos@downshiftit.com` por plus-addressing (una sola bandeja, cada una
distinta):

| Para probar | Cuenta |
|---|---|
| Coordinador | `talos+convite-coordinador@downshiftit.com` |
| Verificador (comunidades TAG/MER/BET) | `talos+convite-verificador@downshiftit.com` |
| Despachador | `talos+convite-despachador@downshiftit.com` |
| Admin de centro | `talos+convite-admin@downshiftit.com` |
| Lectura | `talos+convite-lectura@downshiftit.com` |
| **Admin de plataforma (admin interno)** | `talos+convite-plataforma@downshiftit.com` |
| Puerta de WhatsApp | número `+573000000100` |

### Cómo obtener el enlace o el código
- **Enlace de correo:** el URL viene en el cuerpo del correo «Su enlace para entrar a Convite».
  Se puede leer del buzón `talos`, o del detalle del correo en Resend
  (`resend-api.sh query emails/<id>` — el `text` trae el enlace en claro).
- **Código de WhatsApp:** en staging no hay WABA conectada, así que el código **no se manda por
  WhatsApp**: **sale en el log del servidor** (`railway-api.sh convite logs staging deploy`).
- **Contraseña:** solo se fija desde una sesión ya iniciada (no es una puerta de registro).

## Qué todavía NO está construido (para no reportarlo como falla)

- **Asignar comunidades a un verificador desde la UI de `/equipo`.** El admin de centro lo invita
  con el rol correcto, pero la asignación de comunidades por ahora se hace por el CLI (`invitar`),
  no desde esa pantalla. La copia de la invitación lo dice.
- **Invitar transportista desde `/equipo`.** Un transportista es un contacto vetado (con su
  ventana de tiempo), no un rol de panel; su alta es un flujo aparte, no está en `/equipo`.
- **Lecturas cross-organización de roles admin/coordinador heredados.** Vienen del diseño de una
  sola organización (migración 0017). La frontera cross-org que **sí** se construyó y probó en
  esta tanda es la de **acciones/jerarquía** (aprobar centros, invitar/gestionar, escalar al tier
  de plataforma), no las lecturas heredadas.

## Lo que ya verificamos de nuestro lado (para que Codex confirme, no re-descubra)

- `convite.ai` y `staging.convite.ai` responden 200 sobre HTTPS con certificado propio.
- 581 tests en verde, incluyendo el arnés de RLS que prueba: la plataforma aprueba un centro
  pendiente; un admin de centro **no** puede aprobar; un admin de centro invita en su org pero
  **no** en otra; la plataforma ve cross-org y el admin de centro no; un admin de centro **no**
  puede crear una invitación con el tier de plataforma; y el invariante de siempre —sin invitación
  + posesión no hay cuenta.
- El enlace de ingreso se envía desde `mail.convite.ai` y llega (confirmado a Gmail y al buzón
  talos).
- Producción (`convite.ai`) arrancó limpia: esquema por migraciones, **sin** semilla de datos de
  prueba, con la organización real «Alisio» y el admin de plataforma real.
