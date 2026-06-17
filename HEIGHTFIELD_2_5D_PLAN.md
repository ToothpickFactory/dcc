# Heightfield 2.5D Terrain — Implementation Plan

Goal: give each grid cell a **ground height** so floors get ramps, raised daises, sunken
pits, and sloped caves — turning "flat dungeon" into "place." One walkable surface per
(x,y) (no stacked floors / bridges / overpasses — that's a different engine). Scope is
**server (TS) + Godot client only**; the web/Three.js client is explicitly out of scope.

This plan is grounded in a code-level audit of every affected subsystem (collision,
movement, projectiles/combat, protocol/wire, procgen, Godot world render, fog/LoS,
predictor, persistence). File:line references are to the audited code.

---

## TL;DR — the recommendation

**Ship VISUAL-ONLY first, then add gameplay height behaviors one at a time behind it.**

The decisive insight: **for a single walkable surface per (x,y), visual-only height is
*provably correct*, not a compromise.** Raising or lowering a walkable cell changes
*nothing* about which cells are walkable, which walls occlude sight, or how combat
resolves — so 2D collision, 2D combat, and 2D wall-LoS remain exactly correct. You get
ramps/daises/pits you can see and walk over, with **zero rubber-band risk**, because the
authoritative movement path stays byte-identical to today.

Every *gameplay* height behavior (cliffs that block movement, slope-scaled speed,
height-gated combat, height-aware LoS) requires a bit-identical TS↔GDScript reimplementation
of a new threshold function across the prediction boundary — the exact class of bug we just
spent a batch fixing. We defer all of it.

> **Hard cut-line:** the moment a height value is read inside `canOccupy` / `canOccupyWorld`
> / `Predictor._occupy`, you have left the MVP. If it touches move-acceptance or the
> prediction loop, it's v2. Phase 1–3 may read height **only** in render code and procgen.

Why this ordering and not "do it all at once": the predictor *already* has a latent parity
gap (it never applies `SLOW_FACTOR` — `movement.ts:18` halves speed under slow, `Predictor.gd:90`
doesn't). That proves the two movement paths can't currently be held in perfect sync even
for a scalar multiply. Stacking interpolated step-up gating on top of that is how you get
constant 120px reconciliation snaps. So we close that crack *first*, ship the safe visual
layer, prove it stable in the wild, *then* widen the road.

---

## Frozen design decisions

These resolve the contradictions the audit surfaced. Decide once, freeze, don't relitigate
mid-build.

| Decision | Choice | Why |
|---|---|---|
| **Storage** | `ground: Int16Array` on `CollisionGrid`, **fine grid** (post-2×-scale), px units, row-major `cy*w+cx` (same layout as `solid`) | Fine grid is the only grid that ships and that collision/Geo read — keeps height indices bit-aligned with `solid` and px positions, no second upscale to keep in sync. Int16 px is integer (parity-safe) and px-native (procgen convenience). Named `ground` not `height` (`CollisionGrid.h` already means row-count). |
| **Wire format** | base64 `ground?: string` on `FloorGeometry`, additive/optional, 2 bytes/cell | Reuses the proven `encodeSolid`/`Marshalls.base64_to_raw` once-per-floor channel. ~98KB/floor at 192² — fine once-per-floor, never on the 20Hz path. Float32 (147KB, parity-fragile) rejected. |
| **Per-tick z** | **None.** z is derived from (x,y) + the static ground array on both sides | One surface per cell ⇒ z is fully derivable. Per-tick z would be pure redundant 20Hz bandwidth. (Add `EntityDTO.z` only if a v2 system needs *authoritative* vertical state — fall damage/jump — which MVP has none of.) |
| **Render sampler** | `Geo.ground_height(grid,x,y)` = **bilinear** (smooth ramps), frozen now as canonical | Render-only at MVP (no server partner ⇒ no parity risk). Matches the linearly-interpolated ground mesh. |
| **Future gate sampler** | nearest-cell **integer** lookup (separate function), used only in v2 | Integer compare can *never* disagree across TS double vs GDScript float32 — neutralizes the #1 rubber-band hazard. The gate must never read the bilinear render sampler. |
| **Walkable gradient** | `WALKABLE_DELTA` (~24px) caps |Δheight| between open 4-neighbors in procgen, **= the future v2 step-up threshold** | Generating within the cap from day one means v2 can flip the gate on with nothing becoming an island. Also makes visual-only look right (gentle ramps, no wall-climbing up a cliff face). |
| **Projectile z** | cosmetic client-side lift (server stays flat) | Combat is 2D at MVP; arcs/`vz` deferred. |

---

## Phase 0 — Close the latent predictor parity gap *(prerequisite, tiny)*

Fix the existing `SLOW_FACTOR` divergence before adding *any* height logic, so it isn't a
confounder when debugging height parity later.

- `godot/scripts/Predictor.gd` (~`:90`, `update`): apply `SLOW_FACTOR` to `moveSpeed` when the
  player is slowed, mirroring `src/server/sim/movement.ts:18`. Thread the slow flag in from
  the snapshot the predictor already receives.
- **Verify:** under frost, the local player no longer over-shoots and relies on `_reconcile`
  to claw back — watch predicted-vs-server error stay small (it currently spikes under slow).

This is a real standalone bug fix worth landing regardless of the heightfield.

---

## Phase 1 — Procgen heightfield *(server-only; no wire, no render, no collision change)*

Generate a deterministic, provably-traversable height field. **Nothing renders or ships yet**
— this phase is pure data + tests.

- **`src/procgen/types.ts:3-8`** — add `ground: Int16Array` to `CollisionGrid` (length `w*h`,
  fine grid, px, layout `cy*w+cx`). Comment the `h`=row-count vs `ground`=elevation naming.
- **`src/procgen/index.ts:~107`** (end of `generateFloor`, after `theme`, before `return`) —
  capture the height sub-seed as **the very last `random()` draw**:
  `const heightSeed = (random() * 0x100000000) >>> 0;`. This is critical: inserting a draw
  anywhere earlier shifts every downstream draw and changes *every* existing floor layout.
- **`src/procgen/index.ts:69`** — after `scaleGrid`, call `buildHeightField(...)` and assign
  `collision.ground`. New function `buildHeightField(collision, scaledAnchors, scaledStart,
  scaledFarthest, heightSeed, isCave, openness)`:
  1. **Base:** value-noise / FBM (3–4 octaves, lattice hashed from `(heightSeed,ix,iy)`,
     smoothstep-interpolated) directly on the fine grid. Amplitude/frequency from the
     already-computed `isCave`/`openness` (no new draws): caves get higher amplitude + lower
     frequency (rolling slopes), mazes get low amplitude + near-flat corridors.
  2. **Daises:** each landmark anchor (`PrefabAnchor.landmark`, the `'O'` shrine/vault cells,
     `prefabs.ts:19-23`) adds `+DAIS_HEIGHT` with a smoothstep falloff (~3 fine cells) — shrines
     and vaults get plinths for free.
  3. **Pits** *(defer to end of Phase 1 — highest islanding risk):* subtract `PIT_DEPTH` in
     a few far-from-start open cells, but **never lower a wall-adjacent open cell** (ring-protect
     so a pit can't pinch a corridor into an island).
  4. **Landings:** flatten the entrance room (around `scaledStart`) and stairs room (around
     `scaledFarthest`) to a single level — apply **after** relaxation.
  5. **Gradient-cap relaxation:** ~6–10 passes over open cells (`solid[i]===0`) clamping each
     toward its open 4-neighbors so `|Δ| ≤ WALKABLE_DELTA`; solid cells untouched. This both
     guarantees the step-up rule everywhere **and** carves ramps where regions meet.
  6. Quantize final to Int16 px.
- **`src/procgen/collision.ts`** — add `export function heightAt(grid, x, y): number`
  (nearest-cell integer lookup, `Math.floor(x/cell)`, clamp to bounds, return `grid.ground[cy*w+cx]`,
  0 if absent). This is the canonical TS sampler; document that any bilinear variant must be
  bit-identical on both sides.
- **`src/shared/constants.ts`** — add `WALKABLE_DELTA` (~24px), `DAIS_HEIGHT` (~120px),
  `PIT_DEPTH` (~60px), `HEIGHT_OCTAVES`, `HEIGHT_BASE_FREQ`. `WALKABLE_DELTA` is shared by the
  relaxation cap *and* (in v2) the movement step-up gate — they must read the same constant or
  generation and collision disagree.

**Why connectivity can't silently break:** `reconnect()`/`carveTunnel` (`index.ts:365-432`)
guarantee 2D open-cell adjacency only — they're height-blind. A naive noise field could put an
un-climbable cliff between two cells `reconnect` joined while `solid[]` still says "open,"
making the stairs an island. The relaxation pass makes **height-traversability a strict
superset of solid-traversability** — it's mathematically impossible to create an unclimbable
step — so connectivity is preserved *by construction*. This invariant is mandatory even though
Phase 1 is "visual only," because v2's step-up gate will trust it.

**Verify (Phase 1):**
- `npx tsc --noEmit` clean.
- Run the existing **solid-only** flood test *first* and confirm 100/100 layouts are
  byte-identical (proves the appended `heightSeed` draw didn't shift anything).
- Extend `src/procgen/index.test.ts` to be **height-aware**: a second flood from the entrance
  that crosses an open 4-neighbor only when `Math.abs(ground[a]-ground[b]) <= WALKABLE_DELTA`;
  assert it reaches every open cell + the stairs cell across all 100 seeds; assert entrance &
  stairs landings are flat; assert global max |Δ| between open 4-neighbors ≤ `WALKABLE_DELTA`.

---

## Phase 2 — Wire the height field *(server + Godot decode; still no render)*

- **`src/protocol.ts:13`** — `PROTOCOL_VERSION` 15 → 16.
- **`src/protocol.ts:129`** (`FloorGeometry`) — add optional `ground?: string` (base64 of the
  fine `w*h` Int16, same row-major layout/comment as `solid`). Leave `EntityDTO`/`SelfDTO`
  **unchanged** (no z).
- **`src/server/world-do.ts:~1722`** — add `encodeGround(ground: Int16Array): string`
  (mirror the `encodeSolid` byte-loop + `btoa`, 2-byte layout; document endianness). Wire
  `ground: encodeGround(this.floor.collision.ground)` into the `floorMsg` geometry block
  (`~1643-1651`). `gw/gh` already equal `collision.w/h` so the client knows the dims.
- **`godot/scripts/DccConst.gd:17`** — `PROTOCOL_VERSION` 15 → 16 (lockstep with protocol.ts —
  a missed twin only surfaces as a runtime `push_warning`, not a build error). Mirror
  `WALKABLE_DELTA`/`DAIS_HEIGHT` here per the file's "keep in lockstep" header.
- **`godot/scripts/Geo.gd:8`** — extend `decode()` to base64-decode `geometry.ground` into
  `grid['ground']` (`Marshalls.base64_to_raw` → Int16, re-sign symmetrically), guarded so a
  v15 server (no `ground` key) yields a flat grid. Add **`Geo.ground_height(grid, x, y) -> float`**
  = the frozen **bilinear** render sampler. (Also stub the nearest-cell integer sampler for v2,
  but don't call it yet.)

**Verify (Phase 2):** add a round-trip to `godot/test/geo_test.gd` — encode a known Int16
ground array server-side (or a checked-in base64 fixture), decode in Geo, assert
`ground_height` returns the expected values at sample points incl. signed (pit) cells. A v15
floor message decodes to flat. `npm test` green; `godot --headless --import` parse-clean.

---

## Phase 3 — Godot render → **SHIP visual-only here**

Now the world physically rises and falls. Collision, combat, prediction, fog, and the entity
stream are **untouched** — that untouched list *is* the safety guarantee.

- **`godot/scripts/World.gd:~94`** — replace the flat `PlaneMesh` floor with an `ArrayMesh` of
  `(w+1)×(h+1)` verts displaced in **Y only** by `Geo.ground_height`. (Y-only displacement is
  load-bearing: the fog shader reads `v_world.xz` for albedo/AO/LoS/vision-distance —
  `fog.gdshader:79,100` — so as long as displacement is purely vertical, `xz` still equals game
  `(x,y)` and the entire 2D fog marcher stays valid with **zero shader edits**.)
- **`godot/scripts/World.gd:~145`** — offset each wall box's Y by `ground_height(cx,cy)` and
  extend boxes downward so slope edges have no gap under the wall base.
- **`godot/scripts/EntitySprite.gd`** (`~:875/913/927/1029`) — add `ground_height(wx,wy)` to the
  per-kind Y offset; thread the grid into `SpriteLayer.sync` (`SpriteLayer.gd:161`, which already
  has `set_grid`).
- **`godot/scripts/WorldDecor.gd`** (`~:107/231`) — add `ground_height` to
  `DECO_Y/STAIRS_Y/GLOW_Y/DECAL_Y/TORCH_FLAME_Y`; **tilt** the floor-lying quads (`_floor_quad:279`)
  to the local cell or they z-fight on slopes.
- **`godot/scripts/Main.gd`** (`~:530/274`) — camera `look_at` target Y and the directional
  light target Y follow the player's ground height, or slopes read flat-lit and the camera
  clips terrain.
- **`Predictor.gd`** — add a *render-only* `z = Geo.ground_height(_grid, x, y)` for the local
  player's model/camera. **Do not** touch `_move`/`_occupy`/`_reconcile` (collision & the 2D
  120px error metric stay exactly as today).

**Known render-polish item:** the self-sprite forces `no_depth_test` (`EntitySprite.gd:322`) so
the hero draws over terrain in front of it — on a raised dais the player can render *through* a
hill. Resolve in this phase (conditionally drop `no_depth_test` when terrain occludes, or accept
and revisit).

**Verify (Phase 3):** runtime screenshot (`DCC_SHOT`) on a cave seed with daises/pits — confirm
visible ramps/slopes, walls seated on terrain (no floating/gaps), entities/decor sitting on the
ground, torches/decals tilted to slope, no shader/script errors. Walk a ramp: movement still
predicts tightly (it's pure 2D — should be identical to flat). Confirm pits are fully
visible & shootable across (no wall between you and the far side). Then **bake visual-only in
for real players and let it soak.**

---

## v2 — Deferred gameplay height (each its own gated, independently-revertible release)

Only after visual-only is stable in the wild. Ordered by dependency/risk:

1. **Step-up / cliff gating** — add `canStep(grid, fromX,fromY, toX,toY)` = `abs(intHeight(to) -
   intHeight(from)) <= WALKABLE_DELTA` using the **nearest-cell integer** sampler. Thread per-axis
   into `moveWithWorldCollisions` (`sim/collision.ts:19-31`, evaluating the Y delta against the
   *post-X-commit* position) **and** the inlined `Predictor._move` (`Predictor.gd:36-43`) — the
   predictor does *not* call the shared Geo mover, so patching only Geo would silently leave it
   ungated. Add a **cross-language golden-vector test** (vitest + `geo_test.gd`) asserting
   identical `canStep`/`heightAt` incl. the threshold edges (`Δ==WALKABLE_DELTA` accepted,
   `+1` rejected). Add **sub-stepping** for dash (760px/s ≈ 38px/tick > half a cell) and
   knockback so fast moves can't tunnel a cliff or die mid-dash on a ramp. *This is the
   highest-risk step — it crosses the prediction boundary.*
2. **Slope-scaled move speed** — scalar `cos(slope)` multiplier from identical samples both sides.
3. **Height-gated combat** — `dz` check in `inCone`/hit/`pickTarget`; melee off a dais, etc.
4. **Height-aware LoS** — add `u_height` sampler + `u_player_z` to `fog.gdshader` (compare terrain
   height vs the interpolated sight-ray; walls = `WALL_H` special case) **and** the same test in
   CPU `Geo.line_of_sight` + `Fog._compute_wall_vis`, or ground-fog/wall-reveal/sprite-culling
   desync. Cut `dcc_los_soft` to 1 sample / cap steps — a per-step height fetch ~doubles the
   already-heavy ~144 fetches/pixel.
5. **Authoritative entity z on the wire** (`EntityDTO.z`/`SelfDTO.z`) — *only if* a system needs
   it (fall damage / jump). Another protocol bump.
6. **Ballistic projectile arcs** (`vz`), **prop height bands**, **monster pathfinding** around
   cliffs they can't climb (monsters have no pathfinder today — a cliff gate makes them wedge
   against ledges; flat terrain hides this).

---

## Risks & mitigations (carried into every phase)

- **Rubber-band regression (highest, v2):** integer-only gate + derive z from the *same* rounded
  x/y both sides + fix `SLOW_FACTOR` first (Phase 0). Never let the bilinear render sampler touch
  the gate.
- **`SelfDTO` x/y are `r()`-rounded** (`world-do.ts:1595-1596`) but the sim steps against unrounded
  `p.x/p.y` — in v2, derive z/step from the *same* coords both sides or get an invisible
  cell-edge parity bug.
- **Connectivity silent-sever:** the gradient-cap relaxation + height-aware test are **mandatory
  in Phase 1**, not v2.
- **Draw-order regression:** `heightSeed` must be the literal last `random()` draw; gate on the
  byte-identical solid-flood check.
- **Wire/memory:** Int16 (~98KB/floor) is fine once-per-floor; Float32 (147KB) is not.
- **Web client (out of scope, flag only):** it rebuilds from seed and ignores `FloorGeometry`,
  so it renders **flat**. Harmless through Phase 3 because height never affects walkability. The
  instant v2 gates collision, web diverges in what's walkable — it would need the shared procgen
  height code or it becomes unplayable. Flag, don't fix.

---

## Open items needing sign-off before Phase 2

- **Protocol shape:** the `FloorGeometry.ground` field + the lockstep `PROTOCOL_VERSION` 15→16
  bump want the server-protocol owner + Godot-client owner to OK it (teammates push frequently;
  last v-bump had a race). Additive/optional, so a v16 server still serves a flat v15 client.
- **Constants:** freeze `WALKABLE_DELTA`, `DAIS_HEIGHT`, `PIT_DEPTH`, `HEIGHT_STEP`/quantum before
  wiring serialization (they're mirrored TS↔GDScript).
