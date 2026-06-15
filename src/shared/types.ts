// Domain types shared across client and server. The wire protocol (protocol.ts)
// and every subsystem seam build on these.

export type AbilityCategory = "ranged" | "melee" | "aoe" | "support" | "utility" | "stealth";
export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type Theme = "fantasy" | "cyberpunk" | "forest" | "pirate" | "clockwork" | "nightmare";
export type PlayerClass =
  | "vanilla"
  | "protector"
  | "hunter"
  | "shadow"
  | "negotiator"
  | "berserker";
export type MonsterKind = "grunt" | "ranged" | "brute" | "swarm";

export interface Ability {
  id: string;
  category: AbilityCategory;
  cd: number; // cooldown (ms)
  range: number; // max effective range, px (0 = self)
  dmg: number; // negative = heal
  projectile: boolean;
  speed?: number; // ballistic projectile speed (px/s)
  slowMs?: number;
  ammo?: number; // current charges (consumables like thrown rocks); undefined = unlimited
  maxAmmo?: number; // full ammo, for the UI bar
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
