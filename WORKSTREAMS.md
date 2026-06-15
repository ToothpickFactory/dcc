# DCC — Parallel Work Streams

*Companion to [ROADMAP.md](ROADMAP.md). Decomposes the milestone ladder into streams that run simultaneously across multiple developers. Milestone references (M0–M8) point back to the roadmap.*

## The principle: freeze the seams, then fan out

The roadmap's milestone ladder (M0→M8) is ordered to *de-risk*, not to *parallelize*. To run developers concurrently we cut along the system's natural seams instead:

- The **wire protocol** (intent in / snapshot-delta out) is the contract between *all* client work and *all* server work. Freeze it and the two halves develop independently.
- **Procgen, loot, and art** are standalone libraries behind clean interfaces — they barely touch the live server.
- The blocker today is mechanical: everything lives in `src/index.ts` (460 lines) and `src/client.ts`. Multiple devs editing those two files = merge hell. **Modularizing first is the single biggest enabler of parallel work.**

---

## Phase 0 — Foundation & Contracts *(do first; ~2–4 days; blocks everyone)*

Best done by one senior dev or a pair, with all stream leads reading along (they're agreeing to the contracts they'll code against). Keep it ruthlessly small — stubs over real implementations.

1. **Modularize the monolith.** Split into owned directories so streams stop colliding:
   - `src/worker.ts` — entry + routing (the `default` export)
   - `src/server/world-do.ts` — the DO shell + tick loop
   - `src/server/sim/` — `movement.ts`, `projectiles.ts`, `monsters.ts`, `combat.ts`
   - `src/server/procgen/`, `src/server/loot/`, `src/server/persistence/`
   - `src/protocol.ts` — **shared types + message schemas (the contract)**
   - `src/client/` — `net.ts`, `render.ts`, `input.ts`, `hud.ts`
2. **Freeze wire protocol v1** in `protocol.ts` with a `protocolVersion`: client→server (`join`, `input {seq, moveVec, aim, cast}`); server→client (`welcome`, `state`/`delta`, `event`, `lootGrant`, `floorState`, `runState`). Shared entity types.
3. **Define the internal seam interfaces** so streams can stub each other:
   - **Floor descriptor** (procgen output): `{seed, theme, collision, spawns, stairs, durationMs}`
   - **Loot**: `grantLoot(profile, ctx) -> Ability` (sync heuristic) + `flavor(category, rarity, theme) -> {name, flavor, twist}` (async)
   - **Playstyle event taxonomy**: the event set combat emits and the profile consumes
   - **Persistence**: `loadRun()`, `saveCheckpoint()`, identity verify/lookup
4. **Stub every seam** so the game runs end-to-end day one: one hardcoded floor, static loot names, in-memory persistence.
5. **Headless synthetic-client bot** that drives N fake players over the WS — the cross-stream smoke test and (later) the load-test harness.
6. **CI skeleton + CODEOWNERS** per directory.
7. **Commit/reconcile the existing local WASD work** (the committed tree is still click-to-move) so Stream B starts from reality.

---

## The streams *(run concurrently after Phase 0)*

| # | Stream | Scope (roadmap milestones) | Owner profile | Hard dependency | Develops against (mock) |
|---|---|---|---|---|---|
| **A** | Server Authority & Lifecycle | M0 persistence/eviction-safety · M1 permadeath + HMAC identity + linkdead · M4 Floor/Run FSM, lethal alarm timer, manual run-start, floor_record | Senior backend | protocol + persistence iface (P0) | — (owns the spine) |
| **B** | Combat & Simulation | M3 server: WASD velocity integration · ballistic projectiles + swept collision · positional friendly fire · melee cone · **monster threat-aggro** · emits playstyle events | Gameplay/backend | protocol (P0) | persistence (A stub) |
| **C** | Client Render & Input | M2 Three.js sprite renderer (WebGPU/WebGL2) · M3 client: WASD+mouselook+pointer-lock · local prediction/reconcile · over-shoulder camera · crosshair + ally/enemy coding · HUD (class label, timer, cooldowns) | Frontend/graphics | protocol + sprite spec (P0) | stub server / recorded snapshots; placeholder sprites |
| **D** | Procedural Generation | M4 gen: seeded BSP+cave hybrid · themes · **solvability (BFS reachability + timer feasibility)** · collision/navmesh · spawn/stairs placement · depth scaling | Algorithms dev | floor-descriptor type (P0) | runs fully standalone + debug viewer |
| **E** | Playstyle & AI Loot | M5: 7-axis profile aggregation · deterministic heuristic loot · `classOf` derivation · LLM flavor service (Workers AI/Claude, AI Gateway, cache, validation, fallback table) | Backend (+ a little ML) | event taxonomy + Ability schema (P0) | mock events (until B lands) |
| **F** | Art & Content Pipeline | Sprite atlases (players/monsters/projectiles/props) · theme tilesets · animation frames · atlas manifest format · ability/loot icons | Artist + tools dev | sprite-format spec (P0) | fully independent; start with CC0/placeholder |
| **G** | Scale & Platform | **Now:** bot/load-test harness, CI, observability, admin tooling. **Deferred (post-vertical-slice):** M6 AoI + binary delta · M7 Coordinator + regional shards + spectator DO · M8 zone sharding | Senior infra | protocol (P0); scale work waits on a fun loop | — |

### First tasks (the "start Monday" on-ramp)
- **A:** SQLite checkpoint helper + `blockConcurrencyWhile` rehydrate (M0); delete respawn → spectator state + mint HMAC `playerId` (M1).
- **B:** swap `tx/ty` target-move for velocity-from-input; ballistic projectile struct + swept collision; per-monster threat table.
- **C:** `three/webgpu` scene rendering entities as billboard quads from snapshots; WASD+pointer-lock emitting protocol intents; prediction loop.
- **D:** `seed → FloorDescriptor` generator + BFS reachability/timer-feasibility check + a standalone debug viewer; fuzz across thousands of seeds.
- **E:** profile aggregator over the mock event taxonomy; heuristic `profile → Ability` with clamps + `classOf`; then the flavor service behind AI Gateway with the static-table fallback.
- **F:** define the atlas manifest format; ship placeholder player/monster/projectile atlases + one theme tileset.
- **G:** the headless N-player bot (shared with P0); CI; a basic observability dashboard.

---

## Dependency graph

```
                 ┌─────────────────────────────┐
                 │  PHASE 0 — Foundation &      │
                 │  Contracts   (blocks ALL)    │
                 │  modules · protocol v1 ·     │
                 │  seam stubs · bot harness    │
                 └──────────────┬──────────────┘
                                │ frozen contracts
        ┌──────────┬───────────┼───────────┬───────────┬──────────┐
        v          v           v           v           v          v
   ┌────────┐ ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐ ┌────────┐
   │   A    │ │   B    │  │   C    │  │   D    │  │   E    │ │   F    │
   │Authority│ │Combat  │  │Client  │  │Procgen │  │Loot/AI │ │ Art    │
   │+Lifecyc │ │+Sim    │  │Render  │  │library │  │+Profile│ │Content │
   │M0 M1 M4s│ │M3 srv  │  │M2 M3cl │  │M4 gen  │  │M5      │ │sprites │
   └───┬────┘ └───┬────┘  └───┬────┘  └───┬────┘  └───┬────┘ └───┬────┘
       │          │ events──────────────────────────▶ │          │
       │          │           │ ◀──atlas──────────────────────────┘
       │ ident/   │           │ ◀──floor descriptor───┘
       │ persist  │           │
       └──────────┴───────────┴──── integrate continuously to main ──┘
                                │  (stubs swapped for real impls at checkpoints)
                                v
                   ┌─────────────────────────────┐
                   │  G — Scale & Platform        │
                   │  harness + CI  (NOW)         │
                   │  M6/M7/M8     (DEFERRED)     │
                   └─────────────────────────────┘
```

Edges are **interface dependencies, satisfied by Phase-0 stubs** — no stream waits on another to start. The arrows only matter at integration time: B feeds events to E, D feeds floors to A, F feeds atlases to C, A owns the identity/persistence that B and C consume.

---

## Integration milestones (playable builds)

Each build is the cross-stream merge target — what "done together" looks like.

- **Build 1 — Vertical Slice.** P0 + A(M0,M1) + B(M3) + C(M2,M3) + D(one real floor) + A's M4 core (timer/stairs/permadeath). *Result:* a 3D sprite floor you can play with friends — WASD, ballistic friendly fire, threat-aggro monsters, a lethal timer, real permadeath. **This is the "is it fun?" gate.** Loot is still stub/static; art is placeholder.
- **Build 2 — Identity & Content.** + E(M5 full: emergent classes, hybrid loot) + F (real atlases/themes) + D (multiple themed floors). *Result:* the game in the brief at small scale.
- **Build 3 — Scale.** + G (M6 AoI/binary, then M7 Coordinator + regional shards). *Result:* load-tested toward 100s, region-local combat, one logical worldwide run.

---

## Team assignment — 4 generalists (this team)

No hard specialization, so each dev owns a coherent vertical and **all four land on the Build 1 vertical slice**:

| Dev | Owns | Build-1 contribution |
|---|---|---|
| **Dev 1 — Server Spine + Platform** | Stream A (Authority & Lifecycle) + Stream G infra (CI, bot harness, admin; later the sharding lead) | persistence, permadeath, run/floor FSM |
| **Dev 2 — Server Gameplay** | Stream B (Combat & Sim) + Stream E (Playstyle & AI Loot) — coupled (B emits the events E consumes), so one owner cuts integration friction | WASD movement, ballistic combat, threat-aggro |
| **Dev 3 — Client** | Stream C (Render, Input, HUD) | the entire 3D sprite client |
| **Dev 4 — Content & Worlds** | Stream D (Procgen) + Stream F (Art/atlas pipeline) — both standalone content/library work feeding the client | one real generated floor |

Stream E and Stream F land in **Build 2**; Stream G's scale work (M6–M8) is **deferred** to after Build 1, led by Dev 1. See [PHASE0.md](PHASE0.md) for who does what during Phase 0.

### If the team grows
- **+1 (5 devs):** split Dev 4 — one on Procgen, one on Art/content.
- **+2 (6 devs):** also split Dev 2 — Combat separate from Loot/AI.

---

## Coordination rules

1. **`protocol.ts` is a shared contract.** Any change needs sign-off from the client (C) and server (A/B) leads and a `protocolVersion` bump. Never break the wire without bumping.
2. **CODEOWNERS per directory** — each stream owns its folder; cross-folder PRs get the owning lead's review.
3. **Integrate to `main` continuously behind the stubs.** Hold a short weekly integration checkpoint where one stub gets replaced by its real implementation.
4. **The synthetic-bot harness stays green** — it's the cross-stream smoke test; a red bot run blocks merges.
5. **Don't start G's sharding work until Build 1 proves the loop is fun** (per the roadmap's ordering principle). The harness/CI half of G runs now; the M6/M7/M8 half waits.
