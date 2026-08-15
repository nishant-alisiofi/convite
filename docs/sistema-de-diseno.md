# Sistema de diseño de Convite

Amplía la §5 del PRD con las reglas concretas del sistema tal como está construido. No repite
estándares de plataforma; describe cómo se ve y por qué se ve así **este** producto.

La tesis: es una herramienta humanitaria, no una app de startup. Lo que buscamos es **claridad,
confianza y contención** — no vistosidad. La contención es el rasgo. Un tablero que grita en diez
colores es uno donde nadie ve la fila urgente; una página pública que muestra de más pone en riesgo
a quien pide ayuda. La restricción es intencional y debe leerse así.

## Restricciones que no se negocian

Vienen de la §10 del PRD y son el brief de diseño, no un obstáculo:

- **Funciona en un Android barato sobre 2G.** Todo llega entero sobre una conexión débil.
- **Sin JavaScript de cliente** salvo que una pantalla lo necesite de verdad (el mapa lo necesita;
  el resto, no). Todo se renderiza en el servidor.
- **Sin fuentes web y sin imágenes** en las superficies públicas. Cero bytes de tipografía o de
  media que descargar.
- **Legible desde 14px**, calma, con foco visible en cada control.
- **Primero el móvil.** Cada pantalla se verifica explícitamente a **360px** de ancho, no solo en
  escritorio. Los coordinadores hacen triage desde el teléfono.

## Color — la ley

El color **carga significado y nada más**. Paleta Chocó, definida como tokens de tema en
`app/globals.css`:

| Token | Es | Se usa para |
|---|---|---|
| `selva` (verde selva) | el primario | estados resueltos: listo, atendido, confirmado |
| `atrato` (ocre del río) | la espera | lo que sigue pendiente — **nunca** para peligro |
| `barro` (neutro cálido) | el papel | todo lo demás: texto, chrome, bordes. Rampa completa 50–950 |

`barro` es papel cálido, no gris de pantalla: la rampa sigue la luminancia de `stone` pero con la
tibieza del papel, así una pantalla entera se lee como un solo material. Contraste verificado en
`barro-50`/blanco: 900/800/700/600 pasan AA para cuerpo y texto secundario, 500 para meta a 14px+,
400 solo para placeholders.

**El color de estado manda sobre el color de marca.** En la **página pública** (`/`) `selva`
significa «atendida» junto a los conteos, así que el panel de privacidad ahí se queda en `barro`
neutro — un tinte verde se leería como una cifra. En la **landing** (`/acerca`) no hay conteos de
estado, así que su panel de privacidad sí puede tomar el tinte `selva` como marca. No las unifiques.

## Tipografía — dos registros

- **Panel del coordinador:** todo en la pila `sans` del sistema. Es una herramienta de triage bajo
  presión: densa, rápida, sin adornos.
- **Superficies de marketing** (landing + página pública): los titulares de display van en `font-serif`
  — la pila Georgia del sistema que trae Tailwind. Da gravedad editorial (una institución que se
  toma en serio) **sin descargar ni un byte de fuente**, lo que respeta la restricción de 2G. El
  cuerpo sigue en `sans`. El serif es solo para marketing; el panel no lo usa nunca.

## Íconos

**Lucide** (`lucide-react`), una sola familia, trazo, **siempre con etiqueta de texto**. Un control
solo-ícono es inusable para alguien que se encuentra con el sistema una vez al mes. Los glifos de
familia de necesidad (agua, alimentos, salud, techo) son monocromos en `barro` — ayudan a escanear,
no cargan color.

## Vocabulario de tarjetas — racionado

Para que una superficie no sea un muro de tarjetas idénticas:

- **Panel con tinte** (`selva-50`/`selva-100`): reservado para **una** declaración — la postura de
  privacidad, el corazón de la confianza. Se usa una vez por superficie, y no en la página pública
  (ver la ley de color).
- **Tarjeta de superficie** (blanca, borde `barro-200`, `rounded-xl`): para grupos de ítems que se
  escanean — para-quién-es, el desglose por zona.
- **Abierto / sin borde:** hero, tesis, la escalera de canales, el cierre.

## Componentes compartidos

- `<Marca>` (`components/marca.tsx`) — el lockup de marca (glifo de río + «Convite»), en dos tamaños.
  El glifo lleva el único color (`selva`); el nombre hereda el color de su texto, así se lee sobre
  papel y sobre panel tintado. Toda superficie se firma igual.

## Accesibilidad — el piso

- Anillo de foco visible en cada elemento interactivo, con teclado o sin él (`:focus-visible`,
  `selva-700`, con offset — queda quieto para no competir con los colores de estado).
- Objetivos táctiles cómodos (CTAs con `py-3`, ancho completo en móvil).
- Encabezados semánticos, `aria-label`/`aria-hidden` donde corresponde, `sr-only` para rótulos que
  el diseño resuelve visualmente.
- Contraste AA verificado (ver la tabla de color).

## Cómo verificar sin Supabase / sin base hospedada

Las pantallas del panel viven tras auth y staging es solo-base; para revisar el trabajo de UI por
captura se renderizan los componentes presentacionales (`app/vista-publica.tsx`,
`app/acerca/vista.tsx`, `app/(panel)/**/vista.tsx`, `verificacion/tarjeta.tsx`) desde arneses de
mock. Ver `scripts/vista-marketing.tsx` (superficies públicas) y los `scripts/vista-*.tsx` del panel.
El ancho de móvil real (360px) se comprueba con emulación de dispositivo por CDP — el headless de
Chrome recorta el viewport a ~500px y finge overflow.
