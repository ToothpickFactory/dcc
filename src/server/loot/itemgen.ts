import { WEAPON_TYPES, weaponVisualRarity, type AttrKey, type Attributes, type Item, type ItemSlot, type WeaponType } from "../../shared/items";
import type { Rarity } from "../../shared/types";

// Deterministic gear generator: a slot + an attribute budget scaled by depth and
// rarity, distributed across the attributes that slot favors. Reused for monster
// drops, chests, and player starter kits. (INV-5 adds LLM-named flavor.)

const RARITY_RANK: Record<Rarity, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
const RARITY_BUDGET: Record<Rarity, number> = { common: 4, uncommon: 7, rare: 11, epic: 16, legendary: 24 };
const RARITY_ADJ: Record<Rarity, string> = { common: "Worn", uncommon: "Sturdy", rare: "Fine", epic: "Heroic", legendary: "Mythic" };

const SLOT_NOUN: Record<ItemSlot, string> = {
  helmet: "Helm",
  chest: "Cuirass",
  legs: "Greaves",
  gloves: "Gauntlets",
  weapon: "Weapon",
  ring: "Band",
  amulet: "Pendant",
  bag: "Satchel",
  consumable: "Potion",
};
// Each slot favours a themed set of attributes. Weapons/gloves/rings can roll the
// crit secondary; armor pieces favour stamina/armor; casters' gear favours intellect.
const SLOT_ATTRS: Record<ItemSlot, AttrKey[]> = {
  helmet: ["stamina", "armor", "intellect"],
  chest: ["stamina", "armor"],
  legs: ["stamina", "agility", "armor"],
  gloves: ["strength", "haste", "agility", "crit"],
  weapon: ["strength", "strength", "intellect", "agility", "crit"], // a mix of main stats + crit
  ring: ["strength", "intellect", "agility", "haste", "crit"],
  amulet: ["intellect", "strength", "stamina"],
  bag: ["stamina"],
  consumable: [], // potions carry no equip stats
};
// Slots the generic gear roller can produce. Consumables are minted only via
// generatePotion(), so a routine gear drop never accidentally rolls a potion.
const ALL_SLOTS: ItemSlot[] = ["helmet", "chest", "legs", "gloves", "weapon", "ring", "amulet", "bag"];
const WEAPON_NOUN: Record<WeaponType, string> = {
  axe: "Axe",
  flail: "Flail",
  shield: "Shield",
  sword: "Sword",
};
const WEAPON_ICON: Record<WeaponType, string> = {
  axe: "🪓",
  flail: "⛓",
  shield: "🛡️",
  sword: "⚔️",
};

export function generateItem(depth: number, rarity: Rarity, rng: () => number, slot?: ItemSlot): Item {
  const s = slot ?? ALL_SLOTS[Math.floor(rng() * ALL_SLOTS.length)];
  const item: Item = {
    id: `gear-${depth}-${Math.floor(rng() * 1e9).toString(36)}`,
    name: `${RARITY_ADJ[rarity]} ${SLOT_NOUN[s]}`,
    rarity,
    slot: s,
    attrs: {},
  };

  let budget = RARITY_BUDGET[rarity] + Math.floor(depth * 0.5);
  if (s === "bag") {
    item.bagSlots = 2 + RARITY_RANK[rarity]; // 2..6 extra carry slots
    budget = Math.floor(budget / 2); // bags carry fewer combat stats
  } else if (s === "weapon") {
    const weaponType = WEAPON_TYPES[Math.floor(rng() * WEAPON_TYPES.length)];
    item.weaponType = weaponType;
    item.weaponRarity = weaponVisualRarity(rarity);
    item.name = `${RARITY_ADJ[rarity]} ${WEAPON_NOUN[weaponType]}`;
    item.icon = WEAPON_ICON[weaponType];
  }

  const keys = SLOT_ATTRS[s];
  const attrs = item.attrs as Partial<Attributes>;
  const picks = 1 + Math.min(2, RARITY_RANK[rarity]); // 1..3 stat lines by rarity
  for (let i = 0; i < picks && budget > 0; i++) {
    const k = keys[Math.floor(rng() * keys.length)];
    const give = i === picks - 1 ? budget : 1 + Math.floor(rng() * budget);
    attrs[k] = (attrs[k] ?? 0) + give;
    budget -= give;
  }
  return item;
}

// A health potion — a carried-only consumable you drink (useItem) to heal a % of
// your max HP. Frequent floor drops keep healing available without a dedicated
// healer. Heal % ticks up slightly with depth so they stay relevant.
export function generatePotion(depth: number, rng: () => number): Item {
  const healPct = Math.min(0.6, 0.3 + depth * 0.01);
  return {
    id: `potion-${depth}-${Math.floor(rng() * 1e9).toString(36)}`,
    name: "Healing Potion",
    rarity: "common",
    slot: "consumable",
    attrs: {},
    consumable: { healPct },
    icon: "🧪",
  };
}

// Roll a rarity for a routine drop, skewing richer with depth. Bosses/chests
// pass an explicit rarity instead of using this.
export function rollGearRarity(depth: number, rng: () => number): Rarity {
  const roll = rng() + depth * 0.01;
  if (roll > 0.97) return "epic";
  if (roll > 0.88) return "rare";
  if (roll > 0.62) return "uncommon";
  return "common";
}
