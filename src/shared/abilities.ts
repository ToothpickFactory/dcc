import type { Ability } from "./types";
import { ABILITY_NODES, EVOLUTIONS, evolveCost } from "./skills";
import { MERGE_CD_BUMP_RATIO, MERGE_CD_FLOOR_RATIO, MERGE_RANGE_BUMP_RATIO, MERGE_STAT_BUMP, MERGE_XP_FRACTION } from "./constants";

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

export interface AbilityMerge {
  targetId: string;
  xpGain: number; // evolution xp added; 0 when statBump is true
  statBump: boolean; // true = a terminal ability got an immediate dmg/range/cd bump + tier++
}

// The existing ability (hotbar or bench, starter/talent/loot — doesn't matter) that a
// same-category grant should strengthen: highest |dmg| wins the tie-break. Never matches
// a hotbar consumable slot (usesItem isn't a real ability).
export function findMergeTarget(abilities: Ability[], incoming: Ability): Ability | null {
  let best: Ability | null = null;
  let bestAbs = -1;
  for (const a of abilities) {
    if (a.usesItem) continue;
    if (a.category !== incoming.category) continue;
    const abs = Math.abs(a.dmg);
    if (abs > bestAbs) {
      bestAbs = abs;
      best = a;
    }
  }
  return best;
}

// If `incoming` shares a category with an ability the player already has, fold its
// rolled power into that ability instead of handing back a new kit slot. Mutates the
// matched ability in place. Returns null when there's nothing to merge into yet (first
// ability of that category) — the caller should fall through to addAbilityToKit.
//
// Abilities with an evolution branch (EVOLUTIONS[id] non-empty) bank the power as xp
// toward the existing evolve system (evolveCost) — the player still evolves manually.
// Terminal abilities (no branch — most loot-rolled ids and catalog leaves like
// executioner/boulder/scattershot/whirlwind/taunt/bloodlust/shieldbash/concussive/
// hamstring/frostnova/wavemend) can never spend that xp, so they get an immediate
// proportional dmg/range/cd bump and `tier` increments as a plain power-level counter.
export function mergeDuplicateAbility(abilities: Ability[], incoming: Ability, rarityMult: number): AbilityMerge | null {
  const target = findMergeTarget(abilities, incoming);
  if (!target) return null;

  const opts = EVOLUTIONS[target.id];
  if (opts && opts.length > 0) {
    const xpGain = Math.round(evolveCost(target.tier ?? 0) * MERGE_XP_FRACTION * rarityMult);
    target.xp = (target.xp ?? 0) + xpGain;
    return { targetId: target.id, xpGain, statBump: false };
  }

  const bump = MERGE_STAT_BUMP * rarityMult;
  target.dmg = target.dmg === 0 ? 0 : Math.round(target.dmg * (1 + bump)); // sign-preserving: heals (negative dmg) get stronger too
  target.range = Math.round(target.range * (1 + bump * MERGE_RANGE_BUMP_RATIO));
  target.cd = Math.round(target.cd * Math.max(1 - bump * MERGE_CD_BUMP_RATIO, MERGE_CD_FLOOR_RATIO));
  target.tier = (target.tier ?? 0) + 1;
  return { targetId: target.id, xpGain: 0, statBump: true };
}
