#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

UUID="tokenwatch@efedogan"
OUT="build"
EXT="$OUT/extension"

rm -rf "$OUT"
mkdir -p "$EXT/schemas"

cp metadata.json "$EXT/"
cp src/extension.js "$EXT/"
cp src/prefs.js "$EXT/"
cp src/stylesheet.css "$EXT/"
cp -r src/lib "$EXT/lib"
cp -r icons "$EXT/icons"

glib-compile-schemas schemas --targetdir="$EXT/schemas"
cp schemas/*.gschema.xml "$EXT/schemas/"

(cd "$EXT" && zip -qr "../$UUID.zip" .)

echo "Built $OUT/$UUID.zip"
