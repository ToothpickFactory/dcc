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
export const POISON_PROJECTILE_SPRITE = 95; // EntityDTO.sprite marker for poison GLB projectiles
export const ICE_PROJECTILE_SPRITE = 96; // EntityDTO.sprite marker for ice/rock GLB projectiles
export const FIREBALL_PROJECTILE_SPRITE = 97; // EntityDTO.sprite marker for fireball GLB projectiles
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
export const CRIT_MULT = 1.5; // a critical strike deals +50% (see DerivedStats.critChance)
export const THREAT_DECAY = 0.92; // per-tick threat multiplier
export const SLOW_FACTOR = 0.5; // movement multiplier while a slow (e.g. frost) is active

// Dodge/dash (Champions-of-Norrath-style evade): a short high-speed burst with brief
// invulnerability, on a cooldown. The defensive tool every class shares.
export const DASH_SPEED = 760; // px/s during the dash burst (~3.3x base move)
export const DASH_MS = 180; // dash duration
export const DASH_IFRAME_MS = 240; // i-frames (covers the dash + a hair of recovery)
export const DASH_CD = 1400; // cooldown between dashes

// Per-floor enemy scaling so descent gets genuinely deadlier, not just more crowded.
export const FLOOR_HP_SCALE = 0.12; // +12% enemy HP per floor depth (linear)
export const FLOOR_DMG_SCALE = 0.08; // +8% enemy damage per floor depth

// Attack telegraphs: enemy melee winds up before it lands, so you can dodge/step out
// during the tell (CoN's read-and-evade dance). Brutes/bosses telegraph longer + heavier.
export const MELEE_WINDUP_MS = 340; // monster melee wind-up before damage
export const BRUTE_WINDUP_MULT = 1.6; // brutes telegraph slower (heavier swing)
export const BOSS_MELEE_WINDUP_MS = 480;
export const BOSS_CAST_WINDUP_MS = 420; // boss bolt-fan tell

// Knockback: player hits shove enemies (and they stagger), so blows have weight. Per-kind
// resistance differentiates a swarm bug (flies) from a brute (barely budges).
export const KNOCK_SPEED = 560; // px/s knockback burst on a player hit
export const KNOCK_MS = 170; // knockback impulse duration (decays out)
export const KNOCK_RESIST: Record<string, number> = { swarm: 1.35, grunt: 1.0, ranged: 1.1, healer: 1.0, brute: 0.4 };

// Melee combo: chained swings build to a heavy finisher. Light swings chain fast; the
// finisher hits harder + wider + shoves more, then a recovery resets the chain — rhythm + weight.
export const COMBO_WINDOW_MS = 850; // keep the chain alive if you swing again within this
export const COMBO_FINISHER_STEP = 2; // steps 0,1 = light; step 2 = heavy finisher (then reset)
export const COMBO_LIGHT_CD_MULT = 0.5; // light swings come out at half the base cooldown (chainable)
export const COMBO_FINISHER_DMG_MULT = 1.7; // finisher damage bonus
export const COMBO_FINISHER_CONE_MULT = 1.5; // finisher arc is wider
export const COMBO_FINISHER_KNOCK_MULT = 2.2; // finisher shoves harder

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
