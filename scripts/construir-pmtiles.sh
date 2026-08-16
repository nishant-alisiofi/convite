#!/usr/bin/env bash
#
# Build an offline PMTiles basemap for a territory (PRD-13 / §26).
#
# Field devices in Chocó / Pacífico work with no signal, so the basemap has to be a file on the
# device, not a call to a tile server. This extracts a bounding box from the free, daily
# Protomaps build of OpenStreetMap into a single .pmtiles archive — no paid provider, no API
# key. The archive is OPERATIONAL DATA: it is written under DATA_DIR (outside the repo) and
# copied into public/mapa/ for local serving; it is NEVER committed (see .gitignore). See
# docs/mapas-offline.md for the whole story, the size budget and how to serve it.
#
# The architecture is territory-agnostic: run it once per territory. Chocó is the default;
# Buenaventura (or any basin) is a second invocation with its own name and bbox.
#
#   bash scripts/construir-pmtiles.sh                       # Chocó, the default
#   bash scripts/construir-pmtiles.sh buenaventura "-77.4,3.6,-76.7,4.2" 13
#
# Args: [nombre] [bbox=oeste,sur,este,norte] [maxzoom]
#
# Requires the `pmtiles` CLI (Go). It is not a project dependency because it only runs at build
# time, on a machine with signal — never in the app:
#   brew install pmtiles         # macOS
#   # or a release binary from https://github.com/protomaps/go-pmtiles/releases

set -euo pipefail

# Script-invocation logging (portfolio standard); guarded so the repo does not depend on Base.
if [ -f "$HOME/Github/Base/scripts/lib/log-invocation.sh" ]; then
  # shellcheck disable=SC1091
  source "$HOME/Github/Base/scripts/lib/log-invocation.sh"
fi

NOMBRE="${1:-choco}"
# Chocó / Pacífico operating basin: oeste,sur,este,norte. Generous enough to hold the Atrato
# and San Juan corridors the seed draws, bounded enough to stay a field-device download.
BBOX="${2:--77.9,3.9,-76.0,8.7}"
MAXZOOM="${3:-13}"

RAIZ_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR_DATOS="${DATA_DIR:-$HOME/Data/Convite}/pmtiles"
DESTINO_DATOS="$DIR_DATOS/$NOMBRE.pmtiles"
DESTINO_PUBLICO="$RAIZ_REPO/public/mapa/$NOMBRE.pmtiles"

# Protomaps publishes a full-planet build daily. We extract only the bbox, so the download is
# proportional to the area, not the planet.
FECHA="$(date -u -v-2d +%Y%m%d 2>/dev/null || date -u -d '2 days ago' +%Y%m%d)"
ORIGEN="https://build.protomaps.com/$FECHA.pmtiles"

if ! command -v pmtiles >/dev/null 2>&1; then
  echo "✗ Falta el CLI 'pmtiles'. Instálalo y vuelve a correr:" >&2
  echo "    brew install pmtiles" >&2
  echo "    # o un binario de https://github.com/protomaps/go-pmtiles/releases" >&2
  exit 1
fi

echo "→ Territorio : $NOMBRE"
echo "→ BBox       : $BBOX"
echo "→ Maxzoom    : $MAXZOOM"
echo "→ Origen     : $ORIGEN"
echo "→ Archivo    : $DESTINO_DATOS"

mkdir -p "$DIR_DATOS" "$RAIZ_REPO/public/mapa"

# `pmtiles extract` reads only the tiles inside the bbox over HTTP range requests, so this
# never downloads the whole planet.
pmtiles extract "$ORIGEN" "$DESTINO_DATOS" --bbox="$BBOX" --maxzoom="$MAXZOOM"

cp "$DESTINO_DATOS" "$DESTINO_PUBLICO"

TAM="$(du -h "$DESTINO_DATOS" | cut -f1)"
echo
echo "✓ Listo. Paquete de $TAM en:"
echo "    $DESTINO_DATOS            (dato operativo, fuera del repo)"
echo "    $DESTINO_PUBLICO   (servido localmente, ignorado por git)"
echo
echo "Ahora fija en .env:"
echo "    NEXT_PUBLIC_PMTILES_URL=/mapa/$NOMBRE.pmtiles"
echo
echo "Y reconstruye/reinicia para que el mapa lo use. Ver docs/mapas-offline.md."
