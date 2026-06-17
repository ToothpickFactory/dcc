import type { Ability } from "./types";
import { ABILITY_NODES } from "./skills";

// Every hero starts with this action bar: a melee Wooden Sword in slot 1 (the
// AUTO-CAST slot — it auto-swings at the nearest foe) and throwable Rocks with
// limited ammo in slot 2. Both EVOLVE as you use them (see skills.ts). Found
// abilities (loot) can be swapped into the bar and leveled the same way.
export function starterAbilities(): Ability[] {
  return [
    { ...ABILITY_NODES.sword, xp: 0, tier: 0 },
    { ...ABILITY_NODES.rocks, xp: 0, tier: 0 },
  ];
}

// Back-compat alias (older imports). A fresh copy each access so callers can
// mutate per-player without aliasing the templates.
export const DEFAULT_ABILITIES: Ability[] = starterAbilities();

// A hotbar slot that consumes a carried item when cast — e.g. drink a Healing
// Potion on yourself from the bar. Added via the inventory ("Add to bar"); its
// `ammo` is set live to how many consumables you're carrying.
export const HOTBAR_POTION_ID = "potion";
export function potionHotbarSlot(): Ability {
  return { id: HOTBAR_POTION_ID, category: "support", cd: 6000, range: 0, dmg: 0, projectile: false, usesItem: "consumable", name: "Healing Potion", icon: "🧪", color: "#5dff9b" };
}
