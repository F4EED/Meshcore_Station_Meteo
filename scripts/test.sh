#!/usr/bin/env bash
# Tests hôtes du cœur station (cadence, IAQ, indices, LPP). Pas de flash.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/build"
g++ -std=c++17 -Wall -Wextra -Werror -I "$ROOT/firmware/station" \
  "$ROOT/test/test_station.cpp" -o "$ROOT/build/test_station"
"$ROOT/build/test_station"
