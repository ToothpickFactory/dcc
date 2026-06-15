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

export const PROTOCOL_VERSION = 1;

// ---------- Client -> Server ----------
export type ClientMsg =
  | { t: "join"; name: string; token?: string } // token = signed playerId for reconnect
  | { t: "input"; seq: number; mv: [number, number]; aim: number } // mv = move vec; aim = radians
  | { t: "cast"; seq: number; ability: number; aim: number } // fire ability N in aim direction
  | { t: "ping"; ts: number };

// ---------- Server -> Client ----------
export type ServerMsg =
  | { t: "welcome"; you: string; token: string; world: WorldInfo; protocol: number }
  | { t: "state"; tick: number; ack: number; ents: EntityDTO[]; events: GameEvent[]; self: SelfDTO }
  | { t: "floor"; info: FloorClientInfo; state: FloorState }
  | { t: "run"; state: RunState }
  | { t: "loot"; grant: LootGrantDTO }
  | { t: "pong"; ts: number };

export interface WorldInfo {
  w: number;
  h: number;
}

export type EntityKind = "player" | "monster" | "boss" | "proj";
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
  status: "alive" | "spectator";
}

export type GameEvent =
  | { e: "dmg"; x: number; y: number; amount: number }
  | { e: "heal"; x: number; y: number; amount: number }
  | { e: "death"; x: number; y: number; id: string }
  | { e: "cast"; x: number; y: number; ability: number }
  | { e: "hit"; x: number; y: number; ability: number }
  | { e: "boss"; x: number; y: number; state: "spawn" | "dead" };

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
