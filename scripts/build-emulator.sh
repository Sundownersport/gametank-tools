#!/bin/sh
# Builds the GameTankEmulator WebAssembly target into media/emulator.
# Needs emsdk (emcc) on PATH.
set -e

GTE_COMMIT=${GTE_COMMIT:-9896544460d5bb7dd89c2d2bc0f5c97a6f31d2e0}
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)

git clone -q https://github.com/clydeshaffer/GameTankEmulator.git "$work/gte"
cd "$work/gte"
git checkout -q "$GTE_COMMIT"
git submodule update --init --depth 1 src/mos6502

sed -i "s/EXPORTED_RUNTIME_METHODS='\[\"ccall\",\"cwrap\"\]'/EXPORTED_RUNTIME_METHODS='[\"ccall\",\"cwrap\",\"FS\"]'/" Makefile
grep -q '"FS"' Makefile

head -c 32768 /dev/zero | tr '\0' '\352' > placeholder.gtr
make OS=wasm ROMFILE=placeholder.gtr -j"$(nproc)" bin

mkdir -p "$root/media/emulator"
cp build/index.js build/index.wasm "$root/media/emulator/"
cp LICENSE "$root/media/emulator/LICENSE"
echo "$GTE_COMMIT" > "$root/media/emulator/commit.txt"
rm -rf "$work"
ls -l "$root/media/emulator"
