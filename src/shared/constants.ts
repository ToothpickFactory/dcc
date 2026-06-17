// Tunable constants shared by client prediction and the server simulation.
// Keeping them in ONE place is what lets client-side prediction match the
// authoritative server (see ROADMAP.md M3).
import type { MonsterKind } from "./types";

export const TICK_MS = 50; // server simulation step (20 Hz)
export const INPUT_HZ = 10; // client -> server input rate (scale gate; see ROADMAP.md)
export const INPUT_MS = 1000 / INPUT_HZ;

export const WORLD = { w: 2400, h: 2400 };

export const MAX_FLOORS = 100; // reaching past this ends the run as a victory (lore: Floor 100)

export const PLAYER_SPEED = 230; // px/s
export const PLAYER_MAX_HP = 100;
export const PLAYER_RADIUS = 17;

export const MONSTER_SPEED = 95;
export const MONSTER_MAX_HP = 60;
export const MONSTER_RADIUS = 20;
export const MONSTER_AGGRO = 360;
export const MONSTER_MELEE_RANGE = 56;
export const MONSTER_ATTACK_CD = 1200;
export const MONSTER_DMG = 6;

export const MONSTER_RESPAWN_MS = 6000; // monsters respawn so kills keep accruing (boss trigger)
export const LOOT_BAG_TTL = 120000; // ms a dropped loot bag lingers before despawning
export const LOOT_REACH = 90; // px a player must be within to loot a bag
export const MONSTER_BOLT_SPRITE = 98; // EntityDTO.sprite for a ranged monster's bolt

// Per-kind monster archetypes (Stream B). The grunt row mirrors the legacy
// MONSTER_* constants so existing behavior is unchanged; the others diverge.
// `ranged` kites and shoots instead of meleeing (dmg 0, fires bolts).
export interface MonsterKindDef {
  hp: number;
  speed: number; // px/s
  dmg: number; // melee damage (0 for ranged kiters / healers)
  attackCd: number; // ms between attacks/shots
  meleeRange: number; // px
  radius: number; // collision radius, px
  ranged?: { shootRange: number; kite: number; projSpeed: number; projDmg: number };
  // Support healer: keeps `kite` distance from players and heals the lowest-HP
  // ally within `range` for `amount` every `cd` ms (group survival).
  heal?: { amount: number; cd: number; range: number; kite: number };
}
export const MONSTER_KINDS: Record<MonsterKind, MonsterKindDef> = {
  grunt: { hp: 60, speed: 95, dmg: 6, attackCd: 1200, meleeRange: 56, radius: 20 },
  brute: { hp: 150, speed: 58, dmg: 16, attackCd: 1500, meleeRange: 74, radius: 28 }, // slow tank, big hits
  swarm: { hp: 24, speed: 158, dmg: 4, attackCd: 700, meleeRange: 42, radius: 13 }, // fast, fragile, weak
  ranged: { hp: 42, speed: 86, dmg: 0, attackCd: 1500, meleeRange: 0, radius: 18, ranged: { shootRange: 470, kite: 280, projSpeed: 360, projDmg: 9 } },
  healer: { hp: 50, speed: 92, dmg: 0, attackCd: 1500, meleeRange: 0, radius: 18, heal: { amount: 14, cd: 1400, range: 320, kite: 240 } }, // mends its camp
};

export const PROJECTILE_RADIUS = 7;
export const THREAT_DECAY = 0.92; // per-tick threat multiplier
export const SLOW_FACTOR = 0.5; // movement multiplier while a slow (e.g. frost) is active

// Directional heal (ported): a heal projectile mends the first ally it hits, and
// casting it draws aggro from nearby foes — so support play carries risk.
export const AGGRO_HEAL_RADIUS = 760;
export const AGGRO_PER_HEAL = 1.2; // threat per point healed, added to nearby foes

// ---- Boss / exit guardian --------------------------------------------------
// One boss guards the stairs on every floor. It is deliberately "elite enemy"
// sized: about 50% stronger than the baseline grunt, not a raid-wall.
export const BOSS_POWER_MULT = 1.5;
export const BOSS_MAX_HP = Math.round(MONSTER_KINDS.grunt.hp * BOSS_POWER_MULT);
export const BOSS_SPEED = MONSTER_KINDS.grunt.speed;
export const BOSS_RADIUS = 30;
export const BOSS_MELEE_RANGE = 70;
export const BOSS_MELEE_CD = 1200;
export const BOSS_MELEE_DMG = Math.round(MONSTER_KINDS.grunt.dmg * BOSS_POWER_MULT);
export const BOSS_CAST_CD = 1500; // ms between bolt volleys
export const BOSS_PROJ_SPEED = 340; // px/s, straight-line (dodgeable, not homing)
export const BOSS_PROJ_DMG = Math.round((MONSTER_KINDS.ranged.ranged?.projDmg ?? MONSTER_KINDS.grunt.dmg) * BOSS_POWER_MULT);
export const BOSS_PROJ_LIFE = 4.5; // seconds before a stray bolt despawns
export const BOSS_PROJ_SPREAD = 0.2; // radians between bolts in a volley
export const BOSS_PROJ_RADIUS = 30; // collision radius vs players
export const FIRST_BOSS_NAME = "Iron Jailor";
export const BOSS_NAME = "Slime Guardian";
export const BRIAR_REVENANT_BOSS_NAME = "Briar Revenant";
export const PRIMAL_CONFLUX_BOSS_NAME = "Primal Conflux";
export const BOSS_NAMES = [BRIAR_REVENANT_BOSS_NAME, PRIMAL_CONFLUX_BOSS_NAME, BOSS_NAME] as const;
export function bossNameForDepth(depth: number): string {
  if (depth <= 1) return FIRST_BOSS_NAME;
  return BOSS_NAMES[(depth - 2) % BOSS_NAMES.length];
}
export const BOSS_BOLT_SPRITE = 99; // EntityDTO.sprite marker so the client styles boss bolts
