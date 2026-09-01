#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

UUID="tokenwatch@efedogan"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

[ -d build/extension ] || ./build.sh

mkdir -p "$DEST"
cp -r build/extension/. "$DEST/"

echo "Installed to $DEST"

if gnome-extensions enable "$UUID" 2>/dev/null; then
    gnome-extensions info "$UUID"
else
    echo "Could not enable yet. The shell may need to discover the new extension:"
    echo "  - On X11: press Alt+F2, type 'r', press Enter"
    echo "  - On Wayland: log out and back in (or use the Extensions app)"
fi
