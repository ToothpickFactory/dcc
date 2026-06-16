# DCC — Native Godot 4 Client (Phase 0)

The native client from [`../GODOT_PORT.md`](../GODOT_PORT.md). Connects to the same
Cloudflare authoritative server over `/ws`; the **server is unchanged** except the
additive `floor.geometry` field that lets a non-procgen client render the maze.

**Engine:** Godot **4.6.x** (GDScript — *not* the .NET/mono build).

## Layout
```
godot/
  project.godot
  scenes/Main.tscn         # entry scene
  scripts/
    DccConst.gd            # constants mirrored from src/shared/constants.ts
    Geo.gd                 # geometry decode + collision + line-of-sight (1:1 TS port)  ✅ unit-tested
    Net.gd                 # WebSocketPeer transport (welcome/floor/state)
    Predictor.gd           # client prediction (predicts at derived.moveSpeed)
    World.gd               # wall MultiMesh + ground from server geometry
    Main.gd                # frame loop: connect, build, predict, follow camera
  test/geo_test.gd         # GdUnit4 suite for the High-risk pure-logic ports
```

## Setup (one-time)
GdUnit4 is gitignored (vendored, large). Install it:
```bash
git clone --depth 1 https://github.com/MikeSchulze/gdUnit4.git /tmp/gdunit4 \
  && cp -R /tmp/gdunit4/addons/gdUnit4 addons/gdUnit4
```

## Run the client
Point it at the live server (or local `wrangler dev` → `ws://127.0.0.1:8787/ws`):
```bash
godot --path . res://scenes/Main.tscn
```
You should see the maze (walls from server geometry) and a cyan box (you) that moves
with WASD/arrows and reconciles to the server. Run it twice to see two players.
Override the server in the Main node's `server_url` export, e.g.
`ws://127.0.0.1:8787/ws` for local dev.

## Run the tests (verifies parity of the ported logic)
```bash
godot --headless --path . -s res://addons/gdUnit4/bin/GdUnitCmdTool.gd \
  --add res://test/geo_test.gd --ignoreHeadlessMode
```
`geo_test.gd` checks geometry decode (byte-exact vs the server's base64), collision
determinism, and line-of-sight — the three "High" risks in GODOT_PORT.md.

## Status
- ✅ Phase 0 scaffold: server geometry change, decode + collision + LoS (tested), WS
  transport, wall/ground rendering, prediction, follow camera.
- ⬜ Phase 1+: sprite/animation, HUD, fog shader, inventory, minimap, spectate — see
  the per-system table and roadmap in [`../GODOT_PORT.md`](../GODOT_PORT.md).
