#!/bin/bash
# DCC — one-command click-to-play launcher (macOS). Double-click this file to:
#   0. first run only: vendor GdUnit4 + copy assets + download export templates (~1.2 GB),
#   1. fast-forward `main` to the latest (only if your tree is clean),
#   2. re-export the native .app when there's a new version (or it's missing),
#   3. launch the game (connects to the live server by default).
#
# This is the SINGLE command — it self-installs everything it needs the first time.
# Only prereqs: git + Godot 4.6 (on PATH or at $GODOT). Double-click in Finder, or put an
# alias on your Desktop/Dock. (Right-click → Open the first time to clear Gatekeeper.)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT" || { echo "Can't find the repo."; read -r -p "Press enter to close..." _; exit 1; }
echo "==> DCC launcher  ($ROOT)"

# Locate a Godot binary.
GODOT="${GODOT:-}"
if [ -z "$GODOT" ]; then
  if command -v godot >/dev/null 2>&1; then GODOT="godot"
  elif command -v godot4 >/dev/null 2>&1; then GODOT="godot4"
  elif [ -x "/Applications/Godot.app/Contents/MacOS/Godot" ]; then GODOT="/Applications/Godot.app/Contents/MacOS/Godot"
  fi
fi
if [ -z "$GODOT" ]; then
  echo "!! Godot 4.6 not found. Install it (brew install --cask godot) or set GODOT=/path/to/Godot, then re-run."
  read -r -p "Press enter to close..." _; exit 1
fi

# One-time: vendor GdUnit4 + copy the gitignored art assets if they're missing.
if [ ! -f godot/addons/gdUnit4/plugin.cfg ] || [ ! -d godot/assets ]; then
  echo "==> First-time setup (GdUnit4 + art assets)..."
  GODOT="$GODOT" ./godot/setup.sh
fi

# One-time: install the matching export templates (~1.2 GB) if missing.
VER="$("$GODOT" --version 2>/dev/null | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
TPL="$HOME/Library/Application Support/Godot/export_templates/${VER}.stable"
if [ -n "$VER" ] && [ ! -d "$TPL" ]; then
  echo "==> Installing Godot $VER export templates (one-time, ~1.2 GB)..."
  if curl -L -o /tmp/dcc-tpl.tpz "https://github.com/godotengine/godot-builds/releases/download/${VER}-stable/Godot_v${VER}-stable_export_templates.tpz"; then
    rm -rf /tmp/dcc-tpl && unzip -q /tmp/dcc-tpl.tpz -d /tmp/dcc-tpl && mkdir -p "$TPL" && cp /tmp/dcc-tpl/templates/* "$TPL/"
  else
    echo "!! Template download failed (offline?). Install via the editor: Manage Export Templates."
  fi
fi

# Absolute path: Godot resolves the export path relative to the project dir (--path),
# so a project-relative or absolute path is required — NOT a repo-root-relative one.
APP="$ROOT/godot/build/macos/DCC.app"
NEED_BUILD=0

# 1) Update check — fast-forward main only if the working tree is clean & behind.
if command -v git >/dev/null 2>&1 && [ -d .git ]; then
  echo "==> Checking for updates..."
  if git fetch --quiet origin main 2>/dev/null; then
    LOCAL="$(git rev-parse @ 2>/dev/null)"
    REMOTE="$(git rev-parse origin/main 2>/dev/null)"
    if [ "$LOCAL" != "$REMOTE" ]; then
      if [ -z "$(git status --porcelain)" ] && git merge-base --is-ancestor "$LOCAL" "$REMOTE" 2>/dev/null; then
        echo "    Update found — pulling latest..."
        git pull --ff-only --quiet origin main && NEED_BUILD=1
      else
        echo "    Local changes or diverged branch — skipping auto-update (launching your current code)."
      fi
    else
      echo "    Already up to date."
    fi
  else
    echo "    Offline (fetch failed) — launching the build you have."
  fi
fi

# 2) (Re)build when there's a new version, no app yet, OR the source is newer than the
#    last build (covers a dev box that already has the commits but a stale .app).
[ -d "$APP" ] || NEED_BUILD=1
if [ -d "$APP" ] && [ "$NEED_BUILD" != "1" ]; then
  if [ -n "$(find godot/scripts godot/scenes godot/shaders godot/project.godot godot/export_presets.cfg godot/icon.svg -newer "$APP/Contents/Info.plist" 2>/dev/null | head -1)" ]; then
    echo "    Source changed since last build — rebuilding."
    NEED_BUILD=1
  fi
fi
if [ "$NEED_BUILD" = "1" ]; then
  if [ -z "$GODOT" ]; then
    echo "!! Godot not found. Install Godot 4.6 or set GODOT=/path/to/Godot, then re-run."
    read -r -p "Press enter to close..." _; exit 1
  fi
  # Overlay any new/updated art assets (gitignored godot/assets is sourced from assets) so
  # newly added models — e.g. the per-class hero skins — sync into existing installs, not just fresh ones.
  if [ -d godot/assets ]; then cp -R assets/. godot/assets/ 2>/dev/null || true; fi
  echo "==> Building the latest client (~20s)..."
  "$GODOT" --headless --path godot --import >/dev/null 2>&1
  mkdir -p "$(dirname "$APP")"
  "$GODOT" --headless --path godot --export-release "macOS" "$APP"
  if [ ! -d "$APP" ]; then
    echo "!! Build failed. See godot/SETUP.md (export templates?)."
    read -r -p "Press enter to close..." _; exit 1
  fi
fi

# 3) Launch (connects to the live server by default; no DCC_WS = remote).
echo "==> Launching DCC..."
open "$APP"
