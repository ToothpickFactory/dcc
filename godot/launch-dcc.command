#!/bin/bash
# DCC — click-to-play launcher (macOS). Double-click this file to:
#   1. check git for a newer `main` and fast-forward to it (if your tree is clean),
#   2. re-export the native .app when there's a new version (or it's missing),
#   3. launch the game (which connects to the live server by default).
#
# Put this on your Desktop/Dock via an alias, or just double-click it in Finder.
# Needs: git, Godot 4.6 on PATH or at $GODOT, and the export templates installed
# (see godot/SETUP.md "Building a native release").

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

APP="godot/build/macos/DCC.app"
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

# 2) (Re)build when there's a new version or no app yet.
[ -d "$APP" ] || NEED_BUILD=1
if [ "$NEED_BUILD" = "1" ]; then
  if [ -z "$GODOT" ]; then
    echo "!! Godot not found. Install Godot 4.6 or set GODOT=/path/to/Godot, then re-run."
    read -r -p "Press enter to close..." _; exit 1
  fi
  echo "==> Building the latest client (~20s)..."
  "$GODOT" --headless --path godot --import >/dev/null 2>&1
  mkdir -p godot/build/macos
  "$GODOT" --headless --path godot --export-release "macOS" "$APP"
  if [ ! -d "$APP" ]; then
    echo "!! Build failed. See godot/SETUP.md (export templates?)."
    read -r -p "Press enter to close..." _; exit 1
  fi
fi

# 3) Launch (connects to the live server by default; no DCC_WS = remote).
echo "==> Launching DCC..."
open "$APP"
