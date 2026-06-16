// ===========================================================================
// WIRE CONTRACT v1 — the single source of truth for everything on the socket.
// Client work and server work both code against this; nothing else defines a
// message shape. Changes require a client-lead + server-lead sign-off and a
// PROTOCOL_VERSION bump.
//
// Encoding is JSON in Phase 0. The binary delta protocol (Stream G / M6) changes
// only client/net.ts + the DO's broadcast — never these types.
// ===========================================================================
import type { Ability, AbilityFlavor, PlayerClass, PlaystyleProfile, Theme } from "./shared/types";
import type { Attributes, DerivedStats, EquipSlot, Inventory, Item } from "./shared/items";

export const PROTOCOL_VERSION = 6;

// ---------- Client -> Server ----------
export type ClientMsg =
  | { t: "join"; name: string; token?: string } // token = signed playerId for reconnect
  | { t: "input"; seq: number; mv: [number, number]; aim: number } // mv = move vec; aim = radians
  | { t: "cast"; seq: number; ability: number; aim: number } // fire ability N in aim direction
  // ---- inventory / gear (character screen) ----
  | { t: "equip"; item: string } // equip a carried item (auto-slots)
  | { t: "unequip"; slot: EquipSlot } // move equipped gear back to carry
  | { t: "unequipBag"; index: number } // unequip a bag container
  | { t: "sell"; item: string } // sell a carried item for gold (waiting room only)
  | { t: "drop"; item: string } // drop a carried item onto the floor
  | { t: "openLoot"; bag: string } // request the contents of a nearby loot bag
  | { t: "takeLoot"; bag: string; item?: string } // take one item (or all if omitted)
  | { t: "swapAbility"; a: number; b: number } // reorder/swap two action-bar slots
  | { t: "evolve"; slot: number; to: string } // evolve a matured ability into a chosen branch
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

export type EntityKind = "player" | "monster" | "boss" | "proj" | "lootbag";
export interface EntityDTO {
  id: string;
  kind: EntityKind;
  x: number;
  y: number;
  aim?: number; // facing in radians, for sprite direction
  hp?: number;
  maxHp?: number;
  dead?: boolean;
  name?: string; // players only
  cls?: PlayerClass; // players only
  sprite?: number; // atlas frame id (kind-specific)
  n?: number; // item count (loot bags)
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
  status: "alive" | "spectator";
  reached: boolean; // reached the stairs — in the safe waiting room (spectate + manage gear)
}

export type GameEvent =
  | { e: "dmg"; x: number; y: number; amount: number }
  | { e: "heal"; x: number; y: number; amount: number }
  | { e: "death"; x: number; y: number; id: string }
  | { e: "cast"; x: number; y: number; ability: number }
  | { e: "melee"; by: string }
  | { e: "hit"; x: number; y: number; ability: number }
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
