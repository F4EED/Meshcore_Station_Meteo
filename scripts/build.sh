#!/usr/bin/env bash
# Clone MeshCore au pin, applique le crochet télémétrie, compile l'image L1 Pro.
# pio run produit le .hex. La conversion UF2 (famille nRF52840 0xADA52840)
# reprend la commande de build.sh amont. La copie versionnée va dans firmware/releases/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MESH="$ROOT/build/MeshCore"
PIN="81dbae592ffad40b4212bc0b37e82b38da08f4bc"
REPO="https://github.com/meshcore-dev/MeshCore.git"

if command -v pio >/dev/null 2>&1; then
  PIO=(pio)
elif [[ -x "${HOME}/.local/bin/pio" ]]; then
  PIO=("${HOME}/.local/bin/pio")
elif command -v platformio >/dev/null 2>&1; then
  PIO=(platformio)
else
  echo "PlatformIO est absent. Installer pio, puis relancer ./scripts/build.sh" >&2
  exit 1
fi

mkdir -p "$ROOT/build"
if [[ ! -d "$MESH/.git" ]]; then
  git clone --filter=blob:none "$REPO" "$MESH"
fi
git -C "$MESH" fetch --depth 1 origin "$PIN"
git -C "$MESH" checkout --detach "$PIN"

if ! grep -q "onTelemetryBuilt" "$MESH/examples/simple_sensor/SensorMesh.h"; then
  git -C "$MESH" apply --whitespace=nowarn "$ROOT/firmware/patches/sensor-telemetry-hook.patch"
fi

rm -rf "$MESH/examples/station_meteo"
mkdir -p "$MESH/examples/station_meteo" "$MESH/variants/wio-tracker-l1-meteo"
cp "$ROOT"/firmware/station/* "$MESH/examples/station_meteo/"
cp "$ROOT/firmware/variant/platformio.ini" "$MESH/variants/wio-tracker-l1-meteo/platformio.ini"
cp "$ROOT/firmware/variant/fix_wire_timeout.py" "$MESH/fix_wire_timeout.py"

( cd "$MESH" && "${PIO[@]}" run -e WioTrackerL1_meteo )

HEX="$MESH/.pio/build/WioTrackerL1_meteo/firmware.hex"
UF2="$MESH/.pio/build/WioTrackerL1_meteo/firmware.uf2"
python3 "$MESH/bin/uf2conv/uf2conv.py" "$HEX" -c -o "$UF2" -f 0xADA52840
if [[ ! -f "$UF2" ]]; then
  echo "Compilation terminée, UF2 introuvable à $UF2" >&2
  exit 1
fi

VER="$(sed -n 's/.*kFirmwareVersion\[\] = "\([^"]*\)".*/\1/p' "$ROOT/firmware/station/StationConfig.h")"
if [[ -z "$VER" ]]; then
  echo "kFirmwareVersion introuvable" >&2
  exit 1
fi
RELEASE="$ROOT/firmware/releases/${VER}.uf2"
mkdir -p "$(dirname "$RELEASE")"
cp "$UF2" "$RELEASE"
echo "UF2: $RELEASE"
