// Universal gear / attribute / inventory model — shared by every entity
// (players AND monsters) and by client + server. Pure data + pure functions;
// no engine imports, so it's trivially testable and reusable.
import type { Rarity } from "./types";

// ---- Attributes -----------------------------------------------------------
// WoW-style attributes. Gear grants them; derived gameplay stats fall out of
// them (see deriveStats). Monsters have their own attributes too.
//   strength  — physical main stat (melee/tank ability damage)
//   intellect — caster main stat (spell ability damage) + healing power
//   stamina   — max HP
//   agility   — move speed (and the agility classes' main stat)
//   haste     — cooldown reduction (secondary)
//   crit      — critical-strike chance (secondary)
//   armor     — physical damage reduction
export type AttrKey = "strength" | "intellect" | "stamina" | "agility" | "haste" | "crit" | "armor";
export const ATTR_KEYS: AttrKey[] = ["strength", "intellect", "stamina", "agility", "haste", "crit", "armor"];
export type Attributes = Record<AttrKey, number>;

export function zeroAttrs(): Attributes {
  return { strength: 0, intellect: 0, stamina: 0, agility: 0, haste: 0, crit: 0, armor: 0 };
}
export function addAttrs(into: Attributes, more: Partial<Attributes>): Attributes {
  for (const k of ATTR_KEYS) into[k] += more[k] ?? 0;
  return into;
}

// Back-compat: pre-RPG-Phase-2 attribute keys, aliased onto the WoW names so
// persisted characters/items (stored with the old keys) still load with their
// stats intact across the deploy. Fresh items/characters never use the old keys.
const OLD_TO_NEW: Record<string, AttrKey> = {
  power: "strength",
  spirit: "intellect",
  vitality: "stamina",
  // agility / haste / armor kept their names; crit is new (defaults to 0).
};
// Normalize a possibly-legacy attrs blob to the current AttrKey set.
export function migrateAttrKeys(x: Record<string, unknown>): Partial<Attributes> {
  const out: Partial<Attributes> = {};
  for (const [k, v] of Object.entries(x)) {
    if (typeof v !== "number") continue;
    const key = (OLD_TO_NEW[k] ?? k) as AttrKey;
    if (ATTR_KEYS.includes(key)) out[key] = (out[key] ?? 0) + v;
  }
  return out;
}

// ---- Items + slots --------------------------------------------------------
// Where a character can equip things (Diablo/WoW style).
export type EquipSlot = "helmet" | "chest" | "legs" | "gloves" | "mainHand" | "offHand" | "ring1" | "ring2" | "amulet";
export const EQUIP_SLOTS: EquipSlot[] = ["helmet", "chest", "legs", "gloves", "mainHand", "offHand", "ring1", "ring2", "amulet"];

// What an item IS — drives which equip slot(s) accept it. `weapon` fits either
// hand; `ring` fits either ring slot; `bag` goes into a bag-equip slot;
// `consumable` is never equipped (carried-only; drink it via the useItem message).
export type ItemSlot = "helmet" | "chest" | "legs" | "gloves" | "weapon" | "ring" | "amulet" | "bag" | "consumable";
export type WeaponType = "axe" | "flail" | "shield" | "sword";
export type WeaponVisualRarity = "common" | "standard" | "rare" | "epic";
export const WEAPON_TYPES: WeaponType[] = ["axe", "flail", "shield", "sword"];

export function normalizeWeaponType(value: unknown): WeaponType | undefined {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return WEAPON_TYPES.includes(v as WeaponType) ? (v as WeaponType) : undefined;
}

export function weaponVisualRarity(rarity: Rarity): WeaponVisualRarity {
  switch (rarity) {
    case "common": return "common";
    case "rare": return "rare";
    case "epic":
    case "legendary": return "epic";
    case "uncommon":
    default: return "standard";
  }
}

export function normalizeWeaponVisualRarity(value: unknown): WeaponVisualRarity | undefined {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (v) {
    case "common":
    case "rare":
    case "epic":
    case "standard":
      return v;
    case "uncommon":
      return "standard";
    case "legendary":
      return "epic";
    default:
      return undefined;
  }
}

export interface Item {
  id: string;
  name: string;
  rarity: Rarity;
  slot: ItemSlot;
  attrs: Partial<Attributes>; // stat bonuses while equipped
  bagSlots?: number; // bags only: extra carry slots this container grants
  consumable?: { heal?: number; healPct?: number }; // consumables: effect on use (drink)
  weaponType?: WeaponType; // weapons only: drives equip slot + held model
  weaponRarity?: WeaponVisualRarity; // weapons only: maps existing rarities to GLB asset variants
  icon?: string;
  flavor?: string;
}

// Gold a piece of gear sells for, by rarity (shared so client can preview the
// price on the sell button). Tune freely — purely an economy knob.
const SELL_PRICE: Record<Rarity, number> = { common: 3, uncommon: 8, rare: 20, epic: 50, legendary: 120 };
export function sellValue(item: Item): number {
  return SELL_PRICE[item.rarity] ?? 1;
}

// ---- Inventory ------------------------------------------------------------
export const BASE_CARRY_SLOTS = 8; // the built-in backpack
export const BAG_EQUIP_SLOTS = 4; // how many bag containers you can equip

export interface Inventory {
  equipped: Partial<Record<EquipSlot, Item>>;
  bagEquip: (Item | null)[]; // length BAG_EQUIP_SLOTS — equipped bag containers
  carried: Item[]; // loose items; length <= carryCapacity(inv)
}

export function emptyInventory(): Inventory {
  return { equipped: {}, bagEquip: new Array(BAG_EQUIP_SLOTS).fill(null), carried: [] };
}

// Defensive rehydration of persisted blobs (a malformed/legacy row must never
// crash a join). Coerce to a valid shape, defaulting anything missing.
export function coerceAttrs(x: unknown): Attributes {
  const a = zeroAttrs();
  if (x && typeof x === "object") {
    addAttrs(a, migrateAttrKeys(x as Record<string, unknown>)); // maps legacy keys (power→strength, …)
  }
  return a;
}
// Normalize a persisted item: migrate its attrs keys so legacy gear keeps its stats.
function coerceItem<T>(it: T): T {
  if (it && typeof it === "object" && "attrs" in (it as object)) {
    const o = it as { attrs?: unknown };
    if (o.attrs && typeof o.attrs === "object") o.attrs = migrateAttrKeys(o.attrs as Record<string, unknown>);
  }
  if (it && typeof it === "object" && (it as { slot?: unknown }).slot === "weapon") {
    const o = it as Item;
    o.weaponType = normalizeWeaponType((o as { weaponType?: unknown }).weaponType) ?? inferWeaponType(o) ?? "sword";
    o.weaponRarity = normalizeWeaponVisualRarity((o as { weaponRarity?: unknown }).weaponRarity) ?? weaponVisualRarity(o.rarity);
  }
  return it;
}

function inferWeaponType(item: Pick<Item, "name">): WeaponType | undefined {
  const name = item.name.toLowerCase();
  if (name.includes("axe")) return "axe";
  if (name.includes("flail")) return "flail";
  if (name.includes("shield")) return "shield";
  if (name.includes("sword") || name.includes("blade")) return "sword";
  return undefined;
}
export function coerceInventory(x: unknown): Inventory {
  if (!x || typeof x !== "object") return emptyInventory();
  const o = x as Partial<Inventory>;
  const bagEquip = Array.isArray(o.bagEquip) ? o.bagEquip.slice(0, BAG_EQUIP_SLOTS) : [];
  while (bagEquip.length < BAG_EQUIP_SLOTS) bagEquip.push(null);
  const equipped = o.equipped && typeof o.equipped === "object" ? (o.equipped as Inventory["equipped"]) : {};
  for (const k of Object.keys(equipped) as EquipSlot[]) if (equipped[k]) coerceItem(equipped[k]);
  for (const b of bagEquip) if (b) coerceItem(b);
  const carried = Array.isArray(o.carried) ? (o.carried as Item[]) : [];
  for (const it of carried) coerceItem(it);
  return { equipped, bagEquip, carried };
}

export function carryCapacity(inv: Inventory): number {
  let cap = BASE_CARRY_SLOTS;
  for (const b of inv.bagEquip) if (b?.bagSlots) cap += b.bagSlots;
  return cap;
}
export function carriedFree(inv: Inventory): number {
  return carryCapacity(inv) - inv.carried.length;
}

// Every item the inventory holds — equipped gear, equipped bags, and loose
// items. Used to drop EVERYTHING into a loot bag on death.
export function allItems(inv: Inventory): Item[] {
  const out: Item[] = [];
  for (const s of EQUIP_SLOTS) {
    const it = inv.equipped[s];
    if (it) out.push(it);
  }
  for (const b of inv.bagEquip) if (b) out.push(b);
  out.push(...inv.carried);
  return out;
}

// Sum of base attributes + everything equipped (gear and bags can both carry
// stats). Loose carried items do NOT count — only what you're wearing.
export function aggregateAttrs(base: Attributes, inv: Inventory): Attributes {
  const total = { ...base };
  for (const s of EQUIP_SLOTS) {
    const it = inv.equipped[s];
    if (it) addAttrs(total, it.attrs);
  }
  for (const b of inv.bagEquip) if (b) addAttrs(total, b.attrs);
  return total;
}

// ---- Derived gameplay stats ----------------------------------------------
export interface DerivedStats {
  maxHp: number;
  moveSpeed: number; // px/s
  spellPower: number; // outgoing ability-damage multiplier (scales off the class MAIN stat)
  healPower: number; // outgoing heal multiplier (scales off intellect)
  cdMult: number; // cooldown multiplier (<= 1; lower = faster)
  critChance: number; // chance an ability hit crits, 0..critCap
  dr: number; // incoming physical damage reduction, 0..drCap
}

// Scaling factors (one place to balance). baseMaxHp/baseSpeed come from the
// ENTITY (players vs each monster kind differ), so this stays universal.
export const STAT = {
  hpPerStam: 8,
  speedPerAgi: 0.015, // +1.5% move speed per agility
  dmgPerMain: 0.04, // +4% ability damage per point of the class main stat
  healPerInt: 0.05, // +5% healing per intellect
  cdPerHaste: 0.03,
  critPerPoint: 0.012, // +1.2% crit chance per crit point
  critCap: 0.75,
  armorK: 60, // armor for ~50% DR
  drCap: 0.75,
};

// `mainStat` is the attribute that scales this entity's ability damage (its class
// main stat). Defaults to strength so unclassed players + monsters are unchanged.
export function deriveStats(baseMaxHp: number, baseSpeed: number, a: Attributes, mainStat: AttrKey = "strength"): DerivedStats {
  return {
    maxHp: baseMaxHp + a.stamina * STAT.hpPerStam,
    moveSpeed: baseSpeed * (1 + a.agility * STAT.speedPerAgi),
    spellPower: 1 + a[mainStat] * STAT.dmgPerMain,
    healPower: 1 + a.intellect * STAT.healPerInt,
    cdMult: 1 / (1 + a.haste * STAT.cdPerHaste),
    critChance: Math.min(STAT.critCap, a.crit * STAT.critPerPoint),
    dr: Math.min(STAT.drCap, a.armor / (a.armor + STAT.armorK)),
  };
}

// ---- Mutations (return ok/error; never throw) -----------------------------
export interface InvResult {
  ok: boolean;
  error?: string;
}

// Which equip slots a loose item can occupy (in preference order).
export function compatibleSlots(slot: ItemSlot): EquipSlot[] {
  switch (slot) {
    case "helmet": return ["helmet"];
    case "chest": return ["chest"];
    case "legs": return ["legs"];
    case "gloves": return ["gloves"];
    case "amulet": return ["amulet"];
    case "weapon": return ["mainHand", "offHand"];
    case "ring": return ["ring1", "ring2"];
    case "bag": return [];
    case "consumable": return []; // never equipped — drink it from the carry grid
  }
}

export function compatibleItemSlots(item: Item): EquipSlot[] {
  if (item.slot === "weapon") {
    const type = normalizeWeaponType(item.weaponType) ?? inferWeaponType(item) ?? "sword";
    return type === "shield" ? ["offHand"] : ["mainHand"];
  }
  return compatibleSlots(item.slot);
}

export function findCarried(inv: Inventory, itemId: string): number {
  return inv.carried.findIndex((i) => i.id === itemId);
}

// Put an item in the first free carry slot. False if the bag is full.
export function addItem(inv: Inventory, item: Item): boolean {
  if (carriedFree(inv) <= 0) return false;
  inv.carried.push(item);
  return true;
}

// Equip a carried item. Gear swaps with whatever's in the slot (1 out, 1 in, so
// capacity is preserved). Bags only equip into an EMPTY bag slot.
export function equip(inv: Inventory, itemId: string): InvResult {
  const idx = findCarried(inv, itemId);
  if (idx < 0) return { ok: false, error: "not in inventory" };
  const item = inv.carried[idx];

  if (item.slot === "bag") {
    const free = inv.bagEquip.findIndex((b) => b === null);
    if (free < 0) return { ok: false, error: "no free bag slot — unequip a bag first" };
    inv.carried.splice(idx, 1);
    inv.bagEquip[free] = item;
    return { ok: true };
  }

  coerceItem(item);
  const slots = compatibleItemSlots(item);
  if (slots.length === 0) return { ok: false, error: "not equippable" };
  const target = slots.find((s) => !inv.equipped[s]) ?? slots[0];
  const prev = inv.equipped[target];
  inv.carried.splice(idx, 1); // freed a slot
  inv.equipped[target] = item;
  if (prev) inv.carried.push(prev); // swap back into the freed slot
  return { ok: true };
}

// Move an equipped gear piece back to carry. Needs a free carry slot.
export function unequip(inv: Inventory, slot: EquipSlot): InvResult {
  const item = inv.equipped[slot];
  if (!item) return { ok: false, error: "slot is empty" };
  if (carriedFree(inv) <= 0) return { ok: false, error: "inventory full" };
  delete inv.equipped[slot];
  inv.carried.push(item);
  return { ok: true };
}

// Unequip a bag container. Removing it shrinks capacity, so it's refused if the
// remaining slots couldn't hold the current items plus the bag itself.
export function unequipBag(inv: Inventory, index: number): InvResult {
  const bag = inv.bagEquip[index];
  if (!bag) return { ok: false, error: "no bag there" };
  const freed = bag.bagSlots ?? 0;
  if (carriedFree(inv) - freed < 1) return { ok: false, error: "make room before unequipping that bag" };
  inv.bagEquip[index] = null;
  inv.carried.push(bag);
  return { ok: true };
}

// Remove an item from anywhere in the inventory (carried, gear, or bag slot).
export function removeAnywhere(inv: Inventory, itemId: string): Item | null {
  const ci = findCarried(inv, itemId);
  if (ci >= 0) return inv.carried.splice(ci, 1)[0];
  for (const s of EQUIP_SLOTS) {
    if (inv.equipped[s]?.id === itemId) {
      const it = inv.equipped[s]!;
      delete inv.equipped[s];
      return it;
    }
  }
  for (let i = 0; i < inv.bagEquip.length; i++) {
    if (inv.bagEquip[i]?.id === itemId) {
      const it = inv.bagEquip[i]!;
      inv.bagEquip[i] = null;
      return it;
    }
  }
  return null;
}
