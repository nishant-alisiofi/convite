# Mapas sin conexión (PRD-13 / §26) — primera versión

El mapa del panel llama a `tile.openstreetmap.org`, que es inalcanzable en cuanto la lancha
sale del muelle. Esta primera versión da la mitad que se puede dar hoy sin trabajo en
dispositivo: un **mapa base PMTiles** que MapLibre lee **sin conexión**, un **service worker**
que lo guarda junto con el shell de la app, y un **punto de GPS** encima —porque el GPS del
teléfono no necesita red; solo el mapa la necesitaba—.

## Qué entra en esta versión

1. **Mapa base PMTiles.** Un archivo `.pmtiles` de teselas vectoriales del territorio, construido
   desde un extracto libre de OSM (Protomaps), servido como archivo estático. Sin proveedor de
   pago y sin llave. El estilo pinta agua, tierra, vías y límites como rellenos y líneas — **sin
   capas de símbolos**, así que no necesita servidor de glifos ni sprites (la misma restricción
   bajo la que ya vive el resto del mapa: los nombres son marcadores DOM, no una capa de símbolo).
2. **Vista de mapa con capacidad offline.** `/mapa-offline` registra un service worker
   (`public/sw.js`) que cachea el shell, los assets estáticos y —lo más importante— el archivo
   PMTiles, respondiendo cada *range request* del lector `pmtiles` desde la copia guardada. Con el
   paquete descargado, el mapa base se dibuja **sin red**.
3. **Punto de GPS con «buscando señal».** `navigator.geolocation.watchPosition` pinta un punto
   azul con su halo de precisión real (honesto como cualquier otro círculo del mapa, 2.2). El
   primer fix es lento, así que el estado es **«Buscando señal…»** hasta que llega.

La honestidad de precisión no cambia: los centroides siguen siendo círculos de ~1 km, nunca
puntos. `/mapa-offline` usa exactamente la misma capa pura y probada (`lib/mapa/capas.ts`) que el
mapa del panel; el basemap se compone **encima** de ella en `lib/mapa/pmtiles.ts`, nunca dentro.

## Qué se difiere (anotado, no simulado)

§26 endurece PRD-13 hacia **paquetes por viaje de transportista**. Esa es la mitad de *seguridad*
y necesita trabajo en dispositivo; es un siguiente paso, no está en esta versión:

- **Paquete acotado al viaje:** manifiesto + paradas en orden + códigos de confirmación + teselas
  solo del corredor (no todo el territorio). Sin motor de rutas en el dispositivo.
- **Cifrado en reposo.**
- **Expira al terminar el viaje** (se acopla al offboarding: la terminación cancela las
  asignaciones activas — §29.6, PRD-16).
- **Borrado remoto.**

Nada de esto se finge en la UI: `/mapa-offline` lo dice en pantalla y no hay tabla de manifiesto
todavía (esta versión no trae migración).

## Construir un paquete

Requiere el CLI `pmtiles` (Go), solo en tiempo de construcción, en una máquina con señal:

```bash
brew install pmtiles        # macOS; o un binario de github.com/protomaps/go-pmtiles/releases
bash scripts/construir-pmtiles.sh                        # Chocó (por defecto)
bash scripts/construir-pmtiles.sh buenaventura "-77.4,3.6,-76.7,4.2" 13   # otro territorio
```

El script extrae el bbox del build diario de Protomaps hacia:

- `$DATA_DIR/pmtiles/<nombre>.pmtiles` — **dato operativo, fuera del repo** (por defecto
  `~/Data/Convite/pmtiles/`).
- `public/mapa/<nombre>.pmtiles` — copia servida localmente, **ignorada por git**.

Luego fija en `.env`:

```
NEXT_PUBLIC_PMTILES_URL=/mapa/choco.pmtiles
```

Sin esa variable el mapa usa las teselas OSM en línea (comportamiento actual, cero regresión); el
punto de GPS funciona sin conexión de todos modos.

## Presupuesto de tamaño (dispositivo de campo)

Objetivo: **por debajo de ~50 MB por territorio**. Se controla con el bbox y el `maxzoom` (13 por
defecto). Un `maxzoom` menor reduce mucho el tamaño a costa de detalle al acercar. Verifica con
`du -h` (el script lo imprime). Cada territorio es un paquete propio: Chocó y Buenaventura no
comparten archivo.

## Cómo se sirve y por qué range requests

`pmtiles` lee el archivo con `Range: bytes=…`. El servido estático de Next (`public/`) soporta
range requests, así que en línea funciona directo. Sin conexión, el service worker guarda el
archivo **completo** (mensaje `CACHE_PMTILES`, disparado por «Descargar para uso sin conexión») y
**corta** cada rango pedido desde esa copia. Optimización futura: respaldar la copia en IndexedDB
con un `FileSource` propio en vez de recortar el ArrayBuffer completo en memoria por cada rango.

## Cómo verificar (offline real)

1. `NEXT_PUBLIC_PMTILES_URL=/mapa/choco.pmtiles`, con el `.pmtiles` en `public/mapa/`.
2. `pnpm build && pnpm start` (el service worker solo se registra en producción).
3. Abre `/mapa-offline`, pulsa **«Descargar para uso sin conexión»**, espera **«Mapa guardado»**.
4. DevTools → Network → **Offline** (o modo avión). Recarga: el mapa base se dibuja, el punto de
   GPS aparece («Buscando señal…» y luego el punto azul). El GPS no necesita red.
5. Segundo territorio: repite con otro paquete y confirma que se dibuja por su cuenta.
