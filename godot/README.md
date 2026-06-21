# DCC — Native Godot 4 Client

The native client from [`../GODOT_PORT.md`](../GODOT_PORT.md). Connects to the same
Cloudflare authoritative server over `/ws`; the **server is unchanged** except the
additive `floor.geometry` field that lets a non-procgen client render the maze.

**Engine:** Godot **4.6.x** (GDScript — *not* the .NET/mono build).

> **New here? Full onboarding (install Godot, vendor GdUnit4, copy assets, run client +
> server, troubleshooting) is in [SETUP.md](SETUP.md).** The quick version follows.

## Layout
```
godot/
  project.godot              # autoloads-free; global classes + InputMap + gl_compatibility
  scenes/Main.tscn           # entry scene (root has Main.gd)
  shaders/fog.gdshader       # spatial line-of-sight fog (ground per-pixel + wall per-cell mask)
  scripts/
	DccConst.gd              # constants mirrored from src/shared/constants.ts
	Geo.gd                   # geometry decode + collision + line-of-sight (1:1 TS port)   ✅ unit-tested
	Net.gd                   # WebSocketPeer transport (welcome/floor/state/run/inv/bag)
	Predictor.gd             # client prediction (predicts at derived.moveSpeed)
	World.gd                 # wall MultiMesh + ground from server geometry (+ fog hooks)
	Fog.gd                   # per-cell wall-vis mask + applies the fog shader
	WorldDecor.gd            # themed tile/prop textures + decoration billboards
	Atlas.gd                 # loads <clip>/atlas.json + spritesheet.png -> frame rects
	EntitySprite.gd          # one billboard Sprite3D: frame stepping + facing + actions
	SpriteLayer.gd           # syncs the entity snapshot -> EntitySprites (interp remotes)
	InputCtl.gd              # move vec + camera-ray aim + cast queue (+ gamepad)
	Hud.gd                   # status line, ability bar/cooldowns, boss bar, toast, banner
	InventoryUI.gd           # character screen: equip/unequip/drop/sell + loot panel
	Minimap.gd               # discovery minimap (LoS reveal, you/allies/stairs)
	Spectate.gd              # reached/dead spectate camera (follow/cycle + free-pan)
	Main.gd                  # frame loop wiring everything + follow camera
  test/geo_test.gd           # GdUnit4 suite for the High-risk pure-logic ports
```

## Setup (one-time)
Both are gitignored (vendored/duplicated). From this `godot/` dir:
```bash
# 1) GdUnit4 test framework
git clone --depth 1 https://github.com/MikeSchulze/gdUnit4.git /tmp/gdunit4 \
  && cp -R /tmp/gdunit4/addons/gdUnit4 addons/gdUnit4
# 2) Art assets (source of truth is ../public/assets)
cp -R ../public/assets ./assets
# 3) import (generates the texture .import files + class cache)
godot --headless --path . --import
```

## Run the client
```bash
# Live server:
godot --path . res://scenes/Main.tscn
# Local wrangler dev (no deploy needed): override the server via env
DCC_WS=ws://127.0.0.1:8787/ws godot --path . res://scenes/Main.tscn
```
Run it twice to see two players. WASD/arrows move (predicted + reconciled), mouse aims,
1–4 / click cast, **I** inventory, **Tab** cycle spectate target, **V** toggle free-cam.
`DCC_SMOKE=1` runs a 7-second headless smoke then quits (used in CI/verification).

## Tests
```bash
godot --headless --path . -s res://addons/gdUnit4/bin/GdUnitCmdTool.gd \
  --add res://test/geo_test.gd --ignoreHeadlessMode
```

## Verification status
Verified here (headless, on Godot 4.6.3):
- ✅ All scripts + the shader **import parse-clean**; 13 global classes register.
- ✅ **Integration smoke** vs a live local `/ws`: connects, joins, builds the floor, and runs
  every system for 7s with **0 errors / 0 warnings** (exercises World/Fog/WorldDecor/SpriteLayer/
  Minimap/HUD wiring against a real floor message).
- ✅ **GdUnit4** geo_test: 7/7 (geometry decode byte-exact vs the server base64, collision
  determinism, line-of-sight).

Needs a display to confirm/tune (cannot be checked headless):
- ⬜ Visual correctness: sprite animation/facing, the **fog shader appearance** (headless can't
  compile shaders), camera feel, HUD/inventory layout, minimap drawing.
- ⬜ Gamepad feel; emoji glyphs (add Noto Color Emoji if labels show tofu).
- ⬜ Phase-3 **exports** (Steam/itch): need export templates installed
  (`godot --headless --export-release "macOS" build/dcc.app` etc.) + signing — see GODOT_PORT.md §5.

Per-system details, risks, and the remaining roadmap are in [`../GODOT_PORT.md`](../GODOT_PORT.md).
