import type { Ability, Klass, MonsterKind } from "../shared/types";
import type { Attributes, DerivedStats, Inventory, Item } from "../shared/items";
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
  reached: boolean; // reached the stairs this floor — safe in the "waiting room", out of play
  gold: number; // currency, earned by selling gear in the waiting room
  cds: Record<number, number>;
  lastSeq: number; // last processed input seq (echoed as ack)
  abilities: Ability[];
  charXp: number; // total character XP (from kills); drives character level + passive bonuses
  // ---- WoW-style class & talents (RPG Phase 2) ----
  chosenClass: Klass | null; // picked at the first level-up; drives main-stat scaling + talent tree
  talents: Record<string, number>; // talent node id -> rank spent
  talentPoints: number; // unspent talent points (1 granted per character level)
  // ---- Tank/support state (set by talents; read by the sim) ----
  threatMult: number; // multiplier on threat this player generates (tank talent raises it)
  shield: number; // current absorb shield (consumed before HP)
  shieldUntil: number; // shield expires at this tick
  bloodlustUntil: number; // group-haste buff active while now < this
  slowUntil: number; // movement slowed (e.g. frost) while now < slowUntil
  // ---- Dodge/dash (evade) ----
  dashUntil: number; // dash burst active while now < this (movement overridden)
  dashDirX: number; // unit dash direction
  dashDirY: number;
  dashReadyAt: number; // dash off cooldown at this tick
  dashIframeUntil: number; // invulnerable (i-frames) while now < this
  potionReadyAt: number; // transient: earliest tick a consumable can next be used (not persisted)
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
  dmgMult: number; // per-floor damage scaling (1 at floor 1, grows with depth)
  // ---- Attack telegraph (melee wind-up) ----
  windupUntil: number; // melee lands when now >= this (0 = not winding up)
  windupTarget: string; // player id the wind-up is aimed at
  // ---- Knockback (player hits shove + stagger) ----
  knockUntil: number; // knockback impulse active while now < this
  knockVx: number;
  knockVy: number;
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
  dmgMult: number; // per-floor damage scaling
  // ---- Attack telegraphs (wind-up before melee / cast) ----
  meleeWindupUntil: number; // boss melee lands when now >= this
  castWindupUntil: number; // boss bolt-fan fires when now >= this
  castTarget: string; // player id the pending cast is aimed at
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
  sprite?: number; // optional client render marker; ability remains the real caster slot
  ttl: number; // seconds remaining
  hitR: number; // projectile's own collision radius (px), added to the target's
  boss: boolean; // enemy projectile (boss bolt OR monster bolt): only affects players
  allyOnly?: boolean; // support projectile: only ever resolves on allied players (heals/shields)
  shield?: number; // support projectile: absorb shield applied to the struck ally
}

// A bag of dropped items sitting on the floor. Spawned when ANY entity dies
// (player or monster) holding its full inventory; players walk up and loot it.
export interface LootBagState {
  id: string;
  x: number;
  y: number;
  items: Item[];
  corpseId?: string; // entity whose body should remain visible until this bag is gone
  expiresAt: number; // wall-clock ms; despawns after this so the floor stays clean
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
  lootBags: LootBagState[];
  groupHasteReadyAt: number; // shared cooldown for the group-haste (bloodlust) burst
  floor: FloorDescriptor; // current floor — sim reads collision grid + dims
  pushFx(e: GameEvent): void;
  pushPlay(e: PlaystyleEvent): void;
  dropLoot(x: number, y: number, items: Item[], corpseId?: string): void; // spawn a loot/corpse bag
  rollDrops(m: MonsterState): void; // on monster death: chance-gated, floor-appropriate drops (gear + potions)
  corpseLootExists(corpseId: string): boolean;
  // Award ability + character XP to a player for a hit/kill with action slot `idx`.
  gainXp(playerId: string, idx: number, killed: boolean, kind?: MonsterKind | "boss"): void;
  // Co-op: split a kill's character-XP share to living allies near (x,y).
  shareKillXp(x: number, y: number, killerId: string, kind?: MonsterKind | "boss"): void;
}
