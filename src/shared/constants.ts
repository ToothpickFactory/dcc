// Tunable constants shared by client prediction and the server simulation.
// Keeping them in ONE place is what lets client-side prediction match the
// authoritative server (see ROADMAP.md M3).

export const TICK_MS = 50; // server simulation step (20 Hz)
export const INPUT_HZ = 10; // client -> server input rate (scale gate; see ROADMAP.md)
export const INPUT_MS = 1000 / INPUT_HZ;

export const WORLD = { w: 2400, h: 2400 };

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

export const PROJECTILE_RADIUS = 7;
export const THREAT_DECAY = 0.92; // per-tick threat multiplier

// Directional heal (ported): a heal projectile mends the first ally it hits, and
// casting it draws aggro from nearby foes — so support play carries risk.
export const AGGRO_HEAL_RADIUS = 760;
export const AGGRO_PER_HEAL = 1.2; // threat per point healed, added to nearby foes

// ---- Boss (ported from the monolith: spawns after enough collective kills) ----
export const BOSS_KILL_THRESHOLD = 12; // monster kills before a boss appears
export const BOSS_MAX_HP = 700;
export const BOSS_SPEED = 78; // slower than players so it can be kited
export const BOSS_RADIUS = 38;
export const BOSS_MELEE_RANGE = 78;
export const BOSS_MELEE_CD = 1200;
export const BOSS_MELEE_DMG = 14;
export const BOSS_CAST_CD = 1500; // ms between bolt volleys
export const BOSS_PROJ_SPEED = 340; // px/s, straight-line (dodgeable, not homing)
export const BOSS_PROJ_DMG = 16;
export const BOSS_PROJ_LIFE = 4.5; // seconds before a stray bolt despawns
export const BOSS_PROJ_SPREAD = 0.2; // radians between bolts in a volley
export const BOSS_PROJ_RADIUS = 30; // collision radius vs players
export const BOSS_NAME = "Gorehollow, the Devourer";
export const BOSS_BOLT_SPRITE = 99; // EntityDTO.sprite marker so the client styles boss bolts
