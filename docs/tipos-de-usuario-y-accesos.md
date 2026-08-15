# Convite — Tipos de usuario y control de acceso

Blueprint de RBAC para Convite. Fuente de verdad del modelo de usuarios, la jerarquía de
organizaciones y qué puede hacer cada quién. Se implementa contra esto — no ad-hoc.

**Principio rector:** la fricción de autenticación escala con el poder y con el acceso a datos
sensibles. Quien solo aporta o reporta no ve nada sensible y entra sin fricción; quien ve
teléfonos, ubicaciones y datos de salud, o decide quién espera, se autentica en serio y es
aprobado. Esto no es solo UX: es el modelo de seguridad, porque lo que protegemos son datos de
hogares vulnerables en zona con presencia de actores armados.

## 1. La pregunta de entrada — «¿Qué quiere hacer?»

En vez de un solo muro de login, la entrada enruta por intención:

| Intención | Fricción | Autenticación | Ve datos sensibles |
|---|---|---|---|
| **Reportar** una necesidad o un daño | Ninguna | — (canales: WhatsApp/SMS/IVR; GPS para daño) | No |
| **Donar** («quiero donar») | Mínima | Identificación ligera (teléfono/nombre) | No |
| **Entregar** («puedo entregar») | Ligera | WhatsApp OTP + GPS | Solo su ruta, en su ventana |
| **Operar un centro** («soy/trabajo en un centro») | Completa | Correo (enlace/contraseña) o WhatsApp, **invitado** | Sí, dentro de su organización |

## 2. Los tipos de usuario

### 2.1 Reportante — sin cuenta
Comunidad afectada. Reporta por el canal que tenga. Nunca inicia sesión. Ya existe
(`contactos.rol='reportante'`, canales M5/M6/M10). 2.10 se mantiene: el número vive en el
reporte, no habilita panel.

### 2.2 Donante — autoservicio, sin fricción
«Quiero donar». Crea un ofrecimiento (`ofertas`). No ve PII de hogares. Se identifica ligero
(teléfono/nombre) al ofrecer; sin contraseña ni enlace de correo — el modelo Nigeria de «donar
es fácil». **Nuevo:** un camino de donante autoservicio (hoy los ofrecimientos existen pero se
capturan desde el panel).

### 2.3 Transportista — vetado, ligero
«Puedo entregar». Maneja ayuda real y ve detalles de entrega **durante su ventana** → debe ser
vetado (un centro lo invita/aprueba), pero con auth ligera (WhatsApp) + GPS. Ya existe
(`transportista` + `convite_conduce_hacia`, la ventana temporal probada).

### 2.4 Centro — organización aprobada
Un **centro = una organización** (`organizaciones`, scoping por `organizacion_id` ya en el
esquema y en RLS). Debe ser **aprobado por la plataforma** (manejan ayuda + PII). Dentro del
centro hay jerarquía:

- **Admin del centro** — administra su organización: invita/gestiona a sus trabajadores, ve solo
  los datos de su org. *Nuevo: admin por-organización (hoy la invitación es más global).*
- **Trabajadores del centro** — roles existentes, alcance a su org (y verificadores a sus
  comunidades): `verificador`, `despachador`, `coordinador`, `lectura`.

### 2.5 Admin de plataforma (Alisio / nosotros) — nuevo tier
Super-admins internos, en correos de Alisio (vía `CORREOS_STAFF` hoy). Aprueban centros, ven a
través de todas las organizaciones. *Nuevo: un tier por encima del admin de centro.*

## 3. Matriz de capacidades (lo de «¿qué puedo hacer?»)

`✓` = permitido; `—` = no; `◑` = con alcance (su comunidad / su org / su ruta).

| Capacidad | Reportante | Donante | Transportista | Verificador | Despachador | Coordinador | Admin centro | Admin plataforma |
|---|---|---|---|---|---|---|---|---|
| Reportar necesidad/daño | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Crear ofrecimiento | — | ✓ | — | — | — | ✓ | ✓ | ✓ |
| Ver cola de verificación | — | — | — | ◑ com | — | ◑ org | ◑ org | ✓ |
| Verificar reporte / promover a pedido | — | — | — | ◑ com | — | ◑ org | ◑ org | ✓ |
| Ver PII (teléfono/nombre/transcripción) | — | — | ◑ ruta | ◑ com | ◑ org | ◑ org | ◑ org | ✓ |
| Ver coordenadas exactas | — | — | ◑ ruta/ventana | ◑ com | ◑ org | ◑ org | ◑ org | ✓ |
| Registrar capacidad / planear envío | — | — | — | — | ◑ org | ◑ org | ◑ org | ✓ |
| Despachar / decisión de racionamiento | — | — | — | — | ◑ org | ◑ org | ◑ org | ✓ |
| Confirmar entrega (código 4 díg.) | — | — | ✓ ruta | — | ◑ org | ◑ org | ◑ org | ✓ |
| Desactivar ruta por daño | — | — | — | — | — | ◑ org | ◑ org | ✓ |
| Editar catálogo / comunidades | — | — | — | — | — | — | ◑ org | ✓ |
| Invitar/gestionar trabajadores | — | — | — | — | — | — | ◑ org (invita transp./trabajadores) | ✓ (aprueba centros) |
| Ver a través de organizaciones | — | — | — | — | — | — | — | ✓ |

La RLS ya impone la frontera de **datos** (0017 + los fixes 0030+); esto documenta y completa la
frontera de **acciones**.

## 4. Onboarding y confianza — quién es vetado vs autoservicio

- **Reportar, donar → autoservicio.** Abierto, sin fricción; no ven ni toman nada sensible.
- **Entregar, operar un centro → vetado.** No se quiere a un desconocido recogiendo ayuda ni
  viendo dónde viven las familias.
  - **Centro:** solicita acceso → **la plataforma aprueba** → su admin luego autogestiona a sus
    trabajadores. (Recomendado; ajustable.)
  - **Transportista:** un centro lo invita/aprueba.
- Invariante que se mantiene (Codex-verificado): una cuenta solo sirve si (a) fue invitada/
  aprobada Y (b) probó posesión del correo/número. La contraseña solo se fija desde una sesión ya
  autenticada; no hay auto-registro.

## 5. Qué existe vs qué es nuevo

**Ya existe:** los roles (`reportante`, `transportista`, `verificador`, `despachador`,
`coordinador`, `admin`, `lectura`), el scoping por `organizacion_id`, la RLS por org+comunidad,
la ventana del transportista, las tres puertas de login (enlace/WhatsApp/contraseña), invitación
por correo/teléfono + `CORREOS_STAFF`.

**Nuevo a construir:**
1. La **entrada «¿qué quiere hacer?»** que enruta por intención en vez de un solo login.
2. El **camino de donante** autoservicio.
3. El **admin de plataforma** (tier cross-org) y la **aprobación de centros**.
4. El **admin de centro** que invita/gestiona a los suyos (invitación por-org, no global).
5. La **matriz de capacidades** hecha explícita en política/UI (RLS ya cubre los datos).

## 6. Decisiones abiertas (defaults propuestos; el founder ajusta)

1. **Donante** — ¿autoservicio totalmente abierto, o identificación ligera (teléfono/nombre)?
   *Default: identificación ligera, sin contraseña.*
2. **Centro** — ¿solicita → plataforma aprueba → admin de centro autogestiona? *Default: sí.*
3. **Sesión** — permanece hasta cerrar sesión explícitamente (decisión del founder, ya en curso).

## 7. Orden de construcción sugerido

1. Admin de plataforma + aprobación de centros + admin de centro (la jerarquía de orgs). RLS ya lista.
2. La entrada «¿qué quiere hacer?» + camino de donante autoservicio.
3. Matriz de capacidades explícita por rol en la UI del panel (los datos ya los cubre RLS).
