#!/usr/bin/env bash
# Clone MeshCore au pin, applique le crochet télémétrie, compile l'image L1 Pro.
# L'UF2 sort sous build/MeshCore/.pio/build/WioTrackerL1_meteo/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MESH="$ROOT/build/MeshCore"
PIN="81dbae592ffad40b4212bc0b37e82b38da08f4bc"
REPO="https://github.com/meshcore-dev/MeshCore.git"

if command -v pio >/dev/null 2>&1; then
  PIO=(pio)
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

( cd "$MESH" && "${PIO[@]}" run -e WioTrackerL1_meteo )

UF2="$MESH/.pio/build/WioTrackerL1_meteo/firmware.uf2"
if [[ -f "$UF2" ]]; then
  echo "UF2: $UF2"
else
  echo "Compilation terminée, UF2 introuvable à $UF2" >&2
  exit 1
fi
