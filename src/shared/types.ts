// Domain types shared across client and server. The wire protocol (protocol.ts)
// and every subsystem seam build on these.

export type AbilityCategory = "ranged" | "melee" | "aoe" | "support" | "utility" | "stealth";
export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type Theme = "fantasy" | "cyberpunk" | "forest" | "pirate" | "clockwork" | "nightmare" | "icedungeon";
export type PlayerClass =
  | "vanilla"
  | "protector"
  | "hunter"
  | "shadow"
  | "negotiator"
  | "berserker";
export type MonsterKind = "grunt" | "ranged" | "brute" | "swarm" | "healer" | "pirate" | "sharkman";

// Hard crowd control applied to enemies by player abilities. `root` locks movement
// only; `stun`/`freeze` lock movement AND action (and interrupt a wind-up). `freeze`
// is a stun flavored as ice (icy tint + a short slow on thaw).
export type CcKind = "stun" | "root" | "freeze";

// Chosen WoW-style classes (picked at the first level-up; distinct from the
// emergent playstyle `PlayerClass` label above). Drives the main stat that scales
// your abilities, your trinity role, and which talent tree you spend points in.
export type Klass = "warrior" | "mage" | "priest" | "rogue" | "hunter";
export type TrinityRole = "tank" | "dps" | "healer";

export interface Ability {
  id: string;
  category: AbilityCategory;
  cd: number; // cooldown (ms)
  range: number; // max effective range, px (0 = self)
  dmg: number; // negative = heal
  projectile: boolean;
  speed?: number; // ballistic projectile speed (px/s)
  slowMs?: number;
  // ---- hard crowd control (enemy-only; never lands on players) ----
  stunMs?: number; // on hit: fully lock the foe (no move/act) + interrupt its wind-up
  rootMs?: number; // on hit: lock the foe's movement only (it can still swing/shoot)
  freeze?: boolean; // flavor: render the stun as ice + leave a short slow on thaw
  ammo?: number; // current charges (consumables like thrown rocks); undefined = unlimited
  maxAmmo?: number; // full ammo, for the UI bar
  // ---- evolution shape (drives how the cast behaves) ----
  pellets?: number; // projectile abilities: fire N pellets in a spread (multishot)
  spread?: number; // total spread angle (radians) across pellets, or melee cone width
  cone?: number; // melee cone width (radians); default ~PI/3
  // ---- hotbar consumable slot ----
  usesItem?: "consumable"; // a hotbar slot that, when cast, uses a carried item (e.g. a potion) instead of a normal cast
  // ---- support / trinity behavior (RPG Phase 2) ----
  allyOnly?: boolean; // projectile only ever affects allies (heals/shields), never foes
  shield?: number; // ally-targeted absorb shield applied on hit (instead of/with healing)
  taunt?: boolean; // instant: forces foes in range to target the caster (tank)
  groupBuff?: "haste"; // instant aura: buffs all nearby allies (bloodlust); shared cooldown
  // ---- progression (per-instance; persists on the action bar) ----
  xp?: number; // experience toward this ability's next evolution
  tier?: number; // how many times it has evolved (0 = base)
  fromTalent?: boolean; // granted by spending a talent point — random loot never evicts it
  // Display-only. The heuristic fills `name`; the LLM may overwrite name/flavor/
  // twist. NONE of these ever affect the numbers above.
  name: string;
  flavor?: string;
  twist?: string;
  icon?: string;
  color?: string;
}

export interface AbilityFlavor {
  name: string;
  flavor: string;
  twist?: string;
}

// 7-axis playstyle profile, each axis 0..1 (EMA-smoothed). See Stream E / M5.
export interface PlaystyleProfile {
  stealth: number;
  ranged: number;
  melee: number;
  support: number;
  aggression: number;
  exploration: number;
  teamwork: number;
}
