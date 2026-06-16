#!/usr/bin/env bash
# One-time setup for the DCC Godot client (macOS / Linux):
#   3a) vendor the GdUnit4 test addon   3b) copy art assets   3c) import the project
# Both 3a/3b are gitignored, so each machine runs this once. Idempotent.
# Usage:  ./godot/setup.sh        (run from anywhere; it locates the repo)
#         GODOT=/path/to/godot ./godot/setup.sh   (override the Godot binary)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"
echo "==> DCC Godot client setup  (repo: $ROOT)"

# Locate a Godot binary.
GODOT="${GODOT:-}"
if [ -z "$GODOT" ]; then
  if command -v godot >/dev/null 2>&1; then GODOT="godot"
  elif command -v godot4 >/dev/null 2>&1; then GODOT="godot4"
  elif [ -x "/Applications/Godot.app/Contents/MacOS/Godot" ]; then GODOT="/Applications/Godot.app/Contents/MacOS/Godot"
  fi
fi

# 3a. GdUnit4 test addon (gitignored).
if [ -f godot/addons/gdUnit4/plugin.cfg ]; then
  echo "==> GdUnit4 already installed, skipping."
else
  echo "==> Installing GdUnit4 test addon..."
  TMP="$(mktemp -d)"
  git clone --depth 1 https://github.com/MikeSchulze/gdUnit4.git "$TMP/gdunit4"
  mkdir -p godot/addons
  cp -R "$TMP/gdunit4/addons/gdUnit4" godot/addons/gdUnit4
  rm -rf "$TMP"
fi

# 3b. Art assets (gitignored; source of truth is public/assets).
echo "==> Copying art assets (public/assets -> godot/assets)..."
rm -rf godot/assets
cp -R public/assets godot/assets

# 3c. Import (texture .import files + class cache).
if [ -n "$GODOT" ]; then
  echo "==> Importing project with: $GODOT"
  "$GODOT" --headless --path godot --import
  echo "==> Done. Run it (against a local server):"
  echo "     npm run dev   # in another terminal"
  echo "     DCC_WS=ws://127.0.0.1:8787/ws \"$GODOT\" --path godot res://scenes/Main.tscn"
else
  echo "!! Godot not found on PATH. Install Godot 4.6 (Standard), then run:"
  echo "     godot --headless --path godot --import"
fi
