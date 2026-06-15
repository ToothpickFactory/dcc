import type { Ability, MonsterKind } from "../shared/types";
import type { GameEvent } from "../protocol";
import type { PlaystyleEvent } from "./events";

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
  ws: WebSocket;
  linkdead: boolean; // socket dropped but a LIVING character stays in the world (decision #8)
}

export interface MonsterState {
  id: string;
  kind: MonsterKind;
  x: number;
  y: number;
  aim: number;
  hp: number;
  dead: boolean;
  respawnAt: number; // monsters respawn (keeps kills accruing toward the boss)
  attackReadyAt: number;
  wanderAt: number;
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
  boss: boolean; // boss bolt: only affects players, bigger hit radius
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
  pushFx(e: GameEvent): void;
  pushPlay(e: PlaystyleEvent): void;
}
