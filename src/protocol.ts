// ===========================================================================
// WIRE CONTRACT v1 — the single source of truth for everything on the socket.
// Client work and server work both code against this; nothing else defines a
// message shape. Changes require a client-lead + server-lead sign-off and a
// PROTOCOL_VERSION bump.
//
// Encoding is JSON in Phase 0. The binary delta protocol (Stream G / M6) changes
// only client/net.ts + the DO's broadcast — never these types.
// ===========================================================================
import type { Ability, AbilityFlavor, CcKind, Klass, PlayerClass, PlaystyleProfile, Theme } from "./shared/types";
import type { Attributes, DerivedStats, EquipSlot, Inventory, Item } from "./shared/items";

export const PROTOCOL_VERSION = 13; // was 12 (lootbag rarity) - added projectile render kind + hard CC

// ---------- Client -> Server ----------
export type ClientMsg =
  | { t: "join"; name: string; token?: string } // token = signed playerId for reconnect
  | { t: "input"; seq: number; mv: [number, number]; aim: number } // mv = move vec; aim = radians
  | { t: "cast"; seq: number; ability: number; aim: number } // fire ability N in aim direction
  | { t: "dash"; seq: number; dir: [number, number] } // dodge/evade burst in dir (move vec or aim)
  // ---- inventory / gear (character screen) ----
  | { t: "equip"; item: string } // equip a carried item (auto-slots)
  | { t: "unequip"; slot: EquipSlot } // move equipped gear back to carry
  | { t: "unequipBag"; index: number } // unequip a bag container
  | { t: "sell"; item: string } // sell a carried item for gold (waiting room only)
  | { t: "drop"; item: string } // drop a carried item onto the floor
  | { t: "useItem"; item: string } // drink/use a carried consumable (e.g. a potion)
  | { t: "addHotbarItem"; item: string } // toggle a carried consumable onto/off the action bar
  | { t: "openLoot"; bag: string } // request the contents of a nearby loot bag
  | { t: "takeLoot"; bag: string; item?: string } // take one item (or all if omitted)
  | { t: "swapAbility"; a: number; b: number } // reorder/swap two action-bar slots
  | { t: "evolve"; slot: number; to: string } // evolve a matured ability into a chosen branch
  | { t: "chooseClass"; cls: string } // pick a WoW class at the first level-up (one-time)
  | { t: "spendTalent"; node: string } // spend a talent point on a tree node
  | { t: "ping"; ts: number };

// ---------- Server -> Client ----------
export type ServerMsg =
  | { t: "welcome"; you: string; token: string; world: WorldInfo; protocol: number }
  | { t: "state"; tick: number; ack: number; ents: EntityDTO[]; events: GameEvent[]; self: SelfDTO }
  | { t: "floor"; info: FloorClientInfo; state: FloorState; geometry: FloorGeometry }
  | { t: "run"; state: RunState }
  | { t: "loot"; grant: LootGrantDTO }
  | { t: "inv"; inv: Inventory; attrs: Attributes; derived: DerivedStats; capacity: number; gold: number } // character screen
  | { t: "bag"; id: string; items: Item[] } // contents of an opened loot bag
  | { t: "pong"; ts: number };

export interface WorldInfo {
  w: number;
  h: number;
}

export type EntityKind = "player" | "monster" | "boss" | "proj" | "lootbag" | "prop";
export interface EntityDTO {
  id: string;
  kind: EntityKind;
  x: number;
  y: number;
  aim?: number; // facing in radians, for sprite direction
  hp?: number;
  maxHp?: number;
  dead?: boolean;
  name?: string; // players + named bosses
  cls?: PlayerClass; // players only
  sprite?: number; // atlas frame id (kind-specific)
  proj?: "fire" | "ice" | "poison"; // projectiles: preferred 3D render asset
  n?: number; // item count (loot bags)
  rarity?: string; // loot bags: best item rarity (drives the ground glow/beam)
  variant?: number; // props: themed decoration sheet index
  scale?: number; // props: decoration scale
  cc?: CcKind; // monster/boss: active hard CC (stun/root/freeze) — drives the status tint
}

export interface SelfDTO {
  // Your own authoritative state, for reconciliation + HUD.
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  ack: number; // last input seq the server applied
  cds: Record<number, number>; // ability index -> ready-at (server logical ms)
  cls: PlayerClass;
  profile: PlaystyleProfile;
  derived: DerivedStats; // gear-derived stats (HUD + client movement prediction)
  abilities: Ability[]; // the action bar (slot 1 auto-casts) — incl. live ammo + xp/tier
  charXp: number; // character XP (skill system) — client derives level via charLevelOf
  // ---- WoW-style class & talents (RPG Phase 2) ----
  chosenClass: Klass | null; // picked at the first level-up; null = picker pending
  talents: Record<string, number>; // talent node id -> rank
  talentPoints: number; // unspent talent points (a pending point w/ no class = "pick a class")
  shield: number; // current absorb shield (HUD)
  status: "alive" | "spectator";
  reached: boolean; // reached the stairs — in the safe waiting room (spectate + manage gear)
  dashReadyAt?: number; // tick when the dodge/dash is off cooldown (HUD cue)
  lifetimeXp?: number; // all-time XP across runs (durable; backs the leaderboard)
  bestFloor?: number; // deepest floor ever reached (all-time)
  kills?: number; // all-time kills (all-time)
}

export type GameEvent =
  | { e: "dmg"; x: number; y: number; amount: number; by?: string; crit?: boolean }
  | { e: "heal"; x: number; y: number; amount: number }
  | { e: "death"; x: number; y: number; id: string }
  | { e: "cast"; x: number; y: number; ability: number }
  | { e: "melee"; by: string }
  | { e: "hit"; x: number; y: number; ability: number }
  | { e: "windup"; by: string; x: number; y: number; ms: number } // attack tell: `by` winds up, damage lands in `ms`
  | { e: "cc"; x: number; y: number; id: string; kind: CcKind; ms: number } // hard CC landed on a foe (pop fx)
  | { e: "boss"; x: number; y: number; state: "spawn" | "dead" };

// Static floor geometry shipped to clients that don't run the TS procgen (e.g. the
// native Godot client). The browser ignores this and rebuilds from `seed`. Sent
// once per floor change on the `floor` message — never in the per-tick `state`.
export interface FloorGeometry {
  gw: number; // grid width in cells
  gh: number; // grid height in cells
  cell: number; // cell size px
  solid: string; // base64 of the gw*gh Uint8Array, row-major y*gw+x (1 = wall)
  entrance: { x: number; y: number };
  stairs: { x: number; y: number; r: number };
  decorations: { x: number; y: number; variant: number; scale: number }[];
}

export interface FloorClientInfo {
  // Client rebuilds geometry from the seed (shared procgen); no collision needed.
  index: number;
  seed: number;
  depth: number;
  theme: Theme;
  w: number;
  h: number;
  durationMs: number;
}
export type FloorPhase = "generating" | "active" | "closing" | "complete";
export interface FloorState {
  index: number;
  phase: FloorPhase;
  endsAt: number; // wall-clock ms (the floor's durable-alarm deadline); client counts down via its own clock
  livingAtStairs: number;
  living: number;
}

export type RunPhase = "lobby" | "running" | "ended" | "cooldown";
export interface RunState {
  runId: string;
  currentFloor: number;
  phase: RunPhase;
  players: number;
  spectators: number;
}

export interface LootGrantDTO {
  id: string;
  ability: Ability;
  flavor?: AbilityFlavor; // arrives later if the LLM is in the loop
  rarity: string;
}
