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

// Add a newly-unlocked ability to a kit (mutates in place). Unlocked abilities are
// KEPT so the player can choose which sit in their hotbar (the first `hotbarSize`
// slots). The kit grows to `max`; only then does a new grant replace the WEAKEST
// BENCHED ability (index >= hotbarSize) — never the hotbar, a hotbar consumable
// slot, or a talent-granted ability (unless the incoming one is itself a talent).
// Pure + deterministic so it's unit-testable without the Durable Object.
export function addAbilityToKit(abilities: Ability[], ability: Ability, max: number, hotbarSize: number): void {
  if (abilities.length < max) {
    abilities.push(ability);
    return;
  }
  const incomingIsTalent = ability.fromTalent === true;
  let target = -1;
  let worst = Infinity;
  for (let i = hotbarSize; i < abilities.length; i++) {
    const a = abilities[i];
    if (a.usesItem) continue; // never evict a hotbar consumable slot
    if (!incomingIsTalent && a.fromTalent) continue; // protect chosen talents from random loot
    const score = Math.abs(a.dmg) + (a.category === ability.category ? -1000 : 0);
    if (score < worst) {
      worst = score;
      target = i;
    }
  }
  if (target < 0) return; // every bench slot is protected — keep the kit as-is
  abilities[target] = ability;
}
