// WoW-style class definitions: each chosen class has a MAIN STAT that scales its
// ability damage, a trinity ROLE, and display metadata. The talent tree per class
// lives in talents.ts. Distinct from the emergent `PlayerClass` (playstyle label).
import type { AttrKey } from "./items";
import type { Klass, TrinityRole } from "./types";

export const KLASSES: Klass[] = ["warrior", "mage", "priest", "rogue", "hunter"];

// The attribute that scales each class's ability damage (deriveStats mainStat).
export const CLASS_MAIN_STAT: Record<Klass, AttrKey> = {
  warrior: "strength",
  mage: "intellect",
  priest: "intellect",
  rogue: "agility",
  hunter: "agility",
};

// Default trinity role (talents can grant cross-role abilities, e.g. a Warrior
// taunt or a Priest's shadow damage).
export const CLASS_ROLE: Record<Klass, TrinityRole> = {
  warrior: "dps",
  mage: "dps",
  priest: "healer",
  rogue: "dps",
  hunter: "dps",
};

export interface KlassInfo {
  name: string;
  icon: string;
  blurb: string;
  armor: string; // fantasy armor type (flavor)
}
export const CLASS_INFO: Record<Klass, KlassInfo> = {
  warrior: { name: "Warrior", icon: "⚔️", armor: "Plate", blurb: "Plate-clad weapon master. Strength fuels heavy strikes; talent into a threat-holding tank or a relentless DPS." },
  mage: { name: "Mage", icon: "🔮", armor: "Cloth", blurb: "Glass-cannon spellcaster. Intellect powers ranged bolts and a group haste burst." },
  priest: { name: "Priest", icon: "✨", armor: "Cloth", blurb: "Light-wielding healer. Intellect scales heals, shields on allies, and group buffs — the trinity's anchor." },
  rogue: { name: "Rogue", icon: "🗡️", armor: "Leather", blurb: "Agile melee assassin. Agility and crit turn fast strikes into bursts of damage." },
  hunter: { name: "Hunter", icon: "🏹", armor: "Mail", blurb: "Ranged marksman. Agility drives volleys of thrown shots from a safe distance." },
};
