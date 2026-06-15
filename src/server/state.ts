import type { Ability, MonsterKind } from "../shared/types";
import type { Attributes, DerivedStats, Inventory } from "../shared/items";
import type { GameEvent } from "../protocol";
import type { PlaystyleEvent } from "./events";
import type { FloorDescriptor } from "../procgen/types";

export interface PlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  aim: number;
  mvx: number; // last input move vector (unit-ish)
  mvy: number;
  hp: number;
  status: "alive" | "spectator";
  cds: Record<number, number>;
  lastSeq: number; // last processed input seq (echoed as ack)
  abilities: Ability[];
  slowUntil: number; // movement slowed (e.g. frost) while now < slowUntil
  seen: Set<number>; // floor-grid cell indices revealed (drives the exploration axis)
  base: Attributes; // innate attributes (before gear)
  inv: Inventory; // equipped gear + bags + carried items
  derived: DerivedStats; // cached: base+gear -> maxHp/moveSpeed/spellPower/... (recompute on change)
  ws: WebSocket;
  linkdead: boolean; // socket dropped but a LIVING character stays in the world (decision #8)
}

export interface MonsterState {
  id: string;
  kind: MonsterKind;
  x: number;
  y: number;
  aim: number;
  maxHp: number; // per-kind (grunt/ranged/brute/swarm differ)
  hp: number;
  dead: boolean;
  respawnAt: number; // monsters respawn (keeps kills accruing toward the boss)
  attackReadyAt: number;
  wanderAt: number;
  slowUntil: number; // movement slowed (e.g. frost) while now < slowUntil
  base: Attributes; // innate attributes (per kind); gear adds on top
  inv: Inventory; // monsters carry gear too — dropped on death
  derived: DerivedStats; // cached stats (maxHp mirrors derived.maxHp)
  threat: Map<string, number>; // playerId -> accumulated threat
}

// The boss (ported from the monolith). Its own type so combat can tell it apart
// from a regular monster; the `tag` field is the discriminant.
export interface BossState {
  tag: "boss";
  id: string;
  name: string;
  x: number;
  y: number;
  aim: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  castReadyAt: number;
  meleeReadyAt: number;
  threat: Map<string, number>;
}

export interface ProjectileState {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  slowMs: number;
  ability: number;
  ttl: number; // seconds remaining
  hitR: number; // projectile's own collision radius (px), added to the target's
  boss: boolean; // enemy projectile (boss bolt OR monster bolt): only affects players
}

// The slice of the world the simulation modules operate on. The Durable Object
// implements this and passes itself as the context, so sim modules never import
// the DO.
export interface WorldCtx {
  now: number;
  players: Map<string, PlayerState>;
  monsters: MonsterState[];
  projectiles: ProjectileState[];
  boss: BossState | null;
  floor: FloorDescriptor; // current floor — sim reads collision grid + dims
  pushFx(e: GameEvent): void;
  pushPlay(e: PlaystyleEvent): void;
}
