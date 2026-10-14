#!/bin/sh
# Downloads the emulator built by the latest successful CI run into media/emulator.
set -e

repo=Sundownersport/gametank-tools
root=$(cd "$(dirname "$0")/.." && pwd)
run=$(gh run list -R $repo --workflow build.yml --status success -L 1 --json databaseId -q '.[0].databaseId')
[ -n "$run" ] || { echo "No successful CI run found"; exit 1; }

rm -rf "$root/media/emulator"
gh run download "$run" -R $repo -n emulator -D "$root/media/emulator"
ls -l "$root/media/emulator"
