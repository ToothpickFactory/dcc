# DCC — Phase 0: Foundation & Contracts

*The prerequisite for parallel work (see [WORKSTREAMS.md](WORKSTREAMS.md)). Goal: split the monolith into owned modules, freeze the wire protocol and seam interfaces, and stub every seam so the game runs end-to-end on day one. Target: ~2–4 days, all four devs. Keep implementations to trivial stubs — Phase 0 ships **contracts**, not features.*

> **Encoding note:** protocol v1 is JSON (what the foundation already uses). The binary delta protocol is Stream G / M6 and changes only `client/net.ts` + the DO's broadcast — **never these types**. Design the types now, optimize the bytes later.

---

## Day 1: agree the protocol together (whole team, ~1 hr)

`src/protocol.ts` is the contract between every client task and every server task. The whole team reviews and signs off on it before splitting. After that, changes require a client-lead + server-lead sign-off and a `PROTOCOL_VERSION` bump.

---

## 1. Module split (Dev 1 scaffolds; everyone fills their folder)

```
src/
  worker.ts                  # entry: routes / , /ws , /admin/* ; serves the client bundle
  protocol.ts                # WIRE CONTRACT (v1): ClientMsg, ServerMsg, DTOs, PROTOCOL_VERSION
  shared/
    types.ts                 # Ability, AbilityCategory, Rarity, Theme, PlayerClass, MonsterKind, AbilityFlavor
    constants.ts             # TICK_MS, INPUT_HZ, PLAYER_SPEED, world dims … (imported by client AND server)
  procgen/                   # SHARED deterministic lib — server uses collision/spawns, client rebuilds geometry/theme
    index.ts                 # generateFloor(seed, depth): FloorDescriptor          [Stream D]
    types.ts                 # FloorDescriptor, CollisionGrid
  server/
    world-do.ts              # MyDurableObject: WS accept, message dispatch, tick loop, AoI broadcast
    sim/
      movement.ts            # integrate input vector -> position                   [Stream B]
      projectiles.ts         # ballistic spawn + swept collision                    [Stream B]
      monsters.ts            # threat-aggro AI                                      [Stream B]
      combat.ts              # applyDamage, friendly fire, death                    [Stream B]
    events.ts                # PlaystyleEvent taxonomy + emit funnel        [B emits / E consumes]
    loot/
      profile.ts             # ProfileTracker (EMA, classOf)                        [Stream E]
      heuristic.ts           # LootEngine.grant()                                   [Stream E]
      flavor.ts              # FlavorService (Workers AI/Claude + static fallback)  [Stream E]
    persistence/
      index.ts               # RunStore over DO SQLite                              [Stream A]
      schema.ts              # table DDL + migrations                               [Stream A]
    identity.ts              # Identity: mint/verify HMAC token                     [Stream A]
  client/
    main.ts                  # bootstrap + login + wiring                           [Stream C]
    net.ts                   # WS, protocol encode/decode, snapshot buffer          [Stream C]
    render.ts                # Three.js scene + billboard sprites                   [Stream C]
    input.ts                 # WASD + pointer-lock mouselook -> intents             [Stream C]
    predict.ts               # local prediction + reconciliation                   [Stream C]
    hud.ts                   # ability bar, class label, floor timer                [Stream C]
    atlas.ts                 # sprite-atlas manifest loader                  [Stream F format]
  test/
    bot.ts                   # headless N-player synthetic client                   [Stream G]
```

**Client build pipeline (Dev 3):** the current `client.ts` exports one giant `CLIENT_HTML` template string — that does not scale to a team building a Three.js app. Replace it with an **esbuild bundle** of `src/client/*` → `dist/`, served via the wrangler **static assets** binding (already stubbed-commented in `wrangler.jsonc`). `worker.ts` serves `index.html`; `/ws` still hits the DO.

---

## 2. The wire contract — `src/protocol.ts`  *(Dev 2 authors, team signs off)*

```ts
export const PROTOCOL_VERSION = 1;

import type { Ability, AbilityFlavor, PlayerClass, Theme } from "./shared/types";

// ---------- Client -> Server ----------
export type ClientMsg =
  | { t: "join"; name: string; token?: string }              // token = signed playerId for reconnect
  | { t: "input"; seq: number; mv: [number, number]; aim: number }  // mv = unit move vec; aim = radians; ~INPUT_HZ
  | { t: "cast"; seq: number; ability: number; aim: number }        // fire ability N in aim direction
  | { t: "ping"; ts: number };

// ---------- Server -> Client ----------
export type ServerMsg =
  | { t: "welcome"; you: string; world: WorldInfo; protocol: number }
  | { t: "state"; tick: number; ack: number; ents: EntityDTO[]; events: GameEvent[]; self: SelfDTO }
  | { t: "floor"; info: FloorClientInfo; state: FloorState }
  | { t: "run"; state: RunState }
  | { t: "loot"; grant: LootGrantDTO }                       // sent twice: once on grant, again when flavor lands
  | { t: "pong"; ts: number };

// ---------- DTOs ----------
export interface WorldInfo { w: number; h: number; }

export type EntityKind = "player" | "monster" | "proj";
export interface EntityDTO {
  id: string; kind: EntityKind;
  x: number; y: number; aim?: number;        // aim/facing in radians for sprite direction
  hp?: number; maxHp?: number; dead?: boolean;
  name?: string; cls?: PlayerClass;          // players only
  sprite?: number;                            // atlas frame id (kind-specific)
}

export interface SelfDTO {                    // your own authoritative state, for reconciliation + HUD
  x: number; y: number; hp: number; maxHp: number;
  ack: number;                                // last input seq the server applied
  cds: Record<number, number>;                // ability index -> ready-at (server logical ms)
  cls: PlayerClass; profile: Record<string, number>;
  status: "alive" | "spectator";
}

export type GameEvent =
  | { e: "dmg"; x: number; y: number; amount: number }
  | { e: "heal"; x: number; y: number; amount: number }
  | { e: "death"; x: number; y: number; id: string }
  | { e: "cast"; x: number; y: number; ability: number }
  | { e: "hit"; x: number; y: number; ability: number };

export interface FloorClientInfo {            // client rebuilds geometry from seed (shared procgen); no collision needed
  index: number; seed: number; depth: number; theme: Theme;
  w: number; h: number; durationMs: number;
}
export type FloorPhase = "generating" | "active" | "closing" | "complete";
export interface FloorState { index: number; phase: FloorPhase; endsAt: number; livingAtStairs: number; living: number; }

export type RunPhase = "lobby" | "running" | "ended" | "cooldown";
export interface RunState { runId: string; currentFloor: number; phase: RunPhase; players: number; spectators: number; }

export interface LootGrantDTO { id: string; ability: Ability; flavor?: AbilityFlavor; rarity: string; }
```

---

## 3. Shared domain types — `src/shared/types.ts`  *(Dev 2)*

```ts
export type AbilityCategory = "ranged" | "melee" | "aoe" | "support" | "utility" | "stealth";
export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type Theme = "fantasy" | "cyberpunk" | "forest" | "pirate" | "clockwork" | "nightmare";
export type PlayerClass =
  | "vanilla" | "protector" | "hunter" | "shadow" | "negotiator" | "berserker";
export type MonsterKind = "grunt" | "ranged" | "brute" | "swarm";

export interface Ability {                    // extends the foundation's Ability shape
  id: string;
  category: AbilityCategory;
  cd: number;                                 // cooldown ms
  range: number;                              // max effective range (0 = self)
  dmg: number;                                // negative = heal
  projectile: boolean;
  speed?: number;                             // ballistic projectile speed (px/s)
  slowMs?: number;
  // display strings — filled by the heuristic (static) or the LLM (flavor); never affect numbers
  name: string; flavor?: string; twist?: string;
}
export interface AbilityFlavor { name: string; flavor: string; twist?: string; }
```

---

## 4. Seam interfaces (each stream's contract)

### 4a. Procgen — `src/procgen/types.ts`  *(Stream D / Dev 4)*

```ts
import type { Theme, MonsterKind } from "../shared/types";

export interface CollisionGrid { w: number; h: number; cell: number; solid: Uint8Array; } // server-authoritative

export interface FloorDescriptor {
  index: number; seed: number; depth: number; theme: Theme;
  w: number; h: number;
  durationMs: number;                         // per-floor timer (decision #9 — not depth-scaled)
  collision: CollisionGrid;
  entrance: { x: number; y: number };
  stairs: { x: number; y: number; r: number };
  spawns: { x: number; y: number; kind: MonsterKind }[];
  chests: { x: number; y: number }[];
}

// Pure + deterministic: same (seed, depth) -> identical descriptor on server AND client.
export function generateFloor(seed: number, depth: number): FloorDescriptor;
// MUST internally pass: BFS(entrance -> stairs) reachable, and a path traversable within durationMs; else re-roll seed.
```

### 4b. Playstyle events — `src/server/events.ts`  *(Stream B emits / Stream E consumes)*

```ts
export type PlaystyleEvent =
  | { e: "hit"; by: string; targetKind: "monster" | "player"; range: number; ability: number }
  | { e: "kill"; by: string; targetKind: "monster" | "player" }
  | { e: "heal"; by: string; amount: number; ally: boolean }
  | { e: "friendlyFire"; by: string; amount: number }
  | { e: "explore"; by: string; tilesNew: number }
  | { e: "assist"; by: string };
```

### 4c. Profile + loot — `src/server/loot/*`  *(Stream E / Dev 2)*

```ts
import type { Ability, AbilityCategory, Rarity, Theme, PlayerClass } from "../../shared/types";

export interface PlaystyleProfile {           // 7 axes, each 0..1 (EMA-smoothed)
  stealth: number; ranged: number; melee: number;
  support: number; aggression: number; exploration: number; teamwork: number;
}

export interface ProfileTracker {
  record(ev: PlaystyleEvent): void;           // O(1), in-loop, no IO
  get(playerId: string): PlaystyleProfile;
  classOf(playerId: string): PlayerClass;
}

export interface LootContext { trigger: "kill" | "chest" | "floorEnd"; depth: number; rarity: Rarity; theme: Theme; rng: () => number; }

export interface LootEngine {                 // deterministic, in-tick, owns ALL numbers
  grant(profile: PlaystyleProfile, ctx: LootContext): Ability;
}

export interface FlavorService {              // async, off the hot path; cosmetic strings only
  flavor(category: AbilityCategory, rarity: Rarity, theme: Theme): Promise<AbilityFlavor>;
}
```

### 4d. Persistence + identity — `src/server/persistence/*`, `src/server/identity.ts`  *(Stream A / Dev 1)*

```ts
import type { PlaystyleProfile } from "./loot/profile";
import type { Ability, PlayerClass } from "../shared/types";

export interface PlayerRecord {
  playerId: string; name: string;
  alive: boolean;                             // sole source of truth for permadeath
  cls: PlayerClass; profile: PlaystyleProfile; abilities: Ability[];
  lastSeen: number;
}
export interface RunCheckpoint { runId: string; currentFloor: number; seed: number; phase: string; savedAt: number; }
export interface FloorRecord { runId: string; floor: number; completedAt: number; survivors: number; }

export interface RunStore {
  loadRun(): Promise<RunCheckpoint | null>;
  saveCheckpoint(c: RunCheckpoint): Promise<void>;
  loadPlayer(playerId: string): Promise<PlayerRecord | null>;
  savePlayer(rec: PlayerRecord): Promise<void>;     // idempotent; alive=false write can never be undone in-run
  recordFloorComplete(rec: FloorRecord): Promise<void>;
}

export interface Identity {
  mint(name: string): { playerId: string; token: string };  // HMAC-signed with a Worker secret
  verify(token: string): { playerId: string } | null;        // invalid/expired -> null -> treated as new/spectator
}
```

---

## 5. Stub strategy — make the game run on day one

Every seam ships a trivial stub so all streams have a working end-to-end build immediately:

- `RunStore` → in-memory Map (Dev 1). Real SQLite impl is Stream A / M0.
- `Identity` → returns `playerId = name` with a dev HMAC (Dev 1). Real signed tokens are M1.
- `generateFloor` → one hardcoded room with entrance + stairs, fixed `durationMs` (Dev 4). Real gen is Stream D.
- `LootEngine` → returns a fixed `Ability` from a tiny table; `FlavorService` → returns `{name: "Plain " + category}` (Dev 2). Real engine is M5.
- `ProfileTracker` → records nothing, returns a flat profile + `"vanilla"` (Dev 2).
- `render.ts` → flat colored billboard quads from `EntityDTO` (Dev 3). Real sprites are Stream C + atlases from F.

---

## 6. Phase 0 task checklist (by dev)

**Dev 1 — scaffold + spine stubs + platform**
- [ ] Create the `src/` directory skeleton above; move the DO shell into `server/world-do.ts`, the entry into `worker.ts`.
- [ ] Define `RunStore` + `Identity` interfaces; ship in-memory + dev-HMAC stubs.
- [ ] CI: `wrangler types` + `tsc --noEmit` typecheck + a `test/bot.ts` smoke run on every PR.
- [ ] `CODEOWNERS` mapping each directory to its stream owner.

**Dev 2 — protocol + shared types + gameplay skeletons**
- [ ] Author `protocol.ts` (v1) and `shared/types.ts`; drive the day-1 sign-off.
- [ ] `server/events.ts` taxonomy; carve `sim/{movement,projectiles,monsters,combat}.ts` out of the current `tick()` as skeletons that preserve today's behavior.
- [ ] `LootEngine` / `FlavorService` / `ProfileTracker` interfaces + stubs.

**Dev 3 — client build + module split + net**
- [ ] Replace the inline `CLIENT_HTML` with an esbuild bundle served via the assets binding; `worker.ts` serves `index.html`.
- [ ] Split `client/` into modules; `net.ts` connects, encodes `ClientMsg`, decodes `ServerMsg`, maintains the snapshot buffer.
- [ ] Placeholder `render.ts` that draws current entities so the bundle is verifiably live end-to-end.

**Dev 4 — procgen types + stub + atlas format**
- [ ] `procgen/types.ts` (`FloorDescriptor`, `CollisionGrid`) + a deterministic stub `generateFloor` (one room + stairs).
- [ ] Sprite-atlas **manifest format** + a placeholder atlas (player/monster/projectile) + `client/atlas.ts` loader.

---

## 7. Phase 0 is done when…

- [ ] `tsc --noEmit` passes; every module compiles; `protocol.ts` is the **only** definition of wire types (no stream rolls its own).
- [ ] The stubbed game runs end-to-end: the client bundle loads, connects over `/ws`, you move + cast against the refactored server, and one stub floor with stairs renders.
- [ ] `test/bot.ts` connects ~20 synthetic players that move without errors (the cross-stream smoke test).
- [ ] `PROTOCOL_VERSION === 1` and the team has signed off.
- [ ] `CODEOWNERS` + CI are green.

Then every dev picks up their stream's "first tasks" from [WORKSTREAMS.md](WORKSTREAMS.md) and they run in parallel.
