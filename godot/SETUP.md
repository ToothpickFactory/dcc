# DCC Godot Client — Dev Setup

Onboarding for the native Godot client (`godot/`). It connects to the same Cloudflare
server as the web client over `/ws`. See [GODOT_PORT.md](../GODOT_PORT.md) for the design.

> Two things are **gitignored** and must be set up locally per machine: the **GdUnit4**
> test addon and a copy of the **art assets**. Steps 3a/3b below handle them.

## Prerequisites
- **Godot 4.6.x — Standard (GDScript) build.** *Not* the .NET/Mono build.
- **git**, and access to the repo (`github.com/ToothpickFactory/dcc`).
- Optional (only to run the server locally): **Node 22+** and the repo's npm deps.

## 1. Get the code
```bash
git clone https://github.com/ToothpickFactory/dcc.git
cd dcc
```

## 2. Install Godot 4.6 (Standard / GDScript)
- **macOS (Homebrew):** `brew install --cask godot`
  Optional CLI on PATH (Apple Silicon): `ln -s /Applications/Godot.app/Contents/MacOS/Godot /opt/homebrew/bin/godot`
- **macOS/Windows/Linux (manual):** download "Godot Engine 4.6.x" (the plain build, not .NET) from <https://godotengine.org/download>.
- Verify: `godot --version` → `4.6.x.stable…` (or launch the app).

## 3. One-time project setup (the gitignored bits)
Run from the **repo root**:

**3a. Vendor the GdUnit4 test addon** (tested with 6.2.0):
```bash
git clone --depth 1 https://github.com/MikeSchulze/gdUnit4.git /tmp/gdunit4 \
  && cp -R /tmp/gdunit4/addons/gdUnit4 godot/addons/gdUnit4
```

**3b. Copy the art assets** (source of truth lives in `public/assets`):
```bash
cp -R public/assets godot/assets
```

**3c. Import** (generates texture `.import` files + the class cache):
```bash
godot --headless --path godot --import
```
(If `godot` isn't on PATH, use the full app path, e.g. on macOS
`/Applications/Godot.app/Contents/MacOS/Godot --headless --path godot --import`.)

## 4. Run the game
You need a server that speaks **protocol v6** (sends `floor.geometry`). Easiest is local
(step 5); or use the deployed server once someone has run `npm run deploy`.

**From the editor:** open the Godot Project Manager → **Import** → select
`dcc/godot/project.godot` → open it → press **F5**. (If prompted, enable the GdUnit4 plugin.)
To point at a local server, edit the **Main** node's `server_url` export, or set the
`DCC_WS` env var before launching.

**From the CLI:**
```bash
# Live (deployed) server — the default:
godot --path godot res://scenes/Main.tscn
# Local server (no deploy needed):
DCC_WS=ws://127.0.0.1:8787/ws godot --path godot res://scenes/Main.tscn
```
Launch it twice to test two players.

## 5. Run the server locally (optional but recommended)
From the repo root:
```bash
npm install                 # once
cp .dev.vars.example .dev.vars   # once (local secrets)
npm run dev                 # wrangler dev on http://127.0.0.1:8787  (WS at /ws)
```
Reset the run anytime (local admin is open): `curl -X POST http://127.0.0.1:8787/admin/new-run`

## 6. Run the tests (GdUnit4)
```bash
godot --headless --path godot -s res://addons/gdUnit4/bin/GdUnitCmdTool.gd \
  --add res://test/geo_test.gd --ignoreHeadlessMode
```
`geo_test.gd` checks the pure-logic ports (geometry decode, collision, line-of-sight).

## 7. Controls
- **WASD / arrows** move · **mouse** aim · **1–4 / left-click** cast · **I** inventory
- **Tab** cycle spectate target · **V** toggle free-cam (while dead/in the waiting room)

## 8. Dev env flags (optional)
| Var | Effect |
|-----|--------|
| `DCC_WS=ws://…/ws` | Override the server URL |
| `DCC_NOLOGIN=1` | Skip the name screen (auto-join as `GodotHero`) |
| `DCC_DEBUG=1` | Per-second state prints (cam/pred/floor/ents) |
| `DCC_SMOKE=1` | Run ~7s then quit (headless CI smoke; skips login) |
| `DCC_SHOT=1` | Save a viewport screenshot to `/tmp/dcc_shot.png` after ~4.5s |

## 9. Troubleshooting
- **Black screen / "No floor geometry" toast** → the server isn't on protocol v6. Run a
  local server (step 5) and use `DCC_WS=ws://127.0.0.1:8787/ws`, or have someone `npm run deploy`.
- **Missing textures / blank sprites** → you skipped step 3b/3c. Copy `public/assets` → `godot/assets`, then re-import.
- **`GdUnitCmdTool.gd` not found / tests won't run** → you skipped step 3a (GdUnit4 vendor).
- **UI too big/small** → it scales with window size; resize the window (it re-scales live).
- **`godot: command not found`** → use the full app path, or symlink the CLI (step 2).
