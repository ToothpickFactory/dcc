# DCC Native Godot 4 Client — Definitive Port Plan

> **Status note (2026-06-16):** This plan was produced from a full multi-agent
> analysis of the codebase, verified against the actual files. It was generated
> when `PROTOCOL_VERSION` was `4`; a concurrent change shipped the character-XP
> system and bumped it to **`5`** (adding `evolve` + `swapAbility` client messages
> and `abilities`/`charXp` on `SelfDTO`). **Therefore:** the geometry change below
> targets **`PROTOCOL_VERSION = 6`**, and the GDScript `Protocol.gd` re-declaration
> must mirror the *current* `protocol.ts` (incl. `evolve`/`swapAbility`/`charXp`).
> Re-generate the message catalog from the live `protocol.ts` before coding it.

## 1. Executive Summary

DCC is a top-down sprite multiplayer dungeon-crawler. The authoritative simulation runs on Cloudflare Workers + Durable Objects (`src/server`, ~3017 LOC) and broadcasts JSON snapshots over a WebSocket at `/ws` at 20 Hz. The browser client (`src/client/*.ts`, ~1963 LOC, Three.js/WebGL) renders those snapshots, predicts the local player, and captures input. This plan ports **only the browser client** to a native Godot 4 (GDScript) client that connects to the same unchanged `/ws`.

**What stays untouched**
- **Server (~3017 LOC, `src/server`):** authoritative tick, combat, movement, loot, boss, procgen invocation — zero logic change. The **only** server edit is an additive `geometry` field on the existing `floor` message (Section 3).
- **Wire protocol shape (`src/protocol.ts`):** Godot re-declares the same JSON contract; the server keeps emitting it. One additive field + a `PROTOCOL_VERSION` bump.
- **Art (203 PNGs in `public/assets`):** imported directly into Godot — character/action clips (each a folder with `atlas.json` + `spritesheet.png`) + single-image tile/prop sheets (7 tile themes + 6 prop themes, sliced 4×4 at runtime). No re-authoring.

**What is rewritten**
- The full **client (~1963 LOC)** is rewritten in GDScript: net transport, frame loop, input, prediction, sprite/animation, world+fog rendering, HUD, inventory UI, minimap.

**What is "shared" and how it's handled (~980 LOC of TS the client transitively depends on)**
- `src/shared/*.ts` + `src/protocol.ts` + `src/procgen/*.ts`.
- **Constants** (`shared/constants.ts`) and **protocol/DTO shapes** (`protocol.ts`, `shared/types.ts`, `shared/items.ts`) are **re-declared verbatim** in GDScript (treated mostly as opaque dictionaries; only fields the UI/prediction reads are typed).
- **Procgen** (`src/procgen/*.ts`) is **NOT ported** — replaced by the server geometry message (Section 3). The collision sweep in `src/procgen/collision.ts` (`moveWithCollisions`/`canOccupy`) **is** ported (it is needed by prediction), but it consumes the server-sent grid, not a client-regenerated one.

**Measured baseline:** client ~1960 LOC rewrite · ~980 shared LOC handled (re-declared or replaced) · server ~3000 LOC untouched · 203 art PNGs reused.

---

## 2. Key Decisions (firm recommendations)

### (a) 2D vs 2.5D/3D in Godot → **Build in 3D (Node3D + PerspectiveCamera3D).** Firm.
The existing renderer is **already a billboard-sprites-in-3D design**, not a flat 2D view:
- Camera is a true `PerspectiveCamera(55°)` at `(x, 820, y+460)` looking at `(x, 0, y)` — a tilted ~29° off-vertical perspective view with foreshortening (`render.ts`).
- Walls are real extruded `BoxGeometry(cell, 96, cell)` instanced one-per-solid-cell at `y=48` — players see wall tops and sides.
- Characters/enemies/projectiles are camera-facing billboards at `(wx, h, wy)`.

A flat Godot 2D port (`Camera2D` is orthographic) would force fake projection, painted wall-top art (which **does not exist**), manual depth interleaving, and a Light2D/canvas fog approximation — **more** code **and** lower fidelity. Godot 3D is a near-mechanical transcription: `Camera3D(fov=55)`, `MultiMeshInstance3D` of `BoxMesh(cell,96,cell)`, `Sprite3D(billboard=enabled)`, `PlaneMesh` ground, world `(x,y) → (x, 0, y)`. The fog GLSL ports 1:1 only in a 3D **spatial** shader (world XZ comes free from `MODEL_MATRIX * VERTEX`); a 2D canvas_item shader cannot see world XZ at all. Perf is a non-issue natively.

### (b) GDScript vs C# → **GDScript.** Firm.
The wire format is dynamically-typed JSON; GDScript's `Dictionary`/`JSON.parse_string` map 1:1 to the TS `m.t` switch with zero marshalling. No CPU-bound hot path justifies C# (collision sweep + fog CPU pass run on cell-change, not per-frame). GDScript keeps single-runtime export simplest for Steam/itch. Swap to C# only if a future binary-delta protocol profiles as a bottleneck — isolated behind the `Net`/`Protocol` autoloads.

### (c) Server-sends-geometry vs porting procgen → **Server sends geometry.** Firm.
Today the client regenerates the maze locally via `generateFloor(seed, depth)` because the `floor` message carries **no** geometry. Porting `mulberry32` + maze carve + decoration RNG bit-identically to GDScript is high-risk: a one-cell drift makes the local player visibly stick/slide where the server passes. Procgen is fully deterministic from `(seed, depth)` and the server already holds the full `FloorDescriptor`, so serializing it is cheap, exact, and removes a whole class of desync bugs. **Caveat:** this removes the need to port *generation*, **not** *consumption* — Godot still builds the wall mesh, fog textures, and minimap from the grid array.

### (d) Protocol re-declaration vs codegen → **Hand re-declare in a `Protocol.gd` autoload.** Firm.
The contract is small (plain JSON keyed by `t`/`e`). Codegen TS→GDScript is overkill. Re-declare `const PROTOCOL_VERSION`, outbound builder funcs (`send_join`, `send_input`, `send_cast`, …), and an inbound `match m["t"]` dispatcher. **Mitigate drift** with: (1) client-side version check on `welcome.protocol`; (2) a rule that any `protocol.ts` shape change bumps the version and updates `Protocol.gd` in the same PR.

---

## 3. Server-Side Change Spec — "send floor geometry" (the ONLY server change)

The Godot client cannot run the TS procgen, so the static render geometry must ride the existing `floor` message. **Spawns and chests are excluded** — monsters and loot bags already arrive as live `EntityDTO`s in the per-tick `state` broadcast. Only walls + entrance + stairs + decorations are missing.

### Files to edit (3 files, ~15 lines)
1. `src/protocol.ts` — bump version (**5 → 6**), add interface, extend the `floor` variant.
2. `src/procgen/index.ts` — add + export `encodeSolid(solid: Uint8Array): string`.
3. `src/server/world-do.ts` — import `encodeSolid`; populate `geometry` in `floorMsg()`.

### Exact fields (`src/protocol.ts`)
```ts
export const PROTOCOL_VERSION = 6; // was 5 — wire shape changed (floor geometry)

export interface FloorGeometry {
  gw: number;            // grid width in cells  (currently 30 = floor(2400/80))
  gh: number;            // grid height in cells (30)
  cell: number;          // cell size px (80)
  solid: string;         // base64 of the gw*gh Uint8Array, row-major y*gw+x (1 = wall)
  entrance: { x: number; y: number };            // world px, cell-centered
  stairs:   { x: number; y: number; r: number }; // r = 48 pickup radius
  decorations: { x: number; y: number; variant: number; scale: number }[]; // <=24
}

// extend the floor server message variant:
| { t: "floor"; info: FloorClientInfo; state: FloorState; geometry: FloorGeometry }
```
`FloorClientInfo` is left intact (browser still rebuilds from `seed`); `geometry` is purely additive and the browser ignores it.

### Encoding & bandwidth
- **Ship base64-of-raw-900-bytes** (recommended): `solid` is `gw*gh` bytes (900), base64 ≈ **~1.2 KB**. Godot decode: `Marshalls.base64_to_raw(s)` → `PackedByteArray` length 900, index `y*gw+x`.
- **Do NOT** `JSON.stringify(Uint8Array)` — serializes to an index-keyed object (~5–6 KB) and is painful to decode. Encode explicitly.
- decorations ≤24 × ~4 numbers ≈ ~600 B; entrance/stairs ≈ 80 B. **Total floor message < 2 KB**, sent **once per floor change** (join, `broadcastFloorRun`, descend). ~20 floors/run ≈ ~40 KB lifetime — negligible vs the per-tick `state` stream.
- Optional RLE+LEB128+base64 (~0.5 KB) only if floor-transition bandwidth ever matters; the wire field stays `solid: string` so the protocol doesn't change between encodings.

### Critical do-nots
- Bump `PROTOCOL_VERSION` **5 → 6** in lockstep.
- Decode in Godot must use server-sent `gw/gh/cell`, never hardcoded 30/80.
- Geometry rides only on floor-change sends; never stuff it into the per-tick `state` broadcast.
- Wall world transform must match the renderer exactly: solid cell `(x,y)` → box center `((x+0.5)*cell, 48, (y+0.5)*cell)`, size `(cell, 96, cell)`, index `y*gw + x`.

---

## 4. Per-System Port Table

| # | System | Primary files | Effort | Godot approach | Top risk |
|---|--------|---------------|--------|----------------|----------|
| 1 | **Net transport** | `client/net.ts`, `protocol.ts` | **M** | `Net` autoload (Node) with `WebSocketPeer` (raw JSON, NOT high-level RPC). Poll every `_process`: `poll()`, diff `get_ready_state()` for open/close, drain packets, `JSON.parse_string` → `match m.t`. Two-snapshot ring `prev/cur` with `recv = Time.get_ticks_msec()`. Signals: `welcome/events/closed/inv/bag`. | No `location` object → server URL from config/export var; poll-driven (no callbacks); `wss://` needs `TLSOptions` for dev certs. |
| 2 | **Frame loop / orchestration** | `client/main.ts` | **L** | `Main.gd` Node3D root; `_process(delta)` = `frame()` body, `dt = min(0.05, delta)`. `Camera3D` child. Floor-transition keyed on `seed:depth`; spectate state machine (alive→reached→dead); loot-nearest scan; toast. | Ordering: `predictor.update → aimFromPointer → input.pump`; floor rebuild keyed on `seed:depth` NOT depth; spectate target snapshotted on enter. |
| 3 | **Sprite & animation** | `client/render.ts`, `client/atlas.ts` | **L** | `Sprite3D(billboard=enabled, NEAREST)`. Manual frame stepping (NOT `AnimatedSprite`) — per-sprite `AtlasTexture`, mutate `.region` per frame; `flip_h` for left. Port facing hysteresis, MOVEMENT_HOLD, action one-shots, FNV-1a enemy variant, enemy 1.6× slowdown verbatim. | One `AtlasTexture` per sprite (don't share); 3-dir facing only; local self uses **predicted** pos for movement delta. |
| 4 | **World + fog of war** | `client/render.ts` | **XL** | `MultiMeshInstance3D` of `BoxMesh` walls; `PlaneMesh` ground; one **spatial ShaderMaterial** (unshaded) branched by `u_is_wall`. Port `dccLos()` (48-step half-cell marcher) for ground, `u_wall_vis` texture for walls. R8 `ImageTexture`, NEAREST, no repeat. CPU `computeWallVis` + `canSee` (Amanatides-Woo) on cell-change only. | Spatial shader, NOT canvas_item; recompute wall-vis on cell-move ONLY (per-frame reintroduces the fixed flicker); `(cell+0.5)/gridSize` half-texel sampling. |
| 5 | **Prediction + reconciliation** | `client/predict.ts`, `procgen/collision.ts` | **M** | `Predictor` RefCounted; port `moveWithCollisions` (axis-separated X-then-Y, circle-vs-AABB `canOccupy`, r=17) to a shared `Collision.gd`. Soft blend `x += (server_x - x) * 0.15` every frame. Grid from server geometry. | **Use `SelfDTO.derived.moveSpeed`, not flat 230** (fixes a latent TS bug); axis order must match server; frame-rate-dependent 0.15 → exponential-decay form if not 60fps. |
| 6 | **Input** | `client/input.ts` | **M** | `InputMap` actions (move_*, ability_1..6, cast_primary) + gamepad. `Input.get_vector` for move; aim from `Camera3D` ray onto `Plane(UP,0)` → `atan2(hit.z-py, hit.x-px)`. Cast immediate, move throttled to 100ms accumulator. One monotonic `seq`. Focus-out releases keys. | Diagonal speed: both TS predictor + server normalize by hypot — preserve that, then `get_vector` is safe; dedupe touch+emulated-mouse double cast. |
| 7 | **HUD overlay** | `client/hud.ts`, `client/main.ts` (toast/banner) | **M** | `CanvasLayer` of `Control`s with anchors. Status `RichTextLabel` (BBCode); ability bar `HBoxContainer` of 64×64 slots (cooldown = bottom-anchored `ColorRect`, `anchor_top = 1 - fill`); boss bar; toast `Label`+Tween; waiting banner. `MOUSE_FILTER_IGNORE` on passive nodes. | Emoji font (Noto Color Emoji) required or tofu boxes; `cds`/`tick` are logical-ms, floor timer is wall-clock — two clocks; toast+banner live in `main.ts`. |
| 8 | **Character/Inventory UI** | `client/inventory.ts` | **XL** | Modal `Control` (`GridContainer`s) for equipped/bag/carried + stat panel + loot panel. Tap-to-equip/unequip/take. Ability swap = 2-tap optimistic. Sell badges only when `reached`. Rebuild gated by `barKey` cache. | Server can reject equip/unequip/sell — do NOT mutate locally (only ability-swap selection is optimistic); `inv` and `state` arrive on different messages → two signals; CSS is inline in `index.html`. |
| 9 | **Discovery minimap** | `client/minimap.ts` | **M** | `Control` with `_draw()` (`draw_rect`/`draw_circle`). `discovered` = `Dictionary`. Reveal on cell-change; redraw throttled 80ms. Port `lineOfSight` DDA verbatim (twin of `canSee`). | LoS must match fog exactly (shared `VISION_RADIUS=520`); reveal centers on **predictor** pos while fog centers on **camera** target — preserve the split; `set_floor` on every `seed:depth` change. |
| 10 | **Wire protocol** | `protocol.ts`, `shared/types.ts`, `shared/items.ts` | **M** | `Protocol.gd` autoload: `const PROTOCOL_VERSION`, outbound builders, inbound dispatch. Re-declare DTO shapes (mostly opaque dicts). `cds` keys parse as Strings → `int(key)`. **Include the current message set: `evolve`, `swapAbility`, `charXp`/`abilities` on SelfDTO.** | Three id spaces (slot index vs atlas frame vs string id); `sprite` 98/99 = monster/boss bolt sentinels; parallel copy drifts — version-gate + changelog rule. |
| 11 | **Asset import (203 PNGs)** | `client/atlas.ts`, `public/assets/**` | **L** | Offline `@tool` EditorScript walks `public/assets`, reads each `atlas.json`, builds per-frame `AtlasTexture` regions, NEAREST/no-mipmaps. Import ONLY clips `render.ts` uses (MOVE + Cast/Bolt/Strike + hero Punch/Kick). Tiles/props = single PNG sliced 4×4. | Inconsistent rosters (Ghoul 5×5, Goblin `custom_right` 7×7/256px, only Kevin has Punch/Kick) — read frame_size/count per-atlas; 13 tile/prop PNGs have NO atlas.json; exclude `Clean-Folders.ps1`. |
| 12 | **Server geometry send** | `protocol.ts`, `procgen/index.ts`, `server/world-do.ts` | **S** | See Section 3. Server-side only; Godot decodes base64 → `PackedByteArray`. | `JSON.stringify(Uint8Array)` balloons — encode base64 explicitly; bump version 5→6. |

---

## 5. Phased Roadmap

### Phase 0 — Spike (1–3 days)
**Goal:** prove a Godot window connects to the live `/ws`, renders the maze from server geometry, and shows your own sprite moving with prediction.

**Server change (do first, ~half day):** implement Section 3 exactly (version 5→6, `FloorGeometry`, `encodeSolid`, populate in `floorMsg()`). Verify the existing browser client still works unchanged (it ignores `geometry`).

**Godot file list (new project):**
- `Net.gd` (autoload) — `WebSocketPeer`, poll, join-on-open, decode `welcome`/`floor`/`state`, store `cur/prev`.
- `Protocol.gd` (autoload) — `PROTOCOL_VERSION = 6`, `send_join`, `send_input`, version check.
- `Collision.gd` (autoload) — `moveWithCollisions` + `canOccupy` ported from `procgen/collision.ts`.
- `Predictor.gd` — integrate at `derived.moveSpeed`, 0.15 blend.
- `World.gd` (Node3D) — decode `geometry.solid` → `PackedByteArray`; build `MultiMeshInstance3D` walls + `PlaneMesh` ground (flat textures OK, no fog yet); `Camera3D(fov=55)` follow.
- `Main.gd` — `_process` loop: predict, camera follow, one `Sprite3D` placeholder for self.
- `Input.gd` — `InputMap` move actions, 100ms input send.

**Acceptance:** two Godot instances connect to the live server simultaneously; each sees the same wall layout (decoded grid prints identical `gw/gh/cell` and matching wall count vs the browser's `generateFloor`); WASD moves your sprite with no rubber-banding into walls the server allows; reconnect with stored `token` keeps identity.

### Phase 1 — Playable prototype (~1–2 weeks)
All entities as billboard `Sprite3D` with directional clips (system 3), full input incl. aim + casts (6), HUD status line + ability bar with cooldowns (7), snapshot interpolation for remote entities (prev→cur), basic toast. No fog/inventory/minimap yet.
**Acceptance:** a human plays a full floor — move, aim, cast all 6 abilities, see monsters/boss/projectiles/loot animate at 20 Hz, descend stairs.

### Phase 2 — Feature parity (~2–4 weeks)
Fog + LoS spatial shader + CPU wall-vis (4, the XL item), discovery minimap (9), full inventory/character UI + loot + ability swap + sell (8), spectate/waiting state machine (2), all 7 themes' tiles/props + decorations + stairs pulse, emoji font, asset import finalized (11).
**Acceptance:** side-by-side parity with the browser client on the same live server (Section 8).

### Phase 3 — Polish / native (~1–2 weeks)
Gamepad twin-stick aim, settings (server URL, resolution, audio), Steam + itch.io builds with auto-update (itch via `butler push`; Steam via depots/`GodotSteam`), threaded staggered asset preload, ping/pong RTT, FX from the 5 currently-ignored GameEvents.
**Acceptance:** signed desktop builds launch, auto-update, controller-playable end to end.

---

## 6. Parallelization Across 4 Generalist Devs

After Phase 0 lands (shared by the whole team), the autoloads (`Net`, `Protocol`, `Collision`, `Predictor`) form stable seams:

- **Dev A — Network, orchestration, prediction (systems 1, 2, 5, 10, 12).** Owns the server geometry change, the `Net`/`Protocol` autoloads, `Main.gd` frame loop, prediction, protocol re-declaration. The spine — drives Phase 0, locks the autoload contract early.
- **Dev B — World rendering & fog (system 4 + geometry-consumption side of 12).** The XL fog system, wall MultiMesh, ground, themed tiles/props/decorations, camera, spatial shader. Start Phase 1 with flat walls, deliver fog in Phase 2.
- **Dev C — Sprites, animation & asset pipeline (systems 3, 11, 9).** Asset import EditorScript, `Sprite3D` billboards, facing/animation, enemy-variant hashing, discovery minimap (shares `VISION_RADIUS` + LoS with B via `Const.gd`).
- **Dev D — UI: HUD, inventory, input (systems 7, 8, 6).** `CanvasLayer` HUD, the XL inventory screen, input map + gamepad, Phase 3 packaging. Low coupling to the 3D scene.

**Freeze before fan-out:** autoload signal/field names (A); a `Const.gd` (`VISION_RADIUS=520`, `PLAYER_RADIUS=17`, `TICK_MS=50`, `INPUT_MS=100`, `cell`); the `floor`-change signal that triggers rebuild in B (world), C (minimap), A (predictor).

---

## 7. Risk Register

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Protocol drift** — `Protocol.gd` is a parallel hand-copy; server only announces version in `welcome`. | **High** | Client reads `welcome.protocol`, compares to local const, hard-fails/warns on mismatch. PR rule: any `protocol.ts` shape change bumps version + edits `Protocol.gd` same PR. |
| **Geometry decode desync** — hardcoded 30/80 or wrong indexing makes walls/fog/minimap wrong. | **High** | Decode with server-sent `gw/gh/cell`; index `y*gw+x`; assert wall transform. Phase-0 acceptance compares wall count vs browser. |
| **Prediction speed mismatch** — TS predictor uses flat 230, server uses `derived.moveSpeed` (agility-scaled). | **High (once geared)** | Predict at `SelfDTO.derived.moveSpeed`. For slows, `SelfDTO` has no slow flag — rely on the 0.15 blend (consider adding a slow flag to `SelfDTO` later for clean parity; out of scope for the minimal edit). |
| **Collision non-determinism** — axis order / float drift makes the local player stick/slide. | **High** | Port `moveWithCollisions` X-then-Y verbatim; nearest-point circle-vs-AABB clamp; out-of-bounds = solid. |
| **Fog as 2D shader** — canvas_item can't see world XZ; fog silently fails. | **High** | Mandate 3D **spatial** shader on ground+wall meshes. Biggest silent-failure trap. |
| **Wall-vis flicker regression** — per-frame recompute reintroduces fixed flicker. | **Medium** | Track `last_vis_cell`; recompute + `texture.update()` ONLY on cell change. |
| **Emoji rendering** — HUD/inventory use emoji glyphs; default font shows tofu. | **Medium** | Add Noto Color Emoji to relevant Labels/RichTextLabels. |
| **Cooldown clock confusion** — `cds`/`tick` logical-ms vs floor `endsAt` wall-clock. | **Medium** | Compare `cds[str(i)]` against `state.tick`; floor timer against wall-clock. Never mix. |
| **Optimistic inventory mutation** — server rejects silently (no error reply). | **Medium** | Send intent, wait for next `inv` snapshot. Only ability-swap selection is optimistic. |
| **Atlas roster inconsistency** — varying frame grids/sizes per character. | **Medium** | Import script reads `frame_size`/count/`duration_s` per-atlas; never hardcode. |
| **Snapshot interpolation gap** — 20 Hz looks choppy if raw. | **Medium** | Interpolate `prev→cur` (~50ms delay) via `recv` stamps; predict local only. |
| **`sprite` sentinel conflation** — 98/99 are bolt sentinels, not atlas ids. | **Low** | Special-case 98/99 → bolt color/size before atlas lookup. |
| **TLS / server URL** — no `location`; `wss://` cert trust. | **Low** | Server URL from config; `TLSOptions` for dev certs. |

---

## 8. Verification / Acceptance Per Phase

**Cross-cutting harness — run 2+ Godot instances against the live `/ws`,** plus one browser client as the reference oracle. The server is authoritative and unchanged, so all three must agree on entity positions, HP, floor layout, run phase.

- **Phase 0:** Two Godot instances connect; both decode identical `gw/gh/cell` + matching wall count; print-compare the decoded `solid` grid against the browser's `generateFloor(seed,depth)` collision for the same `seed:depth` (must be byte-identical — validates the geometry serialization end to end). Prediction never tunnels a wall the server blocks; reconnect-with-token preserves identity/inventory.
- **Phase 1:** Side-by-side with the browser: same monster/boss/projectile positions each tick (within rounding + interpolation delay); all 6 abilities produce the same `cast`/`hit` events and sprites; cooldown shades drain at the same rate (vs `state.tick`); descend fires on both.
- **Phase 2:** **Fog parity** — same path → revealed wall set + ground falloff band `[0.6R, R]` match (minimap discovered set == fog wall-vis set). **Inventory parity** — equip/unequip/sell/swap/drop/take round-trip identically (server is oracle). **Spectate parity** — reach stairs while another player lives; waiting room, hidden ability bar, follow/cycle (Tab)/free-pan (V) match the browser.
- **Phase 3:** Exported signed builds launch + auto-update (push bumped build, confirm clients update); full playthrough on gamepad; no load hitch on floor transitions.

**Determinism spot-checks:** FNV-1a enemy-variant hashing maps a given monster id to the same species as the browser; `cds` keys read via `int(str_key)`; prediction uses `derived.moveSpeed` (gear up agility, confirm no rubber-band).

---

## 9. What Could Go Wrong — Parity Traps (explicit)

- **Fog coordinate space.** Fog runs in **world XZ** under a *perspective tilted* camera. A Godot **2D canvas_item shader has no world XZ** and will not reproduce it — the #1 silent failure. Must be a 3D **spatial** shader (XZ from `MODEL_MATRIX*VERTEX`). For MultiMesh walls, `MODEL_MATRIX` already includes the per-instance transform — don't double-multiply. Ground uses per-pixel `dccLos()` (48-step half-cell marcher — keep constant bound + early break); walls use the per-cell `u_wall_vis` texture, sampled at `(cell+0.5)/gridSize` with R8/NEAREST/no-repeat. Fog centers on the **camera target** (`camX/camY`, spectate-aware) while the minimap reveal centers on the **real predictor** position — preserve the split.
- **Prediction.** Soft 0.15 blend, **not** rollback/replay (the client ignores `ack` today; `seq` is sent for a future reconciler). The 0.15 is tuned at 60fps; at variable fps use `p += (target-p)*(1 - pow(1-0.15, dt*60))`. Server steps at fixed dt=0.05 (20 Hz); client predicts at variable dt capped at 0.05. Predict **local self only**; interpolate others. **Fix the latent bug:** predict at `derived.moveSpeed`, not flat 230.
- **Atlas / facing.** 3-direction art only (up/down/right); **left is mirrored** (`flip_h`). Facing hysteresis (`DIR_SWITCH_BIAS=1.2`), `facingFromVector` ties (`|dx|>=|dy|`) → `right`, idle faces by aim. Each sprite needs its **own** `AtlasTexture`. Action one-shots **latch** facing at trigger. Local self's animation is driven by **predicted** position.
- **Protocol drift.** `cds` keys are JSON **strings** → `int()`; three id spaces never conflated (`cast.ability`/`cds` = slot index; `EntityDTO.sprite` = atlas frame, 98/99 = bolt sentinels; string ids elsewhere); `mv` is a 2-elem Array not Vector2; `reached` players are omitted from `ents` so render self from `self`, never from `ents`; loot is two-phase (merge by `grant.id`).
- **Two clocks.** `cds`/`tick` are server logical-ms; `FloorState.endsAt` is wall-clock. Mixing them produces wrong countdowns.
- **Floor rebuild key.** Keyed on `seed:depth`, **not** depth (a fresh run at the same depth must regenerate). Drives world rebuild, minimap reset, predictor `set_collision`.
- **Input edges.** One monotonic `seq` for `input` + `cast`; cast immediate, move throttled 100ms; dedupe touch + emulated-mouse double-casts; release keys on focus-out.
